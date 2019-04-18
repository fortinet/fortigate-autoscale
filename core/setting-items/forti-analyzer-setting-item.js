'use strict';

/*
A DynamoDB structure for Setting item: FortiAnalyzer.
Author: Fortinet
*/

module.exports = class FortiAnalyzerSettingItem {
    constructor(instanceId, ip, vip) {
        this.instanceId = instanceId;
        this.ip = ip;
        this.vip = vip;
    }

    static get SETTING_KEY() {
        return 'fortianalyzer';
    }

    /**
     * Return a DB entry
     * @returns {Object} object
     */
    toDb() {
        return {
            settingKey: FortiAnalyzerSettingItem.SETTING_KEY,
            settingValue: JSON.stringify({
                instanceId: this.instanceId,
                ip: this.ip,
                vip: this.vip
            })
        };
    }

    /**
     * Resucitate from a stored DB entry
     * @param {Object} entry Entry from DB
     * @returns {LifecycleItem} A new setting item.
     */
    static fromDb(entry) {
        let value;
        if (!(entry.settingKey && entry.settingKey === FortiAnalyzerSettingItem.SETTING_KEY)) {
            throw new Error('Invalid entry setting key.');
        }
        try {
            value = JSON.parse(entry.settingValue);
        } catch (error) {
            throw new Error(`Invalid setting value: ${entry.settingValue}`);
        }
        if (!value.instanceId) {
            throw new Error('No instanceId found on setting value.');
        }
        return new FortiAnalyzerSettingItem(value.instanceId, value.ip, value.vip);
    }
};
