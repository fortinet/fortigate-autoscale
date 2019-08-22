# FortiGate Autoscale
A collection of **Node.js** modules and cloud-specific templates which support autoscale functionality for groups of FortiGate-VM instances on various cloud platforms.

This project contains the code and templates for the **Amazon AWS** and **Microsoft Azure** autoscale deployments. For autoscale on **AliCloud** see the [alicloud-autoscale](https://github.com/fortinet/alicloud-autoscale/) repository.

This project is organized in separate node modules:

 * [fortigate-autoscale/core](core) contains the core logic and provides an interface which can be extended to deal with the differences in cloud platform APIs.
 * [fortigate-autoscale/azure](azure) contains an implementation for the **Microsoft Azure** platform API and **Cosmos DB** storage backend.
 * [fortigate-autoscale/aws](aws) contains an implementation for the **AWS SDK** platform API with a **Dynamo DB** storage backend.

The project also contains a deployment script which can generate packages for each cloud service's *serverless* implementation.

## Supported platforms
This project supports autoscaling for the cloud platforms listed below:
* Amazon AWS
* Microsoft Azure

> **Note:** The current GA release is version 1.0.x and supports On-Demand (PAYG) instances only. Version 2.0.0-beta includes support for Azure hybrid licensing and has been released as a preview.

## Deployment packages
To generate local deployment packages:

  1. From the [project release page](https://github.com/fortinet/fortigate-autoscale/releases), download the source code (.zip or .tar.gz) for the version you wish to install.
   * *Version 1.0.x* is the current GA release and supports On-Demand (PAYG) instances only
     > Use this version to deploy FortiGate Autoscale for AWS and FortiGate Autoscale for Azure (PAYG instances).
   * *Version 2.0.0-beta* includes includes support for Azure hybrid licensing and has been released as a preview.
     > Use this version to deploy FortiGate Autoscale for Azure (hybrid licensing).

  2. Extract the source code.
  3. Run `npm run build` at the project root directory.

Deployment packages as well as source code will be available in the **dist** directory.

| Package Name | Description |
| ------ | ------ |
| fortigate-autoscale.zip | Source code for the entire project. |
| fortigate-autoscale-aws-cloudformation.zip | Cloud Formation template. Use this to deploy the solution on the AWS platform.|
| fortigate-autoscale-aws-lambda.zip | Source code for the FortiGate Autoscale handler - AWS Lambda function.|
| fortigate-autoscale-azure-funcapp.zip | Source code for the FortiGate Autoscale handler - Azure function.|
| fortigate-autoscale-azure-template-deployment.zip | Azure template. Use this to deploy the solution on the Azure platform.|

Installation Guides are available from the Fortinet Document Library:

  + [ FortiGate / FortiOS 6.0 Deploying auto scaling on Azure](https://docs.fortinet.com/vm/azure/fortigate/6.0/deploying-auto-scaling-on-azure/6.0.0)
  + [ FortiGate / FortiOS 6.2 Deploying auto scaling on Azure](https://docs.fortinet.com/vm/azure/fortigate/6.2/azure-cookbook/6.2.0/161167/deploying-auto-scaling-on-azure)
  + [ FortiGate / FortiOS 6.0 Deploying auto scaling on AWS](https://docs.fortinet.com/vm/aws/fortigate/6.0/deploying-auto-scaling-on-aws/6.0.0)
  + [ FortiGate / FortiOS 6.2 Deploying auto scaling on AWS](https://docs.fortinet.com/vm/aws/fortigate/6.2/aws-cookbook/6.2.0/543390/deploying-auto-scaling-on-aws-without-transit-gateway-integration)

# Support
Fortinet-provided scripts in this and other GitHub projects do not fall under the regular Fortinet technical support scope and are not supported by FortiCare Support Services.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to this project, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE) © Fortinet Technologies. All rights reserved.
