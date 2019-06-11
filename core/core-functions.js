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

const uuidv5 = require('uuid/v5');
const Logger = require('./logger');
const crypto = require('crypto');
const uuidGenerator = inStr => uuidv5(inStr, uuidv5.URL);
const toGmtTime = function(time) {
    let timeObject;
    if (time instanceof Date) {
        timeObject = time;
    } else {
        timeObject = new Date(isNaN(time) ? time : parseInt(time));
    }
    if (timeObject.getTime()) {
        return new Date(timeObject.getTime() + timeObject.getTimezoneOffset() * 60000);
    } else {
        return null;
    }
};
class DefaultLogger extends Logger {
    constructor(loggerObject) {
        super(loggerObject);
    }
    log() {
        this._logCount ++;
        if (!(this.level && this.level.log === false)) {
            if (this._outputQueue && !this._flushing) {
                this.enQueue('log', arguments);
            } else {
                this.logger.log.apply(null, arguments);
            }
        }
        return this;
    }
    debug() {
        this._debugCount ++;
        if (!(this.level && this.level.debug === false)) {
            if (this._outputQueue && !this._flushing) {
                this.enQueue('debug', arguments);
            } else {
                this.logger.debug.apply(null, arguments);
            }
        }
        return this;
    }
    info() {
        this._infoCount ++;
        if (!(this.level && this.level.info === false)) {
            if (this._outputQueue && !this._flushing) {
                this.enQueue('info', arguments);
            } else {
                this.logger.info.apply(null, arguments);
            }
        }
        return this;
    }
    warn() {
        this._warnCount ++;
        if (!(this.level && this.level.warn === false)) {
            if (this._outputQueue && !this._flushing) {
                this.enQueue('warn', arguments);
            } else {
                this.logger.warn.apply(null, arguments);
            }
        }
        return this;
    }
    error() {
        this._errorCount ++;
        if (!(this.level && this.level.error === false)) {
            if (this._outputQueue && !this._flushing) {
                this.enQueue('error', arguments);
            } else {
                this.logger.error.apply(null, arguments);
            }
        }
        return this;
    }
    flush(level = 'log') {
        if (!this._outputQueue) {
            return '';
        }
        let outputContent = '';
        if (this._queue.length > 0) {
            outputContent += `Queued Logs: [log: ${this._logCount}, info: ${this._infoCount}, ` +
            `debug: ${this._debugCount}, warn: ${this._warnCount}, error: ${this._errorCount}]\n`;
        }
        while (this._queue.length > 0) {
            let item = this._queue.shift();
            outputContent += `[${item.level}][_t:${item.timestamp}]\n[_c]`;
            if (item.arguments.length > 0) {
                item.arguments.forEach(arg => {
                    outputContent += `${arg}\n`;
                });
            }
            outputContent += `[/_c][/${item.level}]`;

        }
        this._flushing = true;
        switch (level) {
            case 'log':
                this.log(outputContent);
                break;
            case 'debug':
                this.debug(outputContent);
                break;
            case 'info':
                this.info(outputContent);
                break;
            case 'warn':
                this.warn(outputContent);
                break;
            case 'error':
                this.error(outputContent);
                break;
            default:
                this.log(outputContent);
                break;
        }
        this._flushing = false;
        return outputContent;
    }
}

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
        let message = '';
        if (error instanceof Error) {
            message = error.message;
        } else {
            message = error && typeof error.toString === 'function' ?
                error.toString() : JSON.stringify(error);
        }
        return Promise.reject(`failed to wait due to error: ${message}`);
    }
    return Promise.resolve(result);
};

/**
 * calculate a string checksum
 * @param {String} str a string to calculate the checksum
 * @param {String} algorithm an algorithm to calculate the checksum
 * @returns {String} checksum
 */
function calStringChecksum(str, algorithm = 'sha1') {
    return crypto.createHash(algorithm).update(str, 'utf8').digest('hex');
}

function configSetResourceFinder(resObject, nodePath) {
    nodePath = nodePath.match(/^{(.+)}$/i);
    if (!resObject || !nodePath) {
        return '';
    }
    let nodes = nodePath[1].split('.');
    let ref = resObject;

    nodes.find(nodeName => {
        let matches = nodeName.match(/^([A-Za-z_@-]+)#([0-9])+$/i);
        if (matches && Array.isArray(ref[matches[1]]) && ref[matches[1]].length > matches[2]) {
            ref = ref[matches[1]][matches[2]];
        } else if (!ref[nodeName]) {
            ref = null;
            return false;
        } else {
            ref = Array.isArray(ref[nodeName]) && ref[nodeName].length > 0 ?
                ref[nodeName][0] : ref[nodeName];
        }
    });
    return ref;
}


exports.DefaultLogger = DefaultLogger;
exports.moduleRuntimeId = () => moduleId;
exports.uuidGenerator = uuidGenerator;
exports.sleep = sleep;
exports.waitFor = waitFor;
exports.calStringChecksum = calStringChecksum;
exports.configSetResourceFinder = configSetResourceFinder;
exports.toGmtTime = toGmtTime;
