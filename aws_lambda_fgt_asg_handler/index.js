'use strict';

/*
FortiGate Autoscale AWS Lambda Function (1.0.0)
Author: Fortinet
*/

const ftgtAutoscaleAws = require('fortigate-autoscale-aws');
// TODO:
// for log output [object object] issues, check util.inspect(result, false, null) for more info
const logger = new ftgtAutoscaleAws.AutoScaleCore.DefaultLogger(console);
const autoscaleHandler = new ftgtAutoscaleAws.AwsAutoscaleHandler();
if (process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED &&
    process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED.toLowerCase() === 'true') {
    logger.outputQueue = true;
    if (process.env.DEBUG_LOGGER_TIMEZONE_OFFSET) {
        logger.timeZoneOffset = process.env.DEBUG_LOGGER_TIMEZONE_OFFSET;
    }
}
autoscaleHandler.useLogger(logger);
ftgtAutoscaleAws.initModule();

async function init() {
    if (!autoscaleHandler._settings) {
        await autoscaleHandler.init();
    } else {
        return Promise.resolve(true);
    }
}

function getSettings() {
    return autoscaleHandler._settings;
}

function getPlatform() {
    return autoscaleHandler.platform;
}

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
    await autoscaleHandler.saveSettings({desiredCapacity: desiredCapacity,
        minSize: minSize, maxSize: maxSize});
}

async function saveSettings(settings) {
    await autoscaleHandler.saveSettings(settings);
}

async function restart() {
    await init();
    // autoscaleHandler = autoscaleHandler || new ftgtAutoscaleAws.autoscaleHandler();
    await autoscaleHandler.updateCapacity(
        autoscaleHandler._settings['payg-auto-scaling-group-name'], 0, 0, null);
    // delete master election result
    await autoscaleHandler.resetMasterElection();
    // set desired capacity & min size from saved setting to start auto scaling again
    let settings = await autoscaleHandler.loadAutoScalingSettings();
    // FIXME: if bug 0560197 is fixed, the delay added here needs to remove
    // and update the capacity to settings.desiredCapacity
    await autoscaleHandler.updateCapacity(
        autoscaleHandler._settings['payg-auto-scaling-group-name'], 1, 1, settings.maxSize);
    if (settings.desiredCapacity > 1) {
        await ftgtAutoscaleAws.AutoScaleCore.Functions.sleep(60000);
        await autoscaleHandler.updateCapacity(
            autoscaleHandler._settings['payg-auto-scaling-group-name'], settings.desiredCapacity,
            settings.minSize, settings.maxSize);
    }
}

async function stop() {
    await init();
    if (autoscaleHandler._settings['enable-hybrid-licensing'] === 'true') {
        await autoscaleHandler.updateCapacity(
            autoscaleHandler._settings['byol-auto-scaling-group-name'], 0, 0, null);
    }
    await autoscaleHandler.updateCapacity(
        autoscaleHandler._settings['payg-auto-scaling-group-name'], 0, 0, null);
    // delete master election result
    await autoscaleHandler.resetMasterElection();
}

async function updateCapacity(scalingGroupName, desiredCapacity, minSize, maxSize) {
    await autoscaleHandler.updateCapacity(scalingGroupName, desiredCapacity, minSize, maxSize);
}

async function checkAutoScalingGroupState(scalingGroupName) {
    return await autoscaleHandler.checkAutoScalingGroupState(scalingGroupName);
}

async function cleanUp() {
    let tasks = [];
    await init();
    // if enabled secondary eni attachment, do the cleanup
    if (autoscaleHandler._settings['enable-second-nic'] === 'true') {
        tasks.push(autoscaleHandler.cleanUpAdditionalNics());
    }
    // if enabled transit gateway vpn support, do the cleanup
    if (autoscaleHandler._settings['enable-transit-gateway-vpn'] === 'true') {
        tasks.push(autoscaleHandler.cleanUpVpnAttachments());
    }
    return await Promise.all(tasks);
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
exports.init = init;
exports.getSettings = getSettings;
exports.getPlatform = getPlatform;
