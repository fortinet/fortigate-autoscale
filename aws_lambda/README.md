# Fortigate Autoscale - AWS Lambda

This is a complete Fortigate Autoscale handler script source code for AWS Cloud Platform. A 'simple' autoscaling setup which takes advantage of the 6.0.1 `auto-scale` callback feature to automate autoscaling group config syncronization.

## Install

To make a deployment package, go to the root directory of Fortigate Autoscale project and run `npm run build-aws-lambda`.

The entry point of this Lambda function is: index.AutoscaleHandler.

## Environment Variables

| Variable Name | Type | Description |
| ------ | ------ | ------ |
| API_GATEWAY_NAME | Text | The API Gateway name tied to this lambda function.|
| API_GATEWAY_RESOURCE_NAME | Text | (Optional) A PI Gateway stage name. Additional section will be added to the API Gateway url, reflect on the ***{resource}*** part. Example: https://{api}.execute-api.{region}.amazonaws.com/{stage}/***{resource}***/get-config|
| API_GATEWAY_STAGE_NAME | Text | (Optional) A PI Gateway stage name. Additional section will be added to the API Gateway url, reflect on the ***{stage}*** part. Example: https://{api}.execute-api.{region}.amazonaws.com/***{stage}***/{resource}/get-config|
| EXPIRE_LIFECYCLE_ENTRY | Integer | The Lifecycle Item expiry time in seconds. Default to 3600. |
| MASTER_FORTIGATE_CONFIG | Text | Configuration file to provide to the master fortigate. The variable substitution expression ***${CALLBACK_URL}*** which will be replaced with the internal api-gateway endpoint used to complete the autoscale lifecycle for each fortigate slave |
| UNIQUE_ID | Text | A unique id for the function resource such as DB name. |

## Scope and Limits

This Lambda function is inteded to use as a component of the fortigate Autoscale solution for AWS. Please refer to the main project at https://github.com/fortinet/fortigate-autoscale for more information.

## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE) © Fortinet Technologies. All rights reserved.