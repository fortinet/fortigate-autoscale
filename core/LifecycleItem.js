'use strict';

/*
Author: Fortinet
*
* Contains all the relevant information needed to complete lifecycle actions for a given
* FortiGate instance, as well as info needed to clean up the related database entry.
*/

module.exports = class LifecycleItem {
    /**
     * @param {String} instanceId Id of the FortiGate instance.
     * @param {Object} detail Opaque information used by the platform to manage this item.
     * @param {String} [actionName=null] Optional name for this record to lookup. should be one in
     * ['syncconfig', 'attachnic']
     * @param {Boolean} [done=false] whether this lifecyclehook action is done or not
     * @param {Date} [timestamp=Date.now()] Optional timestamp for this record.
     */
    constructor(instanceId, detail, actionName = null, done = false, timestamp = null) {
        const actionNames = [
            LifecycleItem.ACTION_NAME_LAUNCHING_INSTANCE,
            LifecycleItem.ACTION_NAME_TERMINATING_INSTANCE,
            LifecycleItem.ACTION_NAME_GET_CONFIG,
            LifecycleItem.ACTION_NAME_ATTACH_NIC2
        ];
        this.instanceId = instanceId;
        this.timestamp = timestamp || Date.now();
        this.detail = detail;
        this.actionName = actionNames.includes(actionName) ? actionName : 'unknown';
        this.done = done;
    }

    static get ACTION_NAME_GET_CONFIG() {
        return 'getconfig';
    }

    static get ACTION_NAME_LAUNCHING_INSTANCE() {
        return 'launching';
    }

    static get ACTION_NAME_TERMINATING_INSTANCE() {
        return 'terminating';
    }

    static get ACTION_NAME_ATTACH_NIC2() {
        return 'attachnic2';
    }

    /**
     * Return a POJO DB entry with capitalized properties.. (not sure why)
     * @returns {Object} object {FortigateInstance, Timestamp, Detail}
     */
    toDb() {
        return {
            instanceId: this.instanceId,
            actionName: this.actionName,
            timestamp: this.timestamp,
            detail: this.detail,
            done: this.done
        };

    }

    /**
     * Resucitate from a stored DB entry
     * @param {Object} entry Entry from DB
     * @returns {LifecycleItem} A new lifecycle item.
     */
    static fromDb(entry) {
        return new LifecycleItem(entry.instanceId, entry.detail, entry.actionName,
            entry.done, entry.timestamp);
    }
};
