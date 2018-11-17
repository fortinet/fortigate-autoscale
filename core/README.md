# FortiGate Autoscale - Core

`fortigate-autoscale/core` contains the core logic used to handle autoscaling groups of FortiGate VM instances in various cloud platforms.
The provided classes are extended for each cloud platform in the neighbouring modules.

The design metaphor for `fortigate-autoscale/core` is an api sandwich with cloud-specific layers on the outside and the core functionality in the middle.
Leveraging this api requires extending the following:

`CloudPlatform` is an _abstract_ class which implements all different cloud api functionality for each cloud
This class should be extended and all methods should be implemented

`AutoscaleHandler` is a _base_ class which handles the core logic and should be extended to handle events invoked by each cloud platform

The reference implementation is `multi-cloud-autoscale/aws`:

 * `AwsAutoscaleHandler` handles the lambda entry event and calls the base class methods to handle the core logic
 * `AwsPlatform` contains methods called by `AutoscaleHandler` to actually call into the aws api.

there is also a container class
`LifecycleItem` which  serves as a common container for the Lifecycle event data, and should work across all NoSql database implementations

Please see the Project [README](../README.md) file for more information

# Support
Note Fortinet-provided scripts (in this GitHub project and others) are not supported within regular Fortinet technical support scope.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to the Lambda scripts, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](../LICENSE) © Fortinet Technologies. All rights reserved.