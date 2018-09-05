'use strict';

/*
Author: Fortinet
*
* Contains all the relevant information needed to complete lifecycle actions for a given
* fortigate instance, as well as info needed to clean up the related database entry.
*/

module.exports = class LifecycleItem {
    /**
     * @param {String} instanceId Id of the fortigate instance.
     * @param {Object} detail Opaque information used by the platform to manage this item.
     * @param {Date} [timestamp=Date.now()] Optional timestamp for this record.
     */
    constructor(instanceId, detail, timestamp = null) {
        this.instanceId = instanceId;
        this.timestamp = timestamp || Date.now();
        this.detail = detail;
    }

    /**
     * Return a POJO DB entry with capitalized properties.. (not sure why)
     * @returns {Object} object {FortigateInstance, Timestamp, Detail}
     */
    toDb() {
        return {
            FortigateInstance: this.instanceId,
            Timestamp: this.timestamp,
            Detail: this.detail
        };

    }

    /**
     * Resucitate from a stored DB entry
     * @param {Object} entry Entry from DB
     * @returns {LifecycleItem} A new lifecycle item.
     */
    static fromDb(entry) {
        return new LifecycleItem(entry.FortigateInstance, entry.Detail, entry.Timestamp);
    }
};
