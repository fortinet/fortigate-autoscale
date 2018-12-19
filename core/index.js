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

/**
 * A wait-for function that periodically awaits an async promise, and does a custom validation on
 * the result and end the waiting on a certain condition.
 * This function will return a Promise resolved with the last result of promiseEmitter.
 * It will also end immediately if any error occurs during, and return a Promise rejected with the
 * error object.
 * @param {Function} promiseEmitter a function that returns a promise for async/await
 * @param {Function} validator compare the result given by promiseEmitter and a certain condition
 * for validation. Should return true if a curtain condition is met so this end the waiting
 * @param {Number} interval a period of time between each waiting
 * @param {Function | Number} counter a counter function or a number of counting to end the waiting.
 * If giving a counter function, it should return true to indicate that waiting should end. If a
 * number is provided, waiting will end at the giving number of attempts to wait. Default is 12.
 */
const waitFor = async (promiseEmitter, validator, interval = 5000, counter = null) => {
    let currentCount = 0, result, maxCount;
    if (typeof counter !== 'function') {
        maxCount = isNaN(counter) ? 12 : counter;
        counter = count => {
            if (count >= maxCount) {
                throw new Error(`failed to wait for a result within ${maxCount} attempts.`);
            }
            return true; // return count < maxCount
        };
    }
    try {
        result = await promiseEmitter();
        while (counter(currentCount) && !validator(result)) {
            await sleep(interval);
            result = await promiseEmitter();
            currentCount ++;
        }
    } catch (error) {
        return Promise.reject(`failed to wait due to error: ${JSON.stringify(error)}`);
    }
    return Promise.resolve(result);
};

exports.moduleRuntimeId = () => moduleId;
exports.uuidGenerator = uuidGenerator;
exports.sleep = sleep;
exports.waitFor = waitFor;
