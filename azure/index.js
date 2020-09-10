'use strict';

/*
FortiGate Autoscale Azure Module (1.0.0)
Author: Fortinet
*/

exports = module.exports;
const AutoScaleCore = require('fortigate-autoscale-core');
const armClient = require('./azure-arm-client');
const UNIQUE_ID = process.env.UNIQUE_ID || '';
const RESOURCE_TAG_PREFIX = process.env.RESOURCE_TAG_PREFIX || '';
const DATABASE_NAME = `FortiGateAutoscale${UNIQUE_ID}`;
const DB = AutoScaleCore.dbDefinitions.getTables(RESOURCE_TAG_PREFIX);
const MINIMUM_REQUIRED_DB_TABLE_KEYS = [
    'FORTIGATEAUTOSCALE',
    'FORTIGATEPRIMARYELECTION',
    'SETTINGS'
];
const moduleId = AutoScaleCore.Functions.uuidGenerator(
    JSON.stringify(`${__filename}${Date.now()}`)
);
const settingItems = AutoScaleCore.settingItems;
const SCRIPT_TIMEOUT =
    isNaN(process.env.SCRIPT_TIMEOUT) ||
    parseInt(process.env.SCRIPT_TIMEOUT) <= 0 ||
    parseInt(process.env.SCRIPT_TIMEOUT) > 2000
        ? 200000
        : parseInt(process.env.SCRIPT_TIMEOUT) * 1000; // script timeout need to set as env var

var logger = new AutoScaleCore.DefaultLogger();
var dbClient, computeClient, storageClient;

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
        let self = this;
        let checkDatabaseAvailability = async function() {
                let attempts = 0,
                    maxAttempts = 3,
                    done = false,
                    error;
                while (attempts < maxAttempts) {
                    try {
                        attempts++;
                        logger.info(`calling checkDatabaseAvailability (attempts: ${attempts})`);
                        let result = await dbClient.listDataBases();
                        if (
                            result &&
                            result.body &&
                            result.body.Databases &&
                            Array.isArray(result.body.Databases)
                        ) {
                            let arr = result.body.Databases.filter(element => {
                                return element.id === DATABASE_NAME;
                            });
                            if (arr.length === 1) {
                                logger.info(
                                    'called checkDatabaseAvailability. DB ' +
                                        `(${DATABASE_NAME}) found.`
                                );
                                done = true;
                            } else {
                                logger.info(
                                    'called checkDatabaseAvailability. DB ' +
                                        `(${DATABASE_NAME}) not found.`
                                );
                            }
                            break;
                        }
                    } catch (e) {
                        if (e.statusCode && e.statusCode === 404) {
                            logger.info(
                                'called checkDatabaseAvailability. DB ' +
                                    `(${DATABASE_NAME}) not found.`
                            );
                            break;
                        } else {
                            error = e;
                            logger.info('called checkDatabaseAvailability. DB > error:');
                            logger.error(JSON.stringify(e));
                        }
                    }
                }
                if (error) {
                    throw error;
                }
                return done;
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
                    throw new Error(
                        'called provisionDatabase > ' + `unknown error:${JSON.stringify(result)}`
                    );
                }
            },
            initDB = async function() {
                try {
                    let collectionNames = Object.entries(DB)
                        .filter(tableEntry => {
                            return MINIMUM_REQUIRED_DB_TABLE_KEYS.includes(tableEntry[0]);
                        })
                        .map(filteredTableEntry => DB[filteredTableEntry[0]].TableName);
                    let available = await checkDatabaseAvailability();
                    if (!available) {
                        await createDatabase();
                        await self.createCollections(collectionNames);
                    } else {
                        await self
                            .checkCollectionsAvailability(collectionNames)
                            .then(missingCollections => self.createCollections(missingCollections));
                    }
                    return true;
                } catch (error) {
                    logger.error(error);
                    logger.warn('some tables are missing, script stops running.');
                    throw error;
                }
            },
            initBlobStorage = async function() {
                if (!(process.env.AZURE_STORAGE_ACCOUNT && process.env.AZURE_STORAGE_ACCESS_KEY)) {
                    throw new Error('missing storage account and access key.');
                }
                return await Promise.resolve(true);
            };
        let dbCheckPassed = true;
        await Promise.all([
            initBlobStorage(),
            initDB().catch(() => {
                dbCheckPassed = false;
            }),
            armClient.authWithServicePrincipal(
                process.env.REST_APP_ID,
                process.env.REST_APP_SECRET,
                process.env.TENANT_ID
            )
        ]).catch(error => {
            throw error;
        });
        // mark this platform class instance is initialized.
        this._initialized = dbCheckPassed && true;
        return this._initialized;
    }

    async checkCollectionsAvailability(collections = []) {
        if (!Array.isArray(collections) || collections.length === 0) {
            return [];
        }
        let result = await dbClient.listCollections(DATABASE_NAME);
        let missingCollections = [];
        if (
            result.body &&
            result.body.DocumentCollections &&
            result.body.DocumentCollections.length >= 0
        ) {
            let existingCollections = result.body.DocumentCollections.map(element => {
                return element.id;
            });
            missingCollections = collections.filter(collectionName => {
                return !existingCollections.includes(collectionName);
            });
        }
        logger.info(
            'called checkCollectionsAvailability.' +
                `${missingCollections.length} collections missing.`
        );
        return missingCollections;
    }

    async createCollections(collections) {
        let collectionCreationPromises = [];
        if (!Array.isArray(collections) || collections.length === 0) {
            return Promise.resolve(true);
        }
        var createCollection = async function(collection) {
            let result = await dbClient.createCollection(DATABASE_NAME, collection.TableName, [
                collection.KeySchema[0].AttributeName
            ]);
            if (result.statusCode === 201) {
                logger.info(`Collection (${collection.TableName}) created.`);
                return true;
            } else if (result.statusCode === 409) {
                logger.info(`Collection (${collection.TableName}) already exists.`);
                return true;
            } else {
                logger.info('Unknown response from API:', JSON.stringify(result));
                return false;
            }
        };
        collections.forEach(collectionName => {
            let [table] = Object.values(DB).filter(
                tableDef => tableDef.TableName === collectionName
            );
            if (table) {
                collectionCreationPromises.push(createCollection(table));
            }
        });
        try {
            await Promise.all(collectionCreationPromises);
            logger.info('called createCollections > successful.');
            return true;
        } catch (error) {
            logger.info('called createCollections > error:', error);
            throw error;
        }
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
        try {
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
                if (
                    request &&
                    request.body &&
                    request.body.interval &&
                    !isNaN(request.body.interval)
                ) {
                    interval = parseInt(request.body.interval);
                }
            }
        } catch (error) {
            logger.error('invalid JSON format in request body');
            logger.error(error);
        }

        logger.info(
            `called extractRequestInfo: extracted: instance Id(${instanceId}), ` +
                `interval(${interval}), status(${status})`
        );
        return {
            instanceId,
            interval,
            status
        };
    }

    /** @override */
    async putPrimaryRecord(candidateInstance, voteState, method = 'new') {
        try {
            let electionTimeout = parseInt(this._settings['primary-election-timeout']);
            let document = {
                id: this.primaryScalingGroupName,
                scalingGroupName: this.primaryScalingGroupName,
                ip: candidateInstance.primaryPrivateIpAddress,
                instanceId: candidateInstance.instanceId,
                vpcId: candidateInstance.virtualNetworkId,
                subnetId: candidateInstance.subnetId,
                voteEndTime: Date.now() + (electionTimeout - 5) * 1000,
                voteState: voteState
            };
            const TABLE = DB.FORTIGATEPRIMARYELECTION;
            return !!(await dbClient.createDocument(
                DATABASE_NAME,
                TABLE.TableName,
                document,
                TABLE.KeySchema[0].AttributeName,
                method === 'replace'
            ));
        } catch (error) {
            logger.warn(
                'error occurs in putPrimaryRecord:',
                JSON.stringify(
                    error instanceof Error ? { message: error.message, stack: error.stack } : error
                )
            );
            return false;
        }
    }

    /**
     * Get the primary record from db
     * @returns {Object} Primary record of the FortiGate which should be the auto-sync primary
     */
    async getPrimaryRecord() {
        const keyExpression = {
            name: 'scalingGroupName',
            value: this.primaryScalingGroupName
        };
        const TABLE = DB.FORTIGATEPRIMARYELECTION;
        let items = await dbClient.simpleQueryDocument(
            DATABASE_NAME,
            TABLE.TableName,
            keyExpression,
            null,
            {
                crossPartition: true
            }
        );
        if (!Array.isArray(items) || items.length === 0) {
            logger.info('No elected primary was found in the db!');
            return null;
        }
        logger.info(`Elected primary found: ${JSON.stringify(items[0])}`, JSON.stringify(items));
        return items[0];
    }

    /** @override */
    async removePrimaryRecord() {
        try {
            const TABLE = DB.FORTIGATEPRIMARYELECTION;
            return await dbClient.deleteDocument(
                DATABASE_NAME,
                TABLE.TableName,
                this.primaryScalingGroupName,
                true
            );
        } catch (error) {
            if (error.statusCode && error.statusCode === 404) {
                return true; // ignore if the file to delete not exists.
            }
        }
    }

    async finalizePrimaryElection() {
        try {
            logger.info('calling finalizePrimaryElection');
            let electedPrimary = this._primaryRecord || (await this.getPrimaryRecord());
            electedPrimary.voteState = 'done';
            const TABLE = DB.FORTIGATEPRIMARYELECTION;
            let result = await dbClient.replaceDocument(
                DATABASE_NAME,
                TABLE.TableName,
                electedPrimary,
                TABLE.KeySchema[0].AttributeName
            );
            logger.info(`called finalizePrimaryElection, result: ${JSON.stringify(result)}`);
            return !!result;
        } catch (error) {
            logger.warn('called finalizePrimaryElection, error:', error);
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
            logger.error(
                'getInstanceHealthCheck > error: no instance id property found on ' +
                    `instance: ${JSON.stringify(instance)}`
            );
            return Promise.reject(`invalid instance: ${JSON.stringify(instance)}`);
        }

        let scalingGroupName = instance.scalingGroupName || this.scalingGroupName;

        const keyExpression = {
                name: 'id',
                value: `${scalingGroupName}-${instance.instanceId}`
            },
            filterExpression = [
                {
                    name: 'instanceId',
                    value: instance.instanceId
                }
            ];
        try {
            let scriptExecutionStartTime,
                healthy,
                heartBeatLossCount,
                heartBeatDelays,
                heartBeatDelayAllowance =
                    parseInt(this._settings['heartbeat-delay-allowance']) * 1000,
                inevitableFailToSyncTime,
                interval,
                healthCheckRecord,
                items = await dbClient.simpleQueryDocument(
                    DATABASE_NAME,
                    DB.FORTIGATEAUTOSCALE.TableName,
                    keyExpression,
                    filterExpression,
                    {
                        crossPartition: true
                    }
                );
            if (!Array.isArray(items) || items.length === 0) {
                logger.info('called getInstanceHealthCheck: no record found');
                return null;
            }
            healthCheckRecord = items[0];
            // to get a more accurate heart beat elapsed time, the script execution time so far
            // is compensated.
            scriptExecutionStartTime = process.env.SCRIPT_EXECUTION_TIME_CHECKPOINT;
            interval =
                heartBeatInterval && !isNaN(heartBeatInterval)
                    ? heartBeatInterval
                    : healthCheckRecord.heartBeatInterval;
            heartBeatDelays = scriptExecutionStartTime - healthCheckRecord.nextHeartBeatTime;
            // The the inevitable-fail-to-sync time is defined as:
            // the maximum amount of time for an instance to be able to sync without being
            // deemed unhealth. For example:
            // the instance has x (x < hb loss count allowance) loss count recorded.
            // the hb loss count allowance is X.
            // the hb interval is set to i second.
            // its hb sync time delay allowance is I ms.
            // its current hb sync time is t.
            // its expected next hb sync time is T.
            // if t > T + (X - x - 1) * (i * 1000 + I), t has passed the
            // inevitable-fail-to-sync time. This means the instance can never catch up with a
            // heartbeat sync that makes it possile to deem health again.
            inevitableFailToSyncTime =
                healthCheckRecord.nextHeartBeatTime +
                (parseInt(this._settings['heartbeat-loss-count']) -
                    healthCheckRecord.heartBeatLossCount -
                    1) *
                    (interval * 1000 + heartBeatDelayAllowance);
            // based on the test results, network delay brought more significant side effects
            // to the heart beat monitoring checking than we thought. we have to expand the
            // checking time to reasonably offset the delay.
            // heartBeatDelayAllowance is used for this purpose
            if (heartBeatDelays <= heartBeatDelayAllowance) {
                // reset hb loss cound if instance sends hb within its interval
                healthy = true;
                heartBeatLossCount = 0;
            } else {
                // if the current sync heartbeat is late, the instance is still considered
                // healthy unless the the inevitable-fail-to-sync time has passed.
                healthy = scriptExecutionStartTime <= inevitableFailToSyncTime;
                heartBeatLossCount = healthCheckRecord.heartBeatLossCount + 1;
                logger.info(
                    `hb sync is late${heartBeatLossCount > 1 ? ' again' : ''}.\n` +
                        `hb loss count becomes: ${heartBeatLossCount},\n` +
                        `hb sync delay allowance: ${heartBeatDelayAllowance} ms\n` +
                        'expected hb arrived time: ' +
                        `${healthCheckRecord.nextHeartBeatTime} ms in unix timestamp\n` +
                        'current hb sync check time: ' +
                        `${scriptExecutionStartTime} ms in unix timestamp\n` +
                        `this hb sync delay is: ${heartBeatDelays} ms`
                );
                // log the math why this instance is deemed unhealthy
                if (!healthy) {
                    logger.info(
                        'Instance is deemed unhealthy. reasons:\n' +
                            `previous hb loss count: ${healthCheckRecord.heartBeatLossCount},\n` +
                            `hb sync delay allowance: ${heartBeatDelayAllowance} ms\n` +
                            'expected hb arrived time: ' +
                            `${healthCheckRecord.nextHeartBeatTime} ms in unix timestamp\n` +
                            'current hb sync check time: ' +
                            `${scriptExecutionStartTime} ms in unix timestamp\n` +
                            `this hb sync delays: ${heartBeatDelays} ms\n` +
                            'the inevitable-fail-to-sync time: ' +
                            `${inevitableFailToSyncTime} ms in unix timestamp has passed.`
                    );
                }
            }
            logger.info(
                'called getInstanceHealthCheck. (timestamp: ' +
                    `${scriptExecutionStartTime},  interval:${heartBeatInterval})` +
                    'healthcheck record:',
                JSON.stringify(healthCheckRecord)
            );
            return {
                instanceId: instance.instanceId,
                ip: healthCheckRecord.ip || '',
                healthy: healthy,
                heartBeatLossCount: heartBeatLossCount,
                heartBeatInterval: interval,
                nextHeartBeatTime: Date.now() + interval * 1000,
                primaryIp: healthCheckRecord.primaryIp,
                syncState: healthCheckRecord.syncState,
                inSync: healthCheckRecord.syncState === 'in-sync',
                inevitableFailToSyncTime: inevitableFailToSyncTime,
                healthCheckTime: scriptExecutionStartTime
            };
        } catch (error) {
            logger.info(
                'called getInstanceHealthCheck with error. ' +
                    `error: ${JSON.stringify(
                        error instanceof Error
                            ? { message: error.message, stack: error.stack }
                            : error
                    )}`
            );
            return null;
        }
    }

    /** @override */
    async updateInstanceHealthCheck(
        healthCheckObject,
        heartBeatInterval,
        primaryIp,
        checkPointTime,
        forceOutOfSync = false
    ) {
        if (!(healthCheckObject && healthCheckObject.instanceId)) {
            logger.error(
                'updateInstanceHealthCheck > error: no instanceId property found' +
                    ` on healthCheckObject: ${JSON.stringify(healthCheckObject)}`
            );
            return Promise.reject(
                'invalid healthCheckObject: ' + `${JSON.stringify(healthCheckObject)}`
            );
        }
        try {
            let result,
                document = {
                    id: `${this.scalingGroupName}-${healthCheckObject.instanceId}`,
                    instanceId: healthCheckObject.instanceId,
                    ip: healthCheckObject.ip,
                    scalingGroupName: this.scalingGroupName,
                    nextHeartBeatTime: checkPointTime + heartBeatInterval * 1000,
                    heartBeatLossCount: healthCheckObject.heartBeatLossCount,
                    heartBeatInterval: heartBeatInterval,
                    syncState:
                        healthCheckObject.healthy && !forceOutOfSync ? 'in-sync' : 'out-of-sync',
                    primaryIp: primaryIp ? primaryIp : 'null'
                };
            if (!forceOutOfSync && healthCheckObject.syncState === 'out-of-sync') {
                logger.info(`instance already out of sync: healthcheck info: ${healthCheckObject}`);
                result = true;
            } else {
                const TABLE = DB.FORTIGATEAUTOSCALE;
                result = await dbClient.replaceDocument(
                    DATABASE_NAME,
                    TABLE.TableName,
                    document,
                    TABLE.KeySchema[0].AttributeName
                );
            }
            logger.info('called updateInstanceHealthCheck');
            return !!result;
        } catch (error) {
            logger.info(
                'called updateInstanceHealthCheck with error. ' +
                    `error: ${JSON.stringify(
                        error instanceof Error
                            ? { message: error.message, stack: error.stack }
                            : error
                    )}`
            );
            return Promise.reject(error);
        }
    }

    /** @override */
    async deleteInstanceHealthCheck(instanceId) {
        logger.warn('calling deleteInstanceHealthCheck');
        try {
            const TABLE = DB.FORTIGATEAUTOSCALE;
            return !!(await dbClient.deleteDocument(
                DATABASE_NAME,
                TABLE.TableName,
                `${this.scalingGroupName}-${instanceId}`,
                true
            ));
        } catch (error) {
            logger.warn('called deleteInstanceHealthCheck. error:', error);
            return false;
        }
    }

    async describeInstance(parameters) {
        logger.info('calling describeInstance');
        let readCache = this._settings['enable-vm-info-cache'] === 'true';
        let virtualMachine,
            hitCache = '';
        if (parameters.scalingGroupName) {
            // use a proper method to get the vm
            if (isNaN(parameters.instanceId)) {
                // describe instance in vmss by vmid
                // get from cache if VM_INFO_CACHE_ENABLED (shoule be enabled by default)
                if (readCache) {
                    virtualMachine = await this.getVmInfoCache(
                        parameters.scalingGroupName,
                        null,
                        parameters.instanceId
                    );
                    hitCache = virtualMachine ? ' (hit cache)' : '';
                }
                if (!virtualMachine) {
                    virtualMachine = await computeClient
                        .refVirtualMachineScaleSet(parameters.scalingGroupName)
                        .getVirtualMachineByVmId(parameters.instanceId);
                    if (virtualMachine) {
                        await this.setVmInfoCache(parameters.scalingGroupName, virtualMachine);
                    }
                }
            } else {
                // describe instance in vmss
                // get from cache if VM_INFO_CACHE_ENABLED (shoule be enabled by default)
                if (readCache) {
                    virtualMachine = await this.getVmInfoCache(
                        parameters.scalingGroupName,
                        parameters.instanceId
                    );
                    hitCache = virtualMachine ? ' (hit cache)' : '';
                }
                if (!virtualMachine) {
                    virtualMachine = await computeClient
                        .refVirtualMachineScaleSet(parameters.scalingGroupName)
                        .getVirtualMachine(parameters.instanceId);
                    if (virtualMachine) {
                        await this.setVmInfoCache(parameters.scalingGroupName, virtualMachine);
                    }
                }
            }
        } else {
            throw new Error(
                'Not enough parameters to describe an instance > parameters:',
                parameters
            );
        }
        logger.info(`called describeInstance${hitCache}`);
        return (
            virtualMachine &&
            AutoScaleCore.VirtualMachine.fromAzureVm(virtualMachine, parameters.scalingGroupName)
        );
    }

    /** @override */
    async getBlobFromStorage(parameters) {
        let blobService = storageClient.refBlobService();
        let queries = [];
        queries.push(
            new Promise((resolve, reject) => {
                blobService.getBlobToText(
                    parameters.keyPrefix,
                    parameters.fileName,
                    (error, text, result, response) => {
                        // eslint-disable-line no-unused-vars
                        if (error) {
                            reject(error);
                        } else if (
                            (response && response.statusCode === 200) ||
                            response.isSuccessful
                        ) {
                            resolve(text);
                        } else {
                            reject(response);
                        }
                    }
                );
            })
        );
        if (parameters.getProperties) {
            queries.push(
                new Promise((resolve, reject) => {
                    blobService.getBlobProperties(
                        parameters.keyPrefix,
                        parameters.fileName,
                        (error, result, response) => {
                            if (error) {
                                reject(error);
                            } else if (
                                (response && response.statusCode === 200) ||
                                response.isSuccessful
                            ) {
                                resolve(result);
                            } else {
                                reject(response);
                            }
                        }
                    );
                })
            );
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
            blobService.getBlobToText(
                parameters.path,
                parameters.fileName,
                (error, text, result, response) => {
                    if (error) {
                        reject(error);
                    } else if ((response && response.statusCode === 200) || response.isSuccessful) {
                        resolve(response.body);
                    } else {
                        reject(response);
                    }
                }
            );
        });
    }

    /** @override */
    async getSettingItems(keyFilter = null, valueOnly = true) {
        try {
            const data = await dbClient.simpleQueryDocument(
                DATABASE_NAME,
                DB.SETTINGS.TableName,
                null,
                null,
                {
                    crossPartition: true
                }
            );
            let items = Array.isArray(data) && data;
            let formattedItems = {};
            let filteredItems = null,
                hasFilter = Array.isArray(keyFilter);

            items.forEach(item => {
                if (item.jsonEncoded === 'true') {
                    try {
                        item.settingValue = JSON.parse(item.settingValue);
                    } catch (error) {
                        logger.warn(
                            `getSettingItems error: ${item.settingKey} has ` +
                                `jsonEncoded (${item.jsonEncoded}) value but unable to apply ` +
                                `JSON.parse(). settingValue is: ${item.settingValue}`
                        );
                    }
                }
                formattedItems[item.settingKey] = valueOnly ? item.settingValue : item;
                if (hasFilter && keyFilter.includes(item.settingKey)) {
                    filteredItems = filteredItems || {};
                    filteredItems[item.settingKey] = formattedItems[item.settingKey];
                }
            });
            this._settings = formattedItems;
            return (keyFilter && filteredItems) || formattedItems;
        } catch (error) {
            logger.warn(
                `getSettingItems > error: ${JSON.stringify(
                    error instanceof Error ? { message: error.message, stack: error.stack } : error
                )}`
            );
            return {};
        }
    }

    async setSettingItem(key, value, description = null, jsonEncoded = false, editable = false) {
        let document = {
            id: key,
            settingKey: key,
            settingValue: jsonEncoded ? JSON.stringify(value) : value,
            description: description ? description : '',
            jsonEncoded: jsonEncoded ? 'true' : 'false',
            editable: editable ? 'true' : 'false'
        };
        try {
            const TABLE = DB.SETTINGS;
            // create new or replace existing
            return !!(await dbClient.createDocument(
                DATABASE_NAME,
                TABLE.TableName,
                document,
                TABLE.KeySchema[0].AttributeName,
                true
            ));
        } catch (error) {
            logger.warn('called setSettingItem > error: ', error, 'setSettingItem:', document);
            return false;
        }
    }

    async terminateInstanceInAutoScalingGroup(instance) {
        logger.info('calling terminateInstanceInAutoScalingGroup');
        try {
            let result = await computeClient
                .refVirtualMachineScaleSet(this.scalingGroupName)
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
            const filterExpression = [
                {
                    name: vmId ? 'vmId' : 'instanceId',
                    value: vmId ? vmId : instanceId
                },
                {
                    name: 'scalingGroupName',
                    value: scaleSetName
                }
            ];

            let items = await dbClient.simpleQueryDocument(
                DATABASE_NAME,
                DB.VMINFOCACHE.TableName,
                null,
                filterExpression,
                {
                    crossPartition: true
                }
            );
            if (!Array.isArray(items) || items.length === 0) {
                return null;
            }
            if (items[0].expireTime < Date.now()) {
                logger.info('called getVmInfoCache > cached expired.');
                return null;
            }
            return JSON.parse(items[0].info);
        } catch (error) {
            logger.warn(`called getVmInfoCache (id: ${idValue}) > error: `, error);
            return null;
        }
    }

    async setVmInfoCache(scaleSetName, info, cacheTime = 3600) {
        let now = Date.now();
        let document = {
            id: `${scaleSetName}-${info.instanceId}`,
            instanceId: info.instanceId,
            vmId: info.properties.vmId,
            scalingGroupName: scaleSetName,
            info: typeof info === 'string' ? info : JSON.stringify(info),
            cacheTime: now,
            expireTime: now + cacheTime * 1000
        };
        try {
            const TABLE = DB.VMINFOCACHE;
            // create new or replace existing
            return !!(await dbClient.createDocument(
                DATABASE_NAME,
                TABLE.TableName,
                document,
                TABLE.KeySchema[0].AttributeName,
                true
            ));
        } catch (error) {
            logger.warn('called setVmInfoCache > error: ', error, 'setVmInfoCache:', document);
            return false;
        }
    }

    async saveLogToDb(log) {
        let timestamp = Date.now(),
            document = {
                id: `t-${timestamp}`,
                logContent: typeof log === 'string' ? log : JSON.stringify(log),
                timestamp: timestamp
            };
        try {
            const TABLE = DB.CUSTOMLOG;
            // create new or replace existing
            return !!(await dbClient.createDocument(
                DATABASE_NAME,
                TABLE.TableName,
                document,
                TABLE.KeySchema[0].AttributeName,
                true
            ));
        } catch (error) {
            logger.warn('called saveLogToDb > error: ', error, 'document item:', document);
            return false;
        }
    }

    // eslint-disable-next-line no-unused-vars
    /**
     * List logs from DB
     * @param {UnixTimeStamp} timeFrom unix timestamp in UTC
     * @param {UnixTimeStamp} timeTo unix timestamp in UTC
     * @param {Integer} timeZoneOffset timezone offset from UTC
     */
    async listLogFromDb(timeFrom, timeTo = null, timeZoneOffset = 0) {
        try {
            let logContent = '',
                queryDone = false,
                rowCount = 0,
                currentCount = 0,
                logTimeFrom,
                logTimeTo;
            while (!queryDone) {
                let filterExp = [];
                if (timeFrom) {
                    filterExp.push({
                        keys: ['timestamp'],
                        exp: `:timestamp > ${timeFrom}`
                    });
                }
                if (timeTo) {
                    filterExp.push({
                        keys: ['timestamp'],
                        exp: `:timestamp < ${timeTo}`
                    });
                }
                let items = await dbClient.simpleQueryDocument(
                    DATABASE_NAME,
                    DB.CUSTOMLOG.TableName,
                    null,
                    filterExp,
                    {
                        crossPartition: true
                    }
                );
                if (!Array.isArray(items)) {
                    return '';
                }
                currentCount = 0;
                items.sort((a, b) => {
                    if (a.id < b.id) {
                        return -1;
                    } else if (a.id > b.id) {
                        return 1;
                    }
                    return 0;
                });
                items.forEach(item => {
                    currentCount++;
                    if (!logTimeFrom || item.timestamp < logTimeFrom) {
                        logTimeFrom = item.timestamp;
                    }
                    if (!logTimeTo || item.timestamp > logTimeTo) {
                        logTimeTo = item.timestamp;
                    }
                    let regMatches = null,
                        nTime = null;
                    do {
                        regMatches = /\[(_t:([0-9]+))\]/g.exec(item.logContent);
                        if (regMatches) {
                            nTime = AutoScaleCore.Functions.toGmtTime(regMatches[2]);
                            nTime = nTime && new Date(nTime.getTime() + timeZoneOffset * 3600000);
                            let timeString = nTime
                                ? nTime.toUTCString()
                                : `unknown ${regMatches[2]}`;
                            item.logContent = item.logContent.replace(
                                new RegExp(regMatches[1], 'g'),
                                `[time]${timeString}${timeZoneOffset}[/time]`
                            );
                        }
                    } while (regMatches);
                    logContent += item.logContent;
                });
                rowCount += currentCount;
                if (timeTo && timeTo > logTimeTo && currentCount > 0) {
                    timeFrom = logTimeTo;
                } else {
                    queryDone = true;
                }
            }
            logTimeFrom = logTimeFrom || timeFrom;
            logTimeTo = logTimeTo || timeTo;
            logTimeFrom += timeZoneOffset * 3600000;
            logTimeTo += timeZoneOffset * 3600000;
            return (
                `Log count:${rowCount}, Time from: ` +
                `${new Date(logTimeFrom).toUTCString()}${timeZoneOffset}` +
                ` to: ${new Date(logTimeTo).toUTCString()}${timeZoneOffset}\n${logContent}`
            );
        } catch (error) {
            return '';
        }
    }

    /**
     * delete logs from DB
     * @param {UnixTimeStamp} timeFrom unix timestamp in UTC
     * @param {UnixTimeStamp} timeTo unix timestamp in UTC
     */
    async deleteLogFromDb(timeFrom, timeTo = null) {
        try {
            let timeRangeFrom = timeFrom && !isNaN(timeFrom) ? parseInt(timeFrom) : 0,
                timeRangeTo = timeTo && !isNaN(timeTo) ? parseInt(timeTo) : Date.now();
            let deletionTasks = [],
                errorTasks = [];
            let items = await dbClient.simpleQueryDocument(
                DATABASE_NAME,
                DB.CUSTOMLOG.TableName,
                null,
                null,
                {
                    crossPartition: true
                }
            );
            if (!Array.isArray(items) || items.length === 0) {
                return `${deletionTasks.length} rows deleted. ${errorTasks.length} error rows.`;
            }
            items.forEach(item => {
                if (item.timestamp >= timeRangeFrom && item.timestamp <= timeRangeTo) {
                    deletionTasks.push(
                        dbClient
                            .deleteDocument(DATABASE_NAME, DB.CUSTOMLOG.TableName, item.id, true)
                            .catch(e => {
                                errorTasks.push({
                                    item: item,
                                    error: e
                                });
                                return e;
                            })
                    );
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
        let platform = this;
        let prefix = platform._settings['fortigate-license-storage-key-prefix'];
        return await new Promise((resolve, reject) => {
            // NOTE: the etag of each object returned by Azure API function:
            // listBlobsSegmented
            // is NOT wrapped with double quotes.
            // however, it would be wrapped with double quotes
            // in the Azure API function:
            // getBlobToText and getBlobProperties
            // see: https://github.com/Azure/azure-storage-node/issues/586
            blobService.listBlobsSegmented(prefix, null, (error, data) => {
                if (error) {
                    reject(error);
                } else {
                    if (data && data.entries) {
                        // need to fire an extra call to get file content

                        let contentQueryPromise = async blobList => {
                            let contentQueries = blobList.entries.map(async item => {
                                const blob = await platform.getBlobFromStorage({
                                    storageName: '',
                                    keyPrefix: prefix,
                                    fileName: item.name,
                                    getProperties: true
                                });
                                return {
                                    filePath: blob.properties.container,
                                    fileName: blob.properties.name,
                                    // the etag should be enclosed with double quote.
                                    fileETag: `"${blob.properties.etag}"`,
                                    content: blob.content
                                };
                            });
                            let contents = await Promise.all(contentQueries);
                            let iterable = contents.map(item => {
                                let licenseItem = new AutoScaleCore.LicenseItem(
                                    item.fileName,
                                    item.fileETag,
                                    item.content
                                );
                                return [licenseItem.blobKey, licenseItem];
                            });
                            return new Map(iterable);
                        };
                        resolve(contentQueryPromise(data));
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
            let items = await dbClient.simpleQueryDocument(
                DATABASE_NAME,
                DB.LICENSEUSAGE.TableName,
                null,
                null,
                {
                    crossPartition: true
                }
            );
            let recordCount = 0,
                records = [];
            if (Array.isArray(items)) {
                recordCount = items.length;
                records = items;
            }
            let iterable = records.map(item => {
                const licenseRecord = AutoScaleCore.LicenseRecord.fromDb(item);
                return [licenseRecord.checksum, licenseRecord];
            });
            logger.info(`called listLicenseUsage: (${recordCount}) licenses in use.`);
            return new Map(iterable);
        } catch (error) {
            return new Map();
        }
    }

    /** @override */
    async updateLicenseUsage(licenseRecord, replace = false) {
        let document = {
            id: licenseRecord.id,
            blobKey: licenseRecord.blobKey,
            checksum: licenseRecord.checksum,
            fileName: licenseRecord.fileName,
            algorithm: licenseRecord.algorithm,
            instanceId: licenseRecord.instanceId,
            scalingGroupName: licenseRecord.scalingGroupName,
            assignedTime: licenseRecord.assignedTime
        };

        try {
            const TABLE = DB.LICENSEUSAGE;
            let doc = await dbClient.createDocument(
                DATABASE_NAME,
                TABLE.TableName,
                document,
                TABLE.KeySchema[0].AttributeName,
                replace
            );
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
            let items = await dbClient.simpleQueryDocument(
                DATABASE_NAME,
                DB.LICENSESTOCK.TableName,
                null,
                null,
                {
                    crossPartition: true
                }
            );
            let recordCount = 0,
                records = [];
            if (Array.isArray(items)) {
                recordCount = items.length;
                records = items;
            }
            let iterable = records.map(item => {
                const licenseRecord = AutoScaleCore.LicenseRecord.fromDb(item);
                return [licenseRecord.checksum, licenseRecord];
            });
            logger.info(`called listLicenseStock: (${recordCount}) licenses in stock.`);
            return new Map(iterable);
        } catch (error) {
            return new Map();
        }
    }

    /** @override */
    async updateLicenseStock(licenseItem, replace = true) {
        try {
            const TABLE = DB.LICENSESTOCK;
            let item = {
                id: licenseItem.id,
                blobKey: licenseItem.blobKey,
                checksum: licenseItem.checksum,
                fileName: licenseItem.fileName,
                algorithm: licenseItem.algorithm
            };
            let doc = await dbClient.createDocument(
                DATABASE_NAME,
                TABLE.TableName,
                item,
                TABLE.KeySchema[0].AttributeName,
                replace || true
            );
            if (doc) {
                return true;
            } else {
                return false;
            }
        } catch (error) {
            logger.error(
                `Called updateLicenseStock: error >, ${JSON.stringify(
                    error instanceof Error ? { message: error.message, stack: error.stack } : error
                )}`
            );
            throw error;
        }
    }

    /** @override */
    async deleteLicenseStock(licenseItem) {
        try {
            const TABLE = DB.LICENSESTOCK;
            return await dbClient.deleteDocument(
                DATABASE_NAME,
                TABLE.TableName,
                licenseItem.checksum,
                true
            );
        } catch (error) {
            logger.error(
                `Called deleteLicenseStock: error >, ${JSON.stringify(
                    error instanceof Error ? { message: error.message, stack: error.stack } : error
                )}`
            );
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
        this.primaryScalingGroupName = null;
    }

    proxyResponse(statusCode, res, logOptions = null) {
        let responseLog = res;
        if (logOptions && logOptions.maskResponse) {
            responseLog = '[********] is masked in this log. ¯\\_(ツ)_/¯';
        }
        let log = logger.log(`(${statusCode}) response body:`, responseLog).flush();
        if (
            process.env.DEBUG_SAVE_CUSTOM_LOG &&
            (!process.env.DEBUG_SAVE_CUSTOM_LOG_ON_ERROR ||
                (process.env.DEBUG_SAVE_CUSTOM_LOG_ON_ERROR && logger.errorCount > 0)) &&
            log !== ''
        ) {
            this.platform.saveLogToDb(log);
        }
        return {
            status: statusCode,
            /* Defaults to 200 */
            headers: {
                'Content-Type': 'text/plain'
            },
            body:
                typeof res.toString === 'function' && res.toString() !== '[object Object]'
                    ? res.toString()
                    : JSON.stringify(res)
        };
    }
    /** @override */
    async init() {
        // for Azure, initialize the platform first. then save settings to db before continue
        // to the rest of AutoscaleHandler initialization
        let errors = [];
        let success = this.platform.initialized || (await this.platform.init());
        if (success) {
            await this.loadSettings();
            if (!(this._settings && Object.keys(this._settings).length > 0)) {
                await this.saveSettings();
            }
            success = await super.init();
            // check other required tables existence
            let requiredDbTableNames =
                (this._settings['required-db-table'] &&
                    this._settings['required-db-table']
                        .split(',')
                        .map(tableName => tableName.trim())) ||
                [];
            let otherRequiredTableEntries = Object.entries(DB)
                .filter(entry => {
                    return (
                        !MINIMUM_REQUIRED_DB_TABLE_KEYS.includes(entry[0]) &&
                        requiredDbTableNames.includes(entry[1].TableName)
                    );
                })
                .map(otherRequiredTableEntry => {
                    return otherRequiredTableEntry[1].TableName;
                });
            let platform = this.platform;
            if (otherRequiredTableEntries.length > 0) {
                logger.info('checking other required db table.');
                await platform
                    .checkCollectionsAvailability(otherRequiredTableEntries)
                    .then(missingCollections => platform.createCollections(missingCollections))
                    .catch(err => {
                        logger.error(err);
                        errors.push(err);
                    });
            }
        }
        logger.info('called init [Autoscale handler initialization]');
        return success && errors.length === 0;
    }

    /* eslint-disable max-len */
    /**
     * @override
     * @param {AzurePlatform.RequestEvent} event Event from the api-gateway.
     * @param {AzurePlatform.RequestContext} context the runtime context of this function
     * call from the platform
     * @param {AzurePlatform.RequestCallback} callback the callback function the platorm
     * uses to end a request
     */
    /* eslint-enable max-len */
    // eslint-disable-next-line no-unused-vars
    async handle(event, context, callback) {
        await super.handle(...arguments);
    }

    /** @override */
    // eslint-disable-next-line no-unused-vars
    async completeGetConfigLifecycleAction(instanceId, success) {
        // this method is required in a core method: handleSyncedCallback()
        // so need to implement it for any platform. However, life cycle handling not required in
        // Azure platform so this method simply returns a true
        return await Promise.resolve(true);
    }

    async handleGetConfig() {
        logger.info('calling handleGetConfig');
        let config,
            primaryInfo,
            params = {},
            primaryIp,
            duplicatedGetConfigCall;

        // FortiGate actually returns its vmId instead of instanceid
        const instanceId = this._requestInfo.instanceId;

        // verify the caller (diagram: trusted source?)
        // get instance object from platform
        this._selfInstance =
            this._selfInstance ||
            (await this.platform.describeInstance({
                instanceId: instanceId,
                scalingGroupName: this.scalingGroupName
            }));
        if (!this._selfInstance) {
            // not trusted
            throw new Error(
                `Unauthorized calling instance (vmid: ${instanceId}). ` +
                    'Instance not found in scale set.'
            );
        }
        // let result = await this.checkPrimaryElection();
        let promiseEmitter = this.checkPrimaryElection.bind(this),
            validator = result => {
                // TODO: remove the workaround if mantis item: #0534971 is resolved
                // if i am the primary, don't wait, continue, if not, wait
                // this if-condition is to work around the double GET config calls.
                if (
                    this._primaryRecord &&
                    this._primaryRecord.voteState === 'pending' &&
                    this._selfInstance &&
                    this._primaryRecord.instanceId === this._selfInstance.instanceId &&
                    this._primaryRecord.scalingGroupName === this.scalingGroupName
                ) {
                    duplicatedGetConfigCall = true;
                    primaryIp = this._primaryRecord.ip;
                    return true;
                }

                // if neither a pending primary nor a primary instance is found on the primary
                // scaling group. and if primary-election-no-wait is enabled, allow this fgt
                // to wake up without a primary ip.
                // this also implies this instance cannot be elected as the next maste which
                // means it should be a secondary.

                // primary info exists
                if (result) {
                    // i am the elected primary
                    if (
                        result.primaryPrivateIpAddress ===
                        this._selfInstance.primaryPrivateIpAddress
                    ) {
                        primaryIp = this._selfInstance.primaryPrivateIpAddress;
                        return true;
                    } else if (this._primaryRecord) {
                        // i am not the elected primary, how is the primary election going?
                        if (this._primaryRecord.voteState === 'done') {
                            // primary election done
                            return true;
                        } else if (this._primaryRecord.voteState === 'pending') {
                            // primary is still pending
                            // if not wait for the primary election to complete,
                            if (this._settings['primary-election-no-wait'] === 'true') {
                                return true;
                            } else {
                                // primary election not done, wait for a moment
                                // clear the current primary record cache and get a new one
                                // in the next call
                                this._primaryRecord = null;
                                return false;
                            }
                        }
                    } else {
                        // primary info exists but no primary record?
                        // this looks like a case that shouldn't happen. do the election again?
                        logger.warn('primary info found but primary record not found. retry.');
                        return false;
                    }
                } else {
                    // primary cannot be elected but I cannot be the next elected primary either
                    // if not wait for the primary election to complete, let me become headless
                    return this._settings['primary-election-no-wait'] === 'true';
                }
            },
            counter = currentCount => {
                logger.info(`wait for primary election (attempt: #${currentCount})`);
                if (Date.now() < process.env.SCRIPT_EXECUTION_EXPIRE_TIME) {
                    return false;
                }
                throw new Error(`failed to wait for a result within ${currentCount} attempts.`);
            };

        try {
            primaryInfo = await AutoScaleCore.Functions.waitFor(
                promiseEmitter,
                validator,
                5000,
                counter
            );
        } catch (error) {
            logger.warn(error);
            // if error occurs, check who is holding a primary election, if it is this instance,
            // terminates this election. then tear down this instance whether it's primary or not.
            this._primaryRecord = this._primaryRecord || (await this.platform.getPrimaryRecord());
            if (
                this._primaryRecord.instanceId === this._selfInstance.instanceId &&
                this._primaryRecord.scalingGroupName === this._selfInstance.scalingGroupName
            ) {
                await this.platform.removePrimaryRecord();
            }
            // await this.removeInstance(this._selfInstance);
            throw new Error(
                'Failed to determine the primary instance within script timeout. ' +
                    'This instance is unable to bootstrap. Please report this to administrators.'
            );
        }

        // the primary ip same as mine? (diagram: primary IP same as mine?)
        // this checking for 'duplicatedGetConfigCall' is to work around
        // the double GET config calls.
        // TODO: remove the workaround if mantis item: #0534971 is resolved
        if (duplicatedGetConfigCall || primaryIp === this._selfInstance.primaryPrivateIpAddress) {
            this._step = 'handler:getConfig:getPrimaryConfig';
            // must pass the event to getCallbackEndpointUrl. this is different from the
            // implementation for AWS
            params.callbackUrl = await this.platform.getCallbackEndpointUrl();
            config = await this.getPrimaryConfig(params);
            logger.info(
                'called handleGetConfig: returning primary config' +
                    `(master-ip: ${primaryIp}):\n ${config}`
            );
            return config;
        } else {
            this._step = 'handler:getConfig:getSecondaryConfig';
            let getPendingPrimaryIp = !(
                this._settings['primary-election-no-wait'] === 'true' &&
                this._primaryRecord &&
                this._primaryRecord.voteState === 'pending'
            );
            params.callbackUrl = await this.platform.getCallbackEndpointUrl();
            params.primaryIp =
                (getPendingPrimaryIp && primaryInfo && primaryInfo.primaryPrivateIpAddress) || null;
            params.allowHeadless = this._settings['primary-election-no-wait'] === 'true';
            config = await this.getSecondaryConfig(params);
            logger.info(
                'called handleGetConfig: returning secondary config' +
                    `(master-ip: ${params.primaryIp || 'undetermined'}):\n ${config}`
            );
            return config;
        }
    }

    /** @override */
    async saveSettings(settings) {
        settings = {}; // no need to pass settins to this function. reuse this variable.
        Object.entries(process.env).forEach(entry => {
            settings[entry[0].replace(new RegExp('_', 'g'), '')] = entry[1];
        });
        settings.deploymentsettingssaved = 'true';
        await super.saveSettings(settings);
    }

    /** @override */
    async addInstanceToMonitor(instance, heartBeatInterval, primaryIp = 'null') {
        logger.info('calling addInstanceToMonitor');
        let document = {
            id: `${this.scalingGroupName}-${instance.instanceId}`,
            instanceId: instance.instanceId,
            ip: instance.primaryPrivateIpAddress,
            scalingGroupName: this.scalingGroupName,
            nextHeartBeatTime: Date.now() + heartBeatInterval * 1000,
            heartBeatLossCount: 0,
            heartBeatInterval: heartBeatInterval,
            syncState: 'in-sync',
            primaryIp: primaryIp
        };

        try {
            const TABLE = DB.FORTIGATEAUTOSCALE;
            let doc = await dbClient.createDocument(
                DATABASE_NAME,
                TABLE.TableName,
                document,
                TABLE.KeySchema[0].AttributeName
            );
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

    /**
     * @override
     */
    async getPrimaryInfo() {
        logger.info('calling getPrimaryInfo');
        let instanceId;
        try {
            this._primaryRecord = this._primaryRecord || (await this.platform.getPrimaryRecord());
            instanceId = this._primaryRecord && this._primaryRecord.instanceId;
        } catch (ex) {
            logger.error(ex);
        }
        return (
            this._primaryRecord &&
            (await this.platform.describeInstance({
                instanceId: instanceId,
                scalingGroupName: this._primaryRecord.scalingGroupName
            }))
        );
    }

    /**
     * handle instance removal
     * @param {Object} instance the instance to remove. minimum required
     *      properties{vmId: <string>}
     */
    async removeInstance(instance) {
        try {
            // should not remove the instance health check monitor record because based on
            // observation, once Azure accepts the command to remove the vm instance from vmss,
            // Azure won't run this operation right away. The instance remains running for a while
            // so it keeps sending hb periodically. If remove the health check monitor,
            // the instance would be accepted into monitor as a new one with a healthy state.
            // The potential problem here is it becomes eligible for a primary election again
            // where it should not be.
            // So a better solution is the health check monitor record will be intentionally kept
            // in the db with an 'out-of-sync' state as the result.
            await this.platform.terminateInstanceInAutoScalingGroup(instance);
            return true;
        } catch (error) {
            logger.error('called removeInstance > error:', error);
            return false;
        }
    }

    /** @override */
    async findRecyclableLicense(stockRecords, usageRecords, limit = -1) {
        if (stockRecords instanceof Map && usageRecords instanceof Map) {
            let gracePeriod = (parseInt(this._settings['get-license-grace-period']) || 600) * 1000;
            // do health check on each item
            let queries = [],
                healthCheckResults,
                recyclableRecords = [],
                count = 0,
                maxCount;
            if (limit === 'all' || isNaN(limit) || parseInt(limit) <= 0) {
                maxCount = -1; // set a negative max count to indicate no limit
            } else {
                maxCount = parseInt(limit); // set a positive maxcount
            }
            usageRecords.forEach(item => {
                if (item.instanceId && item.scalingGroupName) {
                    queries.push(
                        (async function(rec, ref) {
                            // get instance health check and instance info
                            let tasks = [];
                            tasks.push(
                                ref.platform
                                    .getInstanceHealthCheck({
                                        instanceId: rec.instanceId,
                                        scalingGroupName: rec.scalingGroupName
                                    })
                                    .catch(() => null)
                            );
                            tasks.push(
                                ref.platform
                                    .describeInstance({
                                        instanceId: item.instanceId,
                                        scalingGroupName: item.scalingGroupName,
                                        readCache: false
                                    })
                                    .catch(() => null)
                            );
                            let [healthCheck, instance] = await Promise.all(tasks);
                            return {
                                checksum: rec.checksum,
                                usageRecord: rec,
                                healthCheck: healthCheck,
                                instance: instance
                            };
                        })(item, this)
                    );
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
                if (result.checksum && stockRecords.has(result.checksum)) {
                    let recyclable = false;
                    // if instance is gone? recycle the license
                    if (!result.instance) {
                        recyclable = true;
                    } else if (
                        result.instance &&
                        result.healthCheck &&
                        (!result.healthCheck.inSync ||
                            result.healthCheck.inevitableFailToSyncTime <
                                result.healthCheck.healthCheckTime)
                    ) {
                        // if instance exists but instance is unhealth? recycle the license
                        recyclable = true;
                    } else if (
                        result.instance &&
                        !result.healthCheck &&
                        result.usageRecord &&
                        Date.now() > result.usageRecord.assignedTime + gracePeriod * 1000
                    ) {
                        // if instance exists but no healthcheck and grace period has passed?
                        recyclable = true;
                    }
                    // recycle the recyclable license
                    if (recyclable) {
                        count++;
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
            let psksecret,
                proxyMethod = 'method' in event && event.method,
                result = '';
            let timeFrom, timeTo, timeZoneOffset;
            await this.init();
            if (event && event.headers) {
                if (event.headers.psksecret) {
                    psksecret = event.headers.psksecret;
                }
                // time from and time to could be Date Formattable string or valid unix timestamp
                timeFrom = event.headers.timefrom ? event.headers.timefrom : 0;
                timeTo = event.headers.timeto ? event.headers.timeto : Date.now();
                timeZoneOffset = event.headers.timezoneoffset ? event.headers.timezoneoffset : 0;
                timeFrom = AutoScaleCore.Functions.toGmtTime(timeFrom);
                if (!timeFrom) {
                    throw new Error(`TimeFrom (${timeFrom}) is invalid `);
                }
                timeTo = AutoScaleCore.Functions.toGmtTime(timeTo);
                if (!timeTo) {
                    throw new Error(`timeTo (${timeTo}) is invalid `);
                }
            }
            if (!(psksecret && psksecret === this._settings['fortigate-psk-secret'])) {
                return;
            }
            switch (proxyMethod && proxyMethod.toUpperCase()) {
                case 'GET':
                    result = await this.platform.listLogFromDb(
                        timeFrom.getTime(),
                        timeTo.getTime(),
                        timeZoneOffset
                    );
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
                    result = await this.platform.deleteLogFromDb(
                        timeFrom.getTime(),
                        timeTo.getTime()
                    );
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
    dbClient = new armClient.CosmosDB.ApiClient(
        process.env.AUTOSCALE_DB_ACCOUNT,
        process.env.REST_API_MASTER_KEY
    );
    computeClient = new armClient.Compute.ApiClient(
        process.env.SUBSCRIPTION_ID,
        process.env.RESOURCE_GROUP
    );
    storageClient = new armClient.Storage.ApiClient(
        process.env.AZURE_STORAGE_ACCOUNT,
        process.env.AZURE_STORAGE_ACCESS_KEY
    );
    return exports;
}

/**
 * Handle the autoscaling
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
    process.env.SCRIPT_EXECUTION_EXPIRE_TIME = Date.now() + SCRIPT_TIMEOUT;
    logger = new AzureLogger(context.log);
    armClient.useLogger(logger);
    if (
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED &&
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED.toLowerCase() === 'true'
    ) {
        logger.outputQueue = true;
        if (process.env.DEBUG_LOGGER_TIMEZONE_OFFSET) {
            logger.timeZoneOffset = process.env.DEBUG_LOGGER_TIMEZONE_OFFSET;
        }
    }
    const handler = new AzureAutoscaleHandler();
    handler.useLogger(logger);
    initModule();
    logger.log(`Incoming request: ${JSON.stringify(req)}`);
    let callback = (err, data) => {
        if (err) {
            logger.error(err);
        }
        context.res = data;
    };
    return await handler.handle(req, context, callback);
};

exports.handleGetLicense = async (context, req) => {
    // no way to get dynamic timeout time from runtime env so have to defined one in process env
    // Azure function has a weird hard limit of 230 sec to a http response time. see:
    // https://stackoverflow.com/questions/38673318/azure-asp-net-webapp-the-request-timed-out. and
    // https://github.com/Azure/azure-functions-host/issues/3391.  we set the execution expriry to
    // even earlier to bypass these issues.
    // now the script timeout is set to 200 seconds which is 30 seconds earlier.
    // Leave it some time for function finishing up.
    process.env.SCRIPT_EXECUTION_EXPIRE_TIME = Date.now() + SCRIPT_TIMEOUT;
    logger = new AzureLogger(context.log);
    armClient.useLogger(logger);
    if (
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED &&
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED.toLowerCase() === 'true'
    ) {
        logger.outputQueue = true;
        if (process.env.DEBUG_LOGGER_TIMEZONE_OFFSET) {
            logger.timeZoneOffset = process.env.DEBUG_LOGGER_TIMEZONE_OFFSET;
        }
    }
    const handler = new AzureAutoscaleHandler();
    handler.useLogger(logger);
    initModule();
    logger.log(`Incoming request: ${JSON.stringify(req)}`);
    let callback = (err, data) => {
        if (err) {
            logger.error(err);
        }
        context.res = data;
    };
    return await handler.handleGetLicense(req, context, callback);
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
