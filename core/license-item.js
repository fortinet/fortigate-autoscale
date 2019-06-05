'use strict';

/*
Author: Fortinet
*
* A generic license item wrapper class.
*/

const crypto = require('crypto');
module.exports = class LicenseItem {
    constructor(fileName, fileETag, content = null) {
        this._fileName = fileName;
        this._fileETag = fileETag;
        this._checksum = null;
        this._algorithm = 'sha1';
        this.content = content;
    }
    get id() {
        return this._checksum;
    }

    get fileName() {
        return this._fileName;
    }

    get fileETag() {
        return this._fileETag;
    }

    get content() {
        return this._content;
    }

    set content(value) {
        this._content = value;
        if (this._algorithm && this._content) {
            this._checksum =
                crypto.createHash(this._algorithm).update(this._content, 'utf8').digest('hex');
        } else {
            this._checksum = null;
        }
    }

    get algorithm() {
        return this._algorithm;
    }

    set algorithm(value) {
        this._algorithm = value;
        if (this._algorithm && this._content) {
            this._checksum =
                crypto.createHash(this._algorithm).update(this._content, 'utf8').digest('hex');
        } else {
            this._checksum = null;
        }
    }

    get checksum() {
        return this._checksum;
    }

    get blobKey() {
        return LicenseItem.generateBlobKey(this._fileName, this._fileETag);
    }

    updateChecksum(algorithm, checksum) {
        this._algorithm = algorithm;
        this._checksum = checksum;
    }

    /**
     * Generate a key for the blob
     * @param {String} name fileName
     * @param {String} eTag etag of file
     * @returns {String} blobKey
     */
    static generateBlobKey(name, eTag) {
        return crypto.createHash('sha1').update(`${name}-${eTag}`, 'utf8').digest('hex');
    }
};
