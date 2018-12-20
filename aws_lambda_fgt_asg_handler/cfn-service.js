'use strict';

/*
FortiGate Autoscale Project - CloudFormation Custom Service Script:
auto-scaling group (1.0.0-beta)

This module alllows for actions on the given auto-scaling group. Actions includes:
- updateCapacity

Author: Fortinet
*/
/* eslint-disable no-inner-declarations */
exports = module.exports;
const cfnResponse = require('async-cfn-response');
let timer,
    responseData = {},
    responseStatus = cfnResponse.FAILED,
    scriptExecutionExpireTime;
function timeout() {
    throw new Error('Execution is about to time out, sending failure response to CloudFormation');
}

exports.handler = async (event, context) => {
    console.log('incoming event:', event);
    scriptExecutionExpireTime = Date.now() + context.getRemainingTimeInMillis() - 500;
    console.log(`Script time out in : ${context.getRemainingTimeInMillis() - 500} ms`);
    timer = setTimeout(timeout, context.getRemainingTimeInMillis() - 500);
    try {
        const autoscaleHandler = require('./index');
        const logger = autoscaleHandler.getLogger();

        logger.info('requested event:', event);
        let serviceType = event.ResourceProperties.ServiceType;
        if (event.RequestType === 'Create') {
            let desiredCapacity = event.ResourceProperties.DesiredCapacity,
                minSize = event.ResourceProperties.MinSize,
                maxSize = event.ResourceProperties.MaxSize,
                subnetPairs = [
                    {
                        subnetId: event.ResourceProperties.Subnet1,
                        pairId: event.ResourceProperties.Subnet1Pair
                    },
                    {
                        subnetId: event.ResourceProperties.Subnet2,
                        pairId: event.ResourceProperties.Subnet2Pair
                    }
                ];
            switch (serviceType) {
                case 'initiate':
                    // initiate
                    await autoscaleHandler.initiate(desiredCapacity, minSize, maxSize,
                        subnetPairs);
                    await autoscaleHandler.restart();
                    break;
                case 'saveSettings':
                    // save settings
                    await autoscaleHandler.saveSettings(desiredCapacity, minSize, maxSize);
                    break;
                case 'saveSettingsAndRestart':
                    // save settings
                    await autoscaleHandler.saveSettings(desiredCapacity, minSize, maxSize);
                    // start with saved settings
                    await autoscaleHandler.restart();
                    break;
                case 'restart':
                    // set desired capacity & min size to 0 to terminate all existing instnaces
                    // note:
                    // elb will enter a draining state to drain its connections, this process take
                    // 300 seconds by default or a defined time period
                    // must also adjust the script timeout to allow enough time for the process to
                    // complete
                    // this may take a significantly long time
                    await autoscaleHandler.restart();
                    break;
                case 'updateCapacity':
                    // manually change current desired capacity & adjust min size
                    await autoscaleHandler.updateCapacity(desiredCapacity, minSize, maxSize);
                    break;
                case 'stop':
                    // do not need to respond to the stop service type while resource is creating
                    break;
                default:
                    throw new Error(`Unexpected request type: ${event.RequestType}`);
            }
        } else if (event.RequestType === 'Update') {
            // TODO: what actions are expected here?
        } else if (event.RequestType === 'Delete') {
            // only respond to the stop service while this resource is deleting
            // clean up the left over detached nic in case there are some
            if (serviceType === 'stop') {
                let promiseEmitter = () => {
                        return Promise.resolve(autoscaleHandler.checkAutoScalingGroupState());
                    },
                    validator = result => {
                        return result === null || result === 'stopped';
                    },
                    counter = () => {
                        if (Date.now() < scriptExecutionExpireTime - 5000) {
                            return false;
                        }
                        throw new Error('cannot wait for auto-scaling group status because ' +
                    'script execution is about to expire');
                    };
                // this may take a significantly long time to wait for its fully stop
                await autoscaleHandler.stop();
                try {
                    await autoscaleHandler.AutoScaleCore.waitFor(promiseEmitter, validator, 5000,
                    counter);
                } catch (error) {
                    logger.warn('error occurs while waiting for fully stop the auto scaling group',
                    error);
                    throw error;
                }
                // clean up
                await autoscaleHandler.cleanUp();
            }
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
