'use strict';

/*
FortiGate Autoscale Azure Function (1.0.0)
Author: Fortinet
*/

const ftgtAutoscaleAzure = require('fortigate-autoscale-azure');
ftgtAutoscaleAzure.initModule();
/**
 * Azure Function App Entry.
 * Node runtime version 1.x need to call context.done() in either synchronous or asynchronous
 * function.
 * @see https://docs.microsoft.com/en-us/azure/azure-functions/set-runtime-version
 * @see https://docs.microsoft.com/en-us/azure/azure-functions/functions-reference-node
 * @param {Object} context Azure Function App runtime context
 * @param {Object} req request object specified by HTTP trigger Request parameter name
 */
module.exports = async function(context, req) {
    context.log(`Incoming request: ${JSON.stringify(req)}`);
    await ftgtAutoscaleAzure.handleListCustomLog(context, req);
    if (
        process.env.FUNCTIONS_EXTENSION_VERSION &&
        process.env.FUNCTIONS_EXTENSION_VERSION === '~1'
    ) {
        context.done();
    }
};
