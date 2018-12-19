'use strict';

/*
FortiGate Autoscale AWS Module (1.0.0-beta)
Author: Fortinet
*/
exports = module.exports;
const path = require('path');
const AWS = require('aws-sdk');
const AutoScaleCore = require('fortigate-autoscale-core');
const dbDefinitions = require('./db-definitions');

// lock the API versions
AWS.config.apiVersions = {
    autoscaling: '2011-01-01',
    ec2: '2016-11-15',
    lambda: '2015-03-31',
    dynamodb: '2012-08-10',
    apiGateway: '2015-07-09',
    s3: '2006-03-01'
};

const
    EXPIRE_LIFECYCLE_ENTRY = (process.env.EXPIRE_LIFECYCLE_ENTRY || 60 * 60) * 1000,
    autoScaling = new AWS.AutoScaling(),
    dynamodb = new AWS.DynamoDB(),
    docClient = new AWS.DynamoDB.DocumentClient(),
    ec2 = new AWS.EC2(),
    apiGateway = new AWS.APIGateway(),
    s3 = new AWS.S3(),
    unique_id = process.env.UNIQUE_ID.replace(/.*\//, ''),
    custom_id = process.env.CUSTOM_ID.replace(/.*\//, ''),
    SCRIPT_TIMEOUT = 300,
    DB = dbDefinitions.getTables(custom_id, unique_id),
    moduleId = AutoScaleCore.uuidGenerator(JSON.stringify(`${__filename}${Date.now()}`)),
    settingItems = AutoScaleCore.settingItems;

let logger = new AutoScaleCore.DefaultLogger();
// this variable is to store the anticipated script execution expire time (milliseconds)
let scriptExecutionExpireTime;
/**
 * Implements the CloudPlatform abstraction for the AWS api.
 */
class AwsPlatform extends AutoScaleCore.CloudPlatform {
    async init() {
        try {
            await Promise.all([
                this.tableExists(DB.AUTOSCALE),
                this.tableExists(DB.ELECTION),
                this.tableExists(DB.LIFECYCLEITEM)
            ]);
            return true;
        } catch (ex) {
            logger.warn('some tables are missing, script enters instance termination process');
            return false;
        }
    }

    async createTable(schema) {
        try {
            await dynamodb.describeTable({ TableName: schema.TableName }).promise();
            console.log('found table', schema.TableName);
        } catch (ex) {
            console.log('creating table ', schema.TableName);
            await dynamodb.createTable(schema).promise();
        }
        await dynamodb.waitFor('tableExists', { TableName: schema.TableName }).promise();
    }

    async tableExists(schema) {
        try {
            await dynamodb.describeTable({ TableName: schema.TableName }).promise();
            logger.log('found table', schema.TableName);
            return true;
        } catch (ex) {
            throw new Error(`table (${schema.TableName}) not exists!`);
        }
    }

    async createTables() {
        try {
            await Promise.all([
                this.createTable(DB.AUTOSCALE),
                this.createTable(DB.ELECTION),
                this.createTable(DB.LIFECYCLEITEM)
            ]);
            return true;
        } catch (ex) {
            logger.warn('some tables are unable to create. Please read logs for more information.');
            return false;
        }
    }

    // unfortunately we can't link up the api gateway id during CFT stack creation as it
    // would create a cycle. Grab it by looking up the rest api name passed as a parameter
    async getCallbackEndpointUrl() {
        let position,
            page;
        const
            gwName = process.env.API_GATEWAY_NAME,
            region = process.env.AWS_REGION,
            stage = process.env.API_GATEWAY_STAGE_NAME,
            resource = process.env.API_GATEWAY_RESOURCE_NAME;
        do {

            this._step = 'handler:getApiGatewayUrl:getRestApis';
            page = await apiGateway.getRestApis({
                position
            }).promise();
            position = page.position;
            const
                gw = page.items.find(i => i.name === gwName);
            if (gw) {
                return `https://${gw.id}.execute-api.${region}.amazonaws.com/` +
                    `${stage}/${resource}`;
            }
        } while (page.items.length);
        throw new Error(`Api Gateway not found looking for ${gwName}`);
    }

    /**
     * @override
     */
    async getLifecycleItems(instanceId) {
        logger.info(`calling getLifecycleItems, instanceId: ${instanceId}`);
        const query = {
                TableName: DB.LIFECYCLEITEM.TableName,
                KeyConditionExpression: '#InstanceId = :InstanceId',
                ExpressionAttributeNames: {
                    '#InstanceId': 'instanceId'
                },
                ExpressionAttributeValues: {
                    ':InstanceId': instanceId
                }
            },
            response = await docClient.query(query).promise(),
            items = response.Items;
        if (!items || !Array.isArray(items)) {
            logger.info('called getLifecycleItems. No pending lifecycle action.');
            return [];
        }
        logger.info('called getLifecycleItems. ' +
            `[${items.length}] pending lifecycle action. response: ${JSON.stringify(items)}`);
        return items.map(item => AutoScaleCore.LifecycleItem.fromDb(item));
    }
    /**
     * @param {LifecycleItem} item Item containing the data to store.
     */
    async updateLifecycleItem(item) {
        const params = {
            TableName: DB.LIFECYCLEITEM.TableName,
            Item: item.toDb()
        };
        return await docClient.put(params).promise();
    }

    /**
     * remove one life cycle action item hooked with an instance.
     * Abstract class method.
     * @param {LifecycleItem} item Item used by the platform to complete
     *  a lifecycleAction.
     */
    async removeLifecycleItem(item) {
        logger.info('calling removeLifecycleItem');
        return await docClient.delete({
            TableName: DB.LIFECYCLEITEM.TableName,
            Key: {
                instanceId: item.instanceId,
                actionName: item.actionName
            }
        }).promise();
    }

    /**
     * @override
     */
    async cleanUpDbLifeCycleActions(items = []) {
        try {
            const tableName = DB.LIFECYCLEITEM.TableName;
            if (!items || Array.isArray(items) && items.length === 0) {

                const
                    response = await docClient.scan({
                        TableName: tableName,
                        Limit: 5
                    })
                        .promise();
                items = response.Items;
                if (Array.isArray(items) && items.length) {
                    return await this.cleanUpDbLifeCycleActions(items);
                }
            } else {
                logger.info('calling cleanUpDbLifeCycleActions');
                let itemToRemove = [],
                    awaitAll = [];
                let remove = async item => {
                    return await this.removeLifecycleItem(item);
                };
                items.forEach(item => {
                    if (Date.now() - item.timestamp > EXPIRE_LIFECYCLE_ENTRY) {
                        awaitAll.push(remove(item));
                        itemToRemove.push(item);
                    }
                });
                await Promise.all(awaitAll);
                logger.info(`cleaned up items: ${JSON.stringify(itemToRemove)}`);
                return true;
            }
        } catch (ex) {
            console.error('Error while cleaning up (ignored):', ex);
        }
        return false;
    }

    async completeLifecycleAction(lifecycleItem, success) {
        logger.info('calling completeLifecycleAction');
        try {
            await this.updateLifecycleItem(lifecycleItem);
            var params = {
                AutoScalingGroupName: lifecycleItem.detail.AutoScalingGroupName,
                LifecycleActionResult: success ? 'CONTINUE' : 'ABANDON',
                LifecycleActionToken: lifecycleItem.detail.LifecycleActionToken,
                LifecycleHookName: lifecycleItem.detail.LifecycleHookName
                // InstanceId: event.instanceId
            };
            if (!process.env.DEBUG_MODE) {
                await autoScaling.completeLifecycleAction(params).promise();
            }
            // TODO: remove lifecycle Item here
            await this.removeLifecycleItem(lifecycleItem);
            logger.info(
                `[${params.LifecycleActionResult}] applied to hook[${params.LifecycleHookName}] with
            token[${params.LifecycleActionToken}] in auto-scaling group
            [${params.AutoScalingGroupName}]`);
            return true;
        } catch (error) {
            logger.error(`called completeLifecycleAction. error:${error.message}`);
            return false;
        }
    }

    /**
     * Get the master record from db
     * @returns {Object} Master record of the FortiGate which should be the auto-sync master
     */
    async getMasterRecord() {
        const
            params = {
                TableName: DB.ELECTION.TableName,
                FilterExpression: '#PrimaryKeyName = :primaryKeyValue',
                ExpressionAttributeNames: {
                    '#PrimaryKeyName': 'asgName'
                },
                ExpressionAttributeValues: {
                    ':primaryKeyValue': process.env.AUTO_SCALING_GROUP_NAME
                }
            },
            response = await docClient.scan(params).promise(),
            items = response.Items;
        if (!items || items.length === 0) {
            logger.info('No elected master was found in the db!');
            return null;
        }
        logger.info(`Elected master found: ${JSON.stringify(items[0])}`, JSON.stringify(items));
        return items[0];
    }

    /**
     * Remove the current master record from db.
     * Abstract class method.
     */
    async removeMasterRecord() {
        // only purge the master with a done votestate to avoid a
        // race condition
        const params = {
            TableName: DB.ELECTION.TableName,
            Key: { asgName: process.env.AUTO_SCALING_GROUP_NAME },
            ConditionExpression: '#AsgName = :asgName AND #voteState = :voteState',
            ExpressionAttributeNames: {
                '#AsgName': 'asgName',
                '#voteState': 'voteState'
            },
            ExpressionAttributeValues: {
                ':asgName': process.env.AUTO_SCALING_GROUP_NAME,
                ':voteState': 'done'
            }
        };
        return await docClient.delete(params).promise();
    }

    async finalizeMasterElection() {
        try {
            logger.info('calling finalizeMasterElection');
            let electedMaster = await this.getMasterRecord();
            electedMaster.voteState = 'done';
            const params = {
                TableName: DB.ELECTION.TableName,
                Item: electedMaster
            };
            let result = await docClient.put(params).promise();
            logger.info(`called finalizeMasterElection, result: ${JSON.stringify(result)}`);
            return result;
        } catch (ex) {
            logger.warn('called finalizeMasterElection, error:', ex.stack);
            return false;
        }
    }


    /**
     * get the health check info about an instance been monitored.
     * @param {Object} instance instance object which a vmId property is required.
     * @param {Number} heartBeatInterval integer value, unit is second.
     */
    async getInstanceHealthCheck(instance, heartBeatInterval) {
        if (!(instance && instance.instanceId)) {
            logger.error('getInstanceHealthCheck > error: no instanceId property found' +
                ` on instance: ${JSON.stringify(instance)}`);
            return Promise.reject(`invalid instance: ${JSON.stringify(instance)}`);
        }
        var params = {
            Key: {
                instanceId: instance.instanceId
            },
            TableName: DB.AUTOSCALE.TableName
        };
        try {
            let compensatedScriptTime,
                healthy,
                heartBeatLossCount,
                data = await docClient.get(params).promise();
            if (data.Item) {
                // to get a more accurate heart beat elapsed time, the script execution time so far
                // is compensated.
                compensatedScriptTime = process.env.SCRIPT_EXECUTION_TIME_CHECKPOINT;
                healthy = compensatedScriptTime < data.Item.nextHeartBeatTime;
                if (compensatedScriptTime < data.Item.nextHeartBeatTime) {
                    // reset hb loss cound if instance sends hb within its interval
                    healthy = true;
                    heartBeatLossCount = 0;
                } else {
                    // consider instance as health if hb loss < 3
                    healthy = data.Item.heartBeatLossCount < 3;
                    heartBeatLossCount = data.Item.heartBeatLossCount + 1;
                }
                logger.info('called getInstanceHealthCheck');
                return {
                    instanceId: instance.instanceId,
                    healthy: healthy,
                    heartBeatLossCount: heartBeatLossCount,
                    nextHeartBeatTime: Date.now() + heartBeatInterval * 1000,
                    masterIp: data.Item.masterIp,
                    syncState: data.Item.syncState,
                    inSync: data.Item.syncState === 'in-sync'
                };
            } else {
                logger.info('called getInstanceHealthCheck: no record found');
                return null;
            }
        } catch (error) {
            logger.info('called getInstanceHealthCheck with error. ' +
                `error: ${JSON.stringify(error)}`);
            return null;
        }
    }

    /**
     * update the instance health check result to DB.
     * @param {Object} healthCheckObject update based on the healthCheckObject got by return from
     * getInstanceHealthCheck
     * @param {Number} heartBeatInterval the expected interval (second) between heartbeats
     * @param {String} masterIp the current master ip in auto-scaling group
     * @param {Number} checkPointTime the check point time of when the health check is performed.
     * @param {bool} forceOutOfSync whether force to update this record as 'out-of-sync'
     * @returns {bool} resul: true or false
     */
    async updateInstanceHealthCheck(healthCheckObject, heartBeatInterval, masterIp, checkPointTime,
        forceOutOfSync = false) {
        if (!(healthCheckObject && healthCheckObject.instanceId)) {
            logger.error('updateInstanceHealthCheck > error: no instanceId property found' +
                ` on healthCheckObject: ${JSON.stringify(healthCheckObject)}`);
            return Promise.reject('invalid healthCheckObject: ' +
            `${JSON.stringify(healthCheckObject)}`);
        }
        try {
            let params = {
                Key: {instanceId: healthCheckObject.instanceId},
                TableName: DB.AUTOSCALE.TableName,
                UpdateExpression: 'set heartBeatLossCount = :HeartBeatLossCount, ' +
                    'nextHeartBeatTime = :NextHeartBeatTime, ' +
                    'masterIp = :MasterIp, syncState = :SyncState',
                ExpressionAttributeValues: {
                    ':HeartBeatLossCount': healthCheckObject.heartBeatLossCount,
                    ':NextHeartBeatTime': checkPointTime + heartBeatInterval * 1000,
                    ':MasterIp': masterIp,
                    ':SyncState': healthCheckObject.healthy && !forceOutOfSync ? 'in-sync' :
                        'out-of-sync'
                },
                ConditionExpression: 'attribute_exists(instanceId)'
            };
            if (!forceOutOfSync) {
                params.ConditionExpression += ' AND syncState = :SyncState';
            }
            let result = await docClient.update(params).promise();
            logger.info('called updateInstanceHealthCheck');
            return !!result;
        } catch (error) {
            logger.info('called updateInstanceHealthCheck with error. ' +
                `error: ${JSON.stringify(error)}`);
            return Promise.reject(error);
        }
    }

    /**
     * delete the instance health check monitoring record from DB.
     * Abstract class method.
     * @param {Object} instanceId the instanceId of instance
     * @returns {bool} resul: true or false
     */
    async deleteInstanceHealthCheck(instanceId) {
        try {
            let params = {
                TableName: DB.AUTOSCALE.TableName,
                Key: { instanceId: instanceId }
            };
            let result = await docClient.delete(params).promise();
            return !!result;
        } catch (error) {
            logger.warn('called deleteInstanceHealthCheck. error:', error);
            return false;
        }
    }


    /**
     * Get information about an instance by the given parameters.
     * @param {Object} parameters parameters accepts: instanceId, privateIp, publicIp
     */
    async describeInstance(parameters) {
        logger.info('calling describeInstance');
        let params = { Filters: [] };
        if (parameters.instanceId) {
            params.Filters.push({
                Name: 'instance-id',
                Values: [parameters.instanceId]
            });
        }
        if (parameters.publicIp) {
            params.Filters.push({
                Name: 'ip-address',
                Values: [parameters.publicIp]
            });
        }
        if (parameters.privateIp) {
            params.Filters.push({
                Name: 'private-ip-address',
                Values: [parameters.privateIp]
            });
        }
        const result = await ec2.describeInstances(params).promise();
        logger.info(`called describeInstance, result: ${JSON.stringify(result)}`);
        return result.Reservations[0] && result.Reservations[0].Instances[0];
    }

    async findInstanceIdByIp(localIp) {
        if (!localIp) {
            throw new Error('Cannot find instance by Ip because ip is invalid: ', localIp);
        }
        const params = {
            Filters: [{
                Name: 'private-ip-address',
                Values: [localIp]
            }]
        };
        const result = await ec2.describeInstances(params).promise();
        logger.log(localIp, 'DescribeInstances', result);
        const instance = result.Reservations[0] && result.Reservations[0].Instances[0];
        return instance && instance.InstanceId;
    }

    /**
     * Extract useful info from request event.
     * @param {Object} request the request event
     * @returns {Array} an array of required info per platform.
     */
    extractRequestInfo(request) {
        let instanceId = null,
            interval = null,
            status = null;

        if (request && request.headers && request.headers['Fos-instance-id']) {
            instanceId = request.headers['Fos-instance-id'];
        } else if (request && request.body) {
            try {
                let jsonBodyObject = JSON.parse(request.body);
                instanceId = jsonBodyObject.instance;
                interval = jsonBodyObject.interval;
                status = jsonBodyObject.status;
            } catch (ex) {
                logger.info('calling extractRequestInfo: unexpected body content format ' +
                    `(${request.body})`);
            }
        } else {
            logger.error('calling extractRequestInfo: no request body found.');
        }
        logger.info(`called extractRequestInfo: extracted: instance Id(${instanceId}), ` +
            `interval(${interval}), status(${status})`);
        return { instanceId, interval, status };
    }

    async protectInstanceFromScaleIn(asgName, item, protect = true) {
        const
            MAX_TRIES = 10,
            // Delay the attempt to setInstanceProtection because it takes around a second
            // for autoscale to switch the instance to `InService` status.
            PROTECT_DELAY = 2000;
        let count = 0;
        while (true) { // eslint-disable-line no-constant-condition
            try {
                await runAfter(PROTECT_DELAY, () => autoScaling.setInstanceProtection({
                    AutoScalingGroupName: asgName,
                    InstanceIds: [item.instanceId],
                    ProtectedFromScaleIn: protect !== false
                }).promise());
                return true;
            } catch (ex) {
                if (/\bnot in InService\b/.test(ex.message) && count < MAX_TRIES) {
                    ++count;
                    logger.log(`${ex.message} while protecting ${item.instanceId}:
                        (trying again ${count}/${MAX_TRIES})`);
                } else {
                    throw ex;
                }
            }
        }

        function runAfter(interval, callback) {
            const precision = Math.max(0, 3 - Math.log10(interval / 100));
            logger.log(`Delaying for ${(interval / 1000).toFixed(precision)}s > `,
                callback.toString()
                    .replace(/.*(?:function|=>)\s*(.*?)(?:[(\n]|$)(?:\n|.)*/, '$1'));
            return new Promise(resolve => setTimeout(() => resolve(callback()), interval));
        }
    }

    async createNetworkInterface(parameters) {
        try {
            logger.info('called createNetworkInterface');
            let result = await ec2.createNetworkInterface(parameters).promise();
            return result && result.NetworkInterface;
        } catch (error) {
            logger.warn(`called createNetworkInterface. failed.(error: ${JSON.stringify(error)})`);
            return false;
        }
    }

    async deleteNetworkInterface(parameters) {
        try {
            logger.info('called deleteNetworkInterface');
            return await ec2.deleteNetworkInterface(parameters).promise();
        } catch (error) {
            logger.warn(`called deleteNetworkInterface. failed.(error: ${JSON.stringify(error)})`);
            return false;
        }
    }

    async describeNetworkInterface(parameters) {
        try {
            logger.info('called describeNetworkInterface');
            let result = await ec2.describeNetworkInterfaces(parameters).promise();
            return result && result.NetworkInterfaces && result.NetworkInterfaces[0];
        } catch (error) {
            logger.warn('called describeNetworkInterface. ' +
            `failed.(error: ${JSON.stringify(error)})`);
            return false;
        }
    }

    async attachNetworkInterface(instance, nic) {
        logger.info('calling attachNetworkInterface');
        if (!instance || !instance.NetworkInterfaces) {
            logger.warn(`invalid instance: ${JSON.stringify(instance)}`);
            return false;
        } else if (!nic) {
            logger.warn(`invalid network interface controller: ${JSON.stringify(nic)}`);
            return false;
        }
        try {
            let params = {
                DeviceIndex: instance.NetworkInterfaces.length,
                InstanceId: instance.InstanceId,
                NetworkInterfaceId: nic.NetworkInterfaceId
            };
            await ec2.attachNetworkInterface(params).promise();
            let promiseEmitter = () => {
                    return ec2.describeNetworkInterfaces({
                        NetworkInterfaceIds: [nic.NetworkInterfaceId]
                    }).promise();
                },
                validator = result => {
                    return result && result.NetworkInterfaces && result.NetworkInterfaces[0] &&
                        result.NetworkInterfaces[0].Attachment &&
                        result.NetworkInterfaces[0].Attachment.Status === 'attached';
                };
            let result = await AutoScaleCore.waitFor(promiseEmitter, validator);
            logger.info('called attachNetworkInterface. ' +
                `done.(attachment id: ${result.NetworkInterfaces[0].Attachment.AttachmentId})`);
            return result.NetworkInterfaces[0].Attachment.AttachmentId;
        } catch (error) {
            await this.deleteNicAttachmentRecord(instance.InstanceId, 'pending_attach');
            logger.warn(`called attachNetworkInterface. failed.(error: ${JSON.stringify(error)})`);
            return false;
        }
    }

    async detachNetworkInterface(instance, nic) {
        logger.info('calling detachNetworkInterface');
        if (!instance || !instance.NetworkInterfaces) {
            logger.warn(`invalid instance: ${JSON.stringify(instance)}`);
            return false;
        } else if (!nic) {
            logger.warn(`invalid network interface controller: ${JSON.stringify(nic)}`);
            return false;
        }
        let attachedNic = instance.NetworkInterfaces.some(item => {
            return item.NetworkInterfaceId === nic.NetworkInterfaceId;
        });
        if (!attachedNic) {
            logger.warn(`nic(id: ${nic.NetworkInterfaceId}) is not attached to ` +
                `instance(id: ${instance.InstanceId})`);
            return false;
        }
        try {
            let params = {
                AttachmentId: nic.Attachment.AttachmentId
            };
            await ec2.detachNetworkInterface(params).promise();
            let promiseEmitter = () => {
                    return ec2.describeNetworkInterfaces({
                        NetworkInterfaceIds: [nic.NetworkInterfaceId]
                    }).promise();
                },
                validator = result => {
                    return result && result.NetworkInterfaces && result.NetworkInterfaces[0] &&
                    result.NetworkInterfaces[0] &&
                    result.NetworkInterfaces[0].Status === 'available';
                };
            let result = await AutoScaleCore.waitFor(promiseEmitter, validator);
            logger.info('called detachNetworkInterface. ' +
                `done.(nic status: ${result.NetworkInterfaces[0].Status})`);
            return result.NetworkInterfaces[0].Status === 'available';
        } catch (error) {
            logger.warn(`called detachNetworkInterface. failed.(error: ${JSON.stringify(error)})`);
            return false;
        }
    }

    async getNicAttachmentRecord(instanceId) {
        let params = {
            TableName: DB.NICATTACHMENT.TableName,
            Key: { instanceId: instanceId }
        };
        try {
            let result = await docClient.get(params).promise();
            return result && result.Item;
        } catch (error) {
            return null;
        }
    }

    async updateNicAttachmentRecord(instanceId, nicId, state, conditionState = null) {
        let params = {
            Key: {instanceId: instanceId},
            TableName: DB.NICATTACHMENT.TableName
        };
        if (conditionState) {
            params.UpdateExpression = 'set nicId = :NicId, attachmentState = :State';
            params.ExpressionAttributeValues = {
                ':NicId': nicId,
                ':State': state
            };
            return await docClient.update(params).promise();
        } else {
            params.Item = {
                instanceId: instanceId,
                nicId: nicId,
                attachmentState: state
            };
            params.ConditionExpression = 'attribute_not_exists(instanceId)';
            return await docClient.put(params).promise();
        }
    }

    async deleteNicAttachmentRecord(instanceId, conditionState = null) {
        let params = {
            TableName: DB.NICATTACHMENT.TableName,
            Key: { instanceId: instanceId }
        };
        if (conditionState) {
            params.ConditionExpression = 'attachmentState = :State';
            params.ExpressionAttributeValues = { ':State': conditionState };
        }
        try {
            return await docClient.delete(params).promise();
        } catch (error) {
            return error;
        }
    }

    async getSettingItem(key) {
        let params = {
            TableName: DB.SETTINGS.TableName,
            Key: { settingKey: key }
        };
        try {
            let result = await docClient.get(params).promise();
            if (result && result.Item) {
                return JSON.parse(result.Item.settingValue);
            }
        } catch (error) {
            return null;
        }
    }

    async setSettingItem(key, jsonValue) {
        var params = {
            Item: {
                settingKey: key,
                settingValue: JSON.stringify(jsonValue)
            },
            TableName: DB.SETTINGS.TableName
        };
        return !!await docClient.put(params).promise();
    }
    // end of awsPlatform class
}

class AwsAutoscaleHandler extends AutoScaleCore.AutoscaleHandler {
    constructor(platform = new AwsPlatform(), baseConfig = '') {
        super(platform, baseConfig);
        this._step = '';
        this._selfInstance = null;
        this._masterRecord = null;
    }

    async init() {
        const success = await this.platform.init();
        // retrieve base config from an S3 bucket
        this._baseConfig = await this.getBaseConfig();
        return success;
    }

    async handle(event, context, callback) {
        this._step = 'initializing';
        let proxyMethod = 'httpMethod' in event && event.httpMethod, result;
        try {
            const platformInitSuccess = await this.init();
            // enter instance termination process if cannot init for any reason
            if (!platformInitSuccess) {
                result = 'fatal error, cannot initialize.';
                logger.error(result);
                callback(null, proxyResponse(500, result));
            } else if (event.source === 'aws.autoscaling') {
                this._step = 'aws.autoscaling';
                result = await this.handleAutoScalingEvent(event);
                callback(null, proxyResponse(200, result));
            } else if (proxyMethod === 'POST') {
                this._step = 'fortigate:handleSyncedCallback';
                // authenticate the calling instance
                const instanceId = this.getCallingInstanceId(event);
                if (!instanceId) {
                    callback(null, proxyResponse(403, 'Instance id not provided.'));
                    return;
                }
                result = await this.handleSyncedCallback(event);
                callback(null, proxyResponse(200, result));
            } else if (proxyMethod === 'GET') {
                this._step = 'fortigate:getConfig';
                result = await this.handleGetConfig(event);
                callback(null, proxyResponse(200, result));
            } else {
                this._step = '¯\\_(ツ)_/¯';

                logger.log(`${this._step} unexpected event!`, event);
                // probably a test call from the lambda console?
                // should do nothing in response
            }

        } catch (ex) {
            if (ex.message) {
                ex.message = `${this._step}: ${ex.message}`;
            }
            try {
                console.error('ERROR while ', this._step, proxyMethod, ex);
            } catch (ex2) {
                console.error('ERROR while ', this._step, proxyMethod, ex.message, ex, ex2);
            }
            if (proxyMethod) {
                callback(null,
                    proxyResponse(500, {
                        message: ex.message,
                        stack: ex.stack
                    }));
            } else {
                callback(ex);
            }
        }

        function proxyResponse(statusCode, res) {
            const response = {
                statusCode,
                headers: {},
                body: typeof res === 'string' ? res : JSON.stringify(res),
                isBase64Encoded: false
            };
            return response;
        }

    }

    /**
     * Submit an election vote for this ip address to become the master.
     * @param {Object} candidateInstance instance of the FortiGate which wants to become the master
     * @param {Object} purgeMasterRecord master record of the old master, if it's dead.
     */
    async putMasterElectionVote(candidateInstance, purgeMasterRecord = null) {
        try {
            // TODO: call platform.saveElectionRecord
            const params = {
                TableName: DB.ELECTION.TableName,
                Item: {
                    asgName: process.env.AUTO_SCALING_GROUP_NAME,
                    ip: candidateInstance.PrivateIpAddress,
                    instanceId: candidateInstance.InstanceId,
                    vpcId: candidateInstance.VpcId,
                    subnetId: candidateInstance.SubnetId,
                    voteState: 'pending'
                },
                ConditionExpression: 'attribute_not_exists(asgName)'
            };
            logger.log('masterElectionVote, purge master?', JSON.stringify(purgeMasterRecord));
            if (purgeMasterRecord) {
                try {
                    const purged = await this.purgeMaster();
                    logger.log('purged: ', purged);
                } catch (error) {
                    logger.log('no master purge');
                }
            } else {
                logger.log('no master purge');
            }
            return !!await docClient.put(params).promise();
        } catch (ex) {
            console.warn('exception while putMasterElectionVote',
                JSON.stringify(candidateInstance), JSON.stringify(purgeMasterRecord), ex.stack);
            return false;
        }
    }

    async checkMasterElection() {
        let masterInfo,
            masterHealthCheck,
            needElection = false,
            purgeMaster = false,
            electionLock = false,
            electionComplete = false;

        // is there a master election done?
        // check the master record and its voteState
        //
        this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
        // if there's a complete election, get master health check
        if (this._masterRecord && this._masterRecord.voteState === 'done') {
        // get the current master info
            masterInfo = await this.getMasterInfo();
            // get current master heart beat record
            if (masterInfo) {
                masterHealthCheck =
                await this.platform.getInstanceHealthCheck({
                    instanceId: masterInfo.InstanceId
                });
            }
            // if master is unhealthy, we need a new election
            if (!masterHealthCheck || !masterHealthCheck.healthy || !masterHealthCheck.inSync) {
                purgeMaster = needElection = true;
            } else {
                purgeMaster = needElection = false;
            }
        } else if (this._masterRecord && this._masterRecord.voteState === 'pending') {
        // if there's a pending master election, and if this election is incomplete by the end-time,
        // purge this election and starta new master election. otherwise, wait until it's finished
            needElection = purgeMaster = Date.now() > this._masterRecord.voteEndTime;
        } else {
        // if no master, try to hold a master election
            needElection = true;
            purgeMaster = false;
        }
        // if we need a new master, let's hold a master election!
        if (needElection) {
        // can I run the election? (diagram: anyone's holding master election?)
        // try to put myself as the master candidate
            electionLock = await this.putMasterElectionVote(this._selfInstance, purgeMaster);
            if (electionLock) {
            // yes, you run it!
                logger.info(`This instance (id: ${this._selfInstance.InstanceId})` +
                ' is running an election.');
                try {
                // (diagram: elect new master from queue (existing instances))
                    electionComplete = await this.electMaster();
                    logger.info(`Election completed: ${electionComplete}`);
                    // (diagram: master exists?)
                    masterInfo = electionComplete && await this.getMasterInfo();
                } catch (error) {
                    logger.error('Something went wrong in the master election.');
                }
            }
        }
        return Promise.resolve(masterInfo);
    }

    async electMaster() {
        // return the current master record
        return !!await this.platform.getMasterRecord();
    }

    async getConfigSetFromS3(configName) {
        let data = await s3.getObject({
            Bucket: process.env.STACK_ASSETS_S3_BUCKET_NAME,
            Key: path.join(process.env.STACK_ASSETS_S3_KEY_PREFIX, 'configset', configName)
        }).promise();

        return data && data.Body && data.Body.toString('ascii');
    }

    async getFazIp() {
        try {
            let keyValue = settingItems.FortiAnalyzerSettingItem.SETTING_KEY;
            const query = {
                    TableName: DB.SETTINGS.TableName,
                    KeyConditionExpression: '#SettingKey = :SettingKey',
                    ExpressionAttributeNames: {
                        '#SettingKey': 'settingKey'
                    },
                    ExpressionAttributeValues: {
                        ':SettingKey': keyValue
                    }
                },
                response = await docClient.query(query).promise();
            if (response.Items && Array.isArray(response.Items) && response.Items.length === 1) {
                let settingItem = settingItems.FortiAnalyzerSettingItem.fromDb(response.Items[0]);
                return settingItem.vip;
            } else {
                return null;
            }
        } catch (error) {
            return null;
        }

    }
    /**
     * @override
     */
    async getBaseConfig() {
        let baseConfig = await this.getConfigSetFromS3('baseconfig');
        let psksecret = process.env.FORTIGATE_PSKSECRET,
            fazConfig = '',
            fazIp;
        if (baseConfig) {
            // check if other config set are required
            let requiredConfigSet = process.env.REQUIRED_CONFIG_SET.split(',');
            let configContent = '';
            for (let configset of requiredConfigSet) {
                let [name, selected] = configset.trim().split('-');
                if (selected.toLowerCase() === 'yes') {
                    switch (name) {
                        // handle https routing policy
                        case 'httpsroutingpolicy':
                            configContent += await this.getConfigSetFromS3('internalelbweb');
                            configContent += await this.getConfigSetFromS3(name);
                            break;
                        // handle fortianalyzer logging config
                        case 'storelogtofaz':
                            fazConfig = await this.getConfigSetFromS3(name);
                            fazIp = await this.getFazIp();
                            configContent += fazConfig.replace(
                                new RegExp('{FAZ_PRIVATE_IP}', 'gm'), fazIp);
                            break;
                        default:
                            break;
                    }
                }
            }
            baseConfig += configContent;

            baseConfig = baseConfig
                .replace(new RegExp('{SYNC_INTERFACE}', 'gm'),
                    process.env.FORTIGATE_SYNC_INTERFACE ?
                        process.env.FORTIGATE_SYNC_INTERFACE : 'port1')
                .replace(new RegExp('{ASSOCIATED_INTERFACE}', 'gm'),
                    process.env.FORTIGATE_SYNC_INTERFACE ?
                        process.env.FORTIGATE_SYNC_INTERFACE : 'port1')
                .replace(new RegExp('{PSK_SECRET}', 'gm'), psksecret)
                .replace(new RegExp('{TRAFFIC_PORT}', 'gm'),
                    process.env.FORTIGATE_TRAFFIC_PORT ? process.env.FORTIGATE_TRAFFIC_PORT : 443)
                .replace(new RegExp('{ADMIN_PORT}', 'gm'),
                    process.env.FORTIGATE_ADMIN_PORT ? process.env.FORTIGATE_ADMIN_PORT : 8443)
                .replace(new RegExp('{INTERNAL_ELB_DNS}', 'gm'),
                    process.env.FORTIGATE_INTERNAL_ELB_DNS ?
                        process.env.FORTIGATE_INTERNAL_ELB_DNS : '');
        }
        return baseConfig;
    }

    // override
    async getMasterConfig(callbackUrl) {
        // no dollar sign in place holders
        return await this._baseConfig.replace(/\{CALLBACK_URL}/, callbackUrl);
    }

    async getMasterInfo() {
        logger.info('calling getMasterInfo');
        let masterIp;
        try {
            this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
            masterIp = this._masterRecord && this._masterRecord.ip;
        } catch (ex) {
            logger.error(ex);
        }
        return this._masterRecord && await this.platform.describeInstance({ privateIp: masterIp });
    }

    /* ==== Sub-Handlers ==== */

    /* eslint-disable max-len */
    /**
     * Store the lifecycle transition event details for use later.
     * @param {AWS.Event} event Event who's source is 'aws.autoscaling'.
     * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/EventTypes.html#auto_scaling_event_types
     */
    /* eslint-enable max-len */
    async handleAutoScalingEvent(event) {
        logger.info(`calling handleAutoScalingEvent: ${event['detail-type']}`);
        let result;
        switch (event['detail-type']) {
            case 'EC2 Instance-launch Lifecycle Action':
                if (event.detail.LifecycleTransition === 'autoscaling:EC2_INSTANCE_LAUNCHING') {
                    await this.platform.cleanUpDbLifeCycleActions();
                    result = await this.handleLaunchingInstanceHook(event);
                }
                break;
            case 'EC2 Instance-terminate Lifecycle Action':
                if (event.detail.LifecycleTransition === 'autoscaling:EC2_INSTANCE_TERMINATING') {

                    await this.platform.cleanUpDbLifeCycleActions();
                    result = await this.handleTerminatingInstanceHook(event);

                }
                break;
            case 'EC2 Instance Launch Successful':
                // attach nic2
                result = await this.handleNicAttachment(event);
                break;
            case 'EC2 Instance Terminate Successful':
                // detach nic2
                result = await this.handleNicDetachment(event);
                break;
            default:
                logger.warn(`Ignore autoscaling event type: ${event['detail-type']}`);
                break;
        }
        return result;
    }

    /* eslint-disable max-len */
    /**
     * Handle the 'auto-scale synced' callback from the FortiGate.
     * @param {AWS.ProxyIntegrationEvent} event Event from the api-gateway.
     * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format // eslint-disable-line max-len
     */
    /* eslint-enable max-len */
    async handleSyncedCallback(event) {
        const { instanceId, interval, status } =
            this.platform.extractRequestInfo(event),
            statusSuccess = status && status === 'success' || false;
        // if fortigate is sending callback in response to obtaining config, this is a state
        // message
        let parameters = {}, selfHealthCheck, masterHealthCheck, result;

        parameters.instanceId = instanceId;
        // get selfinstance
        this._selfInstance = this._selfInstance || await this.platform.describeInstance(parameters);
        // handle hb monitor
        // get master instance monitoring
        let masterInfo = await this.getMasterInfo();
        if (masterInfo) {
            masterHealthCheck = await this.platform.getInstanceHealthCheck({
                instanceId: masterInfo.InstanceId
            }, interval);
        }
        // if this instance is the unhealthy master, don't hold a master election
        if (masterInfo && this._selfInstance.InstanceId === masterInfo.InstanceId &&
            !masterHealthCheck.healthy) {
            // use master health check result as self health check result
            selfHealthCheck = masterHealthCheck;
        } else if (!(masterInfo && masterHealthCheck && masterHealthCheck.healthy)) {
            // if no master or master is unhealthy
            // TODO: hold a master election
            let promiseEmitter = this.checkMasterElection(),
                validator = result => {
                    // if i am the new master, don't wait, continue, if not, wait
                    if (result &&
                        result.PrivateIpAddress === this._selfInstance.PrivateIpAddress) {
                        return true;
                    } else if (this._masterRecord && this._masterRecord.voteState === 'pending') {
                        this._masterRecord = null;
                    }
                    return false;
                },
                counter = () => {
                    if (Date.now() < scriptExecutionExpireTime - 3000) {
                        return false;
                    }
                    logger.warn('script execution is about to expire');
                    return true;
                };

            try {
                masterInfo = AutoScaleCore.waitFor(promiseEmitter, validator, 5000, counter);
            } catch (error) {
                // if error occurs, check who is holding a master election, if it is this instance,
                // terminates this election. then continue
                this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
                if (this._masterRecord.instanceId === this._selfInstance.InstanceId) {
                    await this.platform.removeMasterRecord();
                }
                await this.terminateInstanceInAutoScalingGroup(this._selfInstance);
                throw new Error(`Failed to determine the master instance within ${SCRIPT_TIMEOUT}` +
                    ' seconds. This instance is unable to bootstrap. Please report this to' +
                    ' administrators.');
            }
        }

        // check if myself is under health check monitoring
        // (master instance itself may have got its healthcheck result previously)
        selfHealthCheck = selfHealthCheck || await this.platform.getInstanceHealthCheck({
            instanceId: this._selfInstance.InstanceId
        }, interval);
        // if no record found, this instance not under monitor. should make sure its all
        // lifecycle actions are complete before starting to monitor it.
        // the success status indicates that the instance acknowledge its config and start to
        // send heart beat regularly
        // for those instance cannot send heart beat correctly, termination will be triggered by
        // default when their lifecycle action expired.
        if (statusSuccess) {
            // for master instance, if it comes up correctly, it will finalize the master election.
            if (this._selfInstance.InstanceId === masterInfo.InstanceId) {
                let electionFinalized = await this.platform.finalizeMasterElection();
                // if election couldn't be finalized, remove the current election so someone else
                // could start another election
                if (!electionFinalized) {
                    await this.platform.removeMasterRecord();
                }
                // if election could not be finalized, this master instance is abandonned too.
                await this.completeGetConfigLifecycleAction(this._selfInstance.InstanceId,
                    statusSuccess && electionFinalized);
            } else {
                // for slave instance, complete its lifecycle action
                await this.completeGetConfigLifecycleAction(this._selfInstance.InstanceId,
                    statusSuccess);
            }
        }
        if (!selfHealthCheck) {
            await this.addInstanceToMonitor(this._selfInstance,
                Date.now() + interval * 1000);
            logger.info(`instance (id:${this._selfInstance.InstanceId}, ` +
                `ip: ${this._selfInstance.PrivateIpAddress}) is added to monitor.`);
            return '';
        } else {
            // if instance is health
            if (selfHealthCheck.healthy) {
                await this.platform.updateInstanceHealthCheck(selfHealthCheck, interval,
                    masterInfo.InstanceId, Date.now());
                logger.info(`instance (id:${this._selfInstance.InstanceId}, ` +
                `ip: ${this._selfInstance.PrivateIpAddress}) health check ` +
                `(${selfHealthCheck.healthy ? 'healthy' : 'unhealthy'}, ` +
                `heartBeatLossCount: ${selfHealthCheck.heartBeatLossCount}, ` +
                `nextHeartBeatTime: ${selfHealthCheck.nextHeartBeatTime}).` +
                `syncState: ${selfHealthCheck.syncState}`);
                return '';
            } else {
                // for unhealthy instance
                // if it is previously on 'in-sync' state, mark it as 'out-of-sync' so script is
                // not going to keep it in sync any more.
                if (selfHealthCheck.inSync) {
                    // change its sync state to 'out of sync' by updating it state one last time
                    await this.platform.updateInstanceHealthCheck(selfHealthCheck, interval,
                        masterInfo.InstanceId, Date.now(), true);
                    // terminate it from auto-scaling group
                    await this.terminateInstanceInAutoScalingGroup(this._selfInstance);
                }
                // if instance is out of sync, respond with action 'shutdown'
                return {
                    action: 'shutdown'
                };
            }
        }
    }

    async completeGetConfigLifecycleAction(instanceId, success) {
        logger.info('calling completeGetConfigLifecycleAction');
        let items = await this.platform.getLifecycleItems(instanceId);
        items = items.filter(item => {
            return item.actionName === AutoScaleCore.LifecycleItem.ACTION_NAME_GET_CONFIG;
        });
        if (Array.isArray(items) && items.length === 1 && !items[0].done) {
            items[0].done = true;
            let complete = await this.platform.completeLifecycleAction(items[0], success);
            logger.info(`called completeGetConfigLifecycleAction. complete: ${complete}`);
            return items[0];
        } else {
            return items && items[0];
        }
    }

    async handleLaunchingInstanceHook(event) {
        logger.info('calling handleLaunchingInstanceHook');
        let result;
        // add an additional nic to instance
        result = await this.handleNicAttachment(event);
        if (result) {
            const instanceId = event.detail.EC2InstanceId,
                item = new AutoScaleCore.LifecycleItem(instanceId, event.detail,
                AutoScaleCore.LifecycleItem.ACTION_NAME_GET_CONFIG, false);
            result = await this.platform.updateLifecycleItem(item);
            logger.info(`ForgiGate (instance id: ${instanceId}) is launching to get config, ` +
            `lifecyclehook(${event.detail.LifecycleActionToken})`);
        }
        return result;
    }

    async handleTerminatingInstanceHook(event) {
        logger.info('calling handleTerminatingInstanceHook');
        let result;
        // detach addtional nic
        result = await this.handleNicDetachment(event);
        if (result) {
            let instanceId = event.detail.EC2InstanceId,
                item = new AutoScaleCore.LifecycleItem(instanceId, event.detail,
                AutoScaleCore.LifecycleItem.ACTION_NAME_TERMINATING_INSTANCE, false);
            // check if master
            let masterInfo = await this.getMasterInfo();
            logger.log(`masterInfo: ${JSON.stringify(masterInfo)}`);
            logger.log(`lifecycle item: ${JSON.stringify(item)}`);
            if (masterInfo && masterInfo.InstanceId === item.instanceId) {
                await this.deregisterMasterInstance(masterInfo);
            }
            await this.platform.completeLifecycleAction(item, true);
            await this.platform.cleanUpDbLifeCycleActions([item]);
            // remove monitoring record
            await this.removeInstanceFromMonitor(instanceId);
            logger.info(`ForgiGate (instance id: ${instanceId}) is terminating, lifecyclehook(${
                event.detail.LifecycleActionToken})`);
        }
        return result;
    }

    async addInstanceToMonitor(instance, nextHeartBeatTime) {
        logger.info('calling addInstanceToMonitor');
        var params = {
            Item: {
                instanceId: instance.InstanceId,
                ip: instance.PrivateIpAddress,
                autoScalingGroupName: process.env.AUTO_SCALING_GROUP_NAME,
                nextHeartBeatTime: nextHeartBeatTime,
                heartBeatLossCount: 0,
                syncState: 'in-sync'
            },
            TableName: DB.AUTOSCALE.TableName
        };
        return await docClient.put(params).promise();
    }

    async removeInstanceFromMonitor(instanceId) {
        logger.info('calling removeInstanceFromMonitor');
        return await this.platform.deleteInstanceHealthCheck(instanceId);
    }

    async purgeMaster() {
        let result = await this.platform.removeMasterRecord();
        return !!result;
    }

    async deregisterMasterInstance(instance) {
        logger.info('calling deregisterMasterInstance', JSON.stringify(instance));
        return await this.purgeMaster();
    }

    async terminateInstanceInAutoScalingGroup(instance) {
        logger.info('calling terminateInstanceInAutoScalingGroup');
        let params = {
            InstanceId: instance.InstanceId,
            ShouldDecrementDesiredCapacity: false
        };
        try {
            let result = await autoScaling.terminateInstanceInAutoScalingGroup(params).promise();
            logger.info('called terminateInstanceInAutoScalingGroup. done.', result);
            return true;
        } catch (error) {
            logger.warn('called terminateInstanceInAutoScalingGroup. failed.', error);
            return false;
        }
    }

    /* eslint-disable max-len */
    /**
     * Handle the 'getConfig' callback from the FortiGate.
     * @param {Aws.ProxyIntegrationEvent} event Event from the api-gateway.
     * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format // eslint-disable-line max-len
     */
    /* eslint-enable max-len */
    async handleGetConfig(event) {
        logger.info('calling handleGetConfig');
        let
            config,
            masterInfo,
            callingInstanceId = this.getCallingInstanceId(event);

        // get instance object from platform
        this._selfInstance = this._selfInstance ||
            await this.platform.describeInstance({ instanceId: callingInstanceId });
        if (!this._selfInstance || this._selfInstance.VpcId !== process.env.VPC_ID) {
            // not trusted
            throw new Error(`Unauthorized calling instance (instanceId: ${callingInstanceId}).` +
                'Instance not found in VPC.');
        }

        let promiseEmitter = this.checkMasterElection(),
            validator = result => {
                // if i am the master, don't wait, continue, if not, wait
                if (result &&
                    result.PrivateIpAddress === this._selfInstance.PrivateIpAddress) {
                    return true;
                } else if (this._masterRecord && this._masterRecord.voteState === 'pending') {
                    this._masterRecord = null;
                }
                return false;
            },
            counter = () => {
                if (Date.now() < scriptExecutionExpireTime - 3000) {
                    return false;
                }
                logger.warn('script execution is about to expire');
                return true;
            };

        try {
            masterInfo = AutoScaleCore.waitFor(promiseEmitter, validator, 5000, counter);
        } catch (error) {
            // if error occurs, check who is holding a master election, if it is this instance,
            // terminates this election. then tear down this instance whether it's master or not.
            this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
            if (this._masterRecord.instanceId === this._selfInstance.InstanceId) {
                await this.platform.removeMasterRecord();
            }
            await this.terminateInstanceInAutoScalingGroup(this._selfInstance);
            throw new Error(`Failed to determine the master instance within ${SCRIPT_TIMEOUT}` +
                ' seconds. This instance is unable to bootstrap. Please report this to' +
                ' administrators.');
        }

        // the master ip same as mine? (diagram: master IP same as mine?)
        if (masterInfo.PrivateIpAddress === this._selfInstance.PrivateIpAddress) {
            this._step = 'handler:getConfig:getMasterConfig';
            config = await this.getMasterConfig(await this.platform.getCallbackEndpointUrl());
            logger.info('called handleGetConfig: returning master config' +
                `(master-ip: ${masterInfo.PrivateIpAddress}):\n ${config}`);
            return config;
        } else {

            this._step = 'handler:getConfig:getSlaveConfig';
            config = await this.getSlaveConfig(masterInfo.PrivateIpAddress,
                await this.platform.getCallbackEndpointUrl());
            logger.info('called handleGetConfig: returning slave config' +
                `(master-ip: ${masterInfo.PrivateIpAddress}):\n ${config}`);
            return config;
        }
    }

    /* ==== Utilities ==== */

    findCallingInstanceIp(request) {
        if (request.headers && request.headers['X-Forwarded-For']) {
            logger.info(`called findCallingInstanceIp: Ip (${request.headers['X-Forwarded-For']})`);
            return request.headers['X-Forwarded-For'];
        } else if (request.requestContext && request.requestContext.identity &&
            request.requestContext.identity.sourceIp) {
            logger.info('called findCallingInstanceIp: ' +
                `Ip (${request.requestContext.identity.sourceIp})`);
            return request.requestContext.identity.sourceIp;
        } else {
            logger.error('called findCallingInstanceIp: instance Ip not found' +
                `. original request: ${JSON.stringify(request)}`);
            return null;
        }
    }

    getCallingInstanceId(request) {
        return this.platform.extractRequestInfo(request).instanceId;
    }

    async findCallingInstance(request) {
        const localIp = this.findCallingInstanceIp(request);
        if (!localIp) {
            throw Error('X-Forwarded-For and requestContext do not contain the instance local ip');
        }
        return await this.platform.findInstanceIdByIp(localIp);
    }

    async handleNicAttachment(event) {
        logger.info('calling handleNicAttachment');
        if (!event || !event.detail || !event.detail.EC2InstanceId) {
            logger.warn(`event not contains ec2 instance info. event: ${JSON.stringify(event)}`);
            return null;
        }
        try {
            let params, result, nic;
            this._selfInstance = this._selfInstance ||
                await this.platform.describeInstance({ instanceId: event.detail.EC2InstanceId });
            // create a nic
            let description = `Addtional nic for instance(id:${this._selfInstance.InstanceId}) ` +
                `in auto-scaling group: ${process.env.AUTO_SCALING_GROUP_NAME}`;
            let securityGroups = [];
            this._selfInstance.SecurityGroups.forEach(sgItem => {
                securityGroups.push(sgItem.GroupId);
            });
            let attachmentRecord =
                await this.platform.getNicAttachmentRecord(this._selfInstance.InstanceId);
            if (!attachmentRecord) {
                params = {
                    Description: description,
                    Groups: securityGroups,
                    SubnetId: this._selfInstance.SubnetId
                };
                nic = await this.platform.createNetworkInterface(params);
                if (!nic) {
                    throw new Error('create network interface unsuccessfully.');
                }
                await this.platform.updateNicAttachmentRecord(this._selfInstance.InstanceId,
                    nic.NetworkInterfaceId, 'pending_attach');
                result = await this.platform.attachNetworkInterface(this._selfInstance, nic);
                if (!result) {
                    params = {
                        NetworkInterfaceId: nic.NetworkInterfaceId
                    };
                    await this.platform.deleteNetworkInterface(params);
                    throw new Error('attach network interface unsuccessfully.');
                }
                await this.platform.updateNicAttachmentRecord(this._selfInstance.InstanceId,
                    nic.NetworkInterfaceId, 'attached', 'pending_attach');
                // reload the instance info
                this._selfInstance =
                    await this.platform.describeInstance(
                        { instanceId: event.detail.EC2InstanceId });
                return true;
            } else {
                logger.info(`instance (id: ${attachmentRecord.instanceId}) has been in ` +
                    `association with nic (id: ${attachmentRecord.nicId}) ` +
                    `in state (${attachmentRecord.attachmentState})`);
                return true;
            }
        } catch (error) {
            logger.warn(`called handleNicAttachment with error: ${JSON.stringify(error)}`);
            return null;
        }
    }

    async handleNicDetachment(event) {
        logger.info('calling handleNicDetachment');
        let attachmentRecord, nic;
        if (!event || !event.detail || !event.detail.EC2InstanceId) {
            logger.warn(`event not contains ec2 instance info. event: ${JSON.stringify(event)}`);
            return null;
        }
        try {
            this._selfInstance = this._selfInstance ||
                await this.platform.describeInstance({ instanceId: event.detail.EC2InstanceId });
            attachmentRecord =
                await this.platform.getNicAttachmentRecord(this._selfInstance.InstanceId);
            if (attachmentRecord && attachmentRecord.attachmentState === 'attached') {
                // get nic
                nic = await this.platform.describeNetworkInterface({NetworkInterfaceIds: [
                    attachmentRecord.nicId
                ]});
                // updete attachment record for in transition
                await this.platform.updateNicAttachmentRecord(attachmentRecord.instanceId,
                    attachmentRecord.nicId, 'pending_detach', 'attached');
                // detach nic
                await this.platform.detachNetworkInterface(this._selfInstance, nic);
                // delete nic
                await this.platform.deleteNetworkInterface({
                    NetworkInterfaceId: attachmentRecord.nicId
                });
                // delete attachment record
                await this.platform.deleteNicAttachmentRecord(
                    attachmentRecord.instanceId, 'pending_detach');
                // reload the instance info
                this._selfInstance =
                    await this.platform.describeInstance(
                        { instanceId: event.detail.EC2InstanceId });
            } else if (!attachmentRecord) {
                logger.info('no tracking record of network interface attached to instance ' +
                `(id: ${this._selfInstance.InstanceId})`);
            } else {
                logger.info(`instance (id: ${attachmentRecord.instanceId}) with nic ` +
                `(id: ${attachmentRecord.nicId}) is not in in the 'attached' state ` +
                `(${attachmentRecord.attachmentState})`);
            }
            return true;
        } catch (error) {
            // rollback attachment record to attached state
            if (attachmentRecord) {
                // reload nic info
                nic = await this.platform.describeNetworkInterface({NetworkInterfaceIds: [
                    attachmentRecord.nicId
                ]});
                // if nic is still attached to the same instance
                if (nic && nic.Attachment &&
                        nic.Attachment.InstanceId === attachmentRecord.instanceId) {
                    await this.platform.updateNicAttachmentRecord(attachmentRecord.instanceId,
                    attachmentRecord.nicId, 'attached', 'pending_detach');
                }
            }
            logger.warn(`called handleNicDetachment with error: ${JSON.stringify(error)}`);
            return null;
        }
    }

    async updateCapacity(desiredCapacity, minSize, maxSize) {
        logger.info('calling updateCapacity');
        let params = {
            AutoScalingGroupName: process.env.AUTO_SCALING_GROUP_NAME
        };
        if (desiredCapacity !== null && !isNaN(desiredCapacity)) {
            params.DesiredCapacity = parseInt(desiredCapacity);
        }
        if (minSize !== null && !isNaN(minSize)) {
            params.MinSize = parseInt(minSize);
        }
        if (maxSize !== null && !isNaN(maxSize)) {
            params.MaxSize = parseInt(maxSize);
        }
        try {
            let result = await autoScaling.updateAutoScalingGroup(params).promise();
            logger.info('called updateCapacity. done.', result);
            return true;
        } catch (error) {
            logger.warn('called updateCapacity. failed.', error);
            return false;
        }
    }

    async resetMasterElection() {
        logger.info('calling resetMasterElection');
        const params = {
            TableName: DB.ELECTION.TableName,
            Key: { asgName: process.env.AUTO_SCALING_GROUP_NAME }
        };
        try {
            await docClient.delete(params).promise();
            logger.info('called resetMasterElection. done.');
            return true;
        } catch (error) {
            logger.info('called resetMasterElection. failed.', error);
            return false;
        }
    }

    // end of AwsAutoscaleHandler class

}

/**
 * Initialize the module to be able to run via the 'handle' function.
 * Otherwise, this module only exposes some classes.
 * @returns {Object} exports
 */
function initModule() {
    process.env.SCRIPT_EXECUTION_TIME_CHECKPOINT = Date.now();
    AWS.config.update({
        region: process.env.AWS_REGION
    });

    logger = new AutoScaleCore.DefaultLogger(console);
    exports.logger = logger;

    return exports;
}

/**
 * Handle the auto-scaling
 * @param {Object} event The event been passed to
 * @param {Object} context The Lambda function runtime context
 * @param {Function} callback a callback function been triggered by AWS Lambda mechanism
 */
exports.handler = async (event, context, callback) => {
    scriptExecutionExpireTime = Date.now() + context.getRemainingTimeInMillis();
    initModule();
    const handler = new AwsAutoscaleHandler();
    await handler.handle(event, context, callback);
};

/**
     * expose the module runtime id
     * @returns {String} a unique id.
     */
exports.moduleRuntimeId = () => moduleId;
exports.initModule = initModule;
exports.AutoScaleCore = AutoScaleCore; // get a reference to the core
exports.AwsPlatform = AwsPlatform;
exports.AwsAutoscaleHandler = AwsAutoscaleHandler;
exports.dbDefinitions = dbDefinitions;
exports.settingItems = settingItems;
exports.logger = logger;
