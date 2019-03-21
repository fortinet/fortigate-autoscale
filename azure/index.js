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
        parseInt(process.env.ELECTION_WAIT_TIME) * 1000 : 60000; // in ms

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
    async getInstanceHealthCheck(instance, heartBeatInterval = null) {
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
                interval,
                healthCheckRecord,
                items = await dbClient.simpleQueryDocument(DATABASE_NAME, DB.AUTOSCALE.TableName,
                keyExpression, filterExpression);
            if (!Array.isArray(items) || items.length === 0) {
                logger.info('called getInstanceHealthCheck: no record found');
                return null;
            }
            healthCheckRecord = items[0];
            // to get a more accurate heart beat elapsed time, the script execution time so far
            // is compensated.
            compensatedScriptTime = process.env.SCRIPT_EXECUTION_TIME_CHECKPOINT;
            healthy = compensatedScriptTime < healthCheckRecord.nextHeartBeatTime;
            interval = heartBeatInterval && !isNaN(heartBeatInterval) ?
                heartBeatInterval : healthCheckRecord.heartBeatInterval;
            if (compensatedScriptTime < healthCheckRecord.nextHeartBeatTime) {
                // reset hb loss cound if instance sends hb within its interval
                healthy = true;
                heartBeatLossCount = 0;
            } else {
                // if the current sync heartbeat is late, the instance is still considered
                // healthy unless 3 times of heartBeatInterval amount of time has passed.
                // where the instance have 0% chance to catch up with a heartbeat sync
                healthy = healthCheckRecord.heartBeatLossCount < 3 &&
                    Date.now() < healthCheckRecord.nextHeartBeatTime +
                        interval * 1000 * (2 - healthCheckRecord.heartBeatLossCount);
                heartBeatLossCount = healthCheckRecord.heartBeatLossCount + 1;
            }
            logger.info(`called getInstanceHealthCheck. (time: ${compensatedScriptTime}, ` +
                `interval:${heartBeatInterval}) healthcheck record:`,
                JSON.stringify(healthCheckRecord));
            return {
                instanceId: instance.instanceId,
                ip: healthCheckRecord.ip ? healthCheckRecord.ip : '',
                healthy: healthy,
                heartBeatLossCount: heartBeatLossCount,
                heartBeatInterval: interval,
                nextHeartBeatTime: Date.now() + interval * 1000,
                masterIp: healthCheckRecord.masterIp,
                syncState: healthCheckRecord.syncState,
                inSync: healthCheckRecord.syncState === 'in-sync'
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
                instanceId: healthCheckObject.instanceId,
                ip: healthCheckObject.ip,
                asgName: this.scalingGroupName,
                nextHeartBeatTime: checkPointTime + heartBeatInterval * 1000,
                heartBeatLossCount: healthCheckObject.heartBeatLossCount,
                heartBeatInterval: heartBeatInterval,
                syncState: healthCheckObject.healthy && !forceOutOfSync ? 'in-sync' : 'out-of-sync',
                masterIp: masterIp ? masterIp : 'null'
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
            readCache = !(parameters.readCache !== undefined && parameters.readCache === false) &&
                    process.env.VM_INFO_CACHE_ENABLED &&
                    process.env.VM_INFO_CACHE_ENABLED.toLowerCase() === 'true';
        if (parameters.scalingGroupName) {
            // use a proper method to get the vm
            if (isNaN(parameters.instanceId)) {
                // describe instance in vmss by vmid
                // get from cache if VM_INFO_CACHE_ENABLED (shoule be enabled by default)
                if (readCache) {
                    virtualMachine = await this.getVmInfoCache(parameters.scalingGroupName, null,
                        parameters.instanceId);
                    hitCache = virtualMachine ? ' (hit cache)' : '';
                }
                if (!virtualMachine) {
                    virtualMachine = await computeClient.refVirtualMachineScaleSet(
                        parameters.scalingGroupName).getVirtualMachineByVmId(parameters.instanceId);
                    if (virtualMachine) {
                        await this.setVmInfoCache(parameters.scalingGroupName, virtualMachine,
                            virtualMachine.instanceId);
                    }
                }
            } else {
                // describe instance in vmss
                // get from cache if VM_INFO_CACHE_ENABLED (shoule be enabled by default)
                if (readCache) {
                    virtualMachine = await this.getVmInfoCache(parameters.scalingGroupName,
                        parameters.instanceId);
                    hitCache = virtualMachine ? ' (hit cache)' : '';
                }
                if (!virtualMachine) {
                    virtualMachine = await computeClient.refVirtualMachineScaleSet(
                    parameters.scalingGroupName).getVirtualMachine(parameters.instanceId);
                    if (virtualMachine) {
                        await this.setVmInfoCache(parameters.scalingGroupName, virtualMachine,
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
        let blobService = storageClient.refBlobService();
        let queries = [];
        queries.push(new Promise((resolve, reject) => {
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
        }));
        if (parameters.getProperties) {
            queries.push(new Promise((resolve, reject) => {
                blobService.getBlobProperties(parameters.path, parameters.fileName,
                (error, result, response) => {
                    if (error) {
                        reject(error);
                    } else if (response && response.statusCode === 200 || response.isSuccessful) {
                        resolve(result);
                    } else {
                        reject(response);
                    }
                });
            }));
        }
        let result = await Promise.all(queries);
        return {
            content: result[0],
            properties: parameters.getProperties && result[1] ? result[1] : null
        };
    }

    /** @override */
    async listBlobFromStorage(parameters) {
        let blobService = storageClient.refBlobService();
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
                return '';
            }
            return items.join('');
        } catch (error) {
            return '';
        }
    }

    async deleteLogFromDb(timeFrom, timeTo = null) {
        try {
            let timeRangeFrom = timeFrom && !isNaN(timeFrom) ? parseInt(timeFrom) : 0,
                timeRangeTo = timeTo && !isNaN(timeTo) ? parseInt(timeTo) : Date.now();
            let deletionTasks = [], errorTasks = [];
            let items = await dbClient.simpleQueryDocument(DATABASE_NAME, DB.CUSTOMLOG.TableName,
                null, null, null, {
                    order: {
                        by: 'timestamp',
                        direction: 'asc'
                    }
                });
            if (!Array.isArray(items) || items.length === 0) {
                return `${deletionTasks.length} rows deleted. ${errorTasks.length} error rows.`;
            }
            items.forEach(item => {
                if (item.timestamp >= timeRangeFrom && item.timestamp <= timeRangeTo) {
                    deletionTasks.push(
                        dbClient.deleteDocument(DATABASE_NAME, DB.CUSTOMLOG.TableName,
                        item.id).catch(e => {
                            errorTasks.push(item);
                            return e;
                        }));
                }
            });
            await Promise.all(deletionTasks);
            return `${deletionTasks.length} rows deleted. ${errorTasks.length} error rows.`;
        } catch (error) {
            return false;
        }
    }

    genLicenseFileSimpleKey(fileName, eTag) {
        return `${eTag}-${fileName}`;
    }

    async listLicenseFiles() {
        let blobService = storageClient.refBlobService();
        return await new Promise((resolve, reject) => {
            blobService.listBlobsSegmented('fgt-asg-license', null,
            (error, data) => {
                if (error) {
                    reject(error);
                } else {
                    if (data && data.entries) {
                        let iterable = data.entries.map(item => {
                            return [this.genLicenseFileSimpleKey(item.name, item.eTag),
                                item];
                        });
                        resolve(new Map(iterable));
                    } else {
                        resolve(new Map());
                    }
                }
            });
        });
    }

    /** @override */
    async listLicenseUsage() {
        try {
            let items = await dbClient.simpleQueryDocument(DATABASE_NAME,
                DB.LICENSEUSAGE.TableName);
            if (!Array.isArray(items) || items.length === 0) {
                return new Map();
            }
            let iterable = items.map(item => [item['sha1-checksum'], item]);
            return new Map(iterable);
        } catch (error) {
            return new Map();
        }
    }

    /** @override */
    async updateLicenseUsage(parameters) {
        let document = {
            id: parameters.stockItem.checksum,
            'sha1-checksum': parameters.stockItem.checksum,
            filePath: parameters.stockItem.filePath,
            fileName: parameters.stockItem.fileName,
            asgName: parameters.asgName,
            instanceId: parameters.instanceId,
            assignedTime: Date.now()
        };

        try {
            let doc = await dbClient.createDocument(DATABASE_NAME, DB.LICENSEUSAGE.TableName,
                document, true);
            if (doc) {
                return true;
            } else {
                return false;
            }
        } catch (error) {
            logger.error('updateLicenseUsage > error', error);
            return false;
        }
    }

    /** @override */
    async listLicenseStock() {
        try {
            let items = await dbClient.simpleQueryDocument(DATABASE_NAME,
                DB.LICENSESTOCK.TableName);
            if (!Array.isArray(items) || items.length === 0) {
                return new Map();
            }
            let iterable = items.map(item => [item.checksum, item]);
            return new Map(iterable);
        } catch (error) {
            return new Map();
        }
    }

    /** @override */
    async updateLicenseStock(parameters) {
        // eTag is originally wrapped with a pair of double quotes.
        let eTag = parameters.item.properties.etag.replace(new RegExp('"', 'g'), '');
        let document = {
            id: parameters.checksum,
            checksum: parameters.checksum,
            filePath: parameters.item.properties.container,
            fileName: parameters.item.properties.name,
            algorithm: parameters.algorithm,
            fileETag: eTag
        };

        try {
            let doc = await dbClient.createDocument(DATABASE_NAME, DB.LICENSESTOCK.TableName,
                document, parameters.replace !== null ? parameters.replace : true);
            if (doc) {
                return true;
            } else {
                return false;
            }
        } catch (error) {
            throw error;
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
            body: typeof res.toString === 'function' && res.toString() !== '[object Object]' ?
                res.toString() : JSON.stringify(res)
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
                scalingGroupName: this.scalingGroupName
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
                // if i am the master, don't wait, continue, if not, wait
                if (result &&
                result.primaryPrivateIpAddress === this._selfInstance.primaryPrivateIpAddress) {
                    return true;
                } else if (result && this._masterRecord &&
                        this._masterRecord.voteState === 'done') {
                    // master election done
                    return true;
                } else if (this._masterRecord && this._masterRecord.voteState === 'pending') {
                // master election not done, wait for a moment
                // clear the current master record cache and get a new one in the next call
                    this._masterRecord = null;
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
            if (this._masterRecord.instanceId === this._selfInstance.instanceId &&
                this._masterRecord.asgName === this._selfInstance.scalingGroupName) {
                await this.platform.removeMasterRecord();
            }
            // await this.removeInstance(this._selfInstance);
            throw new Error('Failed to determine the master instance within script timeout. ' +
            'This instance is unable to bootstrap. Please report this to administrators.');
        }

        // the master ip same as mine? (diagram: master IP same as mine?)
        // this checking for 'duplicatedGetConfigCall' is to work around
        // the double GET config calls.
        // TODO: remove the workaround if mantis item: #0534971 is consumed
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
    async addInstanceToMonitor(instance, heartBeatInterval, masterIp = 'null') {
        logger.info('calling addInstanceToMonitor');
        let document = {
            id: `${this.scalingGroupName}-${instance.instanceId}`,
            instanceId: instance.instanceId,
            ip: instance.primaryPrivateIpAddress,
            asgName: this.scalingGroupName,
            nextHeartBeatTime: Date.now() + heartBeatInterval * 1000,
            heartBeatLossCount: 0,
            heartBeatInterval: heartBeatInterval,
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
                scalingGroupName: this._masterRecord.asgName
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
        // for a consideration of a large volume of license files:
        // could use Azure Event Gridsubscription to update the license file list in the db
        // but since the volume of files is so small, there's no big impact on performance.
        // in conclusion, no need to use Event Grid.
        // for a small amount of license file (such as less than 10 files):
        // could list all file whenever comes a get-license request.
        try {
            await this.platform.init();
            // authenticate the calling instance
            const requestInfo = this.platform.extractRequestInfo(event);
            if (!requestInfo.instanceId) {
                context.res = this.proxyResponse(403, 'Instance id not provided.');
                return;
            }
            await this.parseInstanceInfo(requestInfo.instanceId);

            if (!(this._selfInstance && this.scalingGroupName)) {
                throw new Error('Unauthorized calling instance ' +
                `(vmid: ${requestInfo.instanceId}). Instance not found in scale set.`);
            }

            let [licenseFiles, stockRecords, usageRecords] = await Promise.all([
                this.platform.listLicenseFiles(),// expect it to return a map
                this.platform.listLicenseStock(),// expect it to return a map
                this.platform.listLicenseUsage() // expect it to return a map
            ]);

            // update the license stock records on db if any change in file storage
            // this returns the newest stockRecords on the db
            stockRecords = await this.updateLicenseStockRecord(licenseFiles, stockRecords);

            let availStockItem,
                updateUsage = true;

            let itemKey, itemValue;

            // TODO: remove the workaround if mantis item: #0534971 is consumed
            // a workaround for dobule get call:
            // check if a license is already assigned to one fgt, if it makes a second get call
            // for license, returns the tracked usage record.

            for ([itemKey, itemValue] of usageRecords.entries()) {
                if (itemValue.asgName === this.scalingGroupName &&
                    itemValue.instanceId === this._selfInstance.instanceId) {
                    availStockItem = itemValue;
                    updateUsage = false;
                    break;
                }
            }

            // this is a greedy approach
            // try to find one available license and use it.
            // if none availabe, try to check if any used one could be recycled.
            // if none recyclable, throw an error.

            if (!availStockItem) {
                for ([itemKey, itemValue] of stockRecords.entries()) {
                    if (itemKey && !usageRecords.has(itemKey)) {
                        availStockItem = itemValue;
                        break;
                    }
                }

                // if not found available license file
                if (!availStockItem) {
                    [availStockItem] = await this.findRecycleableLicense(stockRecords,
                        usageRecords, 1);
                }
            }

            if (!availStockItem) {
                throw new Error('No license available.');
            }

            let licenseFile = await this.platform.getBlobFromStorage({
                path: availStockItem.filePath,
                fileName: availStockItem.fileName
            });

            // license file found
            // update usage records
            if (updateUsage) {
                await this.platform.updateLicenseUsage({
                    stockItem: availStockItem,
                    asgName: this.scalingGroupName,
                    instanceId: this._selfInstance.instanceId
                });
            }
            context.res = this.proxyResponse(200, licenseFile.content);
        } catch (error) {
            logger.error(error);
            context.res = this.proxyResponse(500, error);
        }
    }

    async updateLicenseStockRecord(licenseFiles, stockRecords) {
        if (licenseFiles instanceof Map && stockRecords instanceof Map) {
            let fileQueries = [],
                untrackedFiles = new Map(licenseFiles.entries());// copy the map
            try {
                if (stockRecords.size > 0) {
                    // filter out tracked license files
                    stockRecords.forEach(item => {
                        let licenseFileKey =
                            this.platform.genLicenseFileSimpleKey(item.fileName, item.fileETag);
                        if (licenseFiles.has(licenseFileKey)) {
                            untrackedFiles.delete(licenseFileKey);
                        }
                    }, this);
                }
                untrackedFiles.forEach(item => {
                    fileQueries.push(this.platform.getBlobFromStorage({
                        path: 'fgt-asg-license',
                        fileName: item.name,
                        getProperties: true
                    }).catch(() => {
                        return null;
                    }));
                }, this);
                let fileObjects = await Promise.all(fileQueries);
                let updateTasks = [];
                fileObjects.forEach(item => {
                    if (item) {
                        let algorithm = 'sha1',
                            checksum = AutoScaleCore.calStringChecksum(item.content, algorithm);
                        // duplicate license
                        if (stockRecords.has(checksum)) {
                            logger.warn('updateLicenseStockRecord > warning: duplicate' +
                                    ` license found: filename: ${item.properties.name}`);
                        } else {
                            updateTasks.push((function(fileItem, ref) {
                                return ref.platform.updateLicenseStock(
                                    {
                                        item: fileItem,
                                        checksum: checksum,
                                        algorithm: algorithm,
                                        replace: false}
                                ).catch(error => {
                                    logger.error(error);
                                });
                            })(item, this));
                        }
                    }
                }, this);
                await Promise.all(updateTasks);
                return updateTasks.length > 0 ? this.platform.listLicenseStock() : stockRecords;
            } catch (error) {
                logger.error(error);
            }
        } else {
            return stockRecords;
        }
    }

    async findRecycleableLicense(stockRecords, usageRecords, limit = 'all') {
        if (stockRecords instanceof Map && usageRecords instanceof Map) {
            let gracePeriod = 600; // seconds
            if (process.env.GET_LICENSE_GRACE_PERIOD &&
                !isNaN(process.env.GET_LICENSE_GRACE_PERIOD)) {
                gracePeriod = parseInt(process.env.GET_LICENSE_GRACE_PERIOD);
            }
            // do health check on each item
            let queries = [], healthCheckResults, recyclableRecords = [], count = 0, maxCount;
            if (limit === 'all' || isNaN(limit) || parseInt(limit) <= 0) {
                maxCount = -1; // set a negative max count to indicate no limit
            } else {
                maxCount = parseInt(limit); // set a positive maxcount
            }
            usageRecords.forEach(item => {
                if (item.instanceId && item.asgName) {
                    queries.push(async function(rec, ref) {
                        // get instance health check and instance info
                        let tasks = [];
                        tasks.push(
                            ref.platform.getInstanceHealthCheck({
                                instanceId: rec.instanceId,
                                asgName: rec.asgName
                            }, 3600000).catch(() => null));
                        tasks.push(
                            ref.platform.describeInstance({
                                instanceId: item.instanceId,
                                scalingGroupName: item.asgName,
                                readCache: false
                            }).catch(() => null));
                        let [healthCheck, instance] = await Promise.all(tasks);
                        return {
                            checksum: rec['sha1-checksum'],
                            usageRecord: rec,
                            healthCheck: healthCheck,
                            instance: instance
                        };
                    }(item, this));
                }
            }, this);
            healthCheckResults = await Promise.all(queries);
            for (let result of healthCheckResults) {
                // recycle this stock record if checksum (of a license file) exists and the
                // corresponding instance which used this license doesn't exist or is unhealthy
                // there's a situation when one fgt was assigned one license, the fgt need time
                // to get config, boot up, become available, and start to send hb.
                // until then the healch check of that fgt won't be available. therefore, here
                // the script sets a grace period for the fgt to complete the whole process.
                // if the fgt instance exists, but no healthcheck record, if the grace period has
                // passed, recycle the license.
                if (stockRecords.has(result.checksum)) {
                    let recyclable = false;
                    // if instance is gone? recycle the license
                    if (!result.instance) {
                        recyclable = true;
                    } else if (result.instance && result.healthCheck &&
                        !result.healthCheck.healthy) {
                        // if instance exists but instance is unhealth? recycle the license
                        recyclable = true;
                    } else if (result.instance && !result.healthCheck && result.usageRecord &&
                        Date.now() > result.usageRecord.assignedTime + gracePeriod * 1000) {
                        // if instance exists but no healthcheck and grace period has passed?
                        recyclable = true;
                    }
                    // recycle the recyclable license
                    if (recyclable) {
                        count ++;
                        if (maxCount < 0 || count <= maxCount) {
                            recyclableRecords.push(stockRecords.get(result.checksum));
                            if (count === maxCount) {
                                break;
                            }
                        }
                    }
                }
            }
            return recyclableRecords;
        }
    }

    async handleGetCustomLog(context, event) {
        // TODO: this function should be inaccessible on production
        try {
            let psksecret, proxyMethod = 'method' in event && event.method, result = '';
            let timeFrom, timeTo;
            await this.platform.init();
            if (event && event.headers) {
                if (event.headers.psksecret) {
                    psksecret = event.headers.psksecret;
                }
                timeFrom = event.headers.timefrom ? event.headers.timefrom : 0;
                timeTo = event.headers.timeto ? event.headers.timeto : null;
            }
            if (!(psksecret && psksecret === process.env.FORTIGATE_PSKSECRET)) {
                return;
            }
            switch (proxyMethod && proxyMethod.toUpperCase()) {
                case 'GET':
                    result = await this.platform.listLogFromDb(-1, 'html');
                    break;
                case 'DELETE':
                    if (timeFrom && isNaN(timeFrom)) {
                        try {
                            timeFrom = new Date(timeFrom).getTime();
                        } catch (error) {
                            timeFrom = 0;
                        }
                    }
                    if (timeTo && isNaN(timeTo)) {
                        try {
                            timeTo = new Date(timeTo).getTime();
                        } catch (error) {
                            timeTo = null;
                        }
                    }
                    result = await this.platform.deleteLogFromDb(timeFrom, timeTo);
                    break;
                default:
                    break;
            }
            context.res = this.proxyResponse(200, result);
            // context.res = this.proxyResponse(200, licenseFile);
        } catch (error) {
            logger.error(error);
            context.res = this.proxyResponse(500, error);
        }
    }

    async parseInstanceInfo(instanceId) {
        // look for this vm in both byol and payg vmss
        // look from byol first
        this._selfInstance = this._selfInstance || await this.platform.describeInstance({
            instanceId: instanceId,
            scalingGroupName: process.env.SCALING_GROUP_NAME_BYOL
        });
        if (this._selfInstance) {
            this.setScalingGroup(
                process.env.MASTER_SCALING_GROUP_NAME,
                process.env.SCALING_GROUP_NAME_BYOL
            );
        } else { // not found in byol vmss, look from payg
            this._selfInstance = await this.platform.describeInstance({
                instanceId: instanceId,
                scalingGroupName: process.env.SCALING_GROUP_NAME_PAYG
            });
            if (this._selfInstance) {
                this.setScalingGroup(
                    process.env.MASTER_SCALING_GROUP_NAME,
                    process.env.SCALING_GROUP_NAME_PAYG
                );
            }
        }
        if (this._selfInstance) {
            logger.info(`instance identification (id: ${this._selfInstance.instanceId}, ` +
        `scaling group self: ${this.scalingGroupName}, master: ${this.masterScalingGroupName})`);
        } else {
            logger.warn(`cannot identify instance: vmid:(${instanceId})`);
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
        parseInt(process.env.SCRIPT_TIMEOUT) * 1000 : 200000;
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
        parseInt(process.env.SCRIPT_TIMEOUT) * 1000 : 200000;
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
