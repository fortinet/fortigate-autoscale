'use strict';

/*
FortiGate Autoscale Azure Module (1.0.0-beta)
Author: Fortinet
*/

exports = module.exports;
const AutoScaleCore = require('fortigate-autoscale-core');
const armClient = require('./AzureArmClient');
const DATABASE_NAME = 'fortigateInstances';
const DB_COLLECTION_MONITORED = 'instances';
const DB_COLLECTION_MASTER = 'masterPool';
const DB_COLLECTION_MUTEX = 'mutex';
const ELECTION_WAITING_PERIOD = 60;// how many seconds to wait for an election before purging it?
const SCRIPT_TIMEOUT = 300;// Azure script default timeout

const moduleId = AutoScaleCore.uuidGenerator(JSON.stringify(`${__filename}${Date.now()}`));
var logger = new AutoScaleCore.DefaultLogger();

class AzureLogger extends AutoScaleCore.DefaultLogger {
    constructor(loggerObject) {
        super(loggerObject);
    }
    log() {
        if (!(this.level && this.level.log === false)) {
            this.logger.apply(null, arguments);
        }
    }
}

class AzurePlatform extends AutoScaleCore.CloudPlatform {
    async init() {
        let _initDB = async function() {
            return await armClient.CosmosDB.createDB(process.env.SCALESET_DB_ACCOUNT,
                DATABASE_NAME, process.env.REST_API_MASTER_KEY)
                .then(status => {
                    if (status === true) {
                        return Promise.all([
                            // create instances
                            armClient.CosmosDB.createCollection(
                                process.env.SCALESET_DB_ACCOUNT, DATABASE_NAME,
                                DB_COLLECTION_MONITORED, process.env.REST_API_MASTER_KEY),
                            armClient.CosmosDB.createCollection(
                                process.env.SCALESET_DB_ACCOUNT, DATABASE_NAME,
                                DB_COLLECTION_MASTER, process.env.REST_API_MASTER_KEY),
                            armClient.CosmosDB.createCollection(
                                process.env.SCALESET_DB_ACCOUNT, DATABASE_NAME,
                                DB_COLLECTION_MUTEX, process.env.REST_API_MASTER_KEY)
                        ]);
                    } else {
                        logger.info('DB exists. Skip creating collections.');
                        return true;
                    }
                });
        };

        await Promise.all([
            _initDB(),
            armClient.authWithServicePrincipal(process.env.REST_APP_ID,
                process.env.REST_APP_SECRET, process.env.TENANT_ID)]).catch(error => {
            throw error;
        });
        armClient.useSubscription(process.env.SUBSCRIPTION_ID);
    }

    async getCallbackEndpointUrl(fromContext = null) {
        return await fromContext ? fromContext.originalUrl : null;
    }

    async getInstanceById(vmId) {
        let parameters = {
            resourceGroup: process.env.RESOURCE_GROUP,
            scaleSetName: process.env.SCALESET_NAME
        };
        let virtualMachines = await this.listAllInstances(parameters);
        for (let virtualMachine of virtualMachines) {
            if (virtualMachine.properties.vmId === vmId) {
                return virtualMachine;
            }
        }
        return null;
    }

    /**
     * Extract useful info from request event.
     * @param {Object} request the request event
     * @returns {Array} an array of required info per platform.
     */
    extractRequestInfo(request) {
        let instanceId = null,
            interval = 120,
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
        return {instanceId, interval, status};
    }

    async protectInstanceFromScaleIn(item, protect = true) {
        return await Promise.reject(false && protect);
    }

    async listAllInstances(parameters) {
        logger.info('calling listAllInstances');
        let virtualMachines =
            await armClient.Compute.VirtualMachineScaleSets.listVirtualMachines(
                parameters.resourceGroup, parameters.scaleSetName);
        logger.info('called listAllInstances');
        return virtualMachines;
    }

    async describeInstance(parameters) {
        logger.info('calling describeInstance');
        let virtualMachine =
            await armClient.Compute.VirtualMachineScaleSets.getVirtualMachine(
                parameters.resourceGroup, parameters.scaleSetName,
                parameters.virtualMachineId);
        logger.info('called describeInstance');

        return (function(vm) {
            vm.getPrimaryPrivateIp = () => {
                /* eslint-disable max-len */
                for (let networkInterface of vm.properties.networkProfile.networkInterfaces) {
                    if (networkInterface.properties.primary) {
                        for (let ipConfiguration of networkInterface.properties.ipConfigurations) {
                            if (ipConfiguration.properties.primary) {
                                return ipConfiguration.properties.privateIPAddress;
                            }
                        }
                    }
                }
                return null;
                /* eslint-enable max-len */
            };
            return vm;
        })(virtualMachine);
    }

    /**
     * get the health check info about an instance been monitored.
     * @param {Object} instance instance object which a vmId property is required.
     * @param {Number} heartBeatInterval integer value, unit is second.
     */
    async getInstanceHealthCheck(instance, heartBeatInterval) {
        // TODO: not fully implemented in V3
        if (!(instance && instance.vmId)) {
            logger.error(`getInstanceHealthCheck > error: no vmId property found on instance: ${JSON.stringify(instance)}`); // eslint-disable-line max-len
            return Promise.reject(`invalid instance: ${JSON.stringify(instance)}`);
        }
        const queryObject = {
            query: `SELECT * FROM ${DB_COLLECTION_MONITORED} c WHERE c.scaleSetName = @scaleSetName AND c.vmId = @vmId`, // eslint-disable-line max-len
            parameters: [
                {
                    name: '@scaleSetName',
                    value: `${process.env.SCALESET_NAME}`
                },
                {
                    name: '@vmId',
                    value: `${instance.vmId}`
                }
            ]
        };

        try {
            let docs = await armClient.CosmosDB.query(process.env.SCALESET_DB_ACCOUNT, {
                dbName: DATABASE_NAME,
                collectionName: DB_COLLECTION_MONITORED,
                partitioned: true,
                queryObject: queryObject
            }, process.env.REST_API_MASTER_KEY);
            if (Array.isArray(docs) && docs.length > 0) {
                // always return healthy state (v3 implementation)
                logger.info('called getInstanceHealthCheck');
                return {
                    healthy: !!heartBeatInterval, // TODO: need to implement logic here
                    heartBeatLossCount: docs[0].heartBeatLossCount,
                    nextHeartBeatTime: docs[0].nextHeartBeatTime
                };
            } else {
                logger.info('called getInstanceHealthCheck: no record found');
                return null;
            }
        } catch (error) {
            logger.error(error);
            logger.info('called getInstanceHealthCheck with error.');
            return null;
        }
    }
}

class AzureAutoscaleHandler extends AutoScaleCore.AutoscaleHandler {
    constructor() {
        const baseConfig = process.env.FTGT_BASE_CONFIG.replace(/\\n/g, '\n');
        super(new AzurePlatform(), baseConfig);
        this._electionLock = null;
        this._selfInstance = null;
    }

    async handle(context, req) {
        // let x = require(require.resolve(`${process.cwd()}/azure-arm-client`));
        logger.info('start to handle autoscale');
        let response;
        try {
            await this.init();
            // handle get config
            response = await this._handleGetConfig(req);
            logger.info(response);

        } catch (error) {
            if (error instanceof Error) {
                response = error.message;
            } else { response = JSON.stringify(error) }
            context.log.error(response);
        }
        context.res = {
            // status: 200, /* Defaults to 200 */
            headers: {
                'Content-Type': 'text/plain'
            },
            body: response
        };
    }

    async _handleGetConfig(_request) {
        logger.info('calling handleGetConfig');
        let parameters,
            masterInfo,
            masterIsHealthy = false,
            isNewInstance = false,
            selfHealthCheck,
            masterHealthCheck,
            counter = 0,
            nextTime,
            getConfigTimeout,
            virtualMachine;

        let {instanceId, interval} = this.platform.extractRequestInfo(_request);

        // verify the caller (diagram: trusted source?)
        virtualMachine = await this.platform.getInstanceById(instanceId);
        if (!virtualMachine) {
            // not trusted
            throw new Error(`Unauthorized calling instance (vmid: ${instanceId}). Instance not found in scale set.`); // eslint-disable-line max-len
        }

        // describe self
        parameters = {
            resourceGroup: process.env.RESOURCE_GROUP,
            scaleSetName: process.env.SCALESET_NAME,
            virtualMachineId: virtualMachine.instanceId
        };
        this._selfInstance = await this.platform.describeInstance(parameters);

        // is myself under health check monitoring?
        // do self health check
        selfHealthCheck = await this.platform.getInstanceHealthCheck({
            vmId: this._selfInstance.properties.vmId
        }, interval);
        // not monitored instance?
        if (!selfHealthCheck) {
            isNewInstance = true;
            // save self to monitored instances db (diagram: add instance to monitor)
            await this.addInstanceToMonitor(this._selfInstance,
                Date.now() + interval * 1000);
        }

        nextTime = Date.now();
        getConfigTimeout = nextTime + SCRIPT_TIMEOUT * 1000; // unit ms

        // (diagram: master exists?)
        while (!masterIsHealthy && (nextTime < getConfigTimeout)) {
            // get the current master
            masterInfo = await this.getMasterInfo();

            // is master healthy?
            if (masterInfo) {
                // self is master?
                if (masterInfo.ip === this._selfInstance.getPrimaryPrivateIp()) {
                    masterHealthCheck = selfHealthCheck;
                } else {
                    masterHealthCheck =
                        await this.platform.getInstanceHealthCheck(masterInfo,
                            interval);
                }
                masterIsHealthy = !!masterHealthCheck && masterHealthCheck.healthy;
            }

            // we need a new master! let's hold a master election!
            if (!masterIsHealthy) {
                // but can I run the election? (diagram: anyone's holding master election?)
                this._electionLock = await this.AcquireMutex(DB_COLLECTION_MASTER);
                if (this._electionLock) {
                    // yes, you run it!
                    logger.info('This thread is running an election.');
                    try {
                        // (diagram: elect new master from queue (existing instances))
                        await this.holdMasterElection(
                            this._selfInstance.getPrimaryPrivateIp());
                        logger.info('Election completed.');
                    } catch (error) {
                        logger.error('Something went wrong in the master election.');
                    } finally {
                        // release the lock, let someone else run the election.
                        await this.releaseMutex(DB_COLLECTION_MASTER, this._electionLock);
                        this._electionLock = null;
                    }
                    // (diagram: master exists?)
                    masterInfo = await this.getMasterInfo();
                } else {
                    logger.info(`Wait for master election (counter: ${++counter}, time:${Date.now()})`); // eslint-disable-line max-len
                }
            }
            nextTime = Date.now();
            masterIsHealthy = !!masterInfo;
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

        // (diagram: am I a new instance?)
        // I am under monitor, please verify my periodic health check!
        if (!isNewInstance) {
            // if still healthy or unhealthy records are less than
            // process.env.HEARTBEAT_LOSS_COUNT, can claim healthy again
            // (diagram: heartbeats lost previously? & diagram: loss acceptable?)
            if (selfHealthCheck.healthy ||
                (!selfHealthCheck.healthy &&
                    selfHealthCheck.heartBeatLossCount <
                    process.env.HEART_BEAT_LOSS_COUNT)) {
                // may long live! (diagram: Mark instance healthy)
                await this.updateInstanceToMonitor({
                    vmId: this._selfInstance.properties.vmId
                });
            } else { // cannot claim healthy any more, start a new life in heaven.
                // (diagram: remove instance)
                await this.removeInstance({
                    vmId: this._selfInstance.properties.vmId
                });
            }
        }
        // the master ip same as mine? (diagram: master IP same as mine?)
        if (masterInfo.ip === this._selfInstance.getPrimaryPrivateIp()) {
            // am I a new instance? (diagram: am I new instance?)
            if (isNewInstance) {
                logger.info(`called handleGetConfig: returning master config(master-ip: ${masterInfo.ip})`); // eslint-disable-line max-len
                return await this.getMasterConfig(
                    await this.platform.getCallbackEndpointUrl(_request));
            } else {
                logger.info(`called handleGetConfig: respond to master heartbeat(master-ip: ${masterInfo.ip})`); // eslint-disable-line max-len
                return this.responseToHeartBeat(masterInfo.ip);
            }
        } else {
            // am I a new instance? (diagram: am I new instance?)
            if (isNewInstance) {
                logger.info(`called handleGetConfig: returning slave config(master-ip: ${masterInfo.ip})`); // eslint-disable-line max-len
                return await this.getSlaveConfig(masterInfo.ip,
                    await this.platform.getCallbackEndpointUrl(_request));
            } else {
                logger.info(`called handleGetConfig: respond to slave heartbeat(master-ip: ${masterInfo.ip})`); // eslint-disable-line max-len
                return this.responseToHeartBeat(masterInfo.ip);
            }
        }
    }

    async holdMasterElection(ip) { // eslint-disable-line no-unused-vars
        // list all election candidates
        let parameters = {
            resourceGroup: process.env.RESOURCE_GROUP,
            scaleSetName: process.env.SCALESET_NAME
        };
        let virtualMachine, candidate, candidates = [];
        let [virtualMachines, moniteredInstances] = await Promise.all([
            this.platform.listAllInstances(parameters),
            this.listMonitoredInstances()
        ]);
        for (virtualMachine of virtualMachines) {
            // if candidate is monitored, and it is in the healthy state
            // put in in the candidate pool
            if (moniteredInstances[virtualMachine.instanceId] !== undefined) {
                let healthCheck = await this.platform.getInstanceHealthCheck(
                    moniteredInstances[virtualMachine.instanceId], -1
                );
                if (healthCheck.healthy &&
                    virtualMachine.properties.provisioningState === 'Succeeded') {
                    candidates.push(virtualMachine);
                }
            }
        }

        let instanceId = 0,
            master = null;
        let promiseAllArray = [],
            candidateDescribingFunc = async _candidate => {
                let _parameters = {
                    resourceGroup: process.env.RESOURCE_GROUP,
                    scaleSetName: process.env.SCALESET_NAME,
                    virtualMachineId: _candidate.instanceId
                };
                return await this.platform.describeInstance(_parameters);
            };
        if (candidates.length > 0) {
            // choose the one with smaller instanceId
            for (candidate of candidates) {
                if (instanceId === 0 || candidate.instanceId < instanceId) {
                    instanceId = candidate.instanceId;
                    master = candidate;
                }
                promiseAllArray.push((candidateDescribingFunc)(candidate));
            }

            if (promiseAllArray.length > 0) {
                candidates = await Promise.all(promiseAllArray);
            }
            // monitor all candidates
            promiseAllArray = [];
            for (candidate of candidates) {
                promiseAllArray.push((this.addInstanceToMonitor)(candidate));
            }
            await Promise.all(promiseAllArray);
        }

        if (master) {
            parameters = {
                resourceGroup: process.env.RESOURCE_GROUP,
                scaleSetName: process.env.SCALESET_NAME,
                virtualMachineId: instanceId
            };
            virtualMachine = await this.platform.describeInstance(parameters);
            return await this.updateMaster(virtualMachine);
        } else {
            return Promise.reject('No instance available for master.');
        }
    }

    async updateMaster(instance) {
        logger.info('calling updateMaster');
        let documentContent = {
            master: 'master',
            ip: instance.getPrimaryPrivateIp(),
            instanceId: instance.instanceId,
            vmId: instance.properties.vmId
        };

        let documentId = `${process.env.SCALESET_NAME}-master`,
            replaced = true;
        try {
            let doc = await armClient.CosmosDB.createDocument(process.env.SCALESET_DB_ACCOUNT,
                DATABASE_NAME, DB_COLLECTION_MASTER, documentId, documentContent, replaced,
                process.env.REST_API_MASTER_KEY);
            if (doc) {
                logger.info(`called updateMaster: master(id:${documentContent.instanceId}, ip: ${documentContent.ip}) updated.`); // eslint-disable-line max-len
                return true;
            } else {
                logger.error(`called updateMaster: master(id:${documentContent.instanceId}, ip: ${documentContent.ip}) not updated.`); // eslint-disable-line max-len
                return false;
            }
        } catch (error) {
            logger.error(`updateMaster > error: ${error}`);
            return false;
        }
    }

    async addInstanceToMonitor(instance, nextHeartBeatTime) {
        logger.info('calling addInstanceToMonitor');
        let documentContent = {
            ip: instance.getPrimaryPrivateIp(),
            instanceId: instance.instanceId,
            vmId: instance.properties.vmId,
            scaleSetName: process.env.SCALESET_NAME,
            nextHeartBeatTime: nextHeartBeatTime,
            heartBeatLossCount: 0
        };

        let documentId = instance.properties.vmId,
            replaced = true;
        try {
            let doc = await armClient.CosmosDB.createDocument(process.env.SCALESET_DB_ACCOUNT,
                DATABASE_NAME, DB_COLLECTION_MONITORED, documentId, documentContent, replaced,
                process.env.REST_API_MASTER_KEY);
            if (doc) {
                logger.info(`called addInstanceToMonitor: ${documentId} monitored.`);
                return true;
            } else {
                logger.error(`called addInstanceToMonitor: ${documentId} not monitored.`);
                return false;
            }
        } catch (error) {
            logger.error(`addInstanceToMonitor > error: ${error}`);
            return false;
        }
    }

    async listMonitoredInstances() {
        const queryObject = {
            query: `SELECT * FROM ${DB_COLLECTION_MONITORED} c WHERE c.scaleSetName = @scaleSetName`, // eslint-disable-line max-len
            parameters: [
                {
                    name: '@scaleSetName',
                    value: `${process.env.SCALESET_NAME}`
                }
            ]
        };

        try {
            let instances = {},
                docs = await armClient.CosmosDB.query(
                    process.env.SCALESET_DB_ACCOUNT, {
                        dbName: DATABASE_NAME,
                        collectionName: DB_COLLECTION_MONITORED,
                        partitioned: true,
                        queryObject: queryObject
                    }, process.env.REST_API_MASTER_KEY);
            if (Array.isArray(docs)) {
                docs.forEach(doc => {
                    instances[doc.instanceId] = doc;
                });
            }
            return instances;
        } catch (error) {
            logger.error(error);
        }
        return null;
    }

    async getMasterInfo() {
        const queryObject = {
            query: `SELECT * FROM ${DB_COLLECTION_MASTER} c WHERE c.id = @id`,
            parameters: [
                {
                    name: '@id',
                    value: `${process.env.SCALESET_NAME}-master`
                }
            ]
        };

        try {
            let docs = await armClient.CosmosDB.query(process.env.SCALESET_DB_ACCOUNT, {
                dbName: DATABASE_NAME,
                collectionName: DB_COLLECTION_MASTER,
                partitioned: true,
                queryObject: queryObject
            }, process.env.REST_API_MASTER_KEY);
            if (docs.length > 0) {
                return docs[0];
            } else {
                return null;
            }
        } catch (error) {
            logger.error(error);
        }
        return null;
    }

    async AcquireMutex(collectionName) {
        let _electionLock = null,
            _purge = false,
            _now = Math.floor(Date.now() / 1000);
        let _getMutex = async function() {
            const queryObject = {
                query: `SELECT * FROM ${DB_COLLECTION_MUTEX} c WHERE c.collectionName = @collectionName`, // eslint-disable-line max-len
                parameters: [
                    {
                        name: '@collectionName',
                        value: `${collectionName}`
                    }
                ]
            };

            try {
                let docs = await armClient.CosmosDB.query(process.env.SCALESET_DB_ACCOUNT, {
                    dbName: DATABASE_NAME,
                    collectionName: DB_COLLECTION_MUTEX,
                    partitioned: true,
                    queryObject: queryObject
                }, process.env.REST_API_MASTER_KEY);
                _electionLock = docs[0];
            } catch (error) {
                _electionLock = null;
                logger.error(error);
            }
            return _electionLock;
        };

        let _createMutex = async function(purge) {
            logger.info('calling _createMutex');
            let documentContent = {
                servingStatus: 'activated',
                collectionName: collectionName,
                acquireLocalTime: _now
            };

            let documentId =
                AutoScaleCore.uuidGenerator(JSON.stringify(documentContent) +
                    AutoScaleCore.moduleRuntimeId()),
                replaced = false;
            try {
                if (purge && _electionLock) {
                    await armClient.CosmosDB.deleteDocument(process.env.SCALESET_DB_ACCOUNT,
                        DATABASE_NAME, DB_COLLECTION_MUTEX, _electionLock.id,
                        process.env.REST_API_MASTER_KEY);
                    logger.info(`mutex(id: ${_electionLock.id}) was purged.`);
                }
                let doc = await armClient.CosmosDB.createDocument(
                    process.env.SCALESET_DB_ACCOUNT, DATABASE_NAME,
                    DB_COLLECTION_MUTEX, documentId, documentContent, replaced,
                    process.env.REST_API_MASTER_KEY);
                if (doc) {
                    _electionLock = doc;
                    logger.info(`called _createMutex: mutex(${collectionName}) created.`);
                    return true;
                } else {
                    logger.warn(`called _createMutex: mutex(${collectionName}) not created.`);
                    return true;
                }
            } catch (error) {
                logger.error(`_createMutex > error: ${error}`);
                return false;
            }
        };

        await _getMutex();
        // mutex should last no more than a certain waiting period
        // (Azure function default timeout is 5 minutes)
        if (_electionLock && _now - _electionLock.acquireLocalTime > ELECTION_WAITING_PERIOD) {
            // purge the dead mutex
            _purge = true;
        }
        // no mutex?
        if (!_electionLock || _purge) {
            // create one
            let created = await _createMutex(_purge);
            if (!created) {
                throw new Error(`Error in acquiring mutex(${collectionName})`);
            }
            return _electionLock;
        } else {
            return null;
        }
    }

    async releaseMutex(collectionName, mutex) {
        logger.info(`calling releaseMutex: mutex(${collectionName}, ${mutex.id}).`);
        let documentId = mutex.id;
        try {
            let deleted =
                await armClient.CosmosDB.deleteDocument(
                    process.env.SCALESET_DB_ACCOUNT, DATABASE_NAME, DB_COLLECTION_MUTEX,
                    documentId, process.env.REST_API_MASTER_KEY);
            if (deleted) {
                logger.info(`called releaseMutex: mutex(${collectionName}) released.`);
                return true;
            } else {
                logger.warn(`called releaseMutex: mutex(${collectionName}) not found.`);
                return true;
            }
        } catch (error) {
            logger.info(`releaseMutex > error: ${error}`);
            return false;
        }
    }

    /**
     *
     * @param {Ojbect} instance the instance to update. minimum required
     *      properties {vmId: <string>}
     */
    async updateInstanceToMonitor(instance) { // eslint-disable-line no-unused-vars
        // TODO: will not implement instance updating in V3
        // always return true
        return await Promise.resolve(true);
    }

    /**
     * handle instance removal
     * @param {Object} instance the instance to remove. minimum required
     *      properties{vmId: <string>}
     */
    async removeInstance(instance) { // eslint-disable-line no-unused-vars
        // TODO: will not implement instance removal in V3
        // always return true
        return await Promise.resolve(true);
    }
}

exports.AutoScaleCore = AutoScaleCore; // get a reference to the core
exports.AzurePlatform = AzurePlatform;
exports.AzureAutoscaleHandler = AzureAutoscaleHandler;

/**
 * Initialize the module to be able to run via the 'handle' function.
 * Otherwise, this module only exposes some classes.
 */
exports.initModule = async () => {
    /**
     * expose the module runtime id
     * @returns {String} a unique id.
     */
    exports.moduleRuntimeId = () => moduleId;
    /**
     * Handle the auto-scaling
     * @param {Object} context the Azure function app runtime context.
     * @param {*} req the request object to the Azure function app.
     */
    exports.handle = async (context, req) => {
        logger = new AzureLogger(context.log);
        const handler = new AzureAutoscaleHandler();
        return await handler.handle(context, req);
    };
    return await exports;
};
