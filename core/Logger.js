'use strict';

/*
Author: Fortinet
*/

/**
 * A unified logger class to handle logging across different platforms.
 */
module.exports = class Logger {
    constructor(loggerObject) {
        this.logger = loggerObject;
    }

    /**
     * control logging output level.
     * @param {Object} levelObject {log: true | false, info: true | false, warn: true | false,
     *  error: true | false}
     */
    setLoggingLevel(levelObject) {
        this.level = levelObject;
    }

    /**
     * output information to a regular logging stream.
     */
    log() {} // eslint-disable-line no-unused-vars
    /**
     * output information to the debug logging stream.
     */
    debug() {} // eslint-disable-line no-unused-vars
    /**
     * output information to the info logging stream.
     */
    info() {} // eslint-disable-line no-unused-vars
    /**
     * output information to the warning logging stream.
     */
    warn() {} // eslint-disable-line no-unused-vars
    /**
     * output information to the error logging stream.
     */
    error() {} // eslint-disable-line no-unused-vars
};
