'use strict';

/*
FortiGate Autoscale Project - CloudFormation Custom Service - nic attachment handler (1.0.0)
This module creates / deletes a CloudFormation custom service that remove all additional
network interface controllers attached to any ec2 instance managed by a curtain CF stack before
the stack is deleted.

Author: Fortinet
*/
/* eslint-disable no-inner-declarations */
exports = module.exports;
const cfnResponse = require('async-cfn-response');
let timer,
    responseData = {
        PrivateIp: null,
        InstanceId: null,
        VIP: null
    },
    responseStatus = cfnResponse.FAILED;
function timeout() {
    throw new Error('Execution is about to time out, sending failure response to CloudFormation');
}

exports.handler = async (event, context) => {
    console.log('incoming event:', event);
    console.log(`Script time out in : ${context.getRemainingTimeInMillis() - 500} ms`);
    timer = setTimeout(timeout, context.getRemainingTimeInMillis() - 500);
    try {
        const
            nicAttachment = require('./index'),
            logger = new nicAttachment.ftgtAutoscaleAws.AutoScaleCore.DefaultLogger(console);

        logger.info('requested event:', event);
        switch (event.RequestType) {
            case 'Create':
                await nicAttachment.createService();
                break;
            case 'Update':
                await nicAttachment.updateService();
                break;
            case 'Delete':
                await nicAttachment.deleteService();
                break;
            default:
                throw new Error(`Unexpected request type: ${event.RequestType}`);
        }
        responseStatus = cfnResponse.SUCCESS;
    } catch (error) {
        console.log(error);
        responseStatus = cfnResponse.FAILED;
    } finally {
        clearTimeout(timer);
        await cfnResponse.sendAsync(event, context, responseStatus, responseData);
    }
};
/* eslint-enable no-inner-declarations */
