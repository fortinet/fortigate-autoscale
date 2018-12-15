'use strict';

/*
Author: Fortinet
*/

const request = require('request');
const crypto = require('crypto');
const MsRest = require('ms-rest-azure');
const MultiCloudCore = require('fortigate-autoscale-core');
var logger = new MultiCloudCore.DefaultLogger(console);
var credentials, token, subscription;

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
                logger.error(`called AzureArmGet but returned unknown error ${JSON.stringify(error)}`); // eslint-disable-line max-len
                reject(error);
            } else {
                if (response.statusCode === 200) {
                    resolve(body);
                } else {
                    logger.error(`called AzureArmGet but returned error (code: ${response.statusCode}) ${response.body}`); // eslint-disable-line max-len
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
    let response = await AzureArmGet(url);
    return JSON.parse(response);
}

/**
 * Fetch a network interface from ARM
 * @param {String} resourceId the resource id of network interface
 */
async function getNetworkInterface(resourceId) {
    try {
        logger.info('calling getNetworkInterface.');
        let response = await getResource(resourceId, '2017-12-01');
        let body = JSON.parse(response.body);
        logger.info('called getNetworkInterface.');
        return body;
    } catch (error) {
        logger.error(`getNetworkInterface > error ${JSON.stringify(error)}`);
    }
    return null;
}

/**
 * List all virtualmachines of a scale set in a resource group, from ARM.
 * @param {String} resourceGroup the resource group id
 * @param {String} scaleSetName the scale set name
 */
async function listVirtualMachines(resourceGroup, scaleSetName) {
    let resourceId = `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachineScaleSets/${scaleSetName}/virtualMachines`; // eslint-disable-line max-len
    try {
        logger.info('calling listVirtualMachines.');
        let response = await getResource(resourceId, '2017-12-01');
        logger.info('called listVirtualMachines.');
        return response.value;
    } catch (error) {
        logger.error(`listVirtualMachines > error ${JSON.stringify(error)}`);
        return [];
    }
}

/**
 * Get a virtual machine, including its network interface details
 * @param {String} resourceGroup resource group id
 * @param {String} scaleSetName scale set name
 * @param {String} virtualMachineId virtualmachine id
 */
async function getVirtualMachine(resourceGroup, scaleSetName, virtualMachineId) {
    let resourceId = `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachineScaleSets/${scaleSetName}/virtualMachines/${virtualMachineId}`; // eslint-disable-line max-len
    try {
        let virtualMachine = await getResource(resourceId, '2017-12-01'),
            networkInterfaces = await getResource(`${resourceId}/networkInterfaces`, '2017-12-01'); // eslint-disable-line max-len
        virtualMachine.properties.networkProfile.networkInterfaces = networkInterfaces.value;
        return virtualMachine;
    } catch (error) {

    }
}

/**
 * This lookup takes longer time to complete. a few round of http requests require.
 * can we optimize to reduce this ?
 * @param {String} resourceGroup resource group id
 * @param {String} scaleSetName scale set name
 * @param {String} ip primary ip address of an instance
 */
async function getVirtualMachineByIp(resourceGroup, scaleSetName, ip) {
    logger.info('calling getVirtualMachineByIp.');
    let found = {},
        virtualMachines = await listVirtualMachines(resourceGroup, scaleSetName);
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

function azureApiCosmosDBCreateDB(dbAccount, dbName, _masterKey) {
    return new Promise(function(resolve, reject) {
        logger.info('calling azureApiCosmosDBCreateDB.');
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('post', 'dbs', '', date, _masterKey);
        let path = `https://${dbAccount}.documents.azure.com/dbs`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        request.post({
            url: path,
            headers: headers,
            body: {
                id: dbName
            },
            json: true
        }, function(error, response, body) { // eslint-disable-line no-unused-vars
            if (error) {
                logger.error(`called azureApiCosmosDBCreateDB > unknown error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(error);
            } else if (response.statusCode === 201) {
                logger.info(`called azureApiCosmosDBCreateDB: ${dbName} created.`);
                resolve(true);
            } else if (response.statusCode === 409) {
                logger.warn(`called azureApiCosmosDBCreateDB: not created, ${dbName} already exists.`); // eslint-disable-line max-len
                resolve(false); // db exists.
            } else {
                logger.error(`called azureApiCosmosDBCreateDB > other error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(response);
            }
        });
    });
}

function azureApiCosmosDBCreateCollection(dbAccount, dbName, collectionName, _masterKey) {
    return new Promise(function(resolve, reject) {
        logger.info('calling azureApiCosmosDBCreateCollection.');
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('post',
            'colls', `dbs/${dbName}`, date, _masterKey);
        let path = `https://${dbAccount}.documents.azure.com/dbs/${dbName}/colls`;
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        request.post({
            url: path,
            headers: headers,
            body: {
                id: collectionName
            },
            json: true
        }, function(error, response, body) { // eslint-disable-line no-unused-vars
            if (error) {
                logger.error(`called azureApiCosmosDBCreateCollection > unknown error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(error);
            } else if (response.statusCode === 201) {
                logger.info(`called azureApiCosmosDBCreateCollection: ${dbName}/${collectionName} created.`); // eslint-disable-line max-len
                resolve(true);
            } else if (response.statusCode === 409) {
                logger.warn(`called azureApiCosmosDBCreateCollection: not created, ${dbName}/${collectionName} already exists.`); // eslint-disable-line max-len
                resolve(false); // db exists.
            } else {
                logger.error(`called azureApiCosmosDBCreateCollection > other error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(response);
            }
        });
    });
}

function azureApiCosmosDBCreateDocument(dbAccount, dbName, collectionName, documentId, documentContent, replaced, _masterKey) { // eslint-disable-line max-len
    return new Promise(function(resolve, reject) {
        logger.info('calling azureApiCosmosDBCreateDocument.');
        if (!(dbName && collectionName && documentId)) {
            // TODO: what should be returned from here?
            reject(null);
        }
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('post',
            'docs', `dbs/${dbName}/colls/${collectionName}`, date, _masterKey);
        let path = `https://${dbAccount}.documents.azure.com/dbs/${dbName}/colls/${collectionName}/docs`; // eslint-disable-line max-len
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        if (replaced) {
            headers['x-ms-documentdb-is-upsert'] = true;
        }
        let content = documentContent || {};
        content.id = documentId;
        try {
            JSON.stringify(content);
        } catch (error) {
            // TODO: what should be returned from here?
            reject(null);
        }
        request.post({
            url: path,
            headers: headers,
            body: content,
            json: true
        }, function(error, response, body) {
            if (error) {
                logger.error(`called azureApiCosmosDBCreateDocument > unknown error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(error);
            } else if (response.statusCode === 200) {
                logger.info(`called azureApiCosmosDBCreateDocument: ${dbName}/${collectionName}/${documentId} not modified.`); // eslint-disable-line max-len
                resolve(body);
            } else if (response.statusCode === 201) {
                logger.info(`called azureApiCosmosDBCreateDocument: ${dbName}/${collectionName}/${documentId} created.`); // eslint-disable-line max-len
                resolve(body);
            } else if (response.statusCode === 409) {
                logger.warn(`called azureApiCosmosDBCreateDocument: not created, ${dbName}/${collectionName}/${documentId} already exists.`); // eslint-disable-line max-len
                resolve(null); // document with such id exists.
            } else {
                logger.error(`called azureApiCosmosDBCreateDocument > other error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(response);
            }
        });
    });
}

function azureApiCosmosDBDeleteDocument(dbAccount, dbName, collectionName, documentId, _masterKey) {
    return new Promise(function(resolve, reject) {
        logger.info('calling azureApiCosmosDBDeleteDocument.');
        if (!(dbName && collectionName && documentId)) {
            // TODO: what should be returned from here?
            reject(null);
        }
        let date = (new Date()).toUTCString();
        let _token = getAuthorizationTokenUsingMasterKey('delete',
            'docs', `dbs/${dbName}/colls/${collectionName}/docs/${documentId}`, date, _masterKey);
        let path = `https://${dbAccount}.documents.azure.com/dbs/${dbName}/colls/${collectionName}/docs/${documentId}`; // eslint-disable-line max-len
        let headers = {
            Authorization: _token,
            'x-ms-version': '2017-02-22',
            'x-ms-date': date
        };
        request.delete({
            url: path,
            headers: headers
        }, function(error, response, body) { // eslint-disable-line no-unused-vars
            if (error) {
                logger.error(`called azureApiCosmosDBDeleteDocument > unknown error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(error);
            } else if (response.statusCode === 204) {
                logger.info(`called azureApiCosmosDBDeleteDocument: ${dbName}/${collectionName}/${documentId} deleted.`); // eslint-disable-line max-len
                resolve(true);
            } else if (response.statusCode === 404) {
                logger.warn(`called azureApiCosmosDBDeleteDocument: not deleted, ${dbName}/${collectionName}/${documentId} not found.`); // eslint-disable-line max-len
                resolve(false); // document with such id exists.
            } else {
                logger.error(`called azureApiCosmosDBDeleteDocument > other error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(response);
            }
        });
    });
}

/**
 * fire a CosmosDB query
 * @param {String} dbAccount DB account
 * @param {Object} resource  object {dbName, collectionName, queryObject}
 * @param {String} _masterKey the authorization token for db operations
 * @returns {Promise} a promise
 */
function azureApiCosmosDbQuery(dbAccount, resource, _masterKey) {
    return new Promise((resolve, reject) => {
        logger.info('calling azureApiCosmosDbQuery.');
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
                logger.error(`called azureApiCosmosDbQuery: invalid resource ${JSON.stringify(resource)}`); // eslint-disable-line max-len
                reject({});
                return;
            }
            resourceType = 'colls';
            resourcePath += `/colls/${resource.collectionName}`;
        }
        resourceType = 'docs';
        // resourcePath += `/docs`;

        let _token = getAuthorizationTokenUsingMasterKey('post',
            resourceType, resourcePath, date, _masterKey);
        let path = `https://${dbAccount}.documents.azure.com/${resourcePath}/docs`;
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
            logger.error(`called azureApiCosmosDbQuery: invalid queryObject -> ${JSON.stringify(resource.queryObject)}.`); // eslint-disable-line max-len
            reject({});
        }
        request.post({
            url: path,
            headers: headers,
            body: body
        }, function(error, response, _body) { // eslint-disable-line no-unused-vars
            if (error) {
                logger.error(`called azureApiCosmosDbQuery > unknown error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(error);
            } else if (response.statusCode === 200) {
                logger.info(`azureApiCosmosDbQuery: ${resourcePath} retrieved.`);
                try {
                    let res = JSON.parse(response.body);
                    logger.info('called azureApiCosmosDbQuery.');
                    resolve(res.Documents);
                } catch (err) {
                    logger.warn('called azureApiCosmosDbQuery: Documents object parsed failed.');
                    // TODO: what should return if failed to parse the documents?
                    reject({});
                }
            } else if (response.statusCode === 304) {
                logger.warn(`called azureApiCosmosDbQuery: ${resourcePath} not modified. return empty response body.`); // eslint-disable-line max-len
                reject(response);
            } else if (response.statusCode === 404) {
                logger.warn(`called azureApiCosmosDbQuery: not found, ${resourcePath} was deleted.`); // eslint-disable-line max-len
                reject(response);
            } else {
                logger.error(`called azureApiCosmosDbQuery > other error: ${JSON.stringify(response)}`); // eslint-disable-line max-len
                reject(response);
            }
        });
    });
}

exports.authWithServicePrincipal = authWithServicePrincipal;
exports.useSubscription = _subscription => {
    subscription = _subscription;
};

exports.Compute = {
    VirtualMachineScaleSets: {
        getNetworkInterface: getNetworkInterface,
        getVirtualMachineByIp: getVirtualMachineByIp,
        listVirtualMachines: listVirtualMachines,
        getVirtualMachine: getVirtualMachine
    }
};

exports.CosmosDB = {
    createDB: azureApiCosmosDBCreateDB,
    createCollection: azureApiCosmosDBCreateCollection,
    createDocument: azureApiCosmosDBCreateDocument,
    deleteDocument: azureApiCosmosDBDeleteDocument,
    query: azureApiCosmosDbQuery
};
