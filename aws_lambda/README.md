# FortiGate Autoscale - AWS Lambda

This is a complete FortiGate Autoscale handler script source code for AWS Cloud Platform. A 'simple' autoscaling setup which takes advantage of the 6.0.3 `auto-scale` callback feature to automate autoscaling group config syncronization.

## Install

To make a deployment package, go to the root directory of FortiGate Autoscale project and run `npm run build-aws-lambda`.

The entry point of this Lambda function is: index.AutoscaleHandler.

## Environment Variables

| Variable Name | Type | Description |
| ------ | ------ | ------ |
| API_GATEWAY_NAME | Text | The API Gateway name tied to this lambda function.|
| API_GATEWAY_RESOURCE_NAME | Text | A PI Gateway stage name. Additional section will be added to the API Gateway url, reflect on the ***{resource}*** part. Example: https://{api}.execute-api.{region}.amazonaws.com/{stage}/***{resource}***/get-config|
| API_GATEWAY_STAGE_NAME | Text | A PI Gateway stage name. Additional section will be added to the API Gateway url, reflect on the ***{stage}*** part. Example: https://{api}.execute-api.{region}.amazonaws.com/***{stage}***/{resource}/get-config|
| AWS_REGION | Text | The region that this lambda function serves for.|
| AUTO_SCALING_GROUP_NAME | Text | The auto scaling group name tied to this lambda function.|
| CUSTOM_ID | Text | The custom string this lambda function uses to look for resources such as DynamoDB tables.|
| EXPIRE_LIFECYCLE_ENTRY | Integer | The Lifecycle Item expiry time in seconds. Default to 300. |
| FORTIGATE_ADMIN_PORT | Text | FortiGate admin port. Will be put in FortiGate bootstrapping config when spinning up each new FortiGate instance. |
| FORTIGATE_INTERNAL_ELB_DNS | Text | (Optional) The internal elastic load balancer name tied to this lambda function. Default is empty string.|
| FORTIGATE_PSKSECRET | Text | FortiGate PSK secret for HA feature. Will be put in FortiGate bootstrapping config when spinning up each new FortiGate instance. |
| STACK_ASSETS_S3_BUCKET_NAME | Text | The S3 bucket that stores the solution related assets. Especially the necessary configset files in ***configset*** folder|
| STACK_ASSETS_S3_KEY_PREFIX | Text | The S3 bucket key to the assets folder in the S3 bucket defined in ***STACK_ASSETS_S3_BUCKET_NAME***.|
| UNIQUE_ID | Text | An aws-regionally unique id for the solution resources such as DynamoDB name, where this lambda function uses to look for those resources.|
| VPC_ID | Text | The VPC ID tied to this lambda function and solution resources.|

## IAM Policies
This lambda function requires these IAM policies to operate.
### AWS Managed Policies
| Name | ARN |
| ------ | ------ |
| AmazonS3ReadOnlyAccess | arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess |
| AWSLambdaExecute | arn:aws:iam::aws:policy/AWSLambdaExecute |
### Custom Policies
Curly braces - including the capitalized label between - in ARN examples are just place holders and should be omitted.
| Action | Effect | Resource (in ARN format) |
| ------ | ------ | ------ |
| dynamodb:CreateTable, dynamodb:DescribeTable, dynamodb:Scan, dynamodb:Query, dynamodb:DeleteItem, dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem | Allow | The DynamoDB tables created in the solution stack using Cloud Formation templates. ARN example: arn:aws:dynamodb:***{AWS_REGION}***:***{AWS_ACCOUNT_ID}***:table/***{TABLE_NAME}***|
| autoscaling:CompleteLifecycleAction, autoscaling:SetDesiredCapacity, autoscaling:SetInstanceProtection | Allow | The Auto Scaling Group created in the solution stack using Cloud Formation templates. ARN example: arn:aws:autoscaling:***{AWS_REGION}***:***{AWS_ACCOUNT_ID}***:autoScalingGroup:*:autoScalingGroupName/***{GROUP_NAME}***|
| autoscaling:DescribeAutoScalingInstances, ec2:DescribeInstances, ec2:DescribeVpcs, ec2:DescribeInstanceAttribute | Allow | * |
| apigateway:GET | Allow | All API Gateway in a curtain region. ARN example: arn:aws:apigateway:***{AWS_REGION}***::* |
|s3:GetObject | Allow | Files under assets folder in the solution related S3 bucket. ARN example: arn:aws:s3:::***{BUCKET_NAME}***/***{KEY_PREFIX}***assets/configset/* |

## Scope and Limits

This Lambda function is inteded to use as a component of the FortiGate Autoscale solution for AWS. Please refer to the main project at https://github.com/fortinet/fortigate-autoscale for more information.

## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE) © Fortinet Technologies. All rights reserved.
