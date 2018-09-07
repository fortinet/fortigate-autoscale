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
    context.log(`Incoming request: ${JSON.stringify(req)}`);
    await FtntAutoScaleAzure.initModule();
    await FtntAutoScaleAzure.handle(context, req);
};
