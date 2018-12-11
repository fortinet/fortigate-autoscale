# FortiGate Autoscale
A collection of **Node.js** modules and cloud specific templates which support basic autoscale functionality for groups of FortiGate VM instances on various cloud platforms.
Currently this project supports autoscaling with **Microsoft Azure Functions** and **Amazon AWS Lambda**.
The project is organized into separate node modules.
 * [fortigate-autoscale/core](core) contains the core logic and provides an interface which can be extended to deal with the differences in cloud platform apis.
 * [fortigate-autoscale/azure](azure) contains an implementation for the **Microsoft Azure** platform api and **Cosmos DB** storage backend.
 * [fortigate-autoscale/aws](aws) contains an implementation for the **AWS SDK** platform api with a **Dynamo DB** storage backend.
The project also contains a deployment script which can generate packages for each cloud service's *serverless* implementation.

## Supported Platforms
Version tag in parenthese refers to the autoscale module version in FortiGate Autoscale project.

  * Amazon AWS (1.0.0-beta)
  * Microsoft Azure (1.0.0-beta)

## Install
### Generating deployment packages locally
To make deployment packages locally
  1. Clone this project and run `npm run build` at the project root directory.
  2. The deployment package zip files will be available in the **dist** directory.

Deployment packages overview:

| Package Name | Description |
| ------ | ------ |
| fortigate-autoscale.zip | Source code of entire project. |
| fortigate-autoscale-aws-cloudformation.zip | Use Cloud Formation template to deploy the complete solution on AWS platform.|
| fortigate-autoscale-aws-lambda.zip | The source code of the FortiGate auto-scaling handler - AWS Lambda function.|
| fortigate-autoscale-azure-funcapp.zip | The source code of the FortiGate auto-scaling handler - Azure function app.|
| fortigate-autoscale-azure-quickstart.zip | Use Azure template deployment service to deploy the complete solution on Azure platform.|


For full installation guide, please see:
  * [ FortiGate / FortiOS Deploying Auto Scaling on Microsoft Azure](https://docs2.fortinet.com/vm/azure/fortigate/6.0/deploying-auto-scaling-on-azure/6.0.0)
  * [ FortiGate / FortiOS Deploying Auto Scaling on AWS](https://docs2.fortinet.com/vm/aws/fortigate/6.0/deploying-auto-scaling-on-aws/6.0.0/543390/introduction)

# Support
Note Fortinet-provided scripts (in this GitHub project and others) are not supported within regular Fortinet technical support scope.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to the Lambda scripts, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](./LICENSE) © Fortinet Technologies. All rights reserved.
