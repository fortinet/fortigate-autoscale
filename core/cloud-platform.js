'use strict';

/*
Author: Fortinet
*
* @abstract
* Class used to define the capabilities required from cloud platform.
*/

module.exports = class CloudPlatform {
    constructor() {
        this._settings = null;
        this._initialized = false;
    }
    throwNotImplementedException() {
        throw new Error('Not Implemented');
    }

    /**
     * @returns {Boolean} whether the CloudPlatform is initialzied or not
     */
    get initialized() {
        return this._initialized;
    }
    /* eslint-disable no-unused-vars */
    /**
     * Initialize (and wait for) any required resources such as database tables etc.
     * Abstract class method.
     */
    async init() {
        await this.throwNotImplementedException();
    }

    setMasterScalingGroup(scalingGroupName) {
        this.masterScalingGroupName = scalingGroupName;
    }

    setScalingGroup(scalingGroupName) {
        this.scalingGroupName = scalingGroupName;
    }

    /**
     * Submit an election vote for this ip address to become the master.
     * Abstract class method.
     * @param {String} ip Ip of the FortiGate which wants to become the master
     * @param {String} purgeMasterIp Ip of the dead master we should purge before voting
     */
    async putMasterElectionVote(ip, purgeMasterIp) {
        await this.throwNotImplementedException();
    }

    /**
     * Submit an master record for election with a vote state.
     * Abstract class method.
     * @param {String} candidateInstance the master candidate instance
     * @param {String} voteState vote state of 'pending' or 'done'
     * @param {String} method 'new' for inserting when no record exists, 'replace' for replacing
     * the existing record or the same as 'new', otherwise.
     * @returns {boolean} result. true or false
     */
    async putMasterRecord(candidateInstance, voteState, method = 'new') {
        return await this.throwNotImplementedException();
    }
    /**
     * Get the master record from db.
     * Abstract class method.
     * @returns {String} Ip of the FortiGate which should be the auto-sync master
     */
    async getMasterRecord() {
        await this.throwNotImplementedException();
    }

    /**
     * Remove the current master record from db.
     * Abstract class method.
     */
    async removeMasterRecord() {
        await this.throwNotImplementedException();
    }
    /**
     * Get all existing lifecyle actions for a FortiGate instance from the database.
     * Abstract class method.
     * @param {String} instanceId Instance ID of a FortiGate.
     * @returns {LifecycleItem} Item used by the platform to complete a lifecycleAction.
     */
    async getLifecycleItems(instanceId) {
        await this.throwNotImplementedException();
    }
    /**
     * Update one life cycle action item hooked with an instance.
     * Abstract class method.
     * @param {LifecycleItem} item Item used by the platform to complete
     *  a lifecycleAction.
     */
    async updateLifecycleItem(item) {
        await this.throwNotImplementedException();
    }
    /**
     * remove one life cycle action item hooked with an instance.
     * Abstract class method.
     * @param {LifecycleItem} item Item used by the platform to complete
     *  a lifecycleAction.
     */
    async removeLifecycleItem(item) {
        await this.throwNotImplementedException();
    }
    /**
     * Clean up database the current LifeCycleItem entries (or any expired entries).
     * Abstract class method.
     * @param {LifecycleItem} [items] an array of LifeCycleItem to remove from database.
     * When provided, only the list of items will be cleaned up, otherwise scan for expired
     *  items to purge.
     */
    async cleanUpDbLifeCycleActions(items = []) {
        await this.throwNotImplementedException();
    }
    /**
     * Get the url for the callback-url portion of the config.
     * @param {Object} fromContext a context object to get the url, if needed.
     */
    async getCallbackEndpointUrl(fromContext = null) { // eslint-disable-line no-unused-vars
        if (this._settings['autoscale-handler-url']) {
            return await Promise.resolve(this._settings['autoscale-handler-url']);
        } else {
            throw new Error('Autoscale callback URL setting: autoscale-handler-url, not found.');
        }
    }

    /**
     * Lookup the instanceid using an ip address.
     * Abstract class method.
     * @param {String} ip Local ip address of an instance.
     */
    async findInstanceIdByIp(ip) {
        await this.throwNotImplementedException();
    }

    /**
     * Extract useful info from request event.
     * @param {Object} request the request event
     * @returns {Object} an object of required info per platform.
     */
    extractRequestInfo(request) {
        this.throwNotImplementedException();
        return {};
    }

    /**
     * Protect an instance from being scaled out.
     * Abstract class method.
     * @param {LifecycleItem} item Item that was used by the platform to complete a
     *  lifecycle action
     * @param {boolean} [protect=true] Whether to add or remove or protection the instance.
     */
    async protectInstanceFromScaleIn(item, protect = true) {
        await this.throwNotImplementedException();
    }

    /**
     * List all instances with given parameters.
     * Abstract class method.
     * @param {Object} parameters parameters necessary for listing all instances.
     */
    async listAllInstances(parameters) {
        await this.throwNotImplementedException();
    }

    /**
     * Describe an instance and retrieve its information, with given parameters.
     * Abstract class method.
     * @param {Object} parameters parameters necessary for describing an instance.
     */
    async describeInstance(parameters) {
        await this.throwNotImplementedException();
    }

    /**
     * do the instance health check.
     * Abstract class method.
     * @param {Object} instance the platform-specific instance object
     * @param {Number} heartBeatInterval the expected interval (second) between heartbeats
     * @returns {Object}
     *      {healthy: <bool>, heartBeatLossCount: <int>, nextHeartBeatTime: <int>}
     */
    async getInstanceHealthCheck(instance, heartBeatInterval = null) {
        await this.throwNotImplementedException();
    }

    /**
     * update the instance health check result to DB.
     * Abstract class method.
     * @param {Object} healthCheckObject update based on the healthCheckObject got by return from
     * getInstanceHealthCheck
     * @param {Number} heartBeatInterval the expected interval (second) between heartbeats
     * @param {String} masterIp the current master ip in autoscaling group
     * @param {Number} checkPointTime the check point time of when the health check is performed.
     * @param {bool} forceOutOfSync whether force to update this record as 'out-of-sync'
     * @returns {bool} resul: true or false
     */
    async updateInstanceHealthCheck(healthCheckObject, heartBeatInterval, masterIp, checkPointTime,
        forceOutOfSync = false) {
        await this.throwNotImplementedException();
    }

    /**
     * delete the instance health check monitoring record from DB.
     * Abstract class method.
     * @param {Object} instanceId the instanceId of instance
     * @returns {bool} resul: true or false
     */
    async deleteInstanceHealthCheck(instanceId) {
        await this.throwNotImplementedException();
    }

    /**
     * Delete one or more instances from the auto scaling group.
     * Abstract class method.
     * @param {Object} parameters parameters necessary for instance deletion.
     */
    async deleteInstances(parameters) {
        await this.throwNotImplementedException();
    }

    async createNetworkInterface(parameters) {
        await this.throwNotImplementedException();
    }

    async deleteNetworkInterface(parameters) {
        await this.throwNotImplementedException();
    }

    async describeNetworkInterface(parameters) {
        await this.throwNotImplementedException();
    }

    async listNetworkInterfaces(parameters) {
        await this.throwNotImplementedException();
    }

    async attachNetworkInterface(instance, nic) {
        await this.throwNotImplementedException();
    }

    async detachNetworkInterface(instance, nic) {
        await this.throwNotImplementedException();
    }

    async listNicAttachmentRecord() {
        await this.throwNotImplementedException();
    }

    async getNicAttachmentRecord(instanceId) {
        await this.throwNotImplementedException();
    }

    async updateNicAttachmentRecord(instanceId, nicId, state, conditionState = null) {
        await this.throwNotImplementedException();
    }

    async deleteNicAttachmentRecord(instanceId, conditionState = null) {
        await this.throwNotImplementedException();
    }

    async getSettingItem(key, valueOnly = true) {
        // check _setting first
        if (this._settings && this._settings.hasOwnProperty(key)) {
            // if get full item object
            if (!valueOnly && this._settings[key] && this._settings[key].settingKey) {
                return this._settings[key];
            }
            // if not get full item object
            // _settings is not an object of item objects
            if (valueOnly && this._settings[key]) {
                return this._settings[key].settingKey || this._settings[key];
            }
        }
        await this.getSettingItems(key, valueOnly);
        return this._settings[key];
    }

    /**
     * get multiple saved settings from DB
     * @param {Array} keyFilter An array of setting key to filter (return)
     * @param {Boolean} valueOnly return setting value only or full detail
     * @returns {Object} Json object
     */
    async getSettingItems(keyFilter = null, valueOnly = true) {
        await this.throwNotImplementedException();
    }

    async setSettingItem(key, value, description = null, jsonEncoded = false, editable = false) {
        await this.throwNotImplementedException();
    }

    /**
     * get the blob from storage
     * @param {Object} parameters parameter object
     * @returns {Object} the object must have the property 'content' containing the blob content
     */
    async getBlobFromStorage(parameters) {
        return await this.throwNotImplementedException();
    }

    async listBlobFromStorage(parameters) {
        await this.throwNotImplementedException();
    }

    async getLicenseFileContent(fileName) {
        return await this.throwNotImplementedException();
    }

    /**
     * List license files in storage
     * @param {Object} parameters parameter require to list and filter licenses
     * @returns {Map<LicenseItem>} must return a Map of LicenseItem with blobKey as key,
     * and LicenseItem as value
     */
    async listLicenseFiles(parameters) {
        await this.throwNotImplementedException();
    }

    /**
     * Update the license useage record to db
     * @param {LicenseRecord} licenseRecord the license record to update
     * @param {Boolean} replace use replace or update method
     * @return {Boolan} return the update result
     */
    async updateLicenseUsage(licenseRecord, replace = false) {
        await this.throwNotImplementedException();
    }
    /**
     * List license usage records
     * @param {Object} parameters parameter require to list and filter license usage records
     * @returns {Map<licenseRecord>} must return a Map of licenseRecord with checksum as key,
     * and LicenseItem as value
     */
    async listLicenseUsage(parameters) {
        await this.throwNotImplementedException();
    }

    async deleteLicenseUsage(parameters) {
        await this.throwNotImplementedException();
    }

    /**
     *  @returns {Map<licenseRecord>} must return a Map of LicenseItem with blochecksumbKey as key,
     * and LicenseItem as value
     */
    async listLicenseStock() {
        await this.throwNotImplementedException();
    }

    /**
     * Find a recyclable license from those been previously used by a device but now the device
     * has become unavailable. Hence, the license it was assigned can be recycled.
     * @param {Map<licenseRecord>} stockRecords the stock records to compare with
     * @param {Map<licenseRecord>} usageRecords the usage records to compare with
     * @param {Number} limit find how many items? set to a negative number for no limit
     * @returns {Array<licenseRecord>} must return an Array of licenseRecord with checksum as key,
     * and LicenseItem as value
     */
    async findRecyclableLicense(stockRecords, usageRecords, limit = -1) {
        await this.throwNotImplementedException();
    }

    /**
     * Update the given license item to db
     * @param {LicenseItem} licenseItem the license item to update
     * @param {Boolean} replace update method: replace existing or not. Default true
     */
    async updateLicenseStock(licenseItem, replace = true) {
        await this.throwNotImplementedException();
    }
    /**
     * Delete the given license item from db
     * @param {LicenseItem} licenseItem the license item to update
     */
    async deleteLicenseStock(licenseItem) {
        await this.throwNotImplementedException();
    }

    async terminateInstanceInAutoScalingGroup(instance) {
        await this.throwNotImplementedException();
    }

    /**
     * Retrieve the cached vm info from database
     * @param {String} scaleSetName scaling group name the vm belongs to
     * @param {String} instanceId the instanceId of the vm if instanceId is the unique ID
     * @param {String} vmId another unique ID to identify the vm if instanceId is not the unique ID
     */
    async getVmInfoCache(scaleSetName, instanceId, vmId = null) {
        return await this.throwNotImplementedException() || scaleSetName && instanceId && vmId;
    }

    /**
     *
     * @param {String} scaleSetName scaling group name the vm belongs to
     * @param {Object} info the json object of the info to cache in database
     * @param {Integer} cacheTime the maximum time in seconds to keep the cache in database
     */
    async setVmInfoCache(scaleSetName, info, cacheTime = 3600) {
        return await this.throwNotImplementedException() || scaleSetName && info && cacheTime;
    }

    /**
     * Update to enable the Transit Gateway attachment propagation on a given Transit Gateway
     * route table
     * @param {String} attachmentId id of the transit gateway to update
     * @param {String} routeTableId id of the transit gateway route table to update
     * @returns {Boolean} A boolean value for whether the update is success or not.
     */
    async updateTgwRouteTablePropagation(attachmentId, routeTableId) {
        return await this.throwNotImplementedException() || attachmentId && routeTableId;
    }

    /**
     * Update to enable the Transit Gateway attachment association on a given Transit Gateway
     * route table
     * @param {String} attachmentId id of the transit gateway to update
     * @param {String} routeTableId id of the transit gateway route table to update
     * @returns {Boolean} A boolean value for whether the update is success or not.
     */
    async updateTgwRouteTableAssociation(attachmentId, routeTableId) {
        return await this.throwNotImplementedException() || attachmentId && routeTableId;
    }

    /**
     * return a platform-specific logger class
     */
    getPlatformLogger() {
        this.throwNotImplementedException();
    }
    /* eslint-enable no-unused-vars */
};
