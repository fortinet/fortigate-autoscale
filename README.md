# FortiGate Autoscale
A collection of **Node.js** modules and cloud-specific templates which support basic autoscale functionality for groups of FortiGate VM instances on various cloud platforms.

This project is organized in separate node modules:

 * [fortigate-autoscale/core](core) contains the core logic and provides an interface which can be extended to deal with the differences in cloud platform APIs.
 * [fortigate-autoscale/azure](azure) contains an implementation for the **Microsoft Azure** platform API and **Cosmos DB** storage backend.
 * [fortigate-autoscale/aws](aws) contains an implementation for the **AWS SDK** platform API with a **Dynamo DB** storage backend.
The project also contains a deployment script which can generate packages for each cloud service's *serverless* implementation.

## Supported Platforms
This project supports autoscaling for the cloud platforms listed below. The version tag in parentheses refers to the autoscale module version included in this project.

  * Amazon AWS Lamda (1.0.0)
  * Microsoft Azure (1.0.0)

## Deployment Packages
To generate local deployment packages:

  1. Clone this project.
  2. Run `npm run build` at the project root directory.

Deployment packages as well as source code will be available in the **dist** directory.

| Package Name | Description |
| ------ | ------ |
| fortigate-autoscale.zip | Source code of entire project. |
| fortigate-autoscale-aws-cloudformation.zip | Use Cloud Formation template to deploy the complete solution on AWS platform.|
| fortigate-autoscale-aws-lambda.zip | The source code of the FortiGate autoscaling handler - AWS Lambda function.|
| fortigate-autoscale-azure-funcapp.zip | The source code of the FortiGate autoscaling handler - Azure function app.|
| fortigate-autoscale-azure-template_deployment.zip | Use Azure template deployment service to deploy the complete solution on Azure platform.|

Installation Guides are available from the Fortinet Document Library:

  * [ FortiGate / FortiOS Deploying Auto Scaling on Microsoft Azure](https://docs.fortinet.com/vm/azure/fortigate/6.0/deploying-auto-scaling-on-azure/6.0.0/)
  * [ FortiGate / FortiOS Deploying Auto Scaling on AWS](https://docs.fortinet.com/vm/aws/fortigate/6.0/deploying-auto-scaling-on-aws/6.0.0/)

# Support
Fortinet-provided scripts in this and other GitHub projects do not fall under the regular Fortinet technical support scope and are not supported by FortiCare Support Services.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to this project, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE) © Fortinet Technologies. All rights reserved.
