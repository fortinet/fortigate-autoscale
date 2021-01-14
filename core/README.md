# FortiGate Autoscale - Core

`fortigate-autoscale/core` contains the core logic used to handle autoscaling groups for various cloud platforms.

The design metaphor for `fortigate-autoscale/core` is an API sandwich with cloud-specific layers on the outside and core functionality in the middle. Leveraging this API requires extending the following classes:

* `AutoscaleHandler` is a _base_ class which handles the core logic. This class should be extended to handle events invoked by each cloud platform.

* `CloudPlatform` is an _abstract_ class which implements cloud API functionality for each cloud. This class should be extended with methods implemented as needed for the platform.

There is also a container class `LifecycleItem` which is currently used only by AWS. This class serves as a common container for Lifecycle event data.

For more information, please refer to the project [README](https://github.com/fortinet/fortigate-autoscale/blob/main/README.md).

# Support
Fortinet-provided scripts in this and other GitHub projects do not fall under the regular Fortinet technical support scope and are not supported by FortiCare Support Services.
For direct issues, please refer to the [Issues](https://github.com/fortinet/fortigate-autoscale/issues) tab of this GitHub project.
For other questions related to this project, contact [github@fortinet.com](mailto:github@fortinet.com).

## License
[License](https://github.com/fortinet/fortigate-autoscale/blob/master/LICENSE) © Fortinet Technologies. All rights reserved.
