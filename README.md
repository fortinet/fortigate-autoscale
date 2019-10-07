# FortiGate Autoscale
A collection of **Node.js** modules and cloud-specific templates which support autoscale functionality for groups of FortiGate-VM instances on various cloud platforms.

This project contains the code and templates for the **Amazon AWS** and **Microsoft Azure** autoscale deployments. For autoscale on **AliCloud** see the [alicloud-autoscale](https://github.com/fortinet/alicloud-autoscale/) repository.

This project is organized in separate node modules:

 * [fortigate-autoscale/core](core) contains the core logic and provides an interface which can be extended to deal with the differences in cloud platform APIs.
 * [fortigate-autoscale/azure](azure) contains an implementation for the **Microsoft Azure** platform API and **Cosmos DB** storage backend.
 * [fortigate-autoscale/aws](aws) contains an implementation for the **AWS SDK** platform API with a **Dynamo DB** storage backend.

The project also contains a deployment script which can generate packages for each cloud service's *serverless* implementation.

## Notice
The module version 1.0 will not receive any more feature updates. It is recommended to to use the 2.0 template.

## Supported Platforms
This project supports autoscaling for the cloud platforms listed below. The version tag in parentheses refers to the autoscale module version included in this project.

  * Amazon AWS Lambda (1.0.0)
  * Microsoft Azure (1.0.0)

FortiGate Autoscale supports On-Demand (PAYG) instances. Bring Your Own License (BYOL) instance support is available in the version 2.0 module.

## Deployment Packages
To generate local deployment packages:

  1. Clone this project.
  2. Checkout the 1.0 branch.
  3. Run `npm run build` at the project root directory.

Deployment packages as well as source code will be available in the **dist** directory.

| Package Name | Description |
| ------ | ------ |
| fortigate-autoscale.zip | Source code for the entire project. |
| fortigate-autoscale-aws-cloudformation.zip | Cloud Formation template. Use this to deploy the solution on the AWS platform.|
| fortigate-autoscale-aws-lambda.zip | Source code for the FortiGate Autoscale handler - AWS Lambda function.|
| fortigate-autoscale-azure-funcapp.zip | Source code for the FortiGate Autoscale handler - Azure function.|
| fortigate-autoscale-azure-template-deployment.zip | Azure template. Use this to deploy the solution on the Azure platform.|

Installation Guides are available in the *docs* directory:

  * [Deploying Auto Scaling on Azure](https://github.com/fortinet/fortigate-autoscale/blob/1.0/docs/deploying-auto-scaling-on-azure-1.0.pdf)
  * [Deploying Auto Scaling on AWS](https://github.com/fortinet/fortigate-autoscale/blob/1.0/docs/deploying-auto-scaling-on-aws-1.0.pdf)

These documents are no longer maintained as the 1.0 template has been replaced by the 2.0 template.

# Support
Fortinet-provided scripts in this and other GitHub projects do not fall under the regular Fortinet technical support scope and are not supported by FortiCare Support Services.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to this project, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/1.0/LICENSE) © Fortinet Technologies. All rights reserved.
