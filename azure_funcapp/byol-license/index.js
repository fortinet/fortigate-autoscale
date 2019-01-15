'use strict';

/*
FortiGate Autoscale Azure Function (1.0.0-beta)
Author: Fortinet
*/

const ftgtAutoscaleAzure = require('fortigate-autoscale-azure');
ftgtAutoscaleAzure.initModule();
/**
 * Azure Function App Entry.
 * @param {Object} context Azure Function App runtime context
 * @param {Object} req request object from c
 */
module.exports = async function(context, req) {
    context.log(`Incoming request: ${JSON.stringify(req)}`);
    await ftgtAutoscaleAzure.handleGetLicense(context, req);
};
