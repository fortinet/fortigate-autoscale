'use strict';

/*
FortiGate Autoscale AWS DynamoDB table definitions (1.0.0-beta)
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
    }

};

exports.getTables = (custom_id, unique_id) => {
    let tables = {};
    Object.keys(DB).forEach(itemName => {
        let table = {};
        table.AttributeDefinitions = DB[itemName].AttributeDefinitions;
        table.KeySchema = DB[itemName].KeySchema;
        table.ProvisionedThroughput = DB[itemName].ProvisionedThroughput;
        table.TableName = `${custom_id}-${DB[itemName].TableName}-${unique_id}`;
        table.AdditionalAttributeDefinitions = DB[itemName].AdditionalAttributeDefinitions;
        tables[itemName] = table;
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
