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
    SCRIPT_TIMEOUT = 300,
    DB = {
        LIFECYCLEITEM: {
            AttributeDefinitions: [
                {
                    AttributeName: 'instanceId',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'actionName',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'instanceId',
                    KeyType: 'HASH'
                },
                {
                    AttributeName: 'actionName',
                    KeyType: 'RANGE'
                }
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 1,
                WriteCapacityUnits: 1
            },
            TableName: `${custom_id}-FortiGateLifecycleItem-${unique_id}`
        },
        AUTOSCALE: {
            AttributeDefinitions: [
                {
                    AttributeName: 'instanceId',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'instanceId',
                    KeyType: 'HASH'
                }
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 1,
                WriteCapacityUnits: 1
            },
            TableName: `${custom_id}-FortiGateAutoscale-${unique_id}`
        },
        ELECTION: {
            AttributeDefinitions: [
                {
                    AttributeName: 'asgName',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'instanceId',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'ip',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'vpcId',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'subnetId',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'voteState',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'asgName',
                    KeyType: 'HASH'
                }
            ],
            ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
            TableName: `${custom_id}-FortiGateMasterElection-${unique_id}`
        },
        CONFIGSET: {
            AttributeDefinitions: [
                {
                    AttributeName: 'configName',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'configContent',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'configName',
                    KeyType: 'HASH'
                }
            ],
            ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
            TableName: `${custom_id}-FortiGateConfigSet-${unique_id}`
        }

    },
    moduleId = AutoScaleCore.uuidGenerator(JSON.stringify(`${__filename}${Date.now()}`));

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
            await dynamodb.describeTable({TableName: schema.TableName}).promise();
            console.log('found table', schema.TableName);
        } catch (ex) {
            console.log('creating table ', schema.TableName);
            await dynamodb.createTable(schema).promise();
        }
        await dynamodb.waitFor('tableExists', {TableName: schema.TableName}).promise();
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
                    logger.info('cleaning up old entry: ' +
                        `${item.instanceId} (${(Date.now() - item.timestamp) / 1000}s) ago`);
                    await docClient.delete({
                        TableName: tableName,
                        Key: {
                            instanceId: item.instanceId,
                            actionName: item.actionName
                        }
                    }).promise();
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
     * Get the ip address which won the master election
     * @returns {Object} Master record of the FortiGate which should be the auto-sync master
     */
    async getElectedMaster() {
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

    async finalizeMasterElection() {
        try {
            logger.info('calling finalizeMasterElection');
            let electedMaster = await this.getElectedMaster();
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
        // TODO: not fully implemented in V3
        if (!(instance && instance.instanceId)) {
            logger.error('getInstanceHealthCheck > error: no instanceId property found' +
            ` on instance: ${JSON.stringify(instance)}`);
            return Promise.reject(`invalid instance: ${JSON.stringify(instance)}`);
        }
        var params = {
            Key: {
                instanceId: {
                    S: instance.instanceId
                }
            },
            TableName: DB.AUTOSCALE.TableName
        };
        try {
            let data = await dynamodb.getItem(params).promise();
            if (data.Item) {
                logger.info('called getInstanceHealthCheck');
                // TODO: now always return healthy
                return {
                    healthy: !!heartBeatInterval || true, // TODO: need to implement logic here
                    heartBeatLossCount: 0,
                    nextHeartBeatTime: 0
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
     * Get information about an instance by the given parameters.
     * @param {Object} parameters parameters accepts: instanceId, privateIp, publicIp
     */
    async describeInstance(parameters) {
        logger.info('calling describeInstance');
        let params = {Filters: []};
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
        return {instanceId, interval, status};
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
}

class AwsAutoscaleHandler extends AutoScaleCore.AutoscaleHandler {
    constructor(platform = new AwsPlatform(), baseConfig = '') {
        super(platform, baseConfig);
        this._step = '';
        this._selfInstance = null;
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
                    const purged = await this.purgeMaster(process.env.AUTO_SCALING_GROUP_NAME);
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

    async holdMasterElection(instance) {
        // do not need to do anything for master election
        return await instance;
    }

    async getConfigSetFromDb(name) {
        const query = {
                TableName: DB.CONFIGSET.TableName,
                Key: {
                    configName: name
                }
            },
            response = await docClient.get(query).promise();
        return response && response.Item && response.Item.configContent;
    }

    async getConfigSetFromS3(configName) {
        let data = await s3.getObject({
            Bucket: process.env.STACK_ASSETS_S3_BUCKET_NAME,
            Key: path.join(process.env.STACK_ASSETS_S3_KEY_PREFIX, 'configset', configName)
        }).promise();

        return data && data.Body && data.Body.toString('ascii');
    }

    /**
     * @override
     */
    async getBaseConfig() {
        let baseConfig = await this.getConfigSetFromS3('baseconfig');
        if (baseConfig) {
            // check if other config set are required
            let requiredConfigSet = process.env.REQUIRED_CONFIG_SET.split(',');
            let configContent = '', elbWebRequired = false;
            for (let configset of requiredConfigSet) {
                let [name, selected] = configset.trim().split('-');
                if (selected.toLowerCase() === 'yes') {
                    switch (name) {
                        case 'httpsroutingpolicy':
                            elbWebRequired = true;
                            configContent = await this.getConfigSetFromS3(name);
                            break;
                        default:
                            break;
                    }
                }
            }
            if (elbWebRequired) {
                configContent = await this.getConfigSetFromS3('internalelbweb') + configContent;
            }
            baseConfig = baseConfig + configContent;
            let psksecret = process.env.FORTIGATE_PSKSECRET;
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
        let masterRecord, masterIp;
        try {
            masterRecord = await this.platform.getElectedMaster();
            masterIp = masterRecord.ip;
        } catch (ex) {
            logger.error(ex.message);
        }
        return masterRecord && await this.platform.describeInstance({privateIp: masterIp});
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
        const {instanceId, interval, status} =
            this.platform.extractRequestInfo(event),
            statusSuccess = status && status === 'success' || false;
        // if fortigate is sending callback in response to obtaining config, this is a state
        // message
        let parameters = {}, selfHealthCheck;

        parameters.instanceId = instanceId;
        // handle hb monitor
        // get master instance monitoring
        let masterInfo = await this.getMasterInfo();
        // TODO: master health check

        this._selfInstance = await this.platform.describeInstance(parameters);
        // if it is a response from fgt for getting its config
        if (status) {
            // handle get config callback
            return await this.handleGetConfigCallback(
                this._selfInstance.InstanceId === masterInfo.InstanceId, statusSuccess);
        }
        // is myself under health check monitoring?
        // do self health check
        selfHealthCheck = await this.platform.getInstanceHealthCheck({
            instanceId: this._selfInstance.InstanceId
        }, interval);
        // if no record found, this instance not under monitor. should make sure its all
        // lifecycle actions are complete before starting to monitor it
        if (!selfHealthCheck) {
            await this.addInstanceToMonitor(this._selfInstance,
                Date.now() + interval * 1000);
            logger.info(`instance (id:${this._selfInstance.InstanceId}, ` +
                `ip: ${this._selfInstance.PrivateIpAddress}) is added to monitor.`);
            return '';
        } else {
            logger.info(`instance (id:${this._selfInstance.InstanceId}, ` +
                `ip: ${this._selfInstance.PrivateIpAddress}) health check ` +
                `(${selfHealthCheck.healthy ? 'healthy' : 'unhealthy'}, ` +
                `heartBeatLossCount: ${selfHealthCheck.heartBeatLossCount}, ` +
                `nextHeartBeatTime: ${selfHealthCheck.nextHeartBeatTime}).`);
            return '';
        }
    }

    async handleGetConfigCallback(isMaster, statusSuccess) {
        let lifecycleItem, instanceProtected = false;
        lifecycleItem = await this.completeGetConfigLifecycleAction(
                this._selfInstance.InstanceId, statusSuccess) ||
                new AutoScaleCore.LifecycleItem(this._selfInstance.InstanceId, {},
                    AutoScaleCore.LifecycleItem.ACTION_NAME_GET_CONFIG);
        // is it master?
        if (isMaster) {
            try {
                // then protect it from scaling in
                // instanceProtected =
                //         await this.platform.protectInstanceFromScaleIn(
                //             process.env.AUTO_SCALING_GROUP_NAME, lifecycleItem);
                logger.info(`Instance (id: ${lifecycleItem.instanceId}) scaling-in` +
                    ` protection is on: ${instanceProtected}`);
            } catch (ex) {
                logger.warn('Unable to protect instance from scale in:', ex);
            }
            // update master election from 'pending' to 'done'
            await this.platform.finalizeMasterElection();
        }
        logger.info('called handleGetConfigCallback');
        return '';
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
        const instanceId = event.detail.EC2InstanceId,
            item = new AutoScaleCore.LifecycleItem(instanceId, event.detail,
                AutoScaleCore.LifecycleItem.ACTION_NAME_GET_CONFIG, false),
            result = await this.platform.updateLifecycleItem(item);
        logger.info(`ForgiGate (instance id: ${instanceId}) is launching to get config, ` +
            `lifecyclehook(${event.detail.LifecycleActionToken})`);
        return result;
    }

    async handleTerminatingInstanceHook(event) {
        logger.info('calling handleTerminatingInstanceHook');
        let instanceId = event.detail.EC2InstanceId,
            item = new AutoScaleCore.LifecycleItem(instanceId, event.detail,
            AutoScaleCore.LifecycleItem.ACTION_NAME_TERMINATING_INSTANCE, false);
        // check if master
        let masterInfo = this.getMasterInfo();
        logger.log(`masterInfo: ${JSON.stringify(masterInfo)}`);
        logger.log(`lifecycle item: ${JSON.stringify(item)}`);
        if (masterInfo && masterInfo.InstanceId === item.instanceId) {
            await this.deregisterMasterInstance(masterInfo);
        }
        await this.platform.completeLifecycleAction(item, true);
        await this.platform.cleanUpDbLifeCycleActions([item]);
        logger.info(`ForgiGate (instance id: ${instanceId}) is terminating, lifecyclehook(${
            event.detail.LifecycleActionToken})`);
        return;
    }

    async addInstanceToMonitor(instance, nextHeartBeatTime) {
        logger.info('calling addInstanceToMonitor');
        var params = {
            Item: {
                instanceId: instance.InstanceId,
                ip: instance.PrivateIpAddress,
                autoScalingGroupName: process.env.AUTO_SCALING_GROUP_NAME,
                nextHeartBeatTime: nextHeartBeatTime,
                heartBeatLossCount: 0
            },
            TableName: DB.AUTOSCALE.TableName
        };
        return await docClient.put(params).promise();
    }

    async purgeMaster(asgName) {
        // only purge the master with a done votestate to avoid a
        // race condition
        const params = {
            TableName: DB.ELECTION.TableName,
            Key: { asgName: asgName },
            ConditionExpression: '#AsgName = :asgName AND #voteState = :voteState',
            ExpressionAttributeNames: {
                '#AsgName': 'asgName',
                '#voteState': 'voteState'
            },
            ExpressionAttributeValues: {
                ':asgName': asgName,
                ':voteState': 'done'
            }
        };
        return await docClient.delete(params).promise();
    }

    async deregisterMasterInstance(instance) {
        logger.info('calling deregisterMasterInstance', JSON.stringify(instance));
        return await this.purgeMaster(process.env.AUTO_SCALING_GROUP_NAME);
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
            electionLock = null,
            masterIsHealthy = false,
            config,
            getConfigTimeout,
            nextTime,
            masterInfo,
            masterHealthCheck,
            masterRecord,
            callingInstanceId = this.getCallingInstanceId(event);

        // get instance object from platform
        this._selfInstance = await this.platform.describeInstance({instanceId: callingInstanceId});
        if (!this._selfInstance || this._selfInstance.VpcId !== process.env.VPC_ID) {
            // not trusted
            throw new Error(`Unauthorized calling instance (instanceId: ${callingInstanceId}).` +
            'Instance not found in VPC.');
        }

        nextTime = Date.now();
        getConfigTimeout = nextTime + SCRIPT_TIMEOUT * 1000; // unit ms

        // (diagram: master exists?)
        while (!masterIsHealthy && (nextTime < getConfigTimeout)) {
            // is there a master election still holding?
            masterRecord = await this.platform.getElectedMaster();
            if (!(masterRecord && masterRecord.voteState === 'done')) {
                masterIsHealthy = false;
            } else {
                // get the current master
                masterInfo = await this.getMasterInfo();
                // is current master healthy?
                if (masterInfo) {
                    masterHealthCheck =
                            await this.platform.getInstanceHealthCheck({
                                instanceId: masterInfo.InstanceId
                            });
                    masterIsHealthy = !!masterHealthCheck && masterHealthCheck.healthy;
                }
            }

            // we need a new master! let's hold a master election!
            if (!masterIsHealthy) {
                // but can I run the election? (diagram: anyone's holding master election?)
                // try to put myself as the master candidate
                electionLock = !masterRecord &&
                await this.putMasterElectionVote(this._selfInstance,
                    // even if master record exists, this master is unhealthy so need to purge it.
                    masterRecord && masterRecord.voteState === 'done');

                if (electionLock) {
                    // yes, you run it!
                    logger.info(`This instance (id: ${this._selfInstance.InstanceId})` +
                    ' is running an election.');
                    try {
                        // (diagram: elect new master from queue (existing instances))
                        await this.holdMasterElection(this._selfInstance);
                        logger.info('Election completed.');
                    } catch (error) {
                        logger.error('Something went wrong in the master election.');
                    } finally {
                        electionLock = null;
                    }
                    // (diagram: master exists?)
                    masterInfo = await this.getMasterInfo();
                    // if i am the master, don't wait, continue
                    masterIsHealthy = masterInfo &&
                        masterInfo.PrivateIpAddress === this._selfInstance.PrivateIpAddress;
                }
            }
            nextTime = Date.now();
            // masterIsHealthy = !!masterInfo;
            if (!masterIsHealthy) {
                await AutoScaleCore.sleep(5000); // (diagram: wait for a moment (interval))
            }
        }

        // exit with error if script can't get election done within script timeout
        if (nextTime >= getConfigTimeout) {
            // cannot bootstrap due to master election failure.
            // (diagram: remove instance)
            await this.removeInstance({
                vmId: this._selfInstance.properties.vmId
            });
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

}

exports.AutoScaleCore = AutoScaleCore; // get a reference to the core
exports.AwsPlatform = AwsPlatform;
exports.AwsAutoscaleHandler = AwsAutoscaleHandler;

/**
 * Initialize the module to be able to run via the 'handle' function.
 * Otherwise, this module only exposes some classes.
 * @returns {Object} exports
 */
exports.initModule = () => {
    AWS.config.update({
        region: process.env.AWS_REGION
    });
    /**
     * expose the module runtime id
     * @returns {String} a unique id.
     */
    exports.moduleRuntimeId = () => moduleId;
    /**
     * Handle the auto-scaling
     * @param {Object} event The event been passed to
     * @param {Object} context The Lambda function runtime context
     * @param {Function} callback a callback function been triggered by AWS Lambda mechanism
     */
    exports.handler = async (event, context, callback) => {
        logger = new AutoScaleCore.DefaultLogger(console);
        const handler = new AwsAutoscaleHandler();
        await handler.handle(event, context, callback);
    };
    return exports;
};
