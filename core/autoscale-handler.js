'use strict';

/*
Author: Fortinet
*
* AutoscaleHandler contains the core used to handle serving configuration files and
* manage the autoscale events from multiple cloud platforms.
*
* Use this class in various serverless cloud contexts. For each serverless cloud
* implementation extend this class and implement the handle() method. The handle() method
* should call other methods as needed based on the input events from that cloud's
* autoscale mechanism and api gateway requests from the FortiGate's callback-urls.
* (see reference AWS implementation {@link AwsAutoscaleHandler})
*
* Each cloud implementation should also implement a concrete version of the abstract
* {@link CloudPlatform} class which should be passed to super() in the constructor. The
* CloudPlatform interface should abstract each specific cloud's api. The reference
* implementation {@link AwsPlatform} handles access to the dynamodb for persistence and
* locking, interacting with the aws autoscaling api and determining the api endpoint url
* needed for the FortiGate config's callback-url parameter.
*/

const path = require('path');
const Logger = require('./logger');
const CoreFunctions = require('./core-functions');
const
    AUTOSCALE_SECTION_EXPR =
    /(?:^|(?:\s*))config?\s*system?\s*auto-scale\s*((?:.|\s)*)\bend\b/;
const NO_HEART_BEAT_INTERVAL_SPECIFIED = -1;
const DEFAULT_HEART_BEAT_INTERVAL = 30;

module.exports = class AutoscaleHandler {

    constructor(platform, baseConfig) {
        this.platform = platform;
        this._baseConfig = baseConfig;
        this._selfInstance = null;
        this._selfHealthCheck = null;
        this._masterRecord = null;
        this._masterInfo = null;
        this._requestInfo = {};
        this.scalingGroupName = null;
        this.masterScalingGroupName = null;
    }

    static get NO_HEART_BEAT_INTERVAL_SPECIFIED() {
        return NO_HEART_BEAT_INTERVAL_SPECIFIED;
    }

    static get DEFAULT_HEART_BEAT_INTERVAL() {
        return DEFAULT_HEART_BEAT_INTERVAL;
    }

    /**
     * Get the read-only settings object from the platform. To modify the settings object,
     * do it via the platform instance but not here.
     */
    get _settings() {
        return this.platform && this.platform._settings;
    }

    /**
     * Set the logger to output log to platform
     * @param {Logger} logger Logger object used to output log to platform
     */
    useLogger(logger) {
        this.logger = logger || new Logger();
    }

    throwNotImplementedException() {
        throw new Error('Not Implemented');
    }

    async handle() {
        await this.throwNotImplementedException();
    }

    async init() {
        this.logger.info('calling init [Autoscale handler ininitialization]');
        // do the cloud platform initialization
        const success = this.platform.initialized || await this.platform.init();
        // ensure that the settings are saved properly.
        // check settings availability

        // if there's limitation for a platform that it cannot save settings to db during
        // deployment. the deployment template must create a service function that takes all
        // deployment settings as its environment variables. The CloudPlatform class must
        // invoke this service function to store all settings to db. and also create a flag
        // setting item 'deployment-settings-saved' with value set to 'true'.
        // from then on, it can load item from db.
        // if this process cannot be done during the deployment, it must be done once here in the
        // init function of the platform-specific autoscale-handler.
        // by doing so, catch the error 'Deployment settings not saved.' and handle it.
        this.logger.info('checking deployment setting items');
        await this.loadSettings();
        if (!this._settings || this._settings &&
            this._settings['deployment-settings-saved'] !== 'true') {
            // in the init function of each platform autoscale-handler, this error must be caught
            // and provide addtional handling code to save the settings
            throw new Error('Deployment settings not saved.');
        }

        // set scaling group names for master and self
        this.setScalingGroup(
            this._settings['master-scaling-group-name'],
            this._settings['master-scaling-group-name']
        );
        return success;
    }

    async getConfigSet(configName) {
        try {
            let keyPrefix = this._settings['asset-storage-key-prefix'] ?
                path.join(this._settings['asset-storage-key-prefix'], 'configset') : 'configset';
            const parameters = {
                storageName: this._settings['asset-storage-name'],
                keyPrefix: keyPrefix,
                fileName: configName
            };
            let blob = await this.platform.getBlobFromStorage(parameters);
            // replace Windows line feed \r\n with \n to normalize the config set
            if (blob.content && typeof blob.content === 'string' &&
                blob.content.indexOf('\r') >= 0) {
                // eslint-disable-next-line no-control-regex
                return blob.content.replace(new RegExp('\r', 'g', ''));
            } else {
                return blob.content;
            }
        } catch (error) {
            this.logger.warn(`called getConfigSet > error: ${error}`);
            throw error;
        }
    }

    async getConfig(ip) {
        await this.throwNotImplementedException();
        return ip;
    }

    async getBaseConfig() {
        let baseConfig = await this.getConfigSet('baseconfig');
        let psksecret = this._settings['fortigate-psk-secret'],
            fazConfig = '',
            fazIp;
        if (baseConfig) {
            // check if other config set are required
            let requiredConfigSet = this._settings['required-configset'] || [];
            let configContent = '';
            // check if second nic is enabled, config for the second nic must be prepended to
            // base config
            if (this._settings['enable-second-nic'] === 'true') {
                baseConfig = await this.getConfigSet('port2config') + baseConfig;
            }
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
                        case 'extrastaticroutes':
                            configContent += await this.getConfigSet('extrastaticroutes');
                            break;
                        case 'extraports':
                            configContent += await this.getConfigSet('extraports');
                            break;
                        default:
                            break;
                    }
                }
            }
            baseConfig += configContent;

            baseConfig = baseConfig
                .replace(new RegExp('{SYNC_INTERFACE}', 'gm'),
                    this._settings['fortigate-sync-interface'] || 'port1')
                .replace(new RegExp('{EXTERNAL_INTERFACE}', 'gm'), 'port1')
                .replace(new RegExp('{INTERNAL_INTERFACE}', 'gm'), 'port2')
                .replace(new RegExp('{PSK_SECRET}', 'gm'), psksecret)
                .replace(new RegExp('{TRAFFIC_PORT}', 'gm'),
                    this._settings['fortigate-traffic-port'] || 443)
                .replace(new RegExp('{ADMIN_PORT}', 'gm'),
                    this._settings['fortigate-admin-port'] || 8443)
                .replace(new RegExp('{HEART_BEAT_INTERVAL}', 'gm'),
                    this._settings['heartbeat-interval'] || 30)
                .replace(new RegExp('{INTERNAL_ELB_DNS}', 'gm'),
                    this._settings['fortigate-protected-internal-elb-dns'] || '');
        }
        return baseConfig;
    }

    parseRequestInfo(event) {
        this._requestInfo = this.platform.extractRequestInfo(event);
    }

    async parseInstanceInfo(instanceId) {
        await this.throwNotImplementedException();
        return instanceId;
    }

    async checkInstanceAuthorization(instance) {
        await this.throwNotImplementedException();
        return instance && false;
    }

    async handleGetLicense(event, context, callback) {
        let result;
        this.logger.info('calling handleGetLicense');
        try {
            const platformInitSuccess = await this.init();
            // return 500 error if script cannot finish the initialization.
            if (!platformInitSuccess) {
                result = 'fatal error, cannot initialize.';
                this.logger.error(result);
                callback(null, this.proxyResponse(500, result));
                return;
            }

            // authenticate the calling instance
            this.parseRequestInfo(event);
            if (!this._requestInfo.instanceId) {
                callback(null, this.proxyResponse(403, 'Instance id not provided.'));
                return;
            }
            await this.parseInstanceInfo(this._requestInfo.instanceId);

            await this.checkInstanceAuthorization(this._selfInstance);

            let [licenseFiles, stockRecords, usageRecords] = await Promise.all([
                this.platform.listLicenseFiles(), // expect it to return a map
                this.platform.listLicenseStock(), // expect it to return a map
                this.platform.listLicenseUsage() // expect it to return a map
            ]);

            // update the license stock records on db if any change in file storage
            // this returns the newest stockRecords on the db
            stockRecords = await this.updateLicenseStockRecord(licenseFiles, stockRecords);

            // start to pick a valid license here.
            let availStockItem, availStockRecord;

            let itemKey, itemValue;

            let promiseEmitter = async () => {
                let updateUsage = true, replaceUsageRecord = false;
                // TODO: remove the workaround if mantis item: #0534971 is resolved
                // a workaround for double get call:
                // check if a license is already assigned to one fgt, if it makes a second get call
                // for license, returns the tracked usage record.

                for ([itemKey, itemValue] of usageRecords.entries()) {
                    if (itemValue.scalingGroupName === this.scalingGroupName &&
                    itemValue.instanceId === this._selfInstance.instanceId) {
                        availStockRecord = itemValue;
                        availStockItem = licenseFiles.get(itemValue.blobKey);
                        updateUsage = false;
                        break;
                    }
                }

                // this is a greedy approach
                // try to find one available license and use it.
                // if none availabe, try to check if any used one could be recycled.
                // if none recyclable, throw an error.

                // NOTE: need to handle concurrent license requests.
                // if two device request license at the same time, race condition will occur.
                // insert licenseUsage record (neither replace nor update), if insert fail,
                // start it over in 2 seconds.

                if (!availStockItem) {
                    for ([itemKey, itemValue] of stockRecords.entries()) {
                        if (itemKey && !usageRecords.has(itemKey)) {
                            availStockRecord = itemValue;
                            availStockItem = licenseFiles.get(itemValue.blobKey);
                            break;
                        }
                    }

                    // if not found available license file
                    if (!availStockItem) {
                        [availStockRecord] = await this.findRecyclableLicense(stockRecords,
                        usageRecords, 1);
                        availStockItem = availStockRecord && licenseFiles &&
                            licenseFiles.get(availStockRecord.blobKey);
                        replaceUsageRecord = !!availStockItem;
                    }
                }

                // if the selected licenseItem does not contain a content, fetch it from storage
                // this will also update the checksum and algorithm which will be saved in the
                // usage record too.
                if (!availStockItem.content) {
                    availStockItem.content = await this.platform.getLicenseFileContent(
                    availStockItem.fileName
                    );
                }

                // license file found
                // update usage records
                if (availStockItem && updateUsage) {
                    try {
                        availStockRecord.updateUsage(this._selfInstance.instanceId,
                            this._selfInstance.scalingGroupName);
                        await this.platform.updateLicenseUsage(availStockRecord,
                                replaceUsageRecord);
                    } catch (error) {
                        if (error && error.code &&
                            error.code === 'ConditionalCheckFailedException') {
                            // duplicate key caught
                            // reset availStockItem if cannot update
                            availStockItem = null;
                            // fetch the latest usage record from db again.
                            usageRecords = await this.platform.listLicenseUsage();
                        } else {
                            throw error;
                        }
                    }
                }
                return availStockItem;
            };

            let validator = stockItem => {
                return !!stockItem;
            };

            await CoreFunctions.waitFor(promiseEmitter, validator, 5000, 3);

            if (!availStockItem) {
                throw new Error('No license available.');
            }

            this.logger.info(`called handleGetLicense, license: ${availStockItem.fileName} is ` +
            `assigned to instance (id: ${this._selfInstance.instanceId}).`);

            callback(null, this.proxyResponse(200, availStockItem.content));


        } catch (ex) {
            this.logger.error('called handleGetLicense > error: ', ex);
            callback(ex);
        }
    }

    /**
     * Handle the 'auto-scale synced' callback from the FortiGate.
     * the first callback will be considered as an indication for instance "up-and-running"
     * @param {*} event event from the handling call. structure varies per platform.
     */
    async handleSyncedCallback() {
        const
            instanceId = this._requestInfo.instanceId,
            interval = this._requestInfo.interval;

        let parameters = {},
            masterIp,
            lifecycleShouldAbandon = false;

        parameters.instanceId = instanceId;
        parameters.scalingGroupName = this.scalingGroupName;
        // get selfinstance
        this._selfInstance = this._selfInstance || await this.platform.describeInstance(parameters);

        // handle hb monitor
        // get self health check
        this._selfHealthCheck = this._selfHealthCheck ||
            await this.platform.getInstanceHealthCheck({
                instanceId: this._selfInstance.instanceId
            }, interval);
        // if self is already out-of-sync, skip the monitoring logics
        if (this._selfHealthCheck && !this._selfHealthCheck.inSync) {
            return {};
        }
        // get master instance monitoring
        await this.retrieveMaster();

        // if this instance is the master, skip checking master election
        if (this._masterInfo && this._selfInstance.instanceId === this._masterInfo.instanceId &&
            this.scalingGroupName === this.masterScalingGroupName) {
            // use master health check result as self health check result
            this._selfHealthCheck = this._masterHealthCheck;
        } else if (this._selfHealthCheck && !this._selfHealthCheck.healthy) {
            // if this instance is unhealth, skip master election check

        } else if (!(this._masterInfo && this._masterHealthCheck &&
            this._masterHealthCheck.healthy)) {
            // if no master or master is unhealthy, try to run a master election or check if a
            // master election is running then wait for it to end
            // promiseEmitter to handle the master election process by periodically check:
            // 1. if there is a running election, then waits for its final
            // 2. if there isn't a running election, then runs an election and complete it
            let promiseEmitter = this.checkMasterElection.bind(this),
                // validator set a condition to determine if the fgt needs to keep waiting or not.
                validator = masterInfo => {
                    // if i am the new master, don't wait, continue to finalize the election.
                    // should return yes to end the waiting.
                    if (masterInfo &&
                        masterInfo.primaryPrivateIpAddress ===
                        this._selfInstance.primaryPrivateIpAddress) {
                        return true;
                    } else if (this._masterRecord && this._masterRecord.voteState === 'pending') {
                        // if i am not the new master, and the new master hasn't come up to
                        // finalize the election, I should keep on waiting.
                        // should return false to continue.
                        this._masterRecord = null; // clear the master record cache
                        return false;
                    } else if (this._masterRecord && this._masterRecord.voteState === 'done') {
                        // if i am not the new master, and the master election is final, then no
                        // need to wait.
                        // should return true to end the waiting.
                        return true;
                    } else {
                        // no master elected yet
                        // entering this syncedCallback function means i am already insync so
                        // i used to be assigned a master.
                        // if i am not in the master scaling group then I can't start a new
                        // election.
                        // i stay as is and hoping for someone in the master scaling group
                        // triggers a master election. Then I will be notified at some point.
                        if (this.scalingGroupName !== this.masterScalingGroupName) {
                            return true;
                        } else {
                            // for new instance or instance in the master scaling group
                            // they should keep on waiting
                            return false;
                        }
                    }
                },
                // counter to set a time based condition to end this waiting. If script execution
                // time is close to its timeout (6 seconds - abount 1 inteval + 1 second), ends the
                // waiting to allow for the rest of logic to run
                counter = currentCount => { // eslint-disable-line no-unused-vars
                    if (Date.now() < process.env.SCRIPT_EXECUTION_EXPIRE_TIME - 6000) {
                        return false;
                    }
                    this.logger.warn('script execution is about to expire');
                    return true;
                };

            try {
                this._masterInfo = await CoreFunctions.waitFor(
                    promiseEmitter, validator, 5000, counter);
                // after new master is elected, get the new master healthcheck
                // there are two possible results here:
                // 1. a new instance comes up and becomes the new master, master healthcheck won't
                // exist yet because this instance isn't added to monitor.
                //   1.1. in this case, the instance will be added to monitor.
                // 2. an existing slave instance becomes the new master, master healthcheck exists
                // because the instance in under monitoring.
                //   2.1. in this case, the instance will take actions based on its healthcheck
                //        result.
                this._masterHealthCheck = null; // invalidate the master health check object
                // reload the master health check object
                await this.retrieveMaster();
            } catch (error) {
                // if error occurs, check who is holding a master election, if it is this instance,
                // terminates this election. then continue
                await this.retrieveMaster(null, true);

                if (this._masterRecord.instanceId === this._selfInstance.instanceId &&
                    this._masterRecord.asgName === this._selfInstance.scalingGroupName) {
                    await this.platform.removeMasterRecord();
                }
                await this.removeInstance(this._selfInstance);
                throw new Error('Failed to determine the master instance within ' +
                    `${process.env.SCRIPT_EXECUTION_EXPIRE_TIME} seconds. This instance is unable` +
                    ' to bootstrap. Please report this to administrators.');
            }
        }

        // check if myself is under health check monitoring
        // (master instance itself may have got its healthcheck result in some code blocks above)
        this._selfHealthCheck = this._selfHealthCheck ||
            await this.platform.getInstanceHealthCheck({
                instanceId: this._selfInstance.instanceId
            }, interval);

        // if this instance is the master instance and the master record is still pending, it will
        // finalize the master election.
        if (this._masterInfo && this._selfInstance.instanceId === this._masterInfo.instanceId &&
            this.scalingGroupName === this.masterScalingGroupName &&
            this._masterRecord && this._masterRecord.voteState === 'pending') {
            if (!this._selfHealthCheck || this._selfHealthCheck && this._selfHealthCheck.healthy) {
                // if election couldn't be finalized, remove the current election so someone else
                // could start another election
                if (!await this.platform.finalizeMasterElection()) {
                    await this.platform.removeMasterRecord();
                    this._masterRecord = null;
                    lifecycleShouldAbandon = true;
                }
            }
        }

        // if no self healthcheck record found, this instance not under monitor. It's about the
        // time to add it to monitor. should make sure its all lifecycle actions are complete
        // while starting to monitor it.
        // if this instance is not the master, still add it to monitor but leave its master unknown.
        // if there's a master instance, add the monitor record using this master regardless
        // the master health status.
        if (!this._selfHealthCheck) {
            // check if a lifecycle event waiting
            await this.completeGetConfigLifecycleAction(this._selfInstance.instanceId,
                !lifecycleShouldAbandon);

            masterIp = this._masterInfo ? this._masterInfo.primaryPrivateIpAddress : null;
            await this.addInstanceToMonitor(this._selfInstance, interval, masterIp);
            this.logger.info(`instance (id:${this._selfInstance.instanceId}, ` +
                    `master-ip: ${masterIp}) is added to monitor at timestamp: ${Date.now()}.`);
            // if this newly come-up instance is the new master, save its instance id as the
            // default password into settings because all other instance will sync password from
            // the master there's a case if users never changed the master's password, when the
            // master was torn-down, there will be no way to retrieve this original password.
            // so in this case, should keep track of the update of default password.
            if (this._selfInstance.instanceId === this._masterInfo.instanceId &&
                    this.scalingGroupName === this.masterScalingGroupName) {
                await this.platform.setSettingItem('fortigate-default-password',
                    this._selfInstance.instanceId,
                    'default password comes from the new elected master.', false, false);
            }
            return '';
        } else if (this._selfHealthCheck && this._selfHealthCheck.healthy) {
            // for those already in monitor, if there's a healthy master instance, notify
            // the instance with the master ip if the master ip in its monitor record doesn't match
            // the current master.
            // if no master present (master is in failover process), keep what ever master ip
            // it has, keep it in-sync as is.
            masterIp = this._masterInfo && this._masterHealthCheck &&
                this._masterHealthCheck.healthy ?
                this._masterInfo.primaryPrivateIpAddress : this._selfHealthCheck.masterIp;
            let now = Date.now();
            await this.platform.updateInstanceHealthCheck(this._selfHealthCheck, interval,
                masterIp, now);
            this.logger.info(`hb record updated on (timestamp: ${now}, instance id:` +
                `${this._selfInstance.instanceId}, ` +
                `ip: ${this._selfInstance.primaryPrivateIpAddress}) health check ` +
                `(${this._selfHealthCheck.healthy ? 'healthy' : 'unhealthy'}, ` +
                `heartBeatLossCount: ${this._selfHealthCheck.heartBeatLossCount}, ` +
                `nextHeartBeatTime: ${this._selfHealthCheck.nextHeartBeatTime}` +
                `syncState: ${this._selfHealthCheck.syncState}).`);
            return masterIp && this._selfHealthCheck.masterIp !== masterIp ? {
                'master-ip': this._masterInfo.primaryPrivateIpAddress
            } : '';
        } else {
            this.logger.info('instance is unhealthy. need to remove it. healthcheck record:',
                JSON.stringify(this._selfHealthCheck));
            // for unhealthy instances, fail this instance
            // if it is previously on 'in-sync' state, mark it as 'out-of-sync' so script will stop
            // keeping it in sync and stop doing any other logics for it any longer.
            if (this._selfHealthCheck && this._selfHealthCheck.inSync) {
                // change its sync state to 'out of sync' by updating it state one last time
                await this.platform.updateInstanceHealthCheck(this._selfHealthCheck, interval,
                    this._selfHealthCheck.masterIp, Date.now(), true);
                // terminate it from autoscaling group
                await this.removeInstance(this._selfInstance);
            }
            // for unhealthy instances, keep responding with action 'shutdown'
            return {
                action: 'shutdown'
            };
        }
    }

    /**
     * Handle the status messages from FortiGate
     * @param {Object} event the incoming request event
     * @returns {Object} return messages
     */
    handleStatusMessage(event) {
        this.logger.info('calling handleStatusMessage.');
        // do not process status messages till further requriements (Mar 27, 2019)
        this.logger.info(JSON.stringify(event));
        this.logger.info(`Status: ${this._requestInfo.status}`);
        return '';
    }

    /**
     * Parse a configset with given data sources. This function should be implemented in
     * a platform-specific one if needed.
     * @param {String} configSet a config string with placeholders. The placeholder looks like:
     * {@device.networkInterfaces#0.PrivateIpAddress}, where @ + device incidates the data source,
     * networkInterfaces + # + number incidates the nth item of networkInterfaces, so on and so
     * forth. The # index starts from 0. For referencing the 0th item, it can get rid of
     * the # + number, e.g. {@device.networkInterfaces#0.PrivateIpAddress} can be written as
     * {@device.networkInterfaces.PrivateIpAddress}
     * @param {Object} dataSources a json object of multiple key/value pairs with data
     * to relace some placeholders in the configSet parameter. Each key must start with an
     * asperand (@ symbol) to form a category of data such as: @vpc, @device, @vpn_connection, etc.
     * The value of each key must be an object {}. Each property of this object could be
     * a primitive, a nested object, or an array of the same type of primitives or nested object.
     * The leaf property of a nested object must be a primitive.
     * @returns {String} a pasred config string
     */
    async parseConfigSet(configSet, dataSources) { // eslint-disable-line no-unused-vars
        return await configSet;
    }

    async getMasterConfig(parameters) {
        // no dollar sign in place holders
        let config = '';
        this._baseConfig = await this.getBaseConfig();
        // parse TGW VPN
        if (parameters.vpnConfigSetName && parameters.vpnConfiguration) {
            // append vpnConfig to base config
            config = await this.getConfigSet(parameters.vpnConfigSetName);
            config = await this.parseConfigSet(config,
                {'@vpn_connection': parameters.vpnConfiguration});
            this._baseConfig += config;
        }
        config = this._baseConfig.replace(/\{CALLBACK_URL}/,parameters.callbackUrl ?
            parameters.callbackUrl : '');
        return config;
    }

    async getSlaveConfig(parameters) {
        this._baseConfig = await this.getBaseConfig();
        const
            autoScaleSectionMatch = AUTOSCALE_SECTION_EXPR.exec(this._baseConfig),
            autoScaleSection = autoScaleSectionMatch && autoScaleSectionMatch[1],
            matches = [
                /set\s+sync-interface\s+(.+)/.exec(autoScaleSection),
                /set\s+psksecret\s+(.+)/.exec(autoScaleSection)
            ];
        const [syncInterface, pskSecret] = matches.map(m => m && m[1]),
            apiEndpoint = parameters.callbackUrl;
        let config = '', errorMessage;
        if (!apiEndpoint) {
            errorMessage = 'Api endpoint is missing';
        }
        if (!parameters.masterIp) {
            errorMessage = 'Master ip is missing';
        }
        if (!pskSecret) {
            errorMessage = 'psksecret is missing';
        }
        if (!pskSecret || !apiEndpoint || !parameters.masterIp) {
            throw new Error(`Base config is invalid (${errorMessage}): ${
                JSON.stringify({
                    syncInterface: syncInterface,
                    apiEndpoint: apiEndpoint,
                    masterIp: parameters.masterIp,
                    pskSecret: pskSecret && typeof pskSecret
                })}`);
        }
        // parse TGW VPN
        if (parameters.vpnConfigSetName && parameters.vpnConfiguration) {
            // append vpnConfig to base config
            config = await this.getConfigSet(parameters.vpnConfigSetName);
            config = await this.parseConfigSet(config,
                {'@vpn_connection': parameters.vpnConfiguration});
            this._baseConfig += config;
        }
        return await this._baseConfig.replace(new RegExp('set role master', 'gm'),
                `set role slave\n    set master-ip ${parameters.masterIp}`)
            .replace(new RegExp('{CALLBACK_URL}', 'gm'), parameters.callbackUrl);
    }

    async checkMasterElection() {
        this.logger.info('calling checkMasterElection');
        let needElection = false,
            purgeMaster = false,
            electionLock = false,
            electionComplete = false;

        // reload the master
        await this.retrieveMaster(null, true);
        this.logger.info('current master healthcheck:', JSON.stringify(this._masterHealthCheck));
        // is there a master election done?
        // check the master record and its voteState
        // if there's a complete election, get master health check
        if (this._masterRecord && this._masterRecord.voteState === 'done') {
            // if master is unhealthy, we need a new election
            if (!this._masterHealthCheck ||
                !this._masterHealthCheck.healthy || !this._masterHealthCheck.inSync) {
                purgeMaster = needElection = true;
            } else {
                purgeMaster = needElection = false;
            }
        } else if (this._masterRecord && this._masterRecord.voteState === 'pending') {
            // if there's a pending master election, and if this election is incomplete by
            // the end-time, purge this election and starta new master election. otherwise, wait
            // until it's finished
            needElection = purgeMaster = Date.now() > this._masterRecord.voteEndTime;
        } else {
            // if no master, try to hold a master election
            needElection = true;
            purgeMaster = false;
        }
        // if we need a new master, let's hold a master election!
        // 2019/01/14 add support for cross-scaling groups election
        // only instance comes from the masterScalingGroup can start an election
        // all other instances have to wait
        if (needElection) {
            // if i am in the master group, i can hold a master election
            if (this.scalingGroupName === this.masterScalingGroupName) {
                // can I run the election? (diagram: anyone's holding master election?)
                // try to put myself as the master candidate
                electionLock = await this.putMasterElectionVote(this._selfInstance, purgeMaster);
                if (electionLock) {
                    // yes, you run it!
                    this.logger.info(`This instance (id: ${this._selfInstance.instanceId})` +
                        ' is running an election.');
                    try {
                        // (diagram: elect new master from queue (existing instances))
                        electionComplete = await this.electMaster();
                        this.logger.info(`Election completed: ${electionComplete}`);
                        // (diagram: master exists?)
                        this._masterRecord = null;
                        this._masterInfo = electionComplete && await this.getMasterInfo();
                    } catch (error) {
                        this.logger.error('Something went wrong in the master election.');
                    }
                }
            } else { // i am not in the master group, i am not allowed to hold a master election
                this.logger.info(`This instance (id: ${this._selfInstance.instanceId}) not in ` +
                'the master group, cannot hold election but wait for someone else to hold ' +
                'an election.');
            }
        }
        return Promise.resolve(this._masterInfo); // return the new master
    }

    /**
     * get the elected master instance info from the platform
     */
    async getMasterInfo() {
        this.logger.info('calling getMasterInfo');
        let instanceId;
        try {
            this._masterRecord = this._masterRecord || await this.platform.getMasterRecord();
            instanceId = this._masterRecord && this._masterRecord.instanceId;
        } catch (ex) {
            this.logger.error(ex);
        }
        return this._masterRecord && await this.platform.describeInstance({
            instanceId: instanceId
        });
    }

    /**
     * Submit an election vote for this ip address to become the master.
     * @param {Object} candidateInstance instance of the FortiGate which wants to become the master
     * @param {Object} purgeMasterRecord master record of the old master, if it's dead.
     */
    async putMasterElectionVote(candidateInstance, purgeMasterRecord = null) {
        try {
            this.logger.log('masterElectionVote, purge master?', JSON.stringify(purgeMasterRecord));
            if (purgeMasterRecord) {
                try {
                    const purged = await this.purgeMaster();
                    this.logger.log('purged: ', purged);
                } catch (error) {
                    this.logger.log('no master purge');
                }
            } else {
                this.logger.log('no master purge');
            }
            return await this.platform.putMasterRecord(candidateInstance, 'pending', 'new');
        } catch (ex) {
            this.logger.warn('exception while putMasterElectionVote',
                JSON.stringify(candidateInstance), JSON.stringify(purgeMasterRecord), ex.stack);
            return false;
        }
    }

    /**
     * Do the master election
     * @returns {boolean} if election has been successfully completed
     */
    async electMaster() {
        // return the current master record
        return !!await this.platform.getMasterRecord();
    }

    async completeMasterElection(ip) {
        await this.throwNotImplementedException();
        return ip;
    }

    async completeMasterInstance(instanceId) {
        await this.throwNotImplementedException();
        return instanceId;
    }

    responseToHeartBeat(masterIp) {
        let response = {};
        if (masterIp) {
            response['master-ip'] = masterIp;
        }
        return JSON.stringify(response);
    }

    async getFazIp() {
        await this.throwNotImplementedException();
        return null;
    }

    async handleNicAttachment(event) {
        await this.throwNotImplementedException();
        return null || event;
    }

    async handleNicDetachment(event) {
        await this.throwNotImplementedException();
        return null || event;
    }

    async loadSubnetPairs() {
        return await this.platform.getSettingItem('subnets-pairs');
    }

    async saveSubnetPairs(subnetPairs) {
        return await this.platform.setSettingItem('subnets-pairs', subnetPairs, null, true, false);
    }

    async loadAutoScalingSettings() {
        let [desiredCapacity, minSize, maxSize, groupSetting] = await Promise.all([
            this.platform.getSettingItem('scaling-group-desired-capacity'),
            this.platform.getSettingItem('scaling-group-min-size'),
            this.platform.getSettingItem('scaling-group-max-size'),
            this.platform.getSettingItem('auto-scaling-group')
        ]);

        if (!(desiredCapacity && minSize && maxSize) && groupSetting) {
            return groupSetting;
        }
        return {desiredCapacity: desiredCapacity, minSize: minSize, maxSize: maxSize};
    }

    async loadSettings() {
        if (!this._settings) {
            await this.platform.getSettingItems();// initialize the platform settings
        }
    }

    /**
     * Save settings to DB. This function doesn't do value validation. The caller should be
     * responsible for it.
     * @param {Object} settings settings to save
     */
    async saveSettings(settings) {
        let tasks = [], errorTasks = [];
        for (let [key, value] of Object.entries(settings)) {
            let keyName = null, description = null, jsonEncoded = false, editable = false;
            switch (key.toLowerCase()) {
                case 'servicetype':
                    // ignore service type
                    break;
                case 'deploymentsettingssaved':
                    keyName = 'deployment-settings-saved';
                    description = 'A flag setting item that indicates all deployment ' +
                        'settings have been saved.';
                    editable = false;
                    break;
                case 'byolscalinggroupdesiredcapacity':
                    keyName = 'byol-scaling-group-desired-capacity';
                    description = 'BYOL Scaling group desired capacity.';
                    editable = true;
                    break;
                case 'byolscalinggroupminsize':
                    keyName = 'byol-scaling-group-min-size';
                    description = 'BYOL Scaling group min size.';
                    editable = true;
                    break;
                case 'byolscalinggroupmaxsize':
                    keyName = 'byol-scaling-group-max-size';
                    description = 'BYOL Scaling group max size.';
                    editable = true;
                    break;
                case 'scalinggroupdesiredcapacity':
                    keyName = 'scaling-group-desired-capacity';
                    description = 'PAYG Scaling group desired capacity.';
                    editable = true;
                    break;
                case 'scalinggroupminsize':
                    keyName = 'scaling-group-min-size';
                    description = 'PAYG Scaling group min size.';
                    editable = true;
                    break;
                case 'scalinggroupmaxsize':
                    keyName = 'scaling-group-max-size';
                    description = 'PAYG Scaling group max size.';
                    editable = true;
                    break;
                case 'resourcetagprefix':
                    keyName = 'resource-tag-prefix';
                    description = 'Resource tag prefix.';
                    editable = false;
                    break;
                case 'customidentifier':
                    keyName = 'custom-id';
                    description = 'Custom Identifier.';
                    editable = false;
                    break;
                case 'uniqueid':
                    keyName = 'unique-id';
                    description = 'Unique ID.';
                    editable = false;
                    break;
                case 'assetstoragename':
                    keyName = 'asset-storage-name';
                    description = 'Asset storage name.';
                    editable = false;
                    break;
                case 'assetstoragekeyprefix':
                    keyName = 'asset-storage-key-prefix';
                    description = 'Asset storage key prefix.';
                    editable = false;
                    break;
                case 'fortigateautoscalevpcid':
                    keyName = 'fortigate-autoscale-vpc-id';
                    description = 'VPC ID of the FortiGate Autoscale.';
                    editable = false;
                    break;
                case 'fortigateautoscalesubnet1':
                    keyName = 'fortigate-autoscale-subnet-1';
                    description = 'The ID of the subnet 1 (in the first selected AZ) ' +
                        'of the FortiGate Autoscale.';
                    editable = false;
                    break;
                case 'fortigateautoscalesubnet2':
                    keyName = 'fortigate-autoscale-subnet-2';
                    description = 'The ID of the subnet 2 (in the second selected AZ) ' +
                        'of the FortiGate Autoscale.';
                    editable = false;
                    break;
                case 'fortigateautoscaleprotectedsubnet1':
                    keyName = 'fortigate-autoscale-protected-subnet1';
                    description = 'The ID of the protected subnet 1 (in the first selected AZ) ' +
                        'of the FortiGate Autoscale.';
                    editable = true;
                    break;
                case 'fortigateautoscaleprotectedsubnet2':
                    keyName = 'fortigate-autoscale-protected-subnet2';
                    description = 'The ID of the protected subnet 2 (in the second selected AZ) ' +
                        'of the FortiGate Autoscale.';
                    editable = true;
                    break;
                case 'fortigatepsksecret':
                    keyName = 'fortigate-psk-secret';
                    description = 'The PSK for FortiGate Autoscale Synchronization.';
                    break;
                case 'fortigateadminport':
                    keyName = 'fortigate-admin-port';
                    description = 'The port number for administrative login to FortiGate.';
                    break;
                case 'fortigatetrafficport':
                    keyName = 'fortigate-traffic-port';
                    description = 'The port number for load balancer to route traffic through ' +
                        'FortiGate to the protected services behind the load balancer.';
                    break;
                case 'fortigatesyncinterface':
                    keyName = 'fortigate-sync-interface';
                    description = 'The interface the FortiGate uses for configuration ' +
                        'synchronization.';
                    editable = true;
                    break;
                case 'lifecyclehooktimeout':
                    keyName = 'lifecycle-hook-timeout';
                    description = 'The auto scaling group lifecycle hook timeout time in second.';
                    editable = true;
                    break;
                case 'heartbeatinterval':
                    keyName = 'heartbeat-interval';
                    description = 'The FortiGate sync heartbeat interval in second.';
                    editable = true;
                    break;
                case 'masterelectiontimeout':
                    keyName = 'master-election-timeout';
                    description = 'The FortiGate master election timtout time in second.';
                    editable = true;
                    break;
                case 'heartbeatlosscount':
                    keyName = 'heartbeat-loss-count';
                    description = 'The FortiGate sync heartbeat loss count.';
                    editable = true;
                    break;
                case 'heartbeatdelayallowance':
                    keyName = 'heartbeat-delay-allowance';
                    description = 'The FortiGate sync heartbeat delay allowance time in second.';
                    editable = true;
                    break;
                case 'autoscalehandlerurl':
                    keyName = 'autoscale-handler-url';
                    description = 'The FortiGate Autoscale handler URL.';
                    editable = false;
                    break;
                case 'masterautoscalinggroupname':
                    keyName = 'master-auto-scaling-group-name';
                    description = 'The name of the master auto scaling group.';
                    editable = false;
                    break;
                case 'paygautoscalinggroupname':
                    keyName = 'payg-auto-scaling-group-name';
                    description = 'The name of the PAYG auto scaling group.';
                    editable = false;
                    break;
                case 'byolautoscalinggroupname':
                    keyName = 'byol-auto-scaling-group-name';
                    description = 'The name of the BYOL auto scaling group.';
                    editable = false;
                    break;
                case 'requiredconfigset':
                    keyName = 'required-configset';
                    description = 'A comma-delimited list of required configsets.';
                    editable = false;
                    break;
                case 'transitgatewayid':
                    keyName = 'transit-gateway-id';
                    description = 'The ID of the Transit Gateway the FortiGate Autoscale is ' +
                    'attached to.';
                    editable = false;
                    break;
                case 'enabletransitgatewayvpn':
                    keyName = 'enable-transit-gateway-vpn';
                    value = value && value !== 'false' ? 'true' : 'false';
                    description = 'Toggle ON / OFF the Transit Gateway VPN creation on each ' +
                    'FortiGate instance';
                    editable = false;
                    break;
                case 'enablesecondnic':
                    keyName = 'enable-second-nic';
                    value = value && value !== 'false' ? 'true' : 'false';
                    description = 'Toggle ON / OFF the secondary eni creation on each ' +
                    'FortiGate instance';
                    editable = false;
                    break;
                case 'bgpasn':
                    keyName = 'bgp-asn';
                    description = 'The BGP Autonomous System Number of the Customer Gateway ' +
                    'of each FortiGate instance in the Auto Scaling Group.';
                    editable = true;
                    break;
                case 'transitgatewayvpnhandlername':
                    keyName = 'transit-gateway-vpn-handler-name';
                    description = 'The Transit Gateway VPN handler function name.';
                    editable = false;
                    break;
                case 'transitgatewayroutetableinbound':
                    keyName = 'transit-gateway-route-table-inbound';
                    description = 'The Id of the Transit Gateway inbound route table.';
                    editable = true;
                    break;
                case 'transitgatewayroutetableoutbound':
                    keyName = 'transit-gateway-route-table-outbound';
                    description = 'The Id of the Transit Gateway outbound route table.';
                    break;
                case 'enablehybridlicensing':
                    keyName = 'enable-hybrid-licensing';
                    description = 'Toggle ON / OFF the hybrid licensing feature.';
                    editable = false;
                    break;
                case 'enablefortigateelb':
                    keyName = 'enable-fortigate-elb';
                    description = 'Toggle ON / OFF the elastic load balancing for the FortiGate ' +
                    'scaling groups.';
                    editable = false;
                    break;
                case 'enableinternalelb':
                    keyName = 'enable-internal-elb';
                    description = 'Toggle ON / OFF the internal elastic load balancing for ' +
                    'the protected services by FortiGate.';
                    editable = true;
                    break;
                case 'fortigateautoscaleelbdns':
                    keyName = 'fortigate-autoscale-elb-dns';
                    description = 'The DNS name of the elastic load balancer for the FortiGate ' +
                    'scaling groups.';
                    editable = false;
                    break;
                case 'fortigateautoscaletargetgrouparn':
                    keyName = 'fortigate-autoscale-target-group-arn';
                    description = 'The ARN of the target group for FortiGate to receive ' +
                    'load balanced traffic.';
                    editable = false;
                    break;
                case 'fortigateprotectedinternalelbdns':
                    keyName = 'fortigate-protected-internal-elb-dns';
                    description = 'The DNS name of the elastic load balancer for the scaling ' +
                    'groups of services protected by FortiGate';
                    editable = true;
                    break;
                case 'enabledynamicnatgateway':
                    keyName = 'enable-dynamic-nat-gateway';
                    description = 'Toggle ON / OFF the dynamic NAT gateway feature.';
                    editable = true;
                    break;
                case 'dynamicnatgatewayroutetables':
                    keyName = 'dynamic-nat-gateway-route-tables';
                    description = 'The dynamic NAT gateway managed route tables.';
                    editable = true;
                    break;
                case 'enablevminfocache':
                    keyName = 'enable-vm-info-cache';
                    description = 'Toggle ON / OFF the vm info cache feature. It caches the ' +
                    'vm info in db to reduce API calls to query a vm from the platform.';
                    editable = true;
                    break;
                case 'vminfocachetime':
                    keyName = 'vm-info-cache-time';
                    description = 'The vm info cache time in seconds.';
                    editable = true;
                    break;
                case 'fortigatelicensestoragekeyprefix':
                    keyName = 'fortigate-license-storage-key-prefix';
                    description = 'The key prefix for FortiGate licenses in the access storage.';
                    editable = true;
                    break;
                case 'getlicensegraceperiod':
                    keyName = 'get-license-grace-period';
                    description = 'The period (time in seconds) for preventing a newly assigned ' +
                    ' license to be recycled.';
                    editable = true;
                    break;
                default:
                    break;
            }
            if (keyName) {
                tasks.push(this.platform
                    .setSettingItem(keyName, value, description, jsonEncoded, editable)
                    .catch(error => {
                        this.logger.error(`failed to save setting for key: ${keyName}. ` +
                            `Error: ${JSON.stringify(error)}`);
                        errorTasks.push({key: keyName, value: value});
                    }));
            }
        }
        await Promise.all(tasks);
        return errorTasks.length === 0;
    }

    async updateCapacity(desiredCapacity, minSize, maxSize) {
        await this.throwNotImplementedException();
        return null || desiredCapacity && minSize && maxSize;
    }

    async checkAutoScalingGroupState() {
        await this.throwNotImplementedException();
    }

    async resetMasterElection() {
        this.logger.info('calling resetMasterElection');
        try {
            this.setScalingGroup(this._settings['master-scaling-group-name']);
            await this.platform.removeMasterRecord();
            this.logger.info('called resetMasterElection. done.');
            return true;
        } catch (error) {
            this.logger.info('called resetMasterElection. failed.', error);
            return false;
        }
    }

    async addInstanceToMonitor(instance, heartBeatInterval, masterIp = 'null') {
        return await this.throwNotImplementedException() ||
            instance && heartBeatInterval && masterIp;
    }

    async removeInstanceFromMonitor(instanceId) {
        this.logger.info('calling removeInstanceFromMonitor');
        return await this.platform.deleteInstanceHealthCheck(instanceId);
    }

    async retrieveMaster(filters = null, reload = false) {
        if (reload) {
            this._masterInfo = null;
            this._masterHealthCheck = null;
            this._masterRecord = null;
        }
        if (!this._masterInfo && (!filters || filters && filters.masterInfo)) {
            this._masterInfo = await this.getMasterInfo();
        }
        if (!this._masterHealthCheck && (!filters || filters && filters.masterHealthCheck)) {
            if (!this._masterInfo) {
                this._masterInfo = await this.getMasterInfo();
            }
            if (this._masterInfo) {
                // TODO: master health check should not depend on the current hb
                this._masterHealthCheck = await this.platform.getInstanceHealthCheck({
                    instanceId: this._masterInfo.instanceId
                });
            }
        }
        if (!this._masterRecord && (!filters || filters && filters.masterRecord)) {
            this._masterRecord = await this.platform.getMasterRecord();
        }
        return {
            masterInfo: this._masterInfo,
            masterHealthCheck: this._masterHealthCheck,
            masterRecord: this._masterRecord
        };
    }

    async purgeMaster() {
        // TODO: double check that the work flow of terminating the master instance here
        // is appropriate
        try {
            let asyncTasks = [];
            await this.retrieveMaster();
            // if has master health check record, make it out-of-sync
            if (this._masterInfo && this._masterHealthCheck) {
                asyncTasks.push(this.platform.updateInstanceHealthCheck(this._masterHealthCheck,
                    AutoscaleHandler.NO_HEART_BEAT_INTERVAL_SPECIFIED,
                    this._masterInfo.primaryPrivateIpAddress, Date.now(), true));
            }
            asyncTasks.push(
                this.platform.removeMasterRecord(),
                this.removeInstance(this._masterInfo)
            );
            let result = await Promise.all(asyncTasks);
            return !!result;
        } catch (error) {
            this.logger.error('called purgeMaster > error: ', JSON.stringify(error));
            return false;
        }
    }

    async deregisterMasterInstance(instance) {
        return await this.throwNotImplementedException() || instance;
    }

    async removeInstance(instance) {
        return await this.throwNotImplementedException() || instance;
    }

    setScalingGroup(master, self) {
        if (master) {
            this.masterScalingGroupName = master;
            this.platform.setMasterScalingGroup(master);
        }
        if (self) {
            this.scalingGroupName = self;
            this.platform.setScalingGroup(self);
        }
    }

    /**
     * Check and update the route to the NAT gateway instance (which is one healthy ForitGate
     * from the scaling groups)
     */
    async updateNatGatewayRoute() {
        return await this.throwNotImplementedException();
    }

    /**
     *
     * @param {Map<String, LicenseItem>} licenseFiles a map of LicenseItem based on
     * the license files in the blob storage. Each map key is the 'blobKey' of the LicenseItem.
     * @param {Map<String, LicenseRecord>} existingRecords a map of LicenseRecord based on
     * the existing license record in the db. Each map key is the 'checksum' of the LicenseItem.
     */
    async updateLicenseStockRecord(licenseFiles, existingRecords) {
        if (licenseFiles instanceof Map && existingRecords instanceof Map) {
            let untrackedFiles = new Map(licenseFiles.entries()); // copy the map
            try {
                if (existingRecords.size > 0) {
                    // filter out tracked license files
                    existingRecords.forEach(licenseRecord => {
                        if (licenseFiles.has(licenseRecord.blobKey)) {
                            untrackedFiles.delete(licenseRecord.blobKey);
                        }
                    }, this);
                }
                let platform = this.platform;
                // fetch the content for each untrack license file
                let updateTasks = [];
                untrackedFiles.forEach(licenseItem => {
                    updateTasks.push((async () => {
                        const content = await platform.getLicenseFileContent(licenseItem.fileName);
                        licenseItem.content = content;
                        return licenseItem;
                    })());
                });

                untrackedFiles = await Promise.all(updateTasks);
                updateTasks = [];

                untrackedFiles.forEach(licenseItem => {
                    if (existingRecords.has(licenseItem.checksum)) {
                        this.logger.warn('updateLicenseStockRecord > warning: duplicate' +
                            ` license found: filename: ${licenseItem.fileName}`);
                    } else {
                        updateTasks.push(platform.updateLicenseStock(licenseItem, false)
                        .catch(error => {
                            this.logger.error(error);
                        }));
                    }
                });
                await Promise.all(updateTasks);
                return updateTasks.length > 0 ? this.platform.listLicenseStock() : existingRecords;
            } catch (error) {
                this.logger.error(error);
            }
        } else {
            return existingRecords;
        }
    }
};
