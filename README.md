# Fortigate Autoscale
A collection of **Node.js** modules and cloud specific templates which support basic autoscale functionality for groups of FortiGate VM instances on various cloud platforms.
Currently this project supports autoscaling with **Microsoft Azure Functions** and *Amazon AWS Lambda* (alpha).
The project is organized into separate node modules.
 * [fortigate-autoscale/core](core) contains the core logic and provides an interface which can be extended to deal with the differences in cloud platform apis.
 * [fortigate-autoscale/azure](azure) contains an implementation for the **Microsoft Azure** platform api and **Cosmos DB** storage backend.
 * [fortigate-autoscale/aws](aws) contains an implementation for the **AWS SDK** platform api with a **Dynamo DB** storage backend.
The project also contains a deployment script which can generate packages for each cloud service's *serverless* implementation.

## Supported Platforms
Version tag in parenthese refers to the autoscale module version in Fortigate Autoscale project.

  * Amazon AWS (1.0.0-alpha)
  * Microsoft Azure (1.0.0-beta)

## Install

To make deployment packages locally
  1. Clone this project and run `npm run build` at the project root directory.
  2. The deployment package zip files will be available in the **dist** directory.

For full installation guide, please see:
  * [ FortiGate / FortiOS Deploying Auto Scaling on Microsoft Azure](https://docs2.fortinet.com/vm/azure/fortigate/6.0/deploying-auto-scaling-on-azure/6.0.0)

More information and instructions will be available soon.

# Support
Note Fortinet-provided scripts (in this GitHub project and others) are not supported within regular Fortinet technical support scope.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to the Lambda scripts, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](../LICENSE) © Fortinet Technologies. All rights reserved.