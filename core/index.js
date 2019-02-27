'use strict';

/*
Author: Fortinet
*/

const CoreFunctions = require('./core-functions');
exports.LifecycleItem = require('./lifecycle-item');
exports.CloudPlatform = require('./cloud-platform');
exports.AutoscaleHandler = require('./autoscale-handler');
exports.dbDefinitions = require('./db-definitions');
const {VirtualMachine, NetworkInterface} = require('./virtual-machine');
exports.VirtualMachine = VirtualMachine;
exports.NetworkInterface = NetworkInterface;
exports.settingItems = require('./setting-items');
exports.DefaultLogger = CoreFunctions.DefaultLogger;
exports.moduleRuntimeId = () => CoreFunctions.moduleId;
exports.uuidGenerator = CoreFunctions.uuidGenerator;
exports.sleep = CoreFunctions.sleep;
exports.waitFor = CoreFunctions.waitFor;
exports.calStringChecksum = CoreFunctions.calStringChecksum;
