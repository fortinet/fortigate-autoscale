'use strict';

/*
Author: Fortinet
*
* A generic virtual machine wrapper class equivalent to:
* AWS - EC2 instance
* Azure - Virtial Machine
*/

exports = module.exports;

class NetworkInterface {

}

class VirtualMachine {
    constructor(instanceId, platform, vmData) {
        this._instanceId = instanceId;
        this._sourcePlatform = platform; // platform name in lower case
        this._sourceVmData = vmData; // the original vm data retrieved from the platform
        this._primaryPrivateIp = null;
        this._scalingGroupName = null;
        this._securityGroups = [];
        this._networkInterfaces = [];
    }

    get instanceId() {
        return this._instanceId;
    }

    get primaryPrivateIpAddress() {
        return this._primaryPrivateIp;
    }

    get virtualNetworkId() {
        return this._virtualNetworkId;
    }

    get subnetId() {
        return this._subnetId;
    }

    get scalingGroupName() {
        return this._scalingGroupName;
    }

    get securityGroups() {
        return this._securityGroups;
    }

    get networkInterfaces() {
        return this._networkInterfaces;
    }

    static fromAwsEc2(instance, scalingGroupName = '') {
        let virtualMachine = new VirtualMachine(instance.InstanceId, 'aws', instance);
        virtualMachine._primaryPrivateIp = instance.PrivateIpAddress;
        virtualMachine._virtualNetworkId = instance.VpcId;
        virtualMachine._subnetId = instance.SubnetId;
        virtualMachine._scalingGroupName = scalingGroupName;
        virtualMachine._securityGroups = [...instance.SecurityGroups];
        virtualMachine._networkInterfaces = [...instance.NetworkInterfaces];
        return virtualMachine;
    }

    static fromAzureVm(vm, scalingGroupName = '') {
        let virtualMachine = new VirtualMachine(vm.instanceId, 'azure', vm);
        let retrieveNetworkInformation = function() {
            for (let networkInterface of vm.properties.networkProfile.networkInterfaces) {
                // primary nic
                if (networkInterface.properties.primary) {
                    for (let ipConfiguration of networkInterface.properties.ipConfigurations) {
                        if (ipConfiguration.properties.primary) {
                            let matchVPC = ipConfiguration.properties.subnet.id.match(
                                new RegExp('(?<=virtualNetworks/).*(?=/subnets)')),
                                matchSubnet = ipConfiguration.properties.subnet.id.match(
                                    new RegExp('(?<=subnets/).*'));
                            return {
                                vpcId: Array.isArray(matchVPC) && matchVPC[0],
                                subnetId: Array.isArray(matchSubnet) && matchSubnet[0],
                                ipv4: ipConfiguration.properties.privateIPAddress
                            };
                        }
                    }
                }
            }
            return {vpcId: null, subnetId: null, ipv4: null};
        };
        if (vm.properties.networkProfile &&
            Array.isArray(vm.properties.networkProfile.networkInterfaces)) {
            virtualMachine._networkInterfaces = [...vm.properties.networkProfile.networkInterfaces];
            let { vpcId, subnetId, ipv4 } = retrieveNetworkInformation();
            virtualMachine._virtualNetworkId = vpcId;
            virtualMachine._subnetId = subnetId;
            virtualMachine._primaryPrivateIp = ipv4;
        }
        this._scalingGroupName = scalingGroupName;
        return virtualMachine;
    }
}

exports.VirtualMachine = VirtualMachine;
exports.NetworkInterface = NetworkInterface; // TODO: hold a place for this class here.
