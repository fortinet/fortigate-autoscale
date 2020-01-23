'use strict';

/*
FortiGate Autoscale AWS Lambda Function - FortiGate Auto Scaling Group handler (1.0.0)
Author: Fortinet
*/

/* eslint-disable no-unused-vars */
exports = module.exports;
const AWS = require('aws-sdk');
const ftgtAutoscaleAws = require('fortigate-autoscale-aws');

// lock the API versions
AWS.config.apiVersions = {
    autoscaling: '2011-01-01',
    ec2: '2016-11-15',
    lambda: '2015-03-31',
    dynamodb: '2012-08-10',
    apiGateway: '2015-07-09',
    s3: '2006-03-01'
};

AWS.config.update({
    region: process.env.AWS_REGION
});

const RESOURCE_TAG_PREFIX = process.env.RESOURCE_TAG_PREFIX || '';

let logger;

function proxyResponse(statusCode, res) {
    const response = {
        statusCode,
        headers: {},
        body: typeof res === 'string' ? res : JSON.stringify(res),
        isBase64Encoded: false
    };
    return response;
}

/**
 * Handle the vpn management
 * @param {Object} event The event been passed to
 * @param {Object} context The Lambda function runtime context
 * @param {Function} callback a callback function been triggered by AWS Lambda mechanism
 */
exports.handler = async (event, context, callback) => {
    process.env.SCRIPT_EXECUTION_EXPIRE_TIME = Date.now() + context.getRemainingTimeInMillis();
    logger = new ftgtAutoscaleAws.AutoScaleCore.DefaultLogger(console);
    const handler = new ftgtAutoscaleAws.AwsAutoscaleHandler();
    if (
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED &&
        process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED.toLowerCase() === 'true'
    ) {
        logger.outputQueue = true;
        if (process.env.DEBUG_LOGGER_TIMEZONE_OFFSET) {
            logger.timeZoneOffset = process.env.DEBUG_LOGGER_TIMEZONE_OFFSET;
        }
    }
    handler.useLogger(logger);
    ftgtAutoscaleAws.initModule();
    await handler.init();
    let result;
    if (
        !event.pskSecret ||
        !handler._settings ||
        handler._settings['deployment-settings-saved'] !== 'true'
    ) {
        callback(null, proxyResponse(403, 'Unauthorized access.'));
        return;
    }

    if (!event.invokeMethod) {
        callback(null, proxyResponse(403, 'Unknown invocation method.'));
        return;
    }
    switch (event.invokeMethod) {
        case 'updateTgwRouteTable':
            result = await handler.updateTgwRouteTable(event.attachmentId);
            callback(null, proxyResponse(200, result));
            break;
        default:
            callback(null, proxyResponse(403, 'Unknown invocation method.'));
            return;
    }
};
