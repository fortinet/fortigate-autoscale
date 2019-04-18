'use strict';

/*
Author: Fortinet
*/
/* eslint-disable no-unused-vars */
/**
 * A unified logger class to handle logging across different platforms.
 */
module.exports = class Logger {
    constructor(loggerObject) {
        this.logger = loggerObject;
        this._outputQueue = false;
        this._flushing = false;
        this._timeZoneOffset = 0;
        this._queue = [];
        this._logCount = 0;
        this._infoCount = 0;
        this._debugCount = 0;
        this._warnCount = 0;
        this._errorCount = 0;
    }

    /**
     * control logging output or queue level.
     * @param {Object} levelObject {log: true | false, info: true | false, warn: true | false,
     *  error: true | false}
     */
    setLoggingLevel(levelObject) {
        this.level = levelObject;
    }

    /**
     * if use output queue to output all logs as a single log item.
     * @param {Boolean} enable enable this logging feature or not
     */
    set outputQueue(enable) {
        this._outputQueue = enable;
    }

    get outputQueue() {
        return this._outputQueue;
    }

    set timeZoneOffset(offset) {
        this._timeZoneOffset = isNaN(offset) ? 0 : parseInt(offset);
    }

    get timeZoneOffset() {
        return this._timeZoneOffset;
    }

    get logCount() {
        return this._logCount;
    }

    get infoCount() {
        return this._infoCount;
    }

    get debugCount() {
        return this._debugCount;
    }

    get warnCount() {
        return this._warnCount;
    }

    get errorCount() {
        return this._errorCount;
    }

    enQueue(level, args) {
        let d = new Date();
        d.setUTCHours(d.getTimezoneOffset() / 60 + this._timeZoneOffset);
        let item = {level: level, timestamp: d, arguments: []};
        item.arguments = Array.prototype.slice.call(args).map(arg => {
            return arg && arg.toString ? arg.toString() : arg;
        });
        this._queue.push(item);
        return this;
    }

    /**
     * output or queue information to a regular logging stream.
     * @returns {Logger} return logger instance for chaining
     */
    log() {
        return this;
    }
    /**
     * output or queue information to the debug logging stream.
     * @returns {Logger} return logger instance for chaining
     */
    debug() {
        return this;
    }
    /**
     * output or queue information to the info logging stream.
     * @returns {Logger} return logger instance for chaining
     */
    info() {
        return this;
    }
    /**
     * output or queue information to the warning logging stream.
     * @returns {Logger} return logger instance for chaining
     */
    warn() {
        return this;
    }
    /**
     * output or queue information to the error logging stream.
     * @returns {Logger} return logger instance for chaining
     */
    error() {
        return this;
    }

    /**
     * flush all queued logs to the output
     * @param {String} level flush all queued logs with this level
     * @returns {Logger} return logger instance for chaining
     */
    flush(level = 'log') {
        return this;
    }
};
