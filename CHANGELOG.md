# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2020-01-02
### Added
- Azure template: Added support for deploying into an existing vnet.
- Azure template: VnetDeploymentMethod (original name VnetNewOrExisting) offers 3 options.
- Azure template: Added a template output fgtLicensingModel.
- Azure template: Added enhanced security level using Azure provided network security features
- Azure template: Added the following new parameters:
  - VnetResourceGroupName
  - MinBYOLInstanceCount
  - MaxBYOLInstanceCount
  - MinPAYGInstanceCount
  - FrontendIPName
  - NetworkSecurityGroupName

### Changed
- Azure template: Reordered some template parameters.
- Azure template: Changed the default value for HeartBeatInterval from 30 to 60, maximum value from
  90 to 120.
- Azure template: Changed the default value for HeartBeatDelayAllowance from 2 to 30, minimum value
  from 0 to 30.
- Azure template: Rename the following parameters:
  - VnetNewOrExisting to VnetDeploymentMethod
  - SubnetAddressPrefix to VnetAddressSpace
  - Subnet1Prefix to Subnet1AddressRange
  - Subnet2Prefix to Subnet2AddressRange
  - Subnet3Prefix to Subnet3AddressRange
  - Subnet4Prefix to Subnet4AddressRange
- Azure template: Template can now deploy different sets of metrics for BYOL vmss and PAYG vmss
  depending on the licensing models (BYOL-Only, PAYG-Only, and Hybrid)
- Azure template: Disabled the PAYG vmss by default so users need to run the command to enable it
  once deployment is completed.
- Azure template: Updated description of the following parameters:
  - BYOLInstanceCount
  - PAYGInstanceCount
  - VnetName
  - FrontendIPDeploymentMethod
- AWS: Disabled source / destination checking on FortiGate instance & eni by default.
- AWS: Fix wrong subnet association with internal ELB


## [2.0.0] - 2019-10-08
### Added
- Initial support 3 licensing models: Hybrid, PAYG-only, and BYOL-only for AWS and Azure.
- A link to the official documentation site to README.md

### Changed
- Switch master from version 1.0.x to 2.0.x, stop feature development on 1.0.x, and keep 1.0.x in
  the 1.0 branch.
