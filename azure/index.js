'use strict';

/*
FortiGate Autoscale Azure Module (1.0.0-beta)
Author: Fortinet
*/

exports = module.exports;
const url = require('url');
const AutoScaleCore = require('fortigate-autoscale-core');
const armClient = require('./azure-arm-client');
const UNIQUE_ID = process.env.UNIQUE_ID ? process.env.UNIQUE_ID.replace(/.*\//, '') : '';
const CUSTOM_ID = process.env.CUSTOM_ID ? process.env.CUSTOM_ID.replace(/.*\//, '') : '';
const SUBSCRIPTION_ID = process.env.SUBSCRIPTION_ID;
const RESOURCE_GROUP = process.env.RESOURCE_GROUP;
const DATABASE_NAME = `${CUSTOM_ID ? `${CUSTOM_ID}-` : ''}` +
    `FortiGateAutoscale${UNIQUE_ID ? `-${UNIQUE_ID}` : ''}`;
const DB = AutoScaleCore.dbDefinitions.getTables(CUSTOM_ID, UNIQUE_ID);
const moduleId = AutoScaleCore.uuidGenerator(JSON.stringify(`${__filename}${Date.now()}`));
const settingItems = AutoScaleCore.settingItems;
const VM_INFO_CACHE_TIME = 3600000;// in ms. default 3600 * 1000

var logger = new AutoScaleCore.DefaultLogger();
var dbClient, computeClient, storageClient;

// this variable is to store the anticipated script execution expire time (milliseconds)
let scriptExecutionExpireTime,
    electionWaitingTime = process.env.ELECTION_WAIT_TIME ?
        parseInt(process.env.ELECTION_WAIT_TIME) : 60000; // in ms

class AzureLogger extends AutoScaleCore.DefaultLogger {
    constructor(loggerObject) {
        super(loggerObject);
    }
    log() {
        if (!(this.level && this.level.log === false)) {
            if (this._outputQueue && !this._flushing) {
                this.enQueue('log', arguments);
            } else {
                this.logger.apply(null, arguments);
            }
        }
        return this;
    }
}

class AzurePlatform extends AutoScaleCore.CloudPlatform {
    async init() {
        let checkDatabaseAvailability = async function() {
                try {
                    let result = await dbClient.listDataBases();
                    if (result && result.body && result.body.Databases &&
                        Array.isArray(result.body.Databases)) {
                        let arr = result.body.Databases.filter(element => {
                            return element.id === DATABASE_NAME;
                        });
                        if (arr.length === 1) {
                            logger.info('called checkDatabaseAvailability. DB ' +
                            `(${DATABASE_NAME}) found.`);
                            return true;
                        } else {
                            logger.info('called checkDatabaseAvailability. DB ' +
                            `(${DATABASE_NAME}) not found.`);
                            return false;
                        }
                    }
                } catch (error) {
                    if (error.statusCode && error.statusCode === 404) {
                        logger.info('called checkDatabaseAvailability. DB ' +
                    `(${DATABASE_NAME}) not found.`);
                        return false;
                    } else {
                        throw error;
                    }
                }

            },
            createDatabase = async function() {
                // any error here is intended to be thrown but not caught in this function
                let result = await dbClient.createDatabase(DATABASE_NAME);
                if (result.statusCode === 201) {
                    logger.info(`called provisionDatabase > DB ${DATABASE_NAME} created.`);
                    return true;
                } else if (result.statusCode === 409) {
                    logger.info(`called provisionDatabase > DB ${DATABASE_NAME} already exists.`);
                    return true;
                } else {
                    throw new Error('called provisionDatabase > ' +
                    `unknown error:${JSON.stringify(result)}`);
                }
            },
            // eslint-disable-next-line no-unused-vars
            checkCollectionsAvailability = async function(collections = []) {
                if (!Array.isArray(collections) || collections.length === 0) {
                    return [];
                }
                let result = await dbClient.listCollections(DATABASE_NAME);
                let missingCollections = [];
                if (result.body && result.body.DocumentCollections &&
                    result.body.DocumentCollections.length >= 0) {
                    let existingCollections = result.body.DocumentCollections.map(element => {
                        return element.id;
                    }
                    );
                    missingCollections = collections.filter(collectionName => {
                        return !existingCollections.includes(collectionName);
                    });
                }
                logger.info('called checkCollectionsAvailability.' +
                `${missingCollections.length} collections missing.`);
                return missingCollections;
            },
            createCollections = async function(collections) {
                let collectionCreationPromises = [];
                if (!Array.isArray(collections) || collections.length === 0) {
                    return Promise.resolve(true);
                }
                var createCollection = async function(collectionName) {
                    let result = await dbClient.createCollection(DATABASE_NAME, collectionName);
                    if (result.statusCode === 201) {
                        logger.info(`Collection (${collectionName}) created.`);
                        return true;
                    } else if (result.statusCode === 409) {
                        logger.info(`Collection (${collectionName}) already exists.`);
                        return true;
                    } else {
                        logger.info('Unknown response from API:', JSON.stringify(result));
                        return false;
                    }
                };
                collections.forEach(collectionName => {
                    collectionCreationPromises.push(createCollection(collectionName));
                });
                try {
                    await Promise.all(collectionCreationPromises);
                    logger.info('called createCollections > successful.');
                    return true;
                } catch (error) {
                    logger.info('called createCollections > error:', error);
                    throw error;
                }
            },
            initDB = async function() {
                try {
                    let available = await checkDatabaseAvailability();
                    if (!available) {
                        await createDatabase();
                        let collectionNames = Object.keys(DB).map(element => {
                            return DB[element].TableName;
                        });
                        await createCollections(collectionNames);
                    }
                    return true;
                } catch (error) {
                    logger.error(error);
                    logger.warn('some tables are missing, ' +
                    'script enters instance termination process');
                    return false;
                }
            },
            initBlobStorage = async function() {
                if (!(process.env.AZURE_STORAGE_ACCOUNT && process.env.AZURE_STORAGE_ACCESS_KEY)) {
                    throw new Error('missing storage account and access key.');
                }
                return await Promise.resolve(true);
            };

        await Promise.all([
            initBlobStorage(),
            initDB(),
            armClient.authWithServicePrincipal(process.env.REST_APP_ID,
                process.env.REST_APP_SECRET, process.env.TENANT_ID)]).catch(error => {
            throw error;
        });
    }

    async getCallbackEndpointUrl(fromContext = null) {
        return await fromContext ? fromContext.originalUrl : null;
    }

    /**
     * Extract useful info from request event.
     * @param {Object} request the request event
     * @returns {Array} an array of required info per platform.
     */
    extractRequestInfo(request) {
        let instanceId = null,
            interval = 120,
            status = null,
            scaleSetName = null;
        try {
            // try to extract scale set name from api resource in url
            // see https://nodejs.org/docs/latest/api/url.html#url_the_whatwg_url_api
            let endpoint = new url.URL(request.url).pathname.match('(?<=api/).*(?=/)?');
            if (Array.isArray(endpoint) && endpoint.length > 0) {
                scaleSetName = endpoint[0] === 'byol-asg-handler' ?
                    process.env.SCALING_GROUP_NAME_BYOL : process.env.SCALING_GROUP_NAME_PAYG;
            } else {
                throw new Error(`unable to find a scaleset name from url:${request.url}`);
            }
            // try to get instance id from headers
            if (request && request.headers && request.headers['fos-instance-id']) {
                instanceId = request.headers['fos-instance-id'];
            } else {
                // try to get instance id from body
                if (request && request.body && request.body.instance) {
                    instanceId = request.body.instance;
                }
                // try to get get config status from body
                if (request && request.body && request.body.status) {
                    status = request.body.status;
                }
                // try to get heartbeat interval from body
                if (request && request.body && request.body.interval &&
                    !isNaN(request.body.interval)) {
                    interval = parseInt(request.body.interval);
                }
            }
        } catch (error) {
            logger.error('invalid JSON format in request body');
            logger.error(error);
        }
        logger.info(`called extractRequestInfo: extracted: instance Id(${instanceId}), ` +
        `interval(${interval}), status(${status})`);
        return {instanceId, interval, status, scaleSetName};
    }

    /** @override */
    async putMasterRecord(candidateInstance, voteState, method = 'new') {
        try {
            let document = {
                id: this.masterScalingGroupName,
                asgName: this.masterScalingGroupName,
                ip: candidateInstance.primaryPrivateIpAddress,
                instanceId: candidateInstance.instanceId,
                vpcId: candidateInstance.virtualNetworkId,
                subnetId: candidateInstance.subnetId,
                voteEndTime: Date.now() + electionWaitingTime,
                voteState: voteState
            };
            return !!await dbClient.createDocument(DATABASE_NAME, DB.ELECTION.TableName,
                document, method === 'replace');
        } catch (error) {
            logger.warn('error occurs in putMasterRecord:', JSON.stringify(error));
            return false;
        }
    }

    /**
     * Get the master record from db
     * @returns {Object} Master record of the FortiGate which should be the auto-sync master
     */
    async getMasterRecord() {
        const keyExpression = {
            name: 'asgName',
            value: this.masterScalingGroupName
        };
        let items = await dbClient.simpleQueryDocument(DATABASE_NAME, DB.ELECTION.TableName,
            keyExpression);
        if (!Array.isArray(items) || items.length === 0) {
            logger.info('No elected master was found in the db!');
            return null;
        }
        logger.info(`Elected master found: ${JSON.stringify(items[0])}`, JSON.stringify(items));
        return items[0];
    }

    /** @override */
    async removeMasterRecord() {
        try {
            return await dbClient.deleteDocument(DATABASE_NAME, DB.ELECTION.TableName,
                this.masterScalingGroupName);
        } catch (error) {
            if (error.statusCode && error.statusCode === 404) {
                return true; // ignore if the file to delete not exists.
            }
        }
    }

    async finalizeMasterElection() {
        try {
            logger.info('calling finalizeMasterElection');
            let electedMaster = this._masterRecord || await this.getMasterRecord();
            electedMaster.voteState = 'done';
            let result = await dbClient.replaceDocument(DATABASE_NAME, DB.ELECTION.TableName,
                electedMaster);
            logger.info(`called finalizeMasterElection, result: ${JSON.stringify(result)}`);
            return !!result;
        } catch (error) {
            logger.warn('called finalizeMasterElection, error:', error);
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
            logger.error('getInstanceHealthCheck > error: no instance id property found on ' +
            `instance: ${JSON.stringify(instance)}`);
            return Promise.reject(`invalid instance: ${JSON.stringify(instance)}`);
        }

        let asgName = instance.asgName ? instance.asgName : this.scalingGroupName;

        const keyExpression = {
                name: 'id',
                value: `${asgName}-${instance.instanceId}`
            }, filterExpression = [
                {
                    name: 'instanceId',
                    value: instance.instanceId
                }
            ];
        try {
            let compensatedScriptTime,
                healthy,
                heartBeatLossCount,
                items = await dbClient.simpleQueryDocument(DATABASE_NAME, DB.AUTOSCALE.TableName,
                keyExpression, filterExpression);
            if (!Array.isArray(items) || items.length === 0) {
                logger.info('called getInstanceHealthCheck: no record found');
                return null;
            }
            // to get a more accurate heart beat elapsed time, the script execution time so far
            // is compensated.
            compensatedScriptTime = process.env.SCRIPT_EXECUTION_TIME_CHECKPOINT;
            healthy = compensatedScriptTime < items[0].nextHeartBeatTime;
            if (compensatedScriptTime < items[0].nextHeartBeatTime) {
                // reset hb loss cound if instance sends hb within its interval
                healthy = true;
                heartBeatLossCount = 0;
            } else {
                // consider instance as health if hb loss < 3
                healthy = items[0].heartBeatLossCount < 3;
                heartBeatLossCount = items[0].heartBeatLossCount + 1;
            }
            logger.info('called getInstanceHealthCheck');
            return {
                instanceId: instance.instanceId,
                healthy: healthy,
                heartBeatLossCount: heartBeatLossCount,
                nextHeartBeatTime: Date.now() + heartBeatInterval * 1000,
                masterIp: items[0].masterIp,
                syncState: items[0].syncState,
                inSync: items[0].syncState === 'in-sync'
            };
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
            let result, document = {
                id: `${this.scalingGroupName}-${healthCheckObject.instanceId}`,
                asgName: this.scalingGroupName,
                instanceId: healthCheckObject.instanceId,
                heartBeatLossCount: healthCheckObject.heartBeatLossCount,
                nextHeartBeatTime: checkPointTime + heartBeatInterval * 1000,
                masterIp: masterIp ? masterIp : 'null',
                syncState: healthCheckObject.healthy && !forceOutOfSync ? 'in-sync' : 'out-of-sync'
            };
            if (!forceOutOfSync && healthCheckObject.syncState === 'out-of-sync') {
                logger.info(`instance already out of sync: healthcheck info: ${healthCheckObject}`);
                result = true;
            } else {
                result = await dbClient.replaceDocument(DATABASE_NAME, DB.AUTOSCALE.TableName,
                    document);
            }
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
        logger.warn('calling deleteInstanceHealthCheck');
        try {
            return !!await dbClient.deleteDocument(DATABASE_NAME, DB.AUTOSCALE.TableName,
                `${this.scalingGroupName}-${instanceId}`);
        } catch (error) {
            logger.warn('called deleteInstanceHealthCheck. error:', error);
            return false;
        }
    }

    async describeInstance(parameters) {
        logger.info('calling describeInstance');
        let virtualMachine, hitCache = '',
            readCache = !(parameters.readCache && parameters.readCache === false) &&
                    process.env.VM_INFO_CACHE_ENABLED &&
                    process.env.VM_INFO_CACHE_ENABLED.toLowerCase() === 'true';
        if (parameters.scaleSetName) {
            // use a proper method to get the vm
            if (isNaN(parameters.instanceId)) {
                // describe instance in vmss by vmid
                // get from cache if VM_INFO_CACHE_ENABLED (shoule be enabled by default)
                if (readCache) {
                    virtualMachine = await this.getVmInfoCache(parameters.scaleSetName, null,
                        parameters.instanceId);
                    hitCache = virtualMachine ? ' (hit cache)' : '';
                }
                if (!virtualMachine) {
                    virtualMachine = await computeClient.refVirtualMachineScaleSet(
                        parameters.scaleSetName).getVirtualMachineByVmId(parameters.instanceId);
                    if (virtualMachine) {
                        await this.setVmInfoCache(parameters.scaleSetName, virtualMachine,
                            virtualMachine.instanceId);
                    }
                }
            } else {
                // describe instance in vmss
                // get from cache if VM_INFO_CACHE_ENABLED (shoule be enabled by default)
                if (readCache) {
                    virtualMachine = await this.getVmInfoCache(parameters.scaleSetName,
                        parameters.instanceId);
                    hitCache = virtualMachine ? ' (hit cache)' : '';
                }
                if (!virtualMachine) {
                    virtualMachine = await computeClient.refVirtualMachineScaleSet(
                    parameters.scaleSetName).getVirtualMachine(parameters.instanceId);
                    if (virtualMachine) {
                        await this.setVmInfoCache(parameters.scaleSetName, virtualMachine,
                            virtualMachine.instanceId);
                    }
                }
            }

        } else {
            throw new Error('Not enough parameters to describe an instance > parameters:',
            parameters);
        }
        logger.info(`called describeInstance${hitCache}`);
        return virtualMachine && AutoScaleCore.VirtualMachine.fromAzureVm(virtualMachine);
    }

    /** @override */
    async getBlobFromStorage(parameters) {
        // the blob service requires two process env variables:
        // process.env.AZURE_STORAGE_ACCOUNT
        // process.env.AZURE_STORAGE_ACCESS_KEY
        let blobService = azureStorage.createBlobService();
        return await new Promise((resolve, reject) => {
            blobService.getBlobToText(parameters.path, parameters.fileName,
            (error, text, result, response) => {
                if (error) {
                    reject(error);
                } else if (response && response.statusCode === 200 || response.isSuccessful) {
                    resolve(response.body);
                } else {
                    reject(response);
                }
            });
        });
    }

    /** @override */
    async getSettingItem(key) {
        try {
            const keyExpression = {
                name: 'settingKey',
                value: key
            };
            let items = await dbClient.simpleQueryDocument(DATABASE_NAME, DB.SETTINGS.TableName,
                keyExpression);
            if (!Array.isArray(items) || items.length === 0) {
                return null;
            }
            return JSON.parse(items[0].settingValue);
        } catch (error) {
            logger.warn(`called getSettingItem (key: ${key}) > error: `, error);
            return null;
        }
    }

    async setSettingItem(key, jsonValue) {
        let document = {
            id: key,
            settingKey: key,
            settingValue: JSON.stringify(jsonValue)
        };
        try {
            return !!await dbClient.createDocument(DATABASE_NAME, DB.SETTINGS.TableName,
                document, true);// create new or replace existing
        } catch (error) {
            logger.warn('called setSettingItem > error: ', error, 'setSettingItem:', document);
            return false;
        }
    }

    async terminateInstanceInAutoScalingGroup(instance) {
        logger.info('calling terminateInstanceInAutoScalingGroup');
        try {
            let result = await computeClient.refVirtualMachineScaleSet(this.scalingGroupName)
            .deleteInstances([instance.instanceId]);
            logger.info('called terminateInstanceInAutoScalingGroup. done.', result);
            return true;
        } catch (error) {
            logger.warn('called terminateInstanceInAutoScalingGroup. failed.', error);
            return false;
        }
    }

    async getVmInfoCache(scaleSetName, instanceId, vmId = null) {
        let idValue = `${scaleSetName}-${instanceId || vmId}`;
        try {
            const filterExpression = [{
                name: vmId ? 'vmId' : 'instanceId',
                value: vmId ? vmId : instanceId
            },
            {
                name: 'asgName',
                value: scaleSetName
            }];

            let items = await dbClient.simpleQueryDocument(DATABASE_NAME, DB.VMINFOCACHE.TableName,
                null, filterExpression);
            if (!Array.isArray(items) || items.length === 0) {
                return null;
            }
            if (items[0].timestamp + VM_INFO_CACHE_TIME * 1000 < Date.now()) {
                logger.info('called getVmInfoCache > cached expired.');
                return null;
            }
            return JSON.parse(items[0].info);
        } catch (error) {
            logger.warn(`called getVmInfoCache (id: ${idValue}) > error: `, error);
            return null;
        }
    }

    async setVmInfoCache(scaleSetName, info) {
        let document = {
            id: `${scaleSetName}-${info.instanceId}`,
            instanceId: info.instanceId,
            vmId: info.properties.vmId,
            asgName: scaleSetName,
            info: typeof info === 'string' ? info : JSON.stringify(info),
            timestamp: Date.now()
        };
        try {
            return !!await dbClient.createDocument(DATABASE_NAME, DB.VMINFOCACHE.TableName,
                document, true);// create new or replace existing
        } catch (error) {
            logger.warn('called setSettingItem > error: ', error, 'setSettingItem:', document);
            return false;
        }
    }

    async saveLogToDb(log) {
        let timestamp = Date.now(), document = {
            id: `t-${timestamp}`,
            logContent: typeof log === 'string' ? log : JSON.stringify(log),
            timestamp: timestamp
        };
        try {
            return !!await dbClient.createDocument(DATABASE_NAME, DB.CUSTOMLOG.TableName,
                document, true);// create new or replace existing
        } catch (error) {
            logger.warn('called saveLogToDb > error: ', error, 'document item:', document);
            return false;
        }
    }

    // eslint-disable-next-line no-unused-vars
    async listLogFromDb(timeFrom, timeTo = null) {
        try {
            let items = await dbClient.simpleQueryDocument(DATABASE_NAME, DB.CUSTOMLOG.TableName,
                null, null, null, {
                    order: {
                        by: 'timestamp',
                        direction: 'asc'
                    }
                });
            if (!Array.isArray(items) || items.length === 0) {
                return [];
            }
            let logContent = '';
            items.forEach(item => {
                logContent += item.logContent;
            });
            return logContent;
        } catch (error) {
            return [];
        }
    }

    // end of azurePlatform class
}

class AzureAutoscaleHandler extends AutoScaleCore.AutoscaleHandler {
    constructor(myLogger = null) {
        super(new AzurePlatform(), '', myLogger);
        this._electionLock = null;
        this._selfInstance = null;
        this.scalingGroupName = null;
        this.masterScalingGroupName = null;
    }

    proxyResponse(statusCode, res) {
        let log = logger.log(`(${statusCode}) response body:`, res).flush();
        if (process.env.DEBUG_SAVE_CUSTOM_LOG && (!process.env.DEBUG_SAVE_CUSTOM_LOG_ON_ERROR ||
            process.env.DEBUG_SAVE_CUSTOM_LOG_ON_ERROR &&
            logger.errorCount > 0) && log !== '') {
            this.platform.saveLogToDb(log);
        }
        return {
            status: statusCode, /* Defaults to 200 */
            headers: {
                'Content-Type': 'text/plain'
            },
            body: typeof res.toString === 'function' ? res.toString() : JSON.stringify(res)
        };
    }

    async handle(context, event) {
        logger.info('start to handle autoscale');
        let proxyMethod = 'method' in event && event.method,
            result;
        try {
            await this.init();
            const instanceId = this.platform.extractRequestInfo(event).instanceId;
            // authenticate the calling instance
            if (!instanceId) {
                context.res = this.proxyResponse(403, 'Instance id not provided.');
                return;
            }
            await this.parseInstanceInfo(instanceId);

            if (!this.scalingGroupName) {
                // not trusted
                throw new Error(`Unauthorized calling instance (vmid: ${instanceId}). ` +
                'Instance not found in scale set.');
            }
            if (proxyMethod === 'GET') {
                // handle get config
                result = await this.handleGetConfig(event);
                context.res = this.proxyResponse(200, result);
            } else if (proxyMethod === 'POST') {
                result = await this.handleSyncedCallback(event);
                context.res = this.proxyResponse(200, result);
            }
        } catch (error) {
            logger.error(error);
            context.res = this.proxyResponse(500, error);
        }
    }

    /**
     * @override
     */
    async getBaseConfig() {
        let baseConfig = await this.getConfigSet('baseconfig');
        let psksecret = process.env.FORTIGATE_PSKSECRET,
            fazConfig = '',
            fazIp;
        if (baseConfig) {
            // check if other config set are required
            let requiredConfigSet = process.env.REQUIRED_CONFIG_SET.split(',');
            let configContent = '';
            for (let configset of requiredConfigSet) {
                let [name, selected] = configset.trim().split('-');
                if (selected && selected.toLowerCase() === 'yes') {
                    switch (name) {
                        // handle https routing policy
                        case 'httpsroutingpolicy':
                            configContent += await this.getConfigSet('internalelbweb');
                            configContent += await this.getConfigSet(name);
                            break;
                        // handle fortianalyzer logging config
                        case 'storelogtofaz':
                            fazConfig = await this.getConfigSet(name);
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
                .replace(new RegExp('{EXTERNAL_INTERFACE}', 'gm'), 'port1')
                .replace(new RegExp('{INTERNAL_INTERFACE}', 'gm'), 'port2')
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

    /** @override */
    // eslint-disable-next-line no-unused-vars
    async completeGetConfigLifecycleAction(instanceId, success) {
        // this method is required in a core method: handleSyncedCallback()
        // so need to implement it for any platform. However, life cycle handling not required in
        // Azure platform so this method simply returns a true
        return await Promise.resolve(true);
    }

    async handleGetConfig(event) {
        logger.info('calling handleGetConfig');
        let config,
            masterInfo;
        let duplicatedGetConfigCall = false, masterIp;

        // FortiGate actually returns its vmId instead of instanceid
        let instanceId = this.platform.extractRequestInfo(event).instanceId;

        // verify the caller (diagram: trusted source?)
        // get instance object from platform
        this._selfInstance = this._selfInstance ||
            await this.platform.describeInstance({
                instanceId: instanceId,
                scaleSetName: this.scalingGroupName
            });
        if (!this._selfInstance) {
            // not trusted
            throw new Error(`Unauthorized calling instance (vmid: ${instanceId}). ` +
            'Instance not found in scale set.');
        }
        // let result = await this.checkMasterElection();
        let promiseEmitter = this.checkMasterElection.bind(this),
            validator = result => {
                // if i am the master, don't wait, continue, if not, wait
                // this if-condition is to work around the double GET config calls.
                if (this._masterRecord && this._masterRecord.voteState === 'pending' &&
                this._selfInstance &&
                this._masterRecord.instanceId === this._selfInstance.instanceId &&
                this._masterRecord.asgName === this.scalingGroupName) {
                    duplicatedGetConfigCall = true;
                    masterIp = this._masterRecord.ip;
                    return true;
                }
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
            counter = currentCount => {
                logger.info(`wait for master election (attempt: #${currentCount})`);
                if (Date.now() < scriptExecutionExpireTime) {
                    return false;
                }
                throw new Error(`failed to wait for a result within ${currentCount} attempts.`);
            };

        try {
            masterInfo = await AutoScaleCore.waitFor(promiseEmitter, validator, 5000, counter);
        } catch (error) {
            logger.warn(error);
            // if error occurs, check who is holding a master election, if it is this instance,
            // terminates this election. then tear down this instance whether it's master or not.
            this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
            if (this._masterRecord &&
                this._masterRecord.instanceId === this._selfInstance.instanceId &&
                this._masterRecord.asgName === this._selfInstance.scalingGroupName) {
                await this.platform.removeMasterRecord();
            }
            // TODO: this works around the double GET call issue in fgt. need to uncomment once
            // the issue is fixed.
            if (duplicatedGetConfigCall) {
                await this.removeInstance(this._selfInstance);
            }

            throw new Error('Failed to determine the master instance within script timeout. ' +
            'This instance is unable to bootstrap. Please report this to administrators.');
        }

        // the master ip same as mine? (diagram: master IP same as mine?)
        // this checking for 'duplicatedGetConfigCall' is to work around
        // the double GET config calls.
        if (duplicatedGetConfigCall ||
            masterInfo.primaryPrivateIpAddress === this._selfInstance.primaryPrivateIpAddress) {
            this._step = 'handler:getConfig:getMasterConfig';
            // must pass the event to getCallbackEndpointUrl. this is different from the
            // implementation for AWS
            config = await this.getMasterConfig(await this.platform.getCallbackEndpointUrl(event));
            logger.info('called handleGetConfig: returning master config' +
                `(master-ip: ${masterIp || masterInfo.primaryPrivateIpAddress}):\n ${config}`);
            return config;
        } else {
            this._step = 'handler:getConfig:getSlaveConfig';
            config = await this.getSlaveConfig(masterInfo.primaryPrivateIpAddress,
                await this.platform.getCallbackEndpointUrl(event));
            logger.info('called handleGetConfig: returning slave config' +
                `(master-ip: ${masterInfo.primaryPrivateIpAddress}):\n ${config}`);
            return config;
        }
    }

    getCallingInstanceId(request) {
        return this.platform.extractRequestInfo(request).instanceId;
    }

    /** @override */
    async addInstanceToMonitor(instance, nextHeartBeatTime, masterIp = 'null') {
        logger.info('calling addInstanceToMonitor');
        let document = {
            id: `${this.scalingGroupName}-${instance.instanceId}`,
            ip: instance.primaryPrivateIpAddress,
            instanceId: instance.instanceId,
            asgName: this.scalingGroupName,
            nextHeartBeatTime: nextHeartBeatTime,
            heartBeatLossCount: 0,
            syncState: 'in-sync',
            masterIp: masterIp
        };

        try {
            let doc = await dbClient.createDocument(DATABASE_NAME, DB.AUTOSCALE.TableName,
                document);
            if (doc) {
                logger.info(`called addInstanceToMonitor: ${document.id} monitored.`);
                return true;
            } else {
                logger.error(`called addInstanceToMonitor: ${document.id} not monitored.`);
                return false;
            }
        } catch (error) {
            logger.error('addInstanceToMonitor > error', error);
            return false;
        }
    }

    /** @override */
    async purgeMaster() {
        let result = await this.platform.removeMasterRecord();
        return !!result;
    }

    /**
     * @override
     */
    async getMasterInfo() {
        logger.info('calling getMasterInfo');
        let instanceId;
        try {
            this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
            instanceId = this._masterRecord && this._masterRecord.instanceId;
        } catch (ex) {
            logger.error(ex);
        }
        return this._masterRecord && await this.platform.describeInstance(
            { instanceId: instanceId,
                scaleSetName: this._masterRecord.asgName
            });
    }

    /**
     * handle instance removal
     * @param {Object} instance the instance to remove. minimum required
     *      properties{vmId: <string>}
     */
    async removeInstance(instance) {
        try {
            await this.platform.terminateInstanceInAutoScalingGroup(instance);
            await this.removeInstanceFromMonitor(instance.instanceId);
            return true;
        } catch (error) {
            logger.error('called removeInstance > error:', error);
            return false;
        }
    }

    async handleGetLicense(context, event) {
        // TODO: this function is for Poc only for now
        try {
            await this.platform.init();
            // authenticate the calling instance
            const instanceId = this.getCallingInstanceId(event);
            if (!instanceId) {
                context.res = this.proxyResponse(403, 'Instance id not provided.');
                return;
            }
            let licenseFile = await this.platform.getBlobFromStorage({
                path: 'fgt-asg-license',
                fileName: 'license.lic'
            });
            context.res = this.proxyResponse(200, licenseFile);
        } catch (error) {
            logger.error(error);
            context.res = this.proxyResponse(500, error);
        }
    }

    async handleGetCustomLog(context, event) {
        // TODO: this function is for Poc only for now
        try {
            let psksecret;
            await this.platform.init();
            if (event && event.headers && event.headers.psksecret) {
                psksecret = event.headers.psksecret;
            }
            if (!(psksecret && psksecret === process.env.FORTIGATE_PSKSECRET)) {
                return;
            }
            context.res = this.proxyResponse(200, await this.platform.listLogFromDb(-1, 'html'));
            // context.res = this.proxyResponse(200, licenseFile);
        } catch (error) {
            logger.error(error);
            context.res = this.proxyResponse(500, error);
        }
    }

    async parseInstanceInfo(instanceId) {
        // look for this vm in both byol and payg vmss
        let cachedInfo = null;
        if (!this._selfInstance) {
            // look from cache first (if cache enabled){
            if (process.env.VM_INFO_CACHE_ENABLED) {
                // look from BYOL scaling group
                cachedInfo =
                    await this.platform.getVmInfoCache(
                            process.env.SCALING_GROUP_NAME_BYOL,
                            isNaN(instanceId) ? null : instanceId,
                            isNaN(instanceId) ? instanceId : null
                    );
                // found in BYOL
                if (cachedInfo) {
                    this.setScalingGroup(
                        process.env.MASTER_SCALING_GROUP_NAME,
                        process.env.SCALING_GROUP_NAME_BYOL
                    );
                } else {
                    // look from PAYG scaling group
                    cachedInfo =
                    await this.platform.getVmInfoCache(
                            process.env.SCALING_GROUP_NAME_PAYG,
                            isNaN(instanceId) ? null : instanceId,
                            isNaN(instanceId) ? instanceId : null
                    );
                    if (cachedInfo) {
                        this.setScalingGroup(
                            process.env.MASTER_SCALING_GROUP_NAME,
                            process.env.SCALING_GROUP_NAME_PAYG
                        );
                    }
                }
            }

            // if no instance info cache found, get instance info from platform
            if (!cachedInfo) {
                // look from byol first
                this._selfInstance = this._selfInstance || await this.platform.describeInstance({
                    instanceId: instanceId,
                    scaleSetName: process.env.SCALING_GROUP_NAME_BYOL,
                    readCache: false
                });
                if (this._selfInstance) {
                    this.setScalingGroup(
                    process.env.MASTER_SCALING_GROUP_NAME,
                    process.env.SCALING_GROUP_NAME_BYOL
                    );
                } else { // not found in byol vmss, look from payg
                    this._selfInstance = await this.platform.describeInstance({
                        instanceId: instanceId,
                        scaleSetName: process.env.SCALING_GROUP_NAME_PAYG,
                        readCache: false
                    });
                    if (this._selfInstance) {
                        this.setScalingGroup(
                        process.env.MASTER_SCALING_GROUP_NAME,
                        process.env.SCALING_GROUP_NAME_PAYG
                        );
                    }
                }
            }
        }
    }

    // end of AzureAutoscaleHandler class
}

exports.AutoScaleCore = AutoScaleCore; // get a reference to the core
exports.AzurePlatform = AzurePlatform;
exports.AzureAutoscaleHandler = AzureAutoscaleHandler;

/**
 * Initialize the module to be able to run via the 'handle' function.
 * Otherwise, this module only exposes some classes.
 * @returns {Object} exports
 */
function initModule() {
    // process.env.SCRIPT_EXECUTION_TIME_CHECKPOINT is used globally as the script approximate
    // starting time
    process.env.SCRIPT_EXECUTION_TIME_CHECKPOINT = Date.now();
    dbClient = new armClient.CosmosDB.ApiClient(process.env.SCALESET_DB_ACCOUNT,
        process.env.REST_API_MASTER_KEY);
    computeClient = new armClient.Compute.ApiClient(SUBSCRIPTION_ID, RESOURCE_GROUP);
    storageClient = new armClient.Storage.ApiClient(process.env.AZURE_STORAGE_ACCOUNT,
        process.env.AZURE_STORAGE_ACCESS_KEY);
    return exports;
}

/**
 * Handle the auto-scaling
 * @param {Object} context the Azure function app runtime context.
 * @param {*} req the request object to the Azure function app.
 */
exports.handle = async (context, req) => {
    // no way to get dynamic timeout time from runtime env so have to defined one in process env
    // Azure function has a weird hard limit of 230 sec to a http response time. see:
    // https://stackoverflow.com/questions/38673318/azure-asp-net-webapp-the-request-timed-out. and
    // https://github.com/Azure/azure-functions-host/issues/3391.  we set the execution expiry to
    // even earlier to bypass these issues.
    // now the script timeout is set to 200 seconds which is 30 seconds earlier.
    // Leave it some time for function finishing up.
    let scriptTimeOut = process.env.SCRIPT_TIMEOUT && !isNaN(process.env.SCRIPT_TIMEOUT) ?
        parseInt(process.env.SCRIPT_TIMEOUT) : 200000;
    if (scriptTimeOut <= 0 || scriptTimeOut > 200000) {
        scriptTimeOut = 200000;
    }
    scriptExecutionExpireTime = Date.now() + scriptTimeOut;
    logger = new AzureLogger(context.log);
    armClient.useLogger(logger);
    if (process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED &&
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED.toLowerCase() === 'true') {
        logger.outputQueue = true;
        if (process.env.DEBUG_LOGGER_TIMEZONE_OFFSET) {
            logger.timeZoneOffset = process.env.DEBUG_LOGGER_TIMEZONE_OFFSET;
        }
    }
    const handler = new AzureAutoscaleHandler();
    handler.useLogger(logger);
    initModule();
    logger.log(`Incoming request: ${JSON.stringify(req)}`);
    return await handler.handle(context, req);
};

exports.handleGetLicense = async (context, req) => {
    // no way to get dynamic timeout time from runtime env so have to defined one in process env
    // Azure function has a weird hard limit of 230 sec to a http response time. see:
    // https://stackoverflow.com/questions/38673318/azure-asp-net-webapp-the-request-timed-out. and
    // https://github.com/Azure/azure-functions-host/issues/3391.  we set the execution expriry to
    // even earlier to bypass these issues.
    // now the script timeout is set to 200 seconds which is 30 seconds earlier.
    // Leave it some time for function finishing up.
    let scriptTimeOut = process.env.SCRIPT_TIMEOUT && !isNaN(process.env.SCRIPT_TIMEOUT) ?
        parseInt(process.env.SCRIPT_TIMEOUT) : 200000;
    if (scriptTimeOut <= 0 || scriptTimeOut > 200000) {
        scriptTimeOut = 200000;
    }
    scriptExecutionExpireTime = Date.now() + scriptTimeOut;
    logger = new AzureLogger(context.log);
    armClient.useLogger(logger);
    if (process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED &&
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED.toLowerCase() === 'true') {
        logger.outputQueue = true;
        if (process.env.DEBUG_LOGGER_TIMEZONE_OFFSET) {
            logger.timeZoneOffset = process.env.DEBUG_LOGGER_TIMEZONE_OFFSET;
        }
    }
    const handler = new AzureAutoscaleHandler();
    handler.useLogger(logger);
    initModule();
    logger.log(`Incoming request: ${JSON.stringify(req)}`);
    return await handler.handleGetLicense(context, req);
};

exports.handleListCustomLog = async (context, req) => {
    logger = new AzureLogger(context.log);
    armClient.useLogger(logger);
    const handler = new AzureAutoscaleHandler();
    handler.useLogger(logger);
    initModule();
    return await handler.handleGetCustomLog(context, req);
};

/**
 * expose the module runtime id
 * @returns {String} a unique id.
 */
exports.moduleRuntimeId = () => moduleId;
exports.initModule = initModule;
exports.AutoScaleCore = AutoScaleCore; // get a reference to the core
exports.AzurePlatform = AzurePlatform;
exports.AzureAutoscaleHandler = AzureAutoscaleHandler;
exports.settingItems = settingItems;
exports.logger = logger;
