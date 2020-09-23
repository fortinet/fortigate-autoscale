# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2020-09-23
### Changed
- applied primary/secondary terminology update.
- BREAKING CHANGE: some template parameter names, DB table, and record columns changed due to the terminology update

### Deleted
- BREAKING CHANGE: removed AWS portion. (moved to the new project: https://github.com/fortinet/fortigate-autoscale-aws)

## [2.0.9] - 2020-09-01
### Changed
- fixed AWS improperly receiving initial auto scaling events
- removed a FortiOS 6.0.4 #0543036 workaround

## [2.0.8] - 2020-06-25
### Changed
- bugfix AWS: Optional internal ELB selection error on template
- matched the changes in Azure Function App configuration
- updated the AWS 'Launch Stack' buttons on README
- removed Transit Gateway related templates from this repo

### Added
- AWS ELB cross-zone balancing support.

## [2.0.7] - 2020-04-27
### Changed
- Update FortiGate AWS AMI Id.

## [2.0.5] - 2020-02-25
### Changed
- fixed version 6.0.9 missing in FOS selection on the Azure template.

## [2.0.4] - 2020-02-25
### Added
- added suppport for FOS 6.0.9 on Azure.

## [2.0.3] - 2020-02-19
### Added
- added suppport for FOS 6.0.9 and two AWS regions.

## [2.0.2] - 2020-01-23
### Changed
- update lambda function runtime version from 8.10 to 12.x
- fix the incorrect link for 'deploy to aws' button on the README.md
- use the recommended way to allocate Buffer in nodejs.

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
