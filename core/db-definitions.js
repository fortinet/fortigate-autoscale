'use strict';

/*
FortiGate Autoscale AWS DynamoDB table definitions (1.0.0)
Author: Fortinet
*/
exports = module.exports;
const DB = {
    LIFECYCLEITEM: {
        AttributeDefinitions: [
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'actionName',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'instanceId',
                KeyType: 'HASH'
            },
            {
                AttributeName: 'actionName',
                KeyType: 'RANGE'
            }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 1,
            WriteCapacityUnits: 1
        },
        TableName: 'FortiGateLifecycleItem',
        AdditionalAttributeDefinitions: []
    },
    AUTOSCALE: {
        AttributeDefinitions: [
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'instanceId',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 1,
            WriteCapacityUnits: 1
        },
        TableName: 'FortiGateAutoscale',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'asgName',
                AttributeType: 'S'
            },
            {
                AttributeName: 'heartBeatLossCount',
                AttributeType: 'N'
            },
            {
                AttributeName: 'heartBeatInterval',
                AttributeType: 'N'
            },
            {
                AttributeName: 'nextHeartBeatTime',
                AttributeType: 'N'
            },
            {
                AttributeName: 'masterIp',
                AttributeType: 'S'
            },
            {
                AttributeName: 'syncState',
                AttributeType: 'S'
            }
        ]
    },
    ELECTION: {
        AttributeDefinitions: [
            {
                AttributeName: 'asgName',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'asgName',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'FortiGateMasterElection',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'asgName',
                AttributeType: 'S'
            },
            {
                AttributeName: 'ip',
                AttributeType: 'S'
            },
            {
                AttributeName: 'vpcId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'subnetId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'voteEndTime',
                AttributeType: 'N'
            },
            {
                AttributeName: 'voteState',
                AttributeType: 'S'
            }
        ]
    },
    FORTIANALYZER: {
        AttributeDefinitions: [
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'instanceId',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'FortiAnalyzer',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'serialNumber',
                AttributeType: 'S'
            },
            {
                AttributeName: 'ip',
                AttributeType: 'S'
            },
            {
                AttributeName: 'vip',
                AttributeType: 'S'
            },
            {
                AttributeName: 'master',
                AttributeType: 'BOOL'
            },
            {
                AttributeName: 'peers',
                AttributeType: 'S'
            }
        ]
    },
    SETTINGS: {
        AttributeDefinitions: [
            {
                AttributeName: 'settingKey',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'settingKey',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'Settings',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'settingValue',
                AttributeType: 'S'
            },
            {
                AttributeName: 'description',
                AttributeType: 'S'
            },
            {
                AttributeName: 'jsonEncoded',
                AttributeType: 'S'
            },
            {
                AttributeName: 'editable',
                AttributeType: 'S'
            }
        ]
    },
    NICATTACHMENT: {
        AttributeDefinitions: [
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'instanceId',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'NicAttachment',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'nicId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'attachmentState',
                AttributeType: 'S'
            }
        ]
    },
    VMINFOCACHE: {
        AttributeDefinitions: [
            {
                AttributeName: 'id',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'id',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'VmInfoCache',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'vmId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'asgName',
                AttributeType: 'S'
            },
            {
                AttributeName: 'info',
                AttributeType: 'S'
            },
            {
                AttributeName: 'timestamp',
                AttributeType: 'N'
            },
            {
                AttributeName: 'expireTime',
                AttributeType: 'N'
            }
        ]
    },
    LICENSESTOCK: {
        AttributeDefinitions: [
            {
                AttributeName: 'checksum',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'checksum',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'LicenseStock',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'fileName',
                AttributeType: 'S'
            },
            {
                AttributeName: 'algorithm',
                AttributeType: 'S'
            }
        ]
    },
    LICENSEUSAGE: {
        AttributeDefinitions: [
            {
                AttributeName: 'id',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'id',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'LicenseUsage',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'id',
                AttributeType: 'S'
            },
            {
                AttributeName: 'checksum',
                AttributeType: 'S'
            },
            {
                AttributeName: 'fileName',
                AttributeType: 'S'
            },
            {
                AttributeName: 'algorithm',
                AttributeType: 'S'
            },
            {
                AttributeName: 'scalingGroupName',
                AttributeType: 'S'
            },
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'assignedTime',
                AttributeType: 'N'
            },
            {
                AttributeName: 'blobKey',
                AttributeType: 'S'
            }
        ]
    },
    CUSTOMLOG: {
        AttributeDefinitions: [
            {
                AttributeName: 'id',
                AttributeType: 'S'
            },{
                AttributeName: 'timestamp',
                AttributeType: 'N'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'id',
                KeyType: 'HASH'
            },{
                AttributeName: 'timestamp',
                KeyType: 'RANGE'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'CustomLog',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'logContent',
                AttributeType: 'S'
            }
        ]
    },
    VPNATTACHMENT: {
        AttributeDefinitions: [
            {
                AttributeName: 'instanceId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'publicIp',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'instanceId',
                KeyType: 'HASH'
            },
            {
                AttributeName: 'publicIp',
                KeyType: 'RANGE'
            }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
        TableName: 'VpnAttachment',
        AdditionalAttributeDefinitions: [
            {
                AttributeName: 'customerGatewayId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'vpnConnectionId',
                AttributeType: 'S'
            },
            {
                AttributeName: 'configuration',
                AttributeType: 'S'
            }
        ]
    }

};

exports.getTables = (custom_id, unique_id, excludedKeys = null) => {
    let tables = {},
        prefix = () => { return custom_id ? `${custom_id}-` : '' },
        suffix = () => { return unique_id ? `-${unique_id}` : '' };
    Object.keys(DB).forEach(itemName => {
        if (!excludedKeys || Array.isArray(excludedKeys) && !excludedKeys.includes(itemName)) {
            let table = {};
            table.AttributeDefinitions = DB[itemName].AttributeDefinitions;
            table.KeySchema = DB[itemName].KeySchema;
            table.ProvisionedThroughput = DB[itemName].ProvisionedThroughput;
            table.TableName = prefix() + DB[itemName].TableName + suffix();
            table.AdditionalAttributeDefinitions = DB[itemName].AdditionalAttributeDefinitions;
            tables[itemName] = table;
        }
    });
    return tables;
};

exports.getTableSchema = (tables, tableName) => {
    if (!tables || !tables.hasOwnProperty(tableName)) {
        return null;
    }
    let schema = {};
    schema.AttributeDefinitions = tables[tableName].AttributeDefinitions;
    schema.KeySchema = tables[tableName].KeySchema;
    schema.TableName = tables[tableName].TableName;
    schema.ProvisionedThroughput = tables[tableName].ProvisionedThroughput;
    return schema;
};
