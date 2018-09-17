'use strict';

/*
Fortigate Autoscale Azure Function (1.0.0-preview)
Author: Fortinet
*/

const FtgtAutoScaleAzure = require('fortigate-autoscale-azure');
/**
 * Azure Function App Entry.
 * @param {Object} context Azure Function App runtime context
 * @param {Object} req request object from c
 */
module.exports = async function(context, req) {
    context.log(`Incoming request: ${JSON.stringify(req)}`);
    await FtgtAutoScaleAzure.initModule();
    await FtgtAutoScaleAzure.handle(context, req);
};
