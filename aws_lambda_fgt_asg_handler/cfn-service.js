'use strict';

/*
FortiGate Autoscale Project - CloudFormation Custom Service Script:
auto scaling group (1.0.0)

This module alllows for actions on the given auto scaling group. Actions includes:
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
        logger.info(`RequestType: ${event.RequestType}, serviceType: ${serviceType}`);
        if (event.RequestType === 'Create') {
            let subnetPairs = [], params = Object.assign({}, event.ResourceProperties);
            switch (serviceType) {
                case 'initiateAutoscale':
                    // initiate
                    subnetPairs = [
                        {
                            subnetId: params.Subnet1,
                            pairId: params.Subnet1Pair
                        },
                        {
                            subnetId: params.Subnet2,
                            pairId: params.Subnet2Pair
                        }
                    ];
                    await autoscaleHandler.init();
                    await autoscaleHandler.initiate(params.DesiredCapacity, params.MinSize,
                        params.MaxSize, subnetPairs);
                    await autoscaleHandler.restart();
                    break;
                case 'saveSettings':
                    // no need to call await autoscaleHandler.init();
                    // this setting item indicates all deployment settings have been saved.
                    params.DeploymentSettingsSaved = 'true';
                    await autoscaleHandler.saveSettings(params);
                    break;
                case 'restartAutoscale':
                    // set desired capacity & min size to 0 to terminate all existing instnaces
                    // note:
                    // elb will enter a draining state to drain its connections, this process take
                    // 300 seconds by default or a defined time period
                    // must also adjust the script timeout to allow enough time for the process to
                    // complete
                    // this may take a significantly long time
                    await autoscaleHandler.init();
                    await autoscaleHandler.restart();
                    break;
                case 'updateCapacity':
                    // manually change current desired capacity & adjust min size
                    await autoscaleHandler.init();
                    if (autoscaleHandler.getSettings()['enable-hybrid-licensing'] === 'true') {
                        await autoscaleHandler.updateCapacity(
                            autoscaleHandler.getSettings()['byol-scaling-group-name'],
                        params.desiredCapacity, params.minSize, params.maxSize);
                    }
                    await autoscaleHandler.updateCapacity(
                        autoscaleHandler.getSettings()['payg-scaling-group-name'],
                        params.desiredCapacity, params.minSize, params.maxSize);
                    break;
                case 'stopAutoscale':
                    // do not need to respond to the stop service type while resource is creating
                    break;
                default:
                    throw new Error(`Unexpected service type: ${serviceType}`);
            }
        } else if (event.RequestType === 'Update') {
            // TODO: what actions are expected here?
        } else if (event.RequestType === 'Delete') {
            // only respond to the stop service while this resource is deleting
            // clean up the left over detached nic in case there are some
            if (serviceType === 'stopAutoscale') {
                let promiseEmitter = () => {
                        let tasks = [];
                        // check if all additional nics are detached and removed
                        if (autoscaleHandler.getSettings()['enable-second-nic'] === 'true') {
                            tasks.push(autoscaleHandler.getPlatform().listNicAttachmentRecord()
                                .then(nicAttachmentCheck => {
                                    return {checkName: 'nicAttachmentCheck',
                                        result: !nicAttachmentCheck ||
                                                nicAttachmentCheck.length === 0
                                    };
                                }));
                        }
                        if (autoscaleHandler.getSettings()['enable-hybrid-licensing'] === 'true') {
                            tasks.push(autoscaleHandler.checkAutoScalingGroupState(
                                autoscaleHandler.getSettings()['byol-scaling-group-name']
                            ).then(byolGroupCheck => {
                                logger.log(byolGroupCheck);
                                return {checkName: 'byolGroupCheck',
                                    result: !byolGroupCheck || byolGroupCheck === 'stopped'};
                            }));
                        }
                        tasks.push(autoscaleHandler.checkAutoScalingGroupState(
                            autoscaleHandler.getSettings()['payg-scaling-group-name']
                        ).then(paygGroupCheck => {
                            logger.log(paygGroupCheck);
                            return {checkName: 'paygGroupCheck',
                                result: !paygGroupCheck || paygGroupCheck === 'stopped'};
                        }));
                        return Promise.all(tasks);
                    },
                    validator = resultArray => {
                        let fullyStopped = true;
                        resultArray.forEach(item => {
                            fullyStopped = fullyStopped && item.result;
                        });
                        return fullyStopped;
                    },
                    counter = () => {
                        if (Date.now() < scriptExecutionExpireTime - 5000) {
                            return false;
                        }
                        throw new Error('cannot wait for auto scaling group status because ' +
                    'script execution is about to expire');
                    };
                await autoscaleHandler.init();
                // this may take a significantly long time to wait for its fully stop
                await autoscaleHandler.stop();
                try {
                    await autoscaleHandler.AutoScaleCore.Functions.waitFor(
                        promiseEmitter, validator, 5000, counter);
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
