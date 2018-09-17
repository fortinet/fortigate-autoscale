'use strict';

/*
Fortigate Autoscale AWS Module (1.0.0-alpha)
Author: Fortinet
*/

const AWS = require('aws-sdk');
const AutoScaleCore = require('ftnt-autoscale-core');

// lock the API versions
AWS.config.apiVersions = {
    autoscaling: '2011-01-01',
    ec2: '2016-11-15',
    lambda: '2015-03-31',
    dynamodb: '2012-08-10',
    apiGateway: '2015-07-09'
};

const
    EXPIRE_LIFECYCLE_ENTRY = (process.env.EXPIRE_LIFECYCLE_ENTRY || 60 * 60) * 1000,
    autoScaling = new AWS.AutoScaling(),
    dynamodb = new AWS.DynamoDB(),
    docClient = new AWS.DynamoDB.DocumentClient(),
    ec2 = new AWS.EC2(),
    apiGateway = new AWS.APIGateway(),
    id = process.env.UNIQUE_ID.replace(/.*\//, ''),
    DB = {
        AUTOSCALE: {
            AttributeDefinitions: [
                {
                    AttributeName: 'FortigateInstance',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'FortigateInstance',
                    KeyType: 'HASH'
                }
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 1,
                WriteCapacityUnits: 1
            },
            TableName: `FortigateAutoscale-${id}`
        },
        ELECTION: {
            AttributeDefinitions: [
                {
                    AttributeName: 'Master',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'Master',
                    KeyType: 'HASH'
                }
            ],
            ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
            TableName: `FortigateMasterElection-${id}`
        }
    },
    logger = new AutoScaleCore.DefaultLogger();

/**
 * Implements the CloudPlatform abstraction for the AWS api.
 */
class AwsPlatform extends AutoScaleCore.CloudPlatform {
    async init() {
        // TODO: create these as a custom resource instead?
        await Promise.all([createTable(DB.AUTOSCALE), createTable(DB.ELECTION)]);

        async function createTable(schema) {
            try {
                await dynamodb.describeTable({ TableName: schema.TableName }).promise();
                logger.log('found table', schema.TableName);
            } catch (ex) {
                logger.log('creating table ', schema.TableName);
                await dynamodb.createTable(schema).promise();
            }
            await dynamodb.waitFor('tableExists', { TableName: schema.TableName }).promise();
        }
    }

    // unfortunately we can't link up the api gateway id during CFT stack creation as it
    // would create a cycle. Grab it by looking up the rest api name passed as a parameter
    async getApiGatewayUrl() {
        let position,
            page;
        const
            gwName = process.env.API_GATEWAY_NAME,
            region = process.env.AWS_REGION,
            stage = process.env.API_GATEWAY_STAGE_NAME,
            resource = process.env.API_GATEWAY_RESOURCE_NAME;
        do {

            this.step = 'handler:getApiGatewayUrl:getRestApis';
            page = await apiGateway.getRestApis({ position }).promise();
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

    async getPendingLifecycleAction(instanceId) {
        const query = {
                TableName: DB.AUTOSCALE.TableName,
                Key: { FortigateInstance: instanceId }
            },
            response = await docClient.get(query).promise(),
            item = response.Item;
        if (!item) {
            throw new Error(
                `Could not find LifecycleActionToken for instance ${instanceId}`);
        }
        return AutoScaleCore.LifecycleItem.fromDb(item);
    }
    /**
     * @param {LifecycleItem} item Item containing the data to store.
     */
    async putPendingLifecycleAction(item) {
        const params = {
            TableName: DB.AUTOSCALE.TableName,
            Item: item.toDb()
        };
        return await docClient.put(params).promise();
    }

    async cleanUpDb(item = null) {
        try {
            const tableName = DB.AUTOSCALE.TableName;
            if (item == null) {
                const
                    response = await dynamodb.scan({ TableName: tableName, Limit: 5 })
                        .promise(),
                    items = response.Items;
                if (items && items.length) {
                    items.forEach(async i => await this.cleanUpDb(i));
                }
            } else if (Date.now() - item.Timestamp > EXPIRE_LIFECYCLE_ENTRY) {
                logger.log('cleaning up old entry: ' +
                    `${item.instanceId} (${(Date.now() - item.Timestamp) / 1000}s ago`);
                await docClient.delete({
                    TableName: tableName,
                    Key: { FortigateInstance: item.instanceId }
                });
            }
        } catch (ex) {
            console.error('Error while cleaning up (ignored):', ex);
        }
    }

    /**
     * Get the ip address which won the master election
     * @returns {String} Ip of the fortigate which should be the auto-sync master
     */
    async getElectedMaster() {
        const
            query = {
                TableName: DB.ELECTION.TableName,
                Key: { Master: 'master' }
            },
            response = await docClient.get(query).promise(),
            item = response.Item;
        if (!item) {
            throw Error('No elected master was found in the db!', response);
        }
        return item.Ip;
    }

    /**
     * Submit an election vote for this ip address to become the master.
     * @param {String} ip Ip of the fortigate which wants to become the master
     * @param {String} purgeMasterIp Ip of the old master, if it's dead.
     */
    async putMasterElectionVote(ip, purgeMasterIp = null) {
        try {
            const params = {
                TableName: DB.ELECTION.TableName,
                Item: { Master: 'master', Ip: ip },
                ConditionExpression: 'attribute_not_exists(Master)'
            };
            logger.log('masterElectionVote, purge master?', purgeMasterIp);
            if (purgeMasterIp) {
                const purgeParams = {
                    TableName: DB.ELECTION.TableName,
                    Key: { Master: 'master' },
                    ConditionExpression: 'Ip = :ip',
                    ExpressionAttributeValues: {
                        ':ip': purgeMasterIp
                    }
                };
                const purged = await docClient.delete(purgeParams).promise();
                logger.log('purged: ', purged);
            } else {
                logger.log('no master purge');
            }
            return await docClient.put(params).promise();
        } catch (ex) {
            console.warn('exception while putMasterElectionVote',
                ip, purgeMasterIp, ex.stack);
        }
    }

    /**
     * @param {LifecycleItem} item Item from the db containing data
     *  needed by the platform to complete the lifecycle action.
     * @param {boolean} success Whether the action should be completed or aborted.
     */
    async completeLifecycleAction(item, success) {
        logger.log('completeLifecycleAction(', item, ', ', success, ')');
        const detail = item.detail;
        var params = {
            AutoScalingGroupName: detail.AutoScalingGroupName,
            LifecycleActionResult: success ? 'CONTINUE' : 'ABANDON',
            LifecycleActionToken: detail.LifecycleActionToken,
            LifecycleHookName: detail.LifecycleHookName
            // InstanceId: event.instanceId
        };
        const data = await autoScaling.completeLifecycleAction(params).promise();
        logger.log(
            `${params.LifecycleActionResult} applied to ${params.LifecycleHookName}:
            ${params.LifecycleActionToken}`);
        return data;
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

    async protectInstanceFromScaleIn(item, protect = true) {
        const
            MAX_TRIES = 10,
            // Delay the attempt to setInstanceProtection because it takes around a second
            // for autoscale to switch the instance to `InService` status.
            PROTECT_DELAY = 2000;
        let count = 0;
        while (true) { // eslint-disable-line no-constant-condition
            try {
                await runAfter(PROTECT_DELAY, () => autoScaling.setInstanceProtection({
                    AutoScalingGroupName: item.detail.AutoScalingGroupName,
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
    constructor() {
        super(new AwsPlatform(), process.env.MASTER_FORTIGATE_CONFIG);
    }

    async handle(event, context, callback) {
        this.step = 'initializing';
        let proxyMethod = 'httpMethod' in event && event.httpMethod;

        try {
            await this.init();
            logger.log('Event:', event);
            if (event.source === 'aws.autoscaling') {
                this.step = 'aws.autoscaling:handleLifecycleAction';
                callback(null, await this.handleLifecycleAction(event));
            } else if (proxyMethod === 'POST') {
                this.step = 'fortigate:handleSyncedCallback';
                const result = await this.handleSyncedCallback(event);
                callback(null, proxyResponse(200, result));
            } else if (proxyMethod === 'GET') {
                this.step = 'fortigate:getConfig';
                const result = await this.handleGetConfig(event);
                callback(null, proxyResponse(200, result));
            } else {
                this.step = '¯\\_(ツ)_/¯';

                logger.log(`${this.step} unexpected event!`, event);
                // probably a test call from the lambda console?
                callback(null, await this.completeLifecycleAction(event.instanceId));
            }

        } catch (ex) {
            if (ex.message) {
                ex.message = `${this.step}: ${ex.message}`;
            }
            console.error('INPUTS: ', event, context);
            try {
                console.error('ERROR while ', this.step, proxyMethod, ex);
            } catch (ex2) {
                console.error('ERROR while ', this.step, proxyMethod, ex.message, ex, ex2);
            }
            if (proxyMethod) {
                callback(null,
                    proxyResponse(500, { message: ex.message, stack: ex.stack }));
            } else {
                callback(ex);
            }
        }

        function proxyResponse(statusCode, result) {
            const response = {
                statusCode,
                headers: {},
                body: typeof result === 'string' ? result : JSON.stringify(result),
                isBase64Encoded: false
            };
            return response;
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
    async handleLifecycleAction(event) {
        const
            instanceId = event.detail.EC2InstanceId;

        if (event.detail.LifecycleTransition !== 'autoscaling:EC2_INSTANCE_LAUNCHING') {
            throw new Error(`Wrong LifecycleTransition: ${
                event.detail.LifecycleTransition}`);
        }

        await this.platform.cleanUpDb();
        const
            item = new AutoScaleCore.LifecycleItem(instanceId, event.detail),
            result = await this.platform.putPendingLifecycleAction(item);

        logger.log(`Callback pending for ${event.detail.EC2InstanceId} (token ${
            event.detail.LifecycleActionToken})`);
        return result;
    }

    /* eslint-disable max-len */
    /**
     * Handle the 'auto-scale synced' callback from the fortigate.
     * @param {AWS.ProxyIntegrationEvent} event Event from the api-gateway.
     * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format // eslint-disable-line max-len
     */
    /* eslint-enable max-len */
    async handleSyncedCallback(event) {
        const instanceId = await this.findCallingInstanceId(event);
        const success = JSON.parse(event.body).status === 'success';
        return await this.completeLifecycleAction(instanceId, success);
    }

    /* eslint-disable max-len */
    /**
     * Handle the 'getConfig' callback from the fortigate.
     * @param {Aws.ProxyIntegrationEvent} event Event from the api-gateway.
     * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format // eslint-disable-line max-len
     */
    /* eslint-enable max-len */
    async handleGetConfig(event) {
        const
            ip = this.findCallingInstanceIp(event);
        return await this.getConfig(ip);
    }

    /* ==== Utilities ==== */

    findCallingInstanceIp(request) {
        return (request.headers && request.headers['X-Forwarded-For']) ||
            (request.requestContext && request.requestContext.identity &&
                request.requestContext.identity.sourceIp);
    }

    async findCallingInstanceId(request) {
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

exports.handler = async (event, context, callback) => {
    const handler = new AwsAutoscaleHandler();
    await handler.handle(event, context, callback);
};
