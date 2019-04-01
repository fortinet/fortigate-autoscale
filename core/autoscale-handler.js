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

const Logger = require('./logger');
const CoreFunctions = require('./core-functions');
const
    AUTOSCALE_SECTION_EXPR =
    /(?:^|(?:\s*))config?\s*system?\s*auto-scale\s*((?:.|\s)*)\bend\b/;
const NO_HEART_BEAT_INTERVAL_SPECIFIED = -1;

module.exports = class AutoscaleHandler {

    constructor(platform, baseConfig) {
        this.platform = platform;
        this._baseConfig = baseConfig;
        this._selfInstance = null;
        this._selfHealthCheck = null;
        this._masterRecord = null;
        this._masterInfo = null;
        this._requestInfo = {};
    }

    static get NO_HEART_BEAT_INTERVAL_SPECIFIED() {
        return NO_HEART_BEAT_INTERVAL_SPECIFIED;
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
        const success = await this.platform.init();
        // retrieve base config from a blob storage
        this._baseConfig = await this.getBaseConfig();
        return success;
    }

    async getConfigSet(configName) {
        try {
            const parameters = {
                path: 'configset',
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
        let psksecret = process.env.FORTIGATE_PSKSECRET,
            fazConfig = '',
            fazIp;
        if (baseConfig) {
            // check if other config set are required
            let requiredConfigSet = process.env.REQUIRED_CONFIG_SET ?
                process.env.REQUIRED_CONFIG_SET.split(',') : [];
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

    parseRequestInfo(event) {
        this._requestInfo = this.platform.extractRequestInfo(event);
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

        if (!this._selfInstance) {
            // not trusted
            throw new Error(`Unauthorized calling instance (vmid: ${instanceId}). ` +
                'Instance not found in scale set.');
        }
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
                await this.platform.setSettingItem('fortigate-default-password', {
                    value: this._selfInstance.instanceId,
                    description: 'default password comes from the new elected master.'
                });
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
        this.logger.info(`Status: ${this._requestInfo.status}`);
        return '';
    }

    async getMasterConfig(callbackUrl) {
        // no dollar sign in place holders
        return await this._baseConfig.replace(/\{CALLBACK_URL}/, callbackUrl);
    }

    async getSlaveConfig(masterIp, callbackUrl) {
        const
            autoScaleSectionMatch = AUTOSCALE_SECTION_EXPR.exec(this._baseConfig),
            autoScaleSection = autoScaleSectionMatch && autoScaleSectionMatch[1],
            matches = [
                /set\s+sync-interface\s+(.+)/.exec(autoScaleSection),
                /set\s+psksecret\s+(.+)/.exec(autoScaleSection)
            ];
        const [syncInterface, pskSecret] = matches.map(m => m && m[1]),
            apiEndpoint = callbackUrl;
        let errorMessage;
        if (!apiEndpoint) {
            errorMessage = 'Api endpoint is missing';
        }
        if (!masterIp) {
            errorMessage = 'Master ip is missing';
        }
        if (!pskSecret) {
            errorMessage = 'psksecret is missing';
        }
        if (!pskSecret || !apiEndpoint || !masterIp) {
            throw new Error(`Base config is invalid (${errorMessage}): ${
                JSON.stringify({
                    syncInterface,
                    apiEndpoint,
                    masterIp,
                    pskSecret: pskSecret && typeof pskSecret
                })}`);
        }
        return await this._baseConfig.replace(new RegExp('set role master', 'gm'),
                `set role slave\n    set master-ip ${masterIp}`)
            .replace(new RegExp('{CALLBACK_URL}', 'gm'), callbackUrl);
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
        return await this.platform.setSettingItem('subnets-pairs', subnetPairs);
    }

    async loadSettings() {
        return await this.platform.getSettingItem('auto-scaling-group');
    }

    async saveSettings(desiredCapacity, minSize, maxSize) {
        let settingValues = {
            desiredCapacity: desiredCapacity,
            minSize: minSize,
            maxSize: maxSize
        };
        return await this.platform.setSettingItem('auto-scaling-group', settingValues);
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
        this.masterScalingGroupName = master;
        this.platform.setMasterScalingGroup(master);
        this.scalingGroupName = self;
        this.platform.setScalingGroup(self);
    }
};
