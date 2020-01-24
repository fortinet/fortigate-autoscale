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
if (
    process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED &&
    process.env.DEBUG_LOGGER_OUTPUT_QUEUE_ENABLED.toLowerCase() === 'true'
) {
    logger.outputQueue = true;
    if (process.env.DEBUG_LOGGER_TIMEZONE_OFFSET) {
        logger.timeZoneOffset = process.env.DEBUG_LOGGER_TIMEZONE_OFFSET;
    }
}

let _initStarted = false;

autoscaleHandler.useLogger(logger);
ftgtAutoscaleAws.initModule();

async function init() {
    if (!_initStarted) {
        _initStarted = true;
        await autoscaleHandler.init();
    } else if (_initStarted && !autoscaleHandler._settings) {
        return Promise.reject(new Error('Cannot initiate module. Failed to load settings.'));
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
 * FortiGate Autoscale Handler Lambda function entry.
 * @param {Object} event The event been passed to
 * @param {Object} context The Lambda function runtime context
 * @param {Function} callback a callback function been triggered by AWS Lambda mechanism
 */
exports.AutoscaleHandler = async (event, context, callback) => {
    console.log(`Incoming event: ${JSON.stringify(event)}`);
    await ftgtAutoscaleAws.handler(event, context, callback);
};

/**
 * FortiGate Autoscale BYOL License handler Lambda function entry.
 * @param {Object} event The event been passed to
 * @param {Object} context The Lambda function runtime context
 * @param {Function} callback a callback function been triggered by AWS Lambda mechanism
 */
exports.ByolLicenseHandler = async (event, context, callback) => {
    console.log(`Incoming event: ${JSON.stringify(event)}`);
    await ftgtAutoscaleAws.handleGetLicense(event, context, callback);
};

async function initiate() {
    await init();
    let subnetPairs = [];
    subnetPairs.push({
        subnetId: autoscaleHandler._settings['fortigate-autoscale-subnet-1'],
        pairId: autoscaleHandler._settings['fortigate-autoscale-protected-subnet1']
    });
    // create subnet pair 2
    subnetPairs.push({
        subnetId: autoscaleHandler._settings['fortigate-autoscale-subnet-2'],
        pairId: autoscaleHandler._settings['fortigate-autoscale-protected-subnet2']
    });
    await autoscaleHandler.saveSubnetPairs(subnetPairs);
    return await restart();
}

async function saveSettings(settings) {
    await autoscaleHandler.saveSettings(settings);
}

async function restart() {
    await init();
    let tasks = [];
    if (autoscaleHandler._settings['enable-hybrid-licensing'] === 'true') {
        tasks.push(
            autoscaleHandler.updateCapacity(
                autoscaleHandler._settings['byol-scaling-group-name'],
                0,
                0,
                null
            )
        );
    }

    tasks.push(
        autoscaleHandler.updateCapacity(
            autoscaleHandler._settings['payg-scaling-group-name'],
            0,
            0,
            null
        )
    );

    await Promise.all(tasks);

    // delete master election result
    await autoscaleHandler.resetMasterElection();
    // set desired capacity & min size from saved setting to start auto scaling again
    await autoscaleHandler.loadAutoScalingSettings();
    // FIXME: if bug 0560197 is fixed, the delay added here needs to remove
    // and update the capacity to settings.desiredCapacity

    // if the desired capacity is >= 1, bring up the 1st instance in the master scaling group
    // where the master scaling group is the BYOL scaling group if hybrid-licensing enabled,
    // or the PAYG scaling group if not.
    let desiredCapacityBYOL = 0,
        minSizeBYOL = 0,
        maxSizeBYOL = 0,
        desiredCapacityPAYG = 0,
        minSizePAYG = 0,
        maxSizePAYG = 0;
    if (autoscaleHandler._settings['enable-hybrid-licensing'] === 'true') {
        desiredCapacityBYOL = parseInt(
            autoscaleHandler._settings['byol-scaling-group-desired-capacity']
        );
        minSizeBYOL = parseInt(autoscaleHandler._settings['byol-scaling-group-min-size']);
        maxSizeBYOL = parseInt(autoscaleHandler._settings['byol-scaling-group-max-size']);
    }

    desiredCapacityPAYG = parseInt(autoscaleHandler._settings['scaling-group-desired-capacity']);
    minSizePAYG = parseInt(autoscaleHandler._settings['scaling-group-min-size']);
    maxSizePAYG = parseInt(autoscaleHandler._settings['scaling-group-max-size']);

    // update only when the desired capacity > 0 and the size constraint:
    // desired min <= desired <= max is met
    // bring up the 1st instance which will become the master
    if (
        autoscaleHandler._settings['enable-hybrid-licensing'] === 'true' &&
        desiredCapacityBYOL > 0 &&
        desiredCapacityBYOL >= minSizeBYOL &&
        desiredCapacityBYOL <= maxSizeBYOL
    ) {
        // if master-election-no-wait feature is diabled, bring up the master instance first,
        // delay 1 minute to bring up the rest
        if (autoscaleHandler._settings['master-election-no-wait'] !== 'true') {
            // bring up the master
            await autoscaleHandler.updateCapacity(
                autoscaleHandler._settings['byol-scaling-group-name'],
                1,
                1,
                maxSizeBYOL
            );
            // delay 1 min
            await ftgtAutoscaleAws.AutoScaleCore.Functions.sleep(60000);
        }
        // bring up the rest instances which will become the slave(s)
        await autoscaleHandler.updateCapacity(
            autoscaleHandler._settings['byol-scaling-group-name'],
            desiredCapacityBYOL,
            minSizeBYOL,
            maxSizeBYOL
        );
    }

    // bring up instances in the payg scaling group if the capacity and sizes are set properly
    if (
        desiredCapacityPAYG > 0 &&
        desiredCapacityPAYG >= minSizePAYG &&
        desiredCapacityPAYG <= maxSizePAYG
    ) {
        await autoscaleHandler.updateCapacity(
            autoscaleHandler._settings['payg-scaling-group-name'],
            desiredCapacityPAYG,
            minSizePAYG,
            maxSizePAYG
        );
    }
}

async function stop() {
    await init();
    if (autoscaleHandler._settings['enable-hybrid-licensing'] === 'true') {
        await autoscaleHandler.updateCapacity(
            autoscaleHandler._settings['byol-scaling-group-name'],
            0,
            0,
            null
        );
    }
    await autoscaleHandler.updateCapacity(
        autoscaleHandler._settings['payg-scaling-group-name'],
        0,
        0,
        null
    );
    // delete master election result
    await autoscaleHandler.resetMasterElection();
}

async function updateCapacity(scalingGroupName, desiredCapacity, minSize, maxSize) {
    await init();
    await autoscaleHandler.updateCapacity(scalingGroupName, desiredCapacity, minSize, maxSize);
}

async function checkAutoScalingGroupState(scalingGroupName) {
    await init();
    return await autoscaleHandler.checkAutoScalingGroupState(scalingGroupName);
}

async function checkNicStatus(status = 'in-use') {
    await init();
    return await autoscaleHandler.listNetworkInterfaces(status);
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
exports.checkNicStatus = checkNicStatus;
