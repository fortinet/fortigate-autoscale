'use strict';

/*
FortiGate Autoscale AWS Module (1.0.0-beta)
Author: Fortinet
*/
exports = module.exports;
const path = require('path');
const AWS = require('aws-sdk');
const AutoScaleCore = require('fortigate-autoscale-core');

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
    SCRIPT_TIMEOUT = process.env.SCRIPT_TIMEOUT ? process.env.SCRIPT_TIMEOUT : 300,
    DB = AutoScaleCore.dbDefinitions.getTables(custom_id, unique_id),
    moduleId = AutoScaleCore.uuidGenerator(JSON.stringify(`${__filename}${Date.now()}`)),
    settingItems = AutoScaleCore.settingItems;

let logger = new AutoScaleCore.DefaultLogger();
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

    /** @override */
    async getCallbackEndpointUrl(fromContext = null) { // eslint-disable-line no-unused-vars
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
            logger.warn(`called completeLifecycleAction. warning:${error.message}`);
            return false;
        }
    }

    /** @override */
    async putMasterRecord(candidateInstance, voteState, method = 'new') {
        try {
            let params = {
                TableName: DB.ELECTION.TableName,
                Item: {
                    asgName: this.masterScalingGroupName,
                    ip: candidateInstance.primaryPrivateIpAddress,
                    instanceId: candidateInstance.instanceId,
                    vpcId: candidateInstance.virtualNetworkId,
                    subnetId: candidateInstance.subnetId,
                    voteEndTime: Date.now() + (SCRIPT_TIMEOUT - 1) * 1000,
                    voteState: voteState
                }
            };
            if (method !== 'replace') {
                params.ConditionExpression = 'attribute_not_exists(asgName)';
            }
            return !!await docClient.put(params).promise();
        } catch (error) {
            logger.warn('error occurs in putMasterRecord:', JSON.stringify(error));
            return false;
        }
    }

    /** @override */
    async getMasterRecord() {
        const
            params = {
                TableName: DB.ELECTION.TableName,
                FilterExpression: '#PrimaryKeyName = :primaryKeyValue',
                ExpressionAttributeNames: {
                    '#PrimaryKeyName': 'asgName'
                },
                ExpressionAttributeValues: {
                    ':primaryKeyValue': this.masterScalingGroupName
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

    /** @override */
    async removeMasterRecord() {
        // only purge the master with a done votestate to avoid a
        // race condition
        const params = {
            TableName: DB.ELECTION.TableName,
            Key: { asgName: this.masterScalingGroupName },
            ConditionExpression: '#AsgName = :asgName',
            ExpressionAttributeNames: {
                '#AsgName': 'asgName'
            },
            ExpressionAttributeValues: {
                ':asgName': this.masterScalingGroupName
            }
        };
        return await docClient.delete(params).promise();
    }

    async finalizeMasterElection() {
        try {
            logger.info('calling finalizeMasterElection');
            let electedMaster = this._masterRecord || await this.getMasterRecord();
            electedMaster.voteState = 'done';
            const params = {
                TableName: DB.ELECTION.TableName,
                Item: electedMaster
            };
            let result = await docClient.put(params).promise();
            logger.info(`called finalizeMasterElection, result: ${JSON.stringify(result)}`);
            return !!result;
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
    async getInstanceHealthCheck(instance, heartBeatInterval = null) {
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
                interval,
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
                    // if the current sync heartbeat is late, the instance is still considered
                    // healthy unless 3 times of heartBeatInterval amount of time has passed.
                    // where the instance have 0% chance to catch up with a heartbeat sync
                    interval = heartBeatInterval && !isNaN(heartBeatInterval) ?
                        heartBeatInterval : data.Item.heartBeatInterval;
                    healthy = data.Item.heartBeatLossCount < 3 &&
                    Date.now() < data.Item.nextHeartBeatTime +
                        interval * (2 - data.Item.heartBeatLossCount);
                    heartBeatLossCount = data.Item.heartBeatLossCount + 1;
                }
                logger.info('called getInstanceHealthCheck');
                return {
                    instanceId: instance.instanceId,
                    healthy: healthy,
                    heartBeatLossCount: heartBeatLossCount,
                    heartBeatInterval: interval,
                    nextHeartBeatTime: Date.now() + interval * 1000,
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

    /** @override */
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
                'heartBeatInterval = :heartBeatInterval' +
                    'nextHeartBeatTime = :NextHeartBeatTime, ' +
                    'masterIp = :MasterIp, syncState = :SyncState, ',
                ExpressionAttributeValues: {
                    ':HeartBeatLossCount': healthCheckObject.heartBeatLossCount,
                    ':heartBeatInterval': heartBeatInterval,
                    ':NextHeartBeatTime': checkPointTime + heartBeatInterval * 1000,
                    ':MasterIp': masterIp ? masterIp : 'null',
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

    /** @override */
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

    async describeAutoScalingGroups(groupName) {
        try {
            let params = {
                AutoScalingGroupNames: [groupName]
            };
            let data = await autoScaling.describeAutoScalingGroups(params).promise();
            if (data && data.AutoScalingGroups && data.AutoScalingGroups.length > 0) {
                logger.info('called describeAutoScalingGroups. group found.');
                let groups = data.AutoScalingGroups.filter(group => {
                    return group.AutoScalingGroupName === groupName;
                });
                return groups && groups.length && groups[0];
            }
        } catch (error) {
            logger.warn('called describeAutoScalingGroups, error:', error);
        }
        logger.info('called describeAutoScalingGroups, no matching group found.');
        return null;
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
        return result.Reservations[0] && result.Reservations[0].Instances[0] &&
            AutoScaleCore.VirtualMachine.fromAwsEc2(
                result.Reservations[0] && result.Reservations[0].Instances[0]
            );
    }

    /**
     * Extract useful info from request event.
     * @param {Object} request the request event
     * @returns {Array} an array of required info per platform.
     */
    extractRequestInfo(request) {
        let instanceId = null,
            interval = 3600,
            status = null;

        if (request && request.headers && request.headers['Fos-instance-id']) {
            instanceId = request.headers['Fos-instance-id'];
        } else if (request && request.body) {
            try {
                let jsonBodyObject = JSON.parse(request.body);
                instanceId = jsonBodyObject.instance;
                if (jsonBodyObject.interval) {
                    interval = jsonBodyObject.interval;
                }
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

    async createNetworkInterface(parameters) {
        try {
            logger.info('called createNetworkInterface');
            let result = await ec2.createNetworkInterface(parameters).promise();
            // create a tag
            if (result && result.NetworkInterface) {
                let params = {
                    Resources: [
                        result.NetworkInterface.NetworkInterfaceId
                    ],
                    Tags: [
                        {
                            Key: 'FortiGateAutoScaleNicAttachment',
                            Value: `${custom_id}-NicAttachment-${unique_id}`
                        }
                    ]
                };
                await ec2.createTags(params).promise();
            }
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

    async listNetworkInterfaces(parameters) {
        try {
            logger.info('called listNetworkInterfaces');
            let result = await ec2.describeNetworkInterfaces(parameters).promise();
            return result && result.NetworkInterfaces;
        } catch (error) {
            logger.warn('called listNetworkInterfaces. ' +
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
                InstanceId: instance.instanceId,
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
            await this.deleteNicAttachmentRecord(instance.instanceId, 'pending_attach');
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
                `instance(id: ${instance.instanceId})`);
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

    async listNicAttachmentRecord() {
        try {
            const
                response = await docClient.scan({
                    TableName: DB.NICATTACHMENT.TableName
                }).promise();
            let recordCount = 0, records = [];
            if (response && response.Items) {
                recordCount = response.Items.length;
                records = response.Items;
            }
            logger.info(`called listNicAttachmentRecord: found ${recordCount} records.`);
            return records;
        } catch (error) {
            logger.info('called listNicAttachmentRecord: error:', error);
            return null;
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

    /** @override */
    async getBlobFromStorage(parameters) {
        let data = await s3.getObject({
            Bucket: process.env.STACK_ASSETS_S3_BUCKET_NAME,
            Key: path.join(process.env.STACK_ASSETS_S3_KEY_PREFIX, parameters.path,
                parameters.configName)
        }).promise();

        return data && data.Body && data.Body.toString('ascii');
    }

    async terminateInstanceInAutoScalingGroup(instance) {
        logger.info('calling terminateInstanceInAutoScalingGroup');
        let params = {
            InstanceId: instance.instanceId,
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
    // end of awsPlatform class
}

class AwsAutoscaleHandler extends AutoScaleCore.AutoscaleHandler {
    constructor() {
        super(new AwsPlatform(), '');
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

    /* eslint-disable max-len */
    /**
     *
     * @param {AWS.ProxyIntegrationEvent} event Event from the api-gateway.
     * @param {*} context the runtime context of this function call from AWS Lambda service
     * @param {*} callback the callback url from AWS Lambda service
     * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
     */
    /* eslint-enable max-len */
    async handle(event, context, callback) {
        this._step = 'initializing';
        let proxyMethod = 'httpMethod' in event && event.httpMethod, result;
        try {
            const platformInitSuccess = await this.init();
            this.scalingGroupName = process.env.AUTO_SCALING_GROUP_NAME;
            this.masterScalingGroupName = process.env.AUTO_SCALING_GROUP_NAME;
            this.platform.setMasterScalingGroup(this.masterScalingGroupName);
            this.platform.setScalingGroup(this.scalingGroupName);
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

        /* eslint-disable max-len */
        /**
         * Proxy the response to AWS API Gateway call
         * @param {Number} statusCode status code for the HTTP resonse
         * @param {String | Object} res the response body
         * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
         * @return {Object} the response to AWS API Gateway call
         */
        /* eslint-enable max-len */
        function proxyResponse(statusCode, res) {
            logger.log(`(${statusCode}) response body:`, res);
            const response = {
                statusCode,
                headers: {},
                body: typeof res === 'string' ? res : JSON.stringify(res),
                isBase64Encoded: false
            };
            return response;
        }

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
                // attach nic2
                result = await this.handleNicDetachment(event);
                // remove monitor record
                await this.removeInstanceFromMonitor(event.detail.EC2InstanceId);
                break;
            default:
                logger.warn(`Ignore autoscaling event type: ${event['detail-type']}`);
                break;
        }
        return result;
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
        let result, instanceId = event.detail.EC2InstanceId;
        // detach addtional nic
        result = await this.handleNicDetachment(event);
        if (result) {
            // force updating this instance sync state to 'out-of-sync' so the script can treat
            // it as an unhealthy instance
            let instance = this._selfInstance ||
                await this.platform.describeInstance({ instanceId: event.detail.EC2InstanceId }),
                selfHealthCheck = await this.platform.getInstanceHealthCheck({
                    instanceId: instance.instanceId
                });
            await this.platform.updateInstanceHealthCheck(selfHealthCheck,
                0, selfHealthCheck ? selfHealthCheck.masterIp : null, Date.now(), true);
            // check if master
            let masterInfo = await this.getMasterInfo();
            logger.log(`masterInfo: ${JSON.stringify(masterInfo)}`);
            if (masterInfo && masterInfo.instanceId === instance.instanceId) {
                await this.deregisterMasterInstance(masterInfo);
            }
            // complete its lifecycle
            let lifecycleItem = new AutoScaleCore.LifecycleItem(instanceId, event.detail,
                AutoScaleCore.LifecycleItem.ACTION_NAME_TERMINATING_INSTANCE, false);
            logger.log(`lifecycle item: ${JSON.stringify(lifecycleItem)}`);
            await this.platform.completeLifecycleAction(lifecycleItem, true);
            await this.platform.cleanUpDbLifeCycleActions([lifecycleItem]);
            logger.info(`ForgiGate (instance id: ${instanceId}) is terminating, lifecyclehook(${
                event.detail.LifecycleActionToken})`);
        } else {
            logger.warn(`cannot handle nic detachment for instance (id: ${instanceId})`);
        }
        return result;
    }

    /** @override */
    async addInstanceToMonitor(instance, heartBeatInterval, masterIp = 'null') {
        logger.info('calling addInstanceToMonitor');
        var params = {
            Item: {
                instanceId: instance.instanceId,
                ip: instance.primaryPrivateIpAddress,
                autoScalingGroupName: this.masterScalingGroupName,
                nextHeartBeatTime: Date.now() + heartBeatInterval * 1000,
                heartBeatLossCount: 0,
                heartBeatInterval: heartBeatInterval,
                syncState: 'in-sync',
                masterIp: masterIp
            },
            TableName: DB.AUTOSCALE.TableName
        };
        return await docClient.put(params).promise();
    }

    /** @override */
    async purgeMaster() {
        let result = await this.platform.removeMasterRecord();
        return !!result;
    }

    async deregisterMasterInstance(instance) {
        logger.info('calling deregisterMasterInstance', JSON.stringify(instance));
        return await this.purgeMaster();
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
        if (!this._selfInstance || this._selfInstance.virtualNetworkId !== process.env.VPC_ID) {
            // not trusted
            throw new Error(`Unauthorized calling instance (instanceId: ${callingInstanceId}).` +
                'Instance not found in VPC.');
        }

        let promiseEmitter = this.checkMasterElection.bind(this),
            validator = result => {
                // if i am the master, don't wait, continue, if not, wait
                if (result &&
                    result.primaryPrivateIpAddress === this._selfInstance.primaryPrivateIpAddress) {
                    return true;
                } else if (this._masterRecord && this._masterRecord.voteState === 'pending') {
                    // master election not done, wait for a moment
                    // clear the current master record cache and get a new one in the next call
                    this._masterRecord = null;
                } else if (this._masterRecord && this._masterRecord.voteState === 'done') {
                    // master election done
                    return true;
                }
                return false;
            },
            counter = () => {
                if (Date.now() < process.env.SCRIPT_EXECUTION_EXPIRE_TIME - 3000) {
                    return false;
                }
                logger.warn('script execution is about to expire');
                return true;
            };

        try {
            masterInfo = await AutoScaleCore.waitFor(promiseEmitter, validator, 5000, counter);
        } catch (error) {
            // if error occurs, check who is holding a master election, if it is this instance,
            // terminates this election. then tear down this instance whether it's master or not.
            this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
            if (this._masterRecord.instanceId === this._selfInstance.instanceId) {
                await this.platform.removeMasterRecord();
            }
            await this.removeInstance(this._selfInstance);
            throw new Error('Failed to determine the master instance. This instance is unable' +
            ' to bootstrap. Please report this to' +
                ' administrators.');
        }

        // the master ip same as mine? (diagram: master IP same as mine?)
        if (masterInfo.primaryPrivateIpAddress === this._selfInstance.primaryPrivateIpAddress) {
            this._step = 'handler:getConfig:getMasterConfig';
            config = await this.getMasterConfig(await this.platform.getCallbackEndpointUrl());
            logger.info('called handleGetConfig: returning master config' +
                `(master-ip: ${masterInfo.primaryPrivateIpAddress}):\n ${config}`);
            return config;
        } else {

            this._step = 'handler:getConfig:getSlaveConfig';
            config = await this.getSlaveConfig(masterInfo.primaryPrivateIpAddress,
                await this.platform.getCallbackEndpointUrl());
            logger.info('called handleGetConfig: returning slave config' +
                `(master-ip: ${masterInfo.primaryPrivateIpAddress}):\n ${config}`);
            return config;
        }
    }

    /* ==== Utilities ==== */

    getCallingInstanceId(request) {
        return this.platform.extractRequestInfo(request).instanceId;
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
            let description = `Addtional nic for instance(id:${this._selfInstance.instanceId}) ` +
                `in auto-scaling group: ${this.masterScalingGroupName}`;
            let securityGroups = [];
            this._selfInstance.SecurityGroups.forEach(sgItem => {
                securityGroups.push(sgItem.GroupId);
            });
            let attachmentRecord =
                await this.platform.getNicAttachmentRecord(this._selfInstance.instanceId),
                subnetPairs = await this.loadSubnetPairs();
            let subnetId = this._selfInstance.subnetId; // set subnet by default
            // find a paired subnet Id if there is one.
            if (Array.isArray(subnetPairs) && subnetPairs.length > 0) {
                let subnetPair = subnetPairs.filter(element => {
                    return element.subnetId === subnetId;
                });
                if (subnetPair && subnetPair.length >= 0) {
                    subnetId = subnetPair[0].pairId;
                }
            }
            if (!attachmentRecord) {
                params = {
                    Description: description,
                    Groups: securityGroups,
                    SubnetId: subnetId
                };
                nic = await this.platform.createNetworkInterface(params);
                if (!nic) {
                    throw new Error('create network interface unsuccessfully.');
                }
                await this.platform.updateNicAttachmentRecord(this._selfInstance.instanceId,
                    nic.NetworkInterfaceId, 'pending_attach');
                result = await this.platform.attachNetworkInterface(this._selfInstance, nic);
                if (!result) {
                    params = {
                        NetworkInterfaceId: nic.NetworkInterfaceId
                    };
                    await this.platform.deleteNetworkInterface(params);
                    throw new Error('attach network interface unsuccessfully.');
                }
                await this.platform.updateNicAttachmentRecord(this._selfInstance.instanceId,
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
                await this.platform.getNicAttachmentRecord(this._selfInstance.instanceId);
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
                `(id: ${this._selfInstance.instanceId})`);
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
            AutoScalingGroupName: this.masterScalingGroupName
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

    async checkAutoScalingGroupState() {
        try {
            logger.info('calling checkAutoScalingGroupState');
            let state = 'in-service',
                noScale = false,
                instanceInService = false,
                instanceTerminated = false,
                instanceStateInTransition = false,
                noInstance = false,
                noNic = false;
            let groupCheck = await this.platform.describeAutoScalingGroups(
                this.masterScalingGroupName
            );
            if (!groupCheck) {
                throw new Error(`auto scaling group (${this.masterScalingGroupName})` +
                'not exist.');
            }
            // check if capacity set to (desired:0, minSize: 0, maxSize: any number)
            if (groupCheck.DesiredCapacity === 0 && groupCheck.MinSize === 0) {
                noScale = true;
            }
            instanceInService = true;
            if (groupCheck.Instances && groupCheck.Instances.length === 0) {
                instanceInService = false;
                noInstance = true;
            }
            groupCheck.Instances.some(instance => {
                if (instance.LifecycleState !== 'InService') {
                    instanceInService = false;
                }
                if (instance.LifecycleState === 'Pending' ||
                    instance.LifecycleState === 'Pending:Wait' ||
                    instance.LifecycleState === 'Pending:Proceed' ||
                    instance.LifecycleState === 'Terminating' ||
                    instance.LifecycleState === 'Terminating:Wait' ||
                    instance.LifecycleState === 'Terminating:Proceed' ||
                    instance.LifecycleState === 'Detaching' ||
                    instance.LifecycleState === 'EnteringStandby') {
                    instanceStateInTransition = true;
                }
                if (instance.LifecycleState === 'Terminated') {
                    instanceTerminated = true;
                }
            });
            // check if all additional nics are detached and removed
            let nicAttachmentCheck = await this.platform.listNicAttachmentRecord();
            noNic = !nicAttachmentCheck || nicAttachmentCheck.length === 0;

            // if any instance is in service, the group is in-service
            if (instanceInService) {
                state = 'in-service';
            }
            // if any instance is in transition, the group is in-transition
            if (instanceStateInTransition) {
                state = 'in-transition';
            }
            // if the group is not-scaled and all instances are terminated, the group is stopped
            if (noScale && instanceTerminated) {
                state = 'stopped';
            }
            // this is the fully stopped case
            if (noScale && !instanceInService && noInstance && noNic) {
                state = 'stopped';
            }
            logger.info(`called checkAutoScalingGroupState: state: ${state} `);
            return state;
        } catch (error) {
            logger.error(error);
            return null;
        }
    }

    async cleanUpAdditionalNics() {
        logger.info('calling cleanUpAdditionalNics');
        // list all nics with tag: {key: 'FortiGateAutoScaleNicAttachment', value:
        // `${custom_id}-NicAttachment-${unique_id}`}
        let nics = await this.platform.listNetworkInterfaces({
            Filters: [
                {
                    Name: 'tag:FortiGateAutoScaleNicAttachment',
                    Values: [`${custom_id}-NicAttachment-${unique_id}`]
                }
            ]});
        let tasks = [];
        // delete them
        if (Array.isArray(nics) && nics.length > 0) {
            nics.forEach(element => {
                tasks.push(this.platform.deleteNetworkInterface(
                    {
                        NetworkInterfaceId: element.NetworkInterfaceId
                    }
                ));
            });
            try {
                await Promise.all(tasks);
                logger.info('called cleanUpAdditionalNics. no error.');
                return true;
            } catch (error) {
                logger.error('calling cleanUpAdditionalNics. error > ', error);
                return false;
            }
        }
    }

    /** @override */
    async removeInstance(instance) {
        return await this.platform.terminateInstanceInAutoScalingGroup(instance);
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
    process.env.SCRIPT_EXECUTION_EXPIRE_TIME = Date.now() + context.getRemainingTimeInMillis();
    logger = new AutoScaleCore.DefaultLogger(console);
    const handler = new AwsAutoscaleHandler();
    handler.useLogger(logger);
    initModule();
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
exports.settingItems = settingItems;
exports.logger = logger;
