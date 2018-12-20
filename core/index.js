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
 * @param {Function} promiseEmitter Function(result):Promise, A function returns a promise with a
 * result of actions which you wish to wait for.
 * @param {Function} validator Function(result):boolean, a result-based condition function that
 * takes the result of the promiseEmitter, decides whether it should end the waiting or not based on
 *  the result. The validator function should return true to end the waiting, or false to continue.
 * @param {Number} interval a period of time in milliseconds between each wait. Default is 5000.
 * @param {Function | Number} counter Function(currentCount:number):boolean | Number, an additonal
 * time-based condition that could end the waiting. This parameter accepts either a counter
 * function or the number of attempts where each attempt does one set of the following actions:
 * 1. awaits the return of one promise from the promiseEmitter;
 * 2. does one validation provided by the validator function.
 * If giving a counter function, the function takes the count of attempts been taken as parameter,
 * and should return true to end the waiting or false to continue. If giving a number, waiting
 * will end at the given number of attempts. Default is 12.
 */
const waitFor = async (promiseEmitter, validator, interval = 5000, counter = null) => {
    let currentCount = 0, result, maxCount;
    if (typeof counter !== 'function') {
        maxCount = !counter || isNaN(counter) ? 12 : counter;
        counter = count => {
            if (count >= maxCount) {
                throw new Error(`failed to wait for a result within ${maxCount} attempts.`);
            }
            return false;
        };
    }
    try {
        result = await promiseEmitter();
        while (!(await validator(result) || await counter(currentCount))) {
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
