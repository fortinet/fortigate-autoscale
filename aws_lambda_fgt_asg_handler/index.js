'use strict';

/*
FortiGate Autoscale AWS Lambda Function (1.0.0-beta)
Author: Fortinet
*/

const ftgtAutoscaleAws = require('fortigate-autoscale-aws');
ftgtAutoscaleAws.initModule();
let autoscaleHandler = new ftgtAutoscaleAws.AwsAutoscaleHandler();

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

/**
 * restart the auto scaling group with its preset capacity
 */
async function restartAutoScalingGroup() {

}

/**
 * set the auto scaling group to its initial state
 */
async function initiateAutoScalingGroup() {
    // set its min size to 0, desired capacity to 0, max size unchanged
}

exports.getLogger = () => {
    return ftgtAutoscaleAws.logger;
};

exports.saveSettings = saveSettings;
exports.restart = restart;
exports.updateCapacity = updateCapacity;
exports.stop = stop;
