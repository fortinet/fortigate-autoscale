'use strict';

/*
Fortigate Autoscale AWS Lambda Function (1.0.0-alpha)
Author: Fortinet
*/

const ftgtAutoscaleAws = require('fortigate-autoscale-aws');
/**
 * AWS Lambda Entry.
 * @param {Object} event The event been passed to
 * @param {Object} context The Lambda function runtime context
 * @param {Function} callback a callback function been triggered by AWS Lambda mechanism
 */
exports.AutoscaleHandler = async (event, context, callback) => {
    console.log(`Incoming event: ${JSON.stringify(event)}`);
    ftgtAutoscaleAws.initModule();
    await ftgtAutoscaleAws.handler(event, context, callback);
};
