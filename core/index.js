'use strict';

/*
Author: Fortinet
*/

const uuidv5 = require('uuid/v5');
const Logger = require('./logger');
exports.LifecycleItem = require('./lifecycle-item');
exports.CloudPlatform = require('./cloud-platform');
exports.AutoscaleHandler = require('./autoscale-handler');
exports.settingItems = require('./setting-items');

const uuidGenerator = inStr => uuidv5(inStr, uuidv5.URL);

class DefaultLogger extends Logger {
    constructor(loggerObject) {
        super(loggerObject);
    }
    log() {
        if (!(this.level && this.level.log === false)) {
            this.logger.log.apply(null, arguments);
        }
    }
    debug() {
        if (!(this.level && this.level.debug === false)) {
            this.logger.debug.apply(null, arguments);
        }
    }
    info() {
        if (!(this.level && this.level.info === false)) {
            this.logger.info.apply(null, arguments);
        }
    }
    warn() {
        if (!(this.level && this.level.warn === false)) {
            this.logger.warn.apply(null, arguments);
        }
    }
    error() {
        if (!(this.level && this.level.error === false)) {
            this.logger.error.apply(null, arguments);
        }
    }
}

exports.DefaultLogger = DefaultLogger;

const logger = new DefaultLogger(console);
const moduleId = uuidGenerator(JSON.stringify(`${__filename}${Date.now()}`));
const sleep = ms => {
    return new Promise(resolve => {
        logger.warn(`sleep for ${ms} ms`);
        setTimeout(resolve, ms);
    });
};
const waitFor = async (promiseEmitter, comparer, interval = 5000, count = 12) => {
    let currentCount = 0, result;
    try {
        result = await promiseEmitter();
        while (currentCount < count && !comparer(result)) {
            await sleep(interval);
            result = await promiseEmitter();
            count ++;
        }
    } catch (error) {
        return Promise.reject(`failed to wait due to error: ${JSON.stringify(error)}`);
    }
    if (count === currentCount) {
        return Promise.reject(`failed to wait for a result within ${count} attempts.`);
    }
    return Promise.resolve(result);
};

exports.moduleRuntimeId = () => moduleId;
exports.uuidGenerator = uuidGenerator;
exports.sleep = sleep;
exports.waitFor = waitFor;
