'use strict';

/*
Author: Fortinet
*/

const FtntAutoScaleAzure = require('ftnt-autoscale-azure');
/**
 * Azure Function App Entry.
 * @param {Object} context Azure Function App runtime context
 * @param {Object} req request object from c
 */
module.exports = async function(context, req) {
    await FtntAutoScaleAzure.initModule();
    FtntAutoScaleAzure.handle(context, req);
};
