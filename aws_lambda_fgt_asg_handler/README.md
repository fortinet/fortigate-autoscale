# FortiGate Autoscale for AWS Lambda
This folder contains source code for the FortiGate Autoscale handler for the AWS Cloud Platform. A 'simple' autoscaling setup which takes advantage of the FortiOS `auto-scale` callback feature to automate synchronization of the autoscaling group configuration.
The entry point of this AWS Lambda function is **index.AutoscaleHandler**.
# Requirements
This function requires:
* FortiOS 6.0.3 or higher
* An AWS account
## Deployment Package
To generate a local deployment package:
  1. Clone the FortiGate Autoscale project.
  2. Run `npm run build-aws-lambda` at the project root directory.
The deployment package will be available in the **dist** directory.
## Environment Variables
This Lambda function has the following configurable environment variables.

| Variable Name | Type | Description |
| ------ | ------ | ------ |
| API_GATEWAY_NAME | Text | The API Gateway name tied to this Lambda function.|
| API_GATEWAY_RESOURCE_NAME | Text | The API Gateway resource name tied to this Lambda function. An additional section will be added to the API Gateway URL, and will be reflected in the ***API_GATEWAY_RESOURCE_NAME*** part of the URL.<br>Example: https://{api}.execute-api.***AWS_REGION***.amazonaws.com/***API_GATEWAY_STAGE_NAME***/***API_GATEWAY_RESOURCE_NAME***/get-config|
| API_GATEWAY_STAGE_NAME | Text | The API Gateway stage name tied to this Lambda function. An additional section will be added to the API Gateway URL, reflected in the ***API_GATEWAY_STAGE_NAME*** part of the URL.<br>Example: https://{api}.execute-api.***AWS_REGION***.amazonaws.com/***API_GATEWAY_STAGE_NAME***/***API_GATEWAY_RESOURCE_NAME***/get-config|
| AWS_REGION | Text | The AWS region that this Lambda function serves.|
| AUTO_SCALING_GROUP_NAME | Text | The autoscaling group name tied to this Lambda function.|
| CUSTOM_ID | Text | The custom string this Lambda function uses to look for resources such as DynamoDB tables.|
| EXPIRE_LIFECYCLE_ENTRY | Integer | The Lifecycle item expiry time in seconds. The default value is 300. |
| FORTIGATE_ADMIN_PORT | Text | The FortiGate admin port. Each new FortiGate instance will have this added to the FortiGate bootstrapping configuration. |
| FORTIGATE_INTERNAL_ELB_DNS | Text | (Optional) The internal elastic load balancer name tied to this Lambda function. The default value is an empty string.|
| FORTIGATE_PSKSECRET | Text | The FortiGate PSK secret for the HA feature. Each new FortiGate instance will have this added to the FortiGate bootstrapping configuration.<br>**Note:** Changes to the PSK Secret after FortiGate Autoscale has been deployed are not reflected in the <cloud> function. For new instances to be spawned with the changed PSK Secret, the environment variable FORTIGATE_PSKSECRET will need to be manually updated.|
| STACK_ASSETS_S3_BUCKET_NAME | Text | The S3 Bucket that stores the solution related assets. For example, the S3 Bucket where you uploaded the configset.|
| STACK_ASSETS_S3_KEY_PREFIX | Text | The S3 Bucket key to the *assets* folder in the S3 Bucket defined in ***STACK_ASSETS_S3_BUCKET_NAME***.|
| UNIQUE_ID | Text | An AWS-regionally unique ID for solution resources such as the DynamoDB name. This ID is used to look for specific solution resources.|
| VPC_ID | Text | The VPC ID tied to this Lambda function and its solution resources.|
## IAM Policies
This AWS Lambda function requires the policies listed below.

### AWS Managed Policies
| Name | ARN |
| ------ | ------ |
| AmazonS3ReadOnlyAccess | arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess |
| AWSLambdaExecute | arn:aws:iam::aws:policy/AWSLambdaExecute |
### Custom Policies
| Action | Effect | Resource (in ARN format) |
| ------ | ------ | ------ |
| dynamodb:CreateTable, dynamodb:DescribeTable, dynamodb:Scan, dynamodb:Query, dynamodb:DeleteItem, dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem | Allow | The DynamoDB tables created in the solution stack using CloudFormation templates.<br>ARN example: arn:aws:dynamodb:***AWS_REGION***:***AWS_ACCOUNT_ID***:table/***TABLE_NAME***|
| autoscaling:CompleteLifecycleAction, autoscaling:SetDesiredCapacity, autoscaling:SetInstanceProtection | Allow | The autoscaling group created in the solution stack using CloudFormation templates.<br>ARN example: arn:aws:autoscaling:***AWS_REGION***:***AWS_ACCOUNT_ID***:autoScalingGroup:\*:autoScalingGroupName/***AUTO_SCALING_GROUP_NAME***|
| autoscaling:DescribeAutoScalingInstances, ec2:DescribeInstances, ec2:DescribeVpcs, ec2:DescribeInstanceAttribute | Allow | \* |
| apigateway:GET | Allow | All API Gateways in a certain region.<br>ARN example: arn:aws:apigateway:***AWS_REGION***::\* |
| s3:GetObject | Allow | Contents of the **assets** folder for a particular solution in an S3 Bucket, as specified by the **STACK_ASSETS_S3_KEY_PREFIX**.<br>ARN example: arn:aws:s3:::***STACK_ASSETS_S3_BUCKET_NAME***/***STACK_ASSETS_S3_KEY_PREFIX***/assets/configset/* |
## Scope and Limits
This Lambda function is intended for use as a component of the FortiGate Autoscale solution for AWS.
For more information, please refer to the project [README](https://github.com/fortinet/fortigate-autoscale/blob/master/README.md).
# Support
Fortinet-provided scripts in this and other GitHub projects do not fall under the regular Fortinet technical support scope and are not supported by FortiCare Support Services.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to this project, contact [github@fortinet.com](mailto:github@fortinet.com).
## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE) © Fortinet Technologies. All rights reserved.
