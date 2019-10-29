'use strict';

/*
Author: Fortinet
*/

const request = require('request');
const crypto = require('crypto');
const MsRest = require('ms-rest-azure');
const azureStorage = require('azure-storage');
const MultiCloudCore = require('fortigate-autoscale-core');
var logger = new MultiCloudCore.DefaultLogger(console);
var credentials, token;


async function getNicsForVirtualMachine(virtualMachine, appVersion) {
    let networkInterfaces = await getResource(`${virtualMachine.id}/networkInterfaces`, appVersion);
    if (networkInterfaces.value) {
        virtualMachine.properties.networkProfile.networkInterfaces = networkInterfaces.value;
    }
    return virtualMachine;
}

class VirtualMachineScaleSetApiClient {
    constructor(subscriptionId, resourceGroupName, scaleSetName) {
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.scaleSetName = scaleSetName;
        this.apiVersion = '2018-06-01';
    }

    /**
     * Get a virtual machine, including its network interface details
     * @param {String} instanceId virtualmachine id
     */
    async getVirtualMachine(instanceId) {
        let resourceId = `/subscriptions/${this.subscriptionId}/resourceGroups/` +
            `${this.resourceGroupName}/providers/Microsoft.Compute/` +
            `virtualMachineScaleSets/${this.scaleSetName}/virtualMachines/${instanceId}`;
        try {
            let virtualMachine;
            virtualMachine = await getResource(resourceId, this.apiVersion);
            if (virtualMachine) {
                virtualMachine = await getNicsForVirtualMachine(virtualMachine, this.apiVersion);
            }
            return virtualMachine;
        } catch (error) {
            logger.warn('getVirtualMachine > error:', error);
            return null;
        }
    }

    /**
     * List all virtualmachines of a scale set in a resource group, from ARM.
     * @param {String} resourceGroup the resource group id
     * @param {String} scaleSetName the scale set name
     */
    async listVirtualMachines() {
        let resourceId = `/subscriptions/${this.subscriptionId}/resourceGroups/` +
        `${this.resourceGroupName}/providers/Microsoft.Compute/virtualMachineScaleSets/` +
        `${this.scaleSetName}/virtualMachines`;
        try {
            let response = await getResource(resourceId, this.apiVersion);
            return response.value;
        } catch (error) {
            logger.warn('listVirtualMachines > error:', error);
            return [];
        }
    }

    /**
     * get a virtual machine by a vmid
     * @param {String} vmId the vmid of a virtual machine
     */
    async getVirtualMachineByVmId(vmId) {
        let virtualMachines = await this.listVirtualMachines();
        for (let vm of virtualMachines) {
            try {
                if (vm.properties && vm.properties.vmId === vmId) {
                    vm = await getNicsForVirtualMachine(vm, this.apiVersion);
                    return vm;
                }
            } catch (error) {
                logger.warn('getVirtualMachineByVmId > error:', error);
                return null;
            }
        }
        logger.warn('getVirtualMachineByVmId > vm not found.');
        return null;
    }

    /* eslint-disable max-len */
    /**
     * Deletes virtual machines in a VM scale set.
     * @param {Array} instanceIds array of string. The virtual machine scale set instance ids.
     * @see https://docs.microsoft.com/en-us/rest/api/compute/virtualmachinescalesets/deleteinstances
     */
    /* eslint-enable max-len */
    async deleteInstances(instanceIds) {
        let resourceId = `/subscriptions/${this.subscriptionId}/resourceGroups/` +
            `${this.resourceGroupName}/providers/Microsoft.Compute/` +
            `virtualMachineScaleSets/${this.scaleSetName}/delete`;
        try {
            let result = await AzureArmApiCall('post', resourceId, {
                instanceIds: instanceIds
            }, this.apiVersion);
            if (result && (result.statusCode === 200 || result.statusCode === 202)) {
                return true;
            }
        } catch (error) {
            return false;
        }
    }

    /**
     * This lookup takes longer time to complete. a few round of http requests require.
     * can we optimize to reduce this ?
     * @param {String} resourceGroup resource group id
     * @param {String} scaleSetName scale set name
     * @param {String} ip primary ip address of an instance
     */
    async getVirtualMachineByIp(resourceGroup, scaleSetName, ip) {
        logger.info('calling getVirtualMachineByIp.');
        let found = {},
            virtualMachines = await this.listVirtualMachines(resourceGroup, scaleSetName);
        for (let vm of virtualMachines.value) {
            try {
                let nic = await getResource(vm.properties.id, '2017-12-01');
                let vmIp = nic.properties.ipConfigurations[0].properties.privateIPAddress;
                if (ip === vmIp) {
                    found = {
                        virtualMachine: vm,
                        networkInterface: nic
                    };
                    break;
                }
            } catch (error) {
                logger.warn(`getVirtualMachineByIp > error querying for networkInterface: ${JSON.stringify(error)}`); // eslint-disable-line max-len
            }
        }
        logger.info('called getVirtualMachineByIp.');
        return found;
    }
}

class CosmosDbApiClient {
    constructor(dbAccount, masterKey) {
        this.dbAccount = dbAccount;
        this.masterKey = masterKey;
    }

    /**
     * API ref https://docs.microsoft.com/en-us/rest/api/cosmos-db/list-databases
     */
    async listDataBases() {
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('get', 'dbs', '', date,
            this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        return await new Promise(function(resolve, reject) {
            // use GET here
            request.get({
                url: path,
                headers: headers,
                json: true
            }, function(error, response) {
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 200) {
                    resolve(response);
                } else {
                    reject(response);
                }
            });
        });
    }

    /**
     * API ref: https://docs.microsoft.com/en-us/rest/api/cosmos-db/create-a-database
     * @param {String} dbName the db name to create
     */
    async createDatabase(dbName) {
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('post', 'dbs', '', date,
            this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date,
            Accept: 'application/json'
        };
        return await new Promise(function(resolve, reject) {
            // use POST here
            request.post({
                url: path,
                headers: headers,
                body: {
                    id: dbName
                },
                json: true
            }, function(error, response) {
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 201 || response.statusCode === 409) {
                    resolve(response);
                } else {
                    reject(response);
                }
            });
        });
    }

    /**
     * API ref https://docs.microsoft.com/en-us/rest/api/cosmos-db/list-collections
     * @param {String} dbName the db name to list collections
     */
    async listCollections(dbName) {
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('get', 'colls', `dbs/${dbName}`, date,
            this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs/${dbName}/colls`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        return await new Promise(function(resolve, reject) {
            // use GET here
            request.get({
                url: path,
                headers: headers,
                json: true
            }, function(error, response) {
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 200) {
                    resolve(response);
                } else {
                    reject(response);
                }
            });
        });
    }

    /**
     * API ref: https://docs.microsoft.com/en-us/rest/api/cosmos-db/create-a-collection
     * @param {*} dbName the db name to create the collection
     * @param {*} collectionName the name of collectioin to create
     * @param {Array<String>} partitionKey the partition key for the collection
     */
    async createCollection(dbName, collectionName, partitionKey = null) {
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('post',
            'colls', `dbs/${dbName}`, date, this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs/${dbName}/colls`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date,
            Accept: 'application/json'
        };
        let body = {
            id: collectionName
        };
        if (partitionKey) {
            body.partitionKey = {
                paths: partitionKey.map(key => `/${key}`),
                kind: 'Hash'
            };
        }
        return await new Promise(function(resolve, reject) {
            // use post here
            request.post({
                url: path,
                headers: headers,
                body: body,
                json: true
            }, function(error, response) {
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 201 || response.statusCode === 409) {
                    resolve(response);
                } else {
                    reject(response);
                }
            });
        });
    }

    async simpleQueryDocument(dbName, collectionName, keyExp = null, filterExp = null,
        partitioning = null, options = null) {
        let queryObject = {
            query: `SELECT * FROM ${collectionName} c`,
            parameters: []
        };
        if (keyExp || Array.isArray(filterExp)) {
            queryObject.query += ' WHERE';
        }
        if (keyExp && keyExp.name && keyExp.value) {
            queryObject.query += ` c.${keyExp.name} = @keyValue`;
            queryObject.parameters.push({
                name: '@keyValue',
                value: keyExp.value
            });
        }
        if (Array.isArray(filterExp) && filterExp.length > 0) {
            let expressions = [];
            filterExp.forEach(exp => {
                if (queryObject.parameters.length > 0) {
                    queryObject.query += ' AND';
                }
                if (exp.name) {
                    queryObject.query += ` c.${exp.name} = @${exp.name}Value`;
                    queryObject.parameters.push({
                        name: `@${exp.name}Value`,
                        value: exp.value
                    });
                } else if (exp.keys && exp.exp) {
                    let expression = exp.exp;
                    exp.keys.forEach(key => {
                        expression = expression.replace(new RegExp(`:${key}`, 'g'), `c.${key}`);
                    });
                    expressions.push(expression);
                }
            });
            if (expressions.length > 0) {
                queryObject.query += ` ${expressions.join(' AND ')}`;
            }
        }
        if (options && options.order && options.order.by && options.order.direction) {
            let direction = options.order.direction.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            queryObject.query += ` ORDER BY c.${options.order.by} ${direction}`;
        }
        if (options && options.limit) {
            queryObject.query = queryObject.query.replace('SELECT * FROM', 'SELECT TOP ' +
            `${options.limit} * FROM`);
        }
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('post', 'docs',
                `dbs/${dbName}/colls/${collectionName}`, date, this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs/${dbName}/colls/` +
            `${collectionName}/docs`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date,
            'x-ms-documentdb-isquery': 'True',
            'x-ms-max-item-count': options && options.itemCount ? options.itemCount : -1,
            'Content-Type': 'application/query+json'
        };
        // eslint-disable-next-line max-len
        // see: https://docs.microsoft.com/en-us/rest/api/cosmos-db/querying-cosmosdb-resources-using-the-rest-api
        if (partitioning && partitioning.crossPartition) {
            headers['x-ms-documentdb-query-enablecrosspartition'] = true;
            if (partitioning.partitionKey) {
                headers['x-ms-documentdb-partitionkey'] = partitioning.partitionKey;
            }
        }

        return await new Promise((resolve,reject) => {
            request.post({
                url: path,
                headers: headers,
                body: JSON.stringify(queryObject)
            }, function(error, response) { // eslint-disable-line no-unused-vars
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 200) {
                    try {
                        let res = JSON.parse(response.body);
                        resolve(res.Documents);
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(response);
                }
            });
        });
    }
    /**
     * fire a CosmosDB query
     * @param {Object} resource  object {dbName, collectionName, queryObject,
     * partitioned (optional)}
     * @returns {Promise} a promise
     */
    async queryDocument(resource) {
        return await new Promise((resolve, reject) => {
            let date = (new Date()).toUTCString();
            let resourcePath = '',
                resourceType = '';
            if (resource.dbName !== undefined) {
                resourceType = 'dbs';
                resourcePath += `dbs/${resource.dbName}`;
            }
            if (resource.collectionName !== undefined) {
                if (resource.dbName === undefined) {
                // TODO: what should return by this reject?
                    logger.warn('called azureApiCosmosDbQuery: invalid resource ' +
                    `${JSON.stringify(resource)}`);
                    reject({});
                    return;
                }
                resourceType = 'colls';
                resourcePath += `/colls/${resource.collectionName}`;
            }
            resourceType = 'docs';
            // resourcePath += `/docs`;

            let _token = getAuthorizationTokenUsingMasterKey('post',
            resourceType, resourcePath, date, this.masterKey);
            let path = `https://${this.dbAccount}.documents.azure.com/${resourcePath}/docs`;
            let headers = {
                Authorization: _token,
                'x-ms-version': '2017-02-22',
                'x-ms-date': date,
                'x-ms-documentdb-isquery': 'True',
                'Content-Type': 'application/query+json'
            };
            if (resource.partitioned) {
                headers['x-ms-documentdb-query-enablecrosspartition'] = true;
                if (resource.partitionkey) {
                    headers['x-ms-documentdb-partitionkey'] = resource.partitionkey;
                }
            }
            let body = '';
            try {
                body = JSON.stringify({
                    query: resource.queryObject.query,
                    parameters: resource.queryObject.parameters || []
                });
            } catch (error) {
            // TODO: what should return by this reject?
                logger.warn('called azureApiCosmosDbQuery: invalid queryObject -> ' +
                `${JSON.stringify(resource.queryObject)}.`);
                reject({});
            }
            request.post({
                url: path,
                headers: headers,
                body: body
            }, function(error, response, _body) { // eslint-disable-line no-unused-vars
                if (error) {
                    logger.warn('called azureApiCosmosDbQuery > unknown error: ' +
                    `${JSON.stringify(response)}`);
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 200) {
                    logger.info(`azureApiCosmosDbQuery: ${resourcePath} retrieved.`);
                    try {
                        let res = JSON.parse(response.body);
                        logger.info('called azureApiCosmosDbQuery.');
                        resolve(res.Documents);
                    } catch (err) {
                        logger.warn('called azureApiCosmosDbQuery: ' +
                        'Documents object parsed failed.');
                        // TODO: what should return if failed to parse the documents?
                        reject({});
                    }
                } else if (response.statusCode === 304) {
                    logger.warn(`called azureApiCosmosDbQuery: ${resourcePath} not modified. ` +
                    'return empty response body.');
                    reject(response);
                } else if (response.statusCode === 404) {
                    logger.warn('called azureApiCosmosDbQuery: not found, ' +
                    `${resourcePath} was deleted.`);
                    reject(response);
                } else {
                    logger.warn('called azureApiCosmosDbQuery > other error: ' +
                    `${JSON.stringify(response)}`);
                    reject(response);
                }
            });
        });
    }

    /**
     * create a document
     * @see https://docs.microsoft.com/en-us/rest/api/cosmos-db/create-a-document
     * @param {String} dbName the db name to create this document
     * @param {String} collectionName the collection name to create this document
     * @param {Object} document the structure of the document to create.
     * @param {String} partitionKey must provide the name of the partition key specified
     * in the collection if the collection is created with a partition key. leave it null otherwise.
     * @param {boolean} replaced whether replace the document with the same key
     */
    async createDocument(dbName, collectionName, document, partitionKey = null, replaced = false) {
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('post',
            'docs', `dbs/${dbName}/colls/${collectionName}`, date, this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs/${dbName}/colls/` +
        `${collectionName}/docs`; // eslint-disable-line max-len
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        if (partitionKey) {
            headers['x-ms-documentdb-partitionkey'] = `["${document[partitionKey]}"]`;
        }
        if (replaced) {
            headers['x-ms-documentdb-is-upsert'] = true;
        }
        return await new Promise(function(resolve, reject) {
            // use post here
            request.post({
                url: path,
                headers: headers,
                body: document,
                json: true
            }, function(error, response, body) {
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 200) {
                    resolve(body);
                } else if (response.statusCode === 201) {
                    resolve(body);
                } else {
                    // 409: id conflict will be rejected too.
                    reject(response);
                }
            });
        });
    }

    /**
     * replace a document
     * @see https://docs.microsoft.com/en-us/rest/api/cosmos-db/replace-a-document
     * @param {String} dbName the db to create the document
     * @param {String} collectionName the collection to create the document
     * @param {Object} document the structure of the document. an document.id is required
     * @param {String} partitionKey must provide the name of the partition key specified
     * in the collection if the collection is created with a partition key. leave it null otherwise.
     */
    async replaceDocument(dbName, collectionName, document, partitionKey = null) {
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('put',
            'docs', `dbs/${dbName}/colls/${collectionName}/docs/${document.id}`, date,
            this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs/${dbName}/colls/` +
        `${collectionName}/docs/${document.id}`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        if (partitionKey) {
            headers['x-ms-documentdb-partitionkey'] = `["${document[partitionKey]}"]`;
        }

        return await new Promise(function(resolve, reject) {
            // use post here
            request.put({
                url: path,
                headers: headers,
                body: document,
                json: true
            }, function(error, response, body) {
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 200) {
                    resolve(body);
                } else {
                    // 409: id conflict will be rejected too.
                    // 413: Entity Too Large will be rejected too.
                    reject(response);
                }
            });
        });
    }

    /**
     * delete a document
     * @see https://docs.microsoft.com/en-us/rest/api/cosmos-db/delete-a-document
     * @param {String} dbName the db to create the document
     * @param {String} collectionName the collection to create the document
     * @param {String} documentId the document id. is required
     * @param {Boolean} partitioned if the table is partitioned
     */
    async deleteDocument(dbName, collectionName, documentId, partitioned = false) {
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('delete',
            'docs', `dbs/${dbName}/colls/${collectionName}/docs/${documentId}`, date,
            this.masterKey);
        let path = `https://${this.dbAccount}.documents.azure.com/dbs/${dbName}/colls/` +
        `${collectionName}/docs/${documentId}`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        if (partitioned) {
            headers['x-ms-documentdb-partitionkey'] = `["${documentId}"]`;
        }

        return await new Promise(function(resolve, reject) {
            // use delete here
            request.delete({
                url: path,
                headers: headers,
                json: true
            }, function(error, response, body) {
                if (error) {
                    reject(error);
                } else if (response.statusCode === 403) {
                    reject({
                        statusCode: 403,
                        message: response.body && response.body.message ?
                            response.body.message : 'Access Forbidden.'
                    });
                } else if (response.statusCode === 204) {
                    resolve(body);
                } else {
                    // 404: The document is not found.
                    reject(response);
                }
            });
        });
    }
}

class ComputeApiClient {
    constructor(subscriptionId, resourceGroupName) {
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.refVmssApiClient = [];
    }

    refVirtualMachineScaleSet(scaleSetName) {
        if (!this.refVmssApiClient[scaleSetName]) {
            this.refVmssApiClient[scaleSetName] = new VirtualMachineScaleSetApiClient(
                this.subscriptionId, this.resourceGroupName, scaleSetName
            );
        }
        return this.refVmssApiClient[scaleSetName];
    }
}

class StorageApiClient {
    constructor(storageAccount, accessKey) {
        this.storageAccount = storageAccount;
        this.accessKey = accessKey;
        this.blobService = null;
    }

    /**
     * the blob service requires two process env vriables:
     * process.env.AZURE_STORAGE_ACCOUNT
     * process.env.AZURE_STORAGE_ACCESS_KEY
     * @returns {blobService} azure blob service
     */
    refBlobService() {
        if (!process.env.AZURE_STORAGE_ACCOUNT ||
            process.env.AZURE_STORAGE_ACCOUNT !== this.storageAccount) {
            process.env.AZURE_STORAGE_ACCOUNT = this.storageAccount;
        }
        if (!process.env.AZURE_STORAGE_ACCESS_KEY ||
            process.env.AZURE_STORAGE_ACCESS_KEY !== this.accessKey) {
            process.env.AZURE_STORAGE_ACCESS_KEY = this.accessKey;
        }
        if (!this.blobService) {
            this.blobService = azureStorage.createBlobService();
        }
        return this.blobService;
    }
}

/**
 * Call an ARM api
 * this function doesn't do error handling. The caller must do error handling.
 * @param {String} method request method in lower case: get | post
 * @param {String} resourceId resource Id
 * @param {JSON} body request body
 * @param {String} apiVersion a proper api version string
 */
async function AzureArmApiCall(method, resourceId, body, apiVersion) {
    const url =
        `https://management.azure.com${resourceId}?api-version=${apiVersion}`;
    return await AzureArmRequest(method, url, body);
}

function AzureArmRequest(method, url, body = null) {
    return new Promise((resolve, reject) => {
        let callback = (error, response) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(response);
                }
            },
            req = {
                url: url,
                headers: {
                    Authorization: `Bearer ${token}`
                },
                json: true
            };
        if (body) {
            req.body = body;
        }
        switch (method.toLowerCase()) {
            case 'get':
                request.get(req, callback);
                break;
            case 'post':
                request.post(req, callback);
                break;
            default:
                reject(new Error(`unknown method: ${method}`));
                break;
        }
    });
}

/**
 * will throw error if there is any.
 * @param {String} url url to fetch resource
 * @returns {Promise} a promise
 */
function AzureArmGet(url) {
    return new Promise((resolve, reject) => {
        logger.info(`calling AzureArmGet url: ${url}`);
        request.get({
            url: url,
            headers: {
                Authorization: `Bearer ${token}`
            }
        }, function(error, response, body) {
            // TODO: handle error.
            if (error) {
                logger.warn(`called AzureArmGet but returned unknown error ${JSON.stringify(error)}`); // eslint-disable-line max-len
                reject(error);
            } else {
                if (response.statusCode === 200) {
                    resolve(body);
                } else {
                    logger.warn(`called AzureArmGet but returned error (code: ${response.statusCode}) ${response.body}`); // eslint-disable-line max-len
                    reject(response);
                }
            }
        });
    });
}

/**
 * Get a resource by a given id (aka: the full path of an ARM)
 * this function doesn't do error handling. The caller must do error handling.
 * @param {String} resourceId resource Id
 * @param {String} apiVersion a proper api version string
 */
async function getResource(resourceId, apiVersion) {
    const url =
        `https://management.azure.com${resourceId}?api-version=${apiVersion}`;
    try {
        let response = await AzureArmGet(url);
        return JSON.parse(response);
    } catch (error) {
        if (error.statusCode && error.statusCode === 404) {
            return null;
        } else {
            throw error;
        }
    }
}

/* eslint-disable max-len */
/**
 * Do authentication and authorization with Azure Service Principal for this client and store
 * in the client class.
 * @see https://docs.microsoft.com/en-us/azure/azure-resource-manager/resource-group-create-service-principal-portal
 * @param {String} app_id the application id
 * @param {String} app_secret the application secret
 * @param {String} tenant_id the tenant id (aka: Active Directory > directory id)
 * @returns {Promise} a promise
 */
/* eslint-enable max-len */
function authWithServicePrincipal(app_id, app_secret, tenant_id) {
    return new Promise(function(resolve, reject) {
        logger.info('calling authWithServicePrincipal.');
        MsRest.loginWithServicePrincipalSecret(app_id, app_secret, tenant_id,
            (error, _credentials) => {
                if (error) {
                    logger.error(`authWithServicePrincipal > error: ${error.message}`);
                    reject(error.message);
                    return;
                }
                credentials = _credentials.tokenCache._entries[0];
                token = credentials.accessToken;
                logger.info('called authWithServicePrincipal.');
                resolve(true);
            });
    });
}


function getAuthorizationTokenUsingMasterKey(verb, resourceType, resourceId, date, _masterKey) {
    var key = new Buffer(_masterKey, 'base64');

    var text = `${(verb || '').toLowerCase()}\n${
        (resourceType || '').toLowerCase()}\n${
        resourceId || ''}\n${
        date.toLowerCase()}\n` +
        '' + '\n';

    var body = new Buffer(text, 'utf8');
    var signature = crypto.createHmac('sha256', key).update(body).digest('base64');

    var MasterToken = 'master';

    var TokenVersion = '1.0';

    return encodeURIComponent(`type=${MasterToken}&ver=${TokenVersion}&sig=${signature}`);
}

exports.authWithServicePrincipal = authWithServicePrincipal;

exports.Compute = {
    ApiClient: ComputeApiClient
};

exports.CosmosDB = {
    ApiClient: CosmosDbApiClient
};

exports.Storage = {
    ApiClient: StorageApiClient
};

exports.useLogger = function(lg) {
    logger = lg;
};
