# AWS Cloud Formation cfn-response with asynchronous-call capability

This file is initially created as part of a Fortinet project and this package is open source and free for use under the [License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE). Ownership of this package will be transferred to the Fortinet npm account in the future.


# Functions

## send(event, context, responseStatus, responseData, physicalResourceId, noEcho)
This is a regular call.
Please find detailed docs & description here in: [AWS Lambda Function Code](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-code.html)

## sendAsync(event, context, responseStatus, responseData, physicalResourceId, noEcho)
This is an asynchronous call of the **send** function.

## Copyright & License
Please see a full license and notice statement here in: [License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE), [copyright notice](./NOTICE)
© Fortinet Technologies. All rights reserved.
