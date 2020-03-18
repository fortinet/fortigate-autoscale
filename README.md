# FortiGate Autoscale
A collection of **Node.js** modules and cloud-specific templates which support autoscale functionality for groups of FortiGate-VM instances on various cloud platforms.

This project contains the code and templates for the **Amazon AWS** and **Microsoft Azure** autoscale deployments. For autoscale on **AliCloud** see the [alicloud-autoscale](https://github.com/fortinet/alicloud-autoscale/) repository. For autoscale on **GCP** see the [fortigate-autoscale-gcp](https://github.com/fortinet/fortigate-autoscale-gcp) repository.

This project is organized in separate node modules:

 * [fortigate-autoscale/core](core) contains the core logic and provides an interface which can be extended to deal with the differences in cloud platform APIs.
 * [fortigate-autoscale/azure](azure) contains an implementation for the **Microsoft Azure** platform API and **Cosmos DB** storage backend.
 * [fortigate-autoscale/aws](aws) contains an implementation for the **AWS SDK** platform API with a **Dynamo DB** storage backend.

The project also contains a deployment script which can generate packages for each cloud service's *serverless* implementation.

## Supported platforms
This project supports autoscaling for the cloud platforms listed below:
* Amazon AWS
* Microsoft Azure

## Deployment packages

To generate local deployment packages:

  1. From the [project release page](https://github.com/fortinet/fortigate-autoscale/releases), download the source code (.zip or .tar.gz) for the latest 2.0 version.
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

## Deploy to AWS

<a href="https://us-west-2.console.aws.amazon.com/cloudformation/home?region=us-west-2#/stacks/quickcreate?templateUrl=https%3A%2F%2Fs3-us-west-2.amazonaws.com%2Ffortinet-github-aws-release-artifacts%2Ffortigate-autoscale%2Fmaster%2Ffortigate-autoscale-aws-cloudformation%2Ftemplates%2Fautoscale-new-vpc.template&param_S3BucketName=fortinet-github-aws-release-artifacts&param_S3KeyPrefix=fortigate-autoscale%2Fmaster%2Ffortigate-autoscale-aws-cloudformation%2F&stackName=fortigate-autoscale-demo&param_ResourceTagPrefix=fortigate-autoscale-demo" alt="Launch Stack" src="https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png"></a>

# Support
Fortinet-provided scripts in this and other GitHub projects do not fall under the regular Fortinet technical support scope and are not supported by FortiCare Support Services.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to this project, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE) © Fortinet Technologies. All rights reserved.
