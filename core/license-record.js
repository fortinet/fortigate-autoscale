'use strict';

/*
Author: Fortinet
*
* A license record class.
*/
module.exports = class LicenseRecord {
    constructor(
        checksum,
        algorithm,
        fileName,
        blobKey,
        instanceId = null,
        scalingGroupName = null,
        assignedTime = null
    ) {
        this._checksum = checksum;
        this._algorithm = algorithm;
        this._fileName = fileName;
        this._blobKey = blobKey;
        this.updateUsage(instanceId, scalingGroupName, assignedTime);
    }
    get id() {
        return this._checksum;
    }

    get checksum() {
        return this._checksum;
    }

    get algorithm() {
        return this._algorithm;
    }

    get fileName() {
        return this._fileName;
    }

    get blobKey() {
        return this._blobKey;
    }

    get instanceId() {
        return this._instanceId;
    }

    get scalingGroupName() {
        return this._scalingGroupName;
    }

    get assignedTime() {
        return this._assignedTime;
    }

    set assignedTime(time) {
        let date = time && new Date(time);
        if (date && !isNaN(date.getTime())) {
            this._assignedTime = date.getTime();
        } else {
            this._assignedTime = null;
        }
    }

    get inUse() {
        return this._instanceId !== null;
    }

    updateUsage(instanceId, scalingGroupName, assignTime = null) {
        this._instanceId = instanceId;
        this._scalingGroupName = (instanceId && scalingGroupName) || null;
        this.assignedTime = instanceId && (assignTime || Date.now());
    }

    static fromDb(data) {
        if (data && data.checksum && data.algorithm && data.fileName && data.blobKey) {
            return new LicenseRecord(
                data.checksum,
                data.algorithm,
                data.fileName,
                data.blobKey,
                data.instanceId,
                data.scalingGroupName,
                data.assignTime
            );
        } else {
            return null;
        }
    }
};
