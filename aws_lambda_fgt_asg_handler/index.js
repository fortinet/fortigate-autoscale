'use strict';

/*
FortiGate Autoscale AWS Lambda Function (1.0.0-beta)
Author: Fortinet
*/

const ftgtAutoscaleAws = require('fortigate-autoscale-aws');
const logger = new ftgtAutoscaleAws.AutoScaleCore.DefaultLogger(console);
const autoscaleHandler = new ftgtAutoscaleAws.AwsAutoscaleHandler();
autoscaleHandler.useLogger(logger);
ftgtAutoscaleAws.initModule();

/**
 * AWS Lambda Entry.
 * @param {Object} event The event been passed to
 * @param {Object} context The Lambda function runtime context
 * @param {Function} callback a callback function been triggered by AWS Lambda mechanism
 */
exports.AutoscaleHandler = async (event, context, callback) => {
    console.log(`Incoming event: ${JSON.stringify(event)}`);
    await ftgtAutoscaleAws.handler(event, context, callback);
};

async function initiate(desiredCapacity, minSize, maxSize, subnetPairs) {
    await autoscaleHandler.saveSubnetPairs(subnetPairs);
    await autoscaleHandler.saveSettings(desiredCapacity, minSize, maxSize);
}

async function saveSettings(desiredCapacity, minSize, maxSize) {
    await autoscaleHandler.saveSettings(desiredCapacity, minSize, maxSize);
}

async function restart() {
    // autoscaleHandler = autoscaleHandler || new ftgtAutoscaleAws.autoscaleHandler();
    await autoscaleHandler.updateCapacity(0, 0, null);
    // delete master election result
    await autoscaleHandler.resetMasterElection();
    // set desired capacity & min size from saved setting to start auto scaling again
    let settings = await autoscaleHandler.loadSettings();
    await autoscaleHandler.updateCapacity(settings.desiredCapacity,
                        settings.minSize, settings.maxSize);
}

async function stop() {
    await autoscaleHandler.updateCapacity(0, 0, null);
    // delete master election result
    await autoscaleHandler.resetMasterElection();
}

async function updateCapacity(desiredCapacity, minSize, maxSize) {
    await autoscaleHandler.updateCapacity(desiredCapacity,
        minSize, maxSize);
}

async function checkAutoScalingGroupState() {
    return await autoscaleHandler.checkAutoScalingGroupState();
}

async function cleanUp() {
    return await autoscaleHandler.cleanUpAdditionalNics();
}

exports.getLogger = () => {
    return ftgtAutoscaleAws.logger;
};

exports.saveSettings = saveSettings;
exports.restart = restart;
exports.updateCapacity = updateCapacity;
exports.initiate = initiate;
exports.stop = stop;
exports.checkAutoScalingGroupState = checkAutoScalingGroupState;
exports.cleanUp = cleanUp;
exports.AutoScaleCore = ftgtAutoscaleAws.AutoScaleCore;
