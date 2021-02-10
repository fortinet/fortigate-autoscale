# FortiGate Autoscale for Azure

A collection of **Node.js** modules and cloud-specific templates which support auto scaling functionality for groups of FortiGate-VM instances on various cloud platforms.

This project contains the code and templates for the **Microsoft Azure** deployment. For deployment on other cloud platforms, visit the relevant repository:
* The **AliCloud** deployment is in the  [alicloud-autoscale](https://github.com/fortinet/alicloud-autoscale/) repository.
* The **Amazon AWS** deployment is in the [fortigate-autoscale-aws](https://github.com/fortinet/fortigate-autoscale-aws) repository.
* The **GCP** deployment is in the [fortigate-autoscale-gcp](https://github.com/fortinet/fortigate-autoscale-gcp) repository.

This project is organized in separate node modules:

 * [fortigate-autoscale/core](core) contains the core logic and provides an interface that can be extended to deal with the differences in cloud platform APIs.
 * [fortigate-autoscale/azure](azure) contains an implementation for the **Microsoft Azure** platform API and **Cosmos DB** storage backend.

The project also contains a deployment script that can generate packages for each cloud service's *serverless* implementation.

## Deployment packages
To generate local deployment packages:

  1. From the [project release page](https://github.com/fortinet/fortigate-autoscale/releases), download the source code (.zip or .tar.gz) for the latest version.
  2. Extract the source code.
  3. Run `npm run build` at the project root directory.

Deployment packages as well as source code will be available in the **dist** directory.

| Package Name                                      | Description                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| fortigate-autoscale.zip                           | Source code for the entire project.                                    |
| fortigate-autoscale-azure-funcapp.zip             | Source code for the FortiGate Autoscale handler - Azure function.      |
| fortigate-autoscale-azure-template-deployment.zip | Azure template. Use this to deploy the solution on the Azure platform. |

## Deployment guide
A deployment guide is available from the Fortinet Document Library:

  + [ FortiGate / FortiOS 6.4 / Deploying auto scaling on Azure](https://docs.fortinet.com/vm/azure/fortigate/6.4/azure-cookbook/6.4.0/161167/deploying-auto-scaling-on-azure)

# Launch a demo
FortiGate Autoscale for Azure requires the deployment of two templates in sequence into the same resource group.
| Step | Action |
|------|---------------|
| 1 | Deploy the stage 1 template using the [deployment parameters file](https://github.com/fortinet/fortigate-autoscale/blob/main/azure_template_deployment/templates/deploy_fortigate_autoscale.hybrid_licensing.params.json).<br><a href="https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Ffortinet%2Ffortigate-autoscale%2Fmaster%2Fazure_template_deployment%2Ftemplates%2Fdeploy_fortigate_autoscale.hybrid_licensing.json" target="_blank"><img src="http://azuredeploy.net/deploybutton.png"/></a> |
| 2 | Wait for the stage 1 deployment to complete. |
| 3 | Deploy the stage 2 template using the same [deployment parameters file](https://github.com/fortinet/fortigate-autoscale/blob/main/azure_template_deployment/templates/deploy_fortigate_autoscale.hybrid_licensing.params.json) with the same parameter values used in step 1.<br><a href="https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Ffortinet%2Ffortigate-autoscale%2Fmaster%2Fazure_template_deployment%2Ftemplates%2Fdeploy_fortigate_autoscale.hybrid_licensing.json" target="_blank"><img src="http://azuredeploy.net/deploybutton.png"/></a> |

Refer to the [documentation](https://docs.fortinet.com/vm/azure/fortigate/6.4/azure-cookbook/6.4.0/161167/deploying-auto-scaling-on-azure) for descriptions of the deployment parameters file.

## Project development history
| Version | Details | Documentation |
| ------- | ------- | ------------- |
| 3.x (latest) | The AWS portion of this project has been moved to [fortigate-autoscale-aws](https://github.com/fortinet/fortigate-autoscale-aws). Going forward, this project will be maintained for Azure only. | [ FortiGate / FortiOS 6.2 / Deploying auto scaling on Azure](https://docs.fortinet.com/vm/azure/fortigate/6.2/azure-cookbook/6.2.0/161167/deploying-auto-scaling-on-azure) |
| 2.0 | Added support for Hybrid Licensing (any combination of BYOL and/or PAYG instances). | A PDF for AWS is available in the 2.0 branch.<br/>[deploying-auto-scaling-on-aws-2.0.9.pdf](https://github.com/fortinet/fortigate-autoscale/blob/2.0/docs/deploying-auto-scaling-on-aws-2.0.9.pdf) |
| 1.0 | Supports auto scaling for PAYG instances only.  | PDFs for AWS and for Azure are available in the 1.0.6 branch.<br/>[deploying-auto-scaling-on-aws-1.0.pdf](https://github.com/fortinet/fortigate-autoscale/blob/1.0/docs/deploying-auto-scaling-on-aws-1.0.pdf)<br/>[deploying-auto-scaling-on-azure-1.0.pdf](https://github.com/fortinet/fortigate-autoscale/blob/1.0/docs/deploying-auto-scaling-on-azure-1.0.pdf) |

# Support
Fortinet-provided scripts in this and other GitHub projects do not fall under the regular Fortinet technical support scope and are not supported by FortiCare Support Services.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to this project, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](./LICENSE) © Fortinet Technologies. All rights reserved.
