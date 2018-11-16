'use strict';

/*
Author: Fortinet
*/

const uuidv5 = require('uuid/v5');
const Logger = require('./Logger');
var LifecycleItem = require('./LifecycleItem');
var CloudPlatform = require('./CloudPlatform');
var AutoscaleHandler = require('./AutoscaleHandler');

exports.AutoscaleHandler = AutoscaleHandler;
exports.LifecycleItem = LifecycleItem;
exports.CloudPlatform = CloudPlatform;

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

exports.moduleRuntimeId = () => moduleId;
exports.uuidGenerator = uuidGenerator;
exports.sleep = sleep;
