'use strict';

/*
FortiGate Autoscale AWS Lambda Function - FortiGate Auto-Scaling Group handler (1.0.0-beta)
Author: Fortinet
*/

/* eslint-disable no-inner-declarations */
exports = module.exports;
const AWS = require('aws-sdk');
const ftgtAutoscaleAws = require('fortigate-autoscale-aws');

// lock the API versions
AWS.config.apiVersions = {
    autoscaling: '2011-01-01',
    ec2: '2016-11-15',
    lambda: '2015-03-31',
    dynamodb: '2012-08-10',
    apiGateway: '2015-07-09',
    s3: '2006-03-01'
};

AWS.config.update({
    region: process.env.AWS_REGION
});

const
    dynamodb = new AWS.DynamoDB(),
    docClient = new AWS.DynamoDB.DocumentClient(),
    unique_id = process.env.UNIQUE_ID.replace(/.*\//, ''),
    custom_id = process.env.CUSTOM_ID.replace(/.*\//, ''),
    dbTables = ftgtAutoscaleAws.dbDefinitions.getTables(custom_id, unique_id);

ftgtAutoscaleAws.initModule();

let logger = ftgtAutoscaleAws.logger;

async function createTable(schema) {
    try {
        await tableExists(schema);
        logger.info(`no need to create table (${schema.TableName})`);
        return true;
    } catch (error) {

    }
    try {
        logger.info(`creating table (${schema.TableName})...`);
        let promiseEmitter = () => {
                dynamodb.createTable(schema).promise();
            },
            validator = result => {
                return !!result;
            };
        await ftgtAutoscaleAws.AutoScaleCore.sleep(3000);
        await ftgtAutoscaleAws.AutoScaleCore.waitFor(promiseEmitter, validator);
        logger.info(`table (${schema.TableName}) created.`);
        return true;
    } catch (error) {
        logger.warn(`cannot create table (${schema.TableName}). error: ${error}`);
        throw error;
    }
}

async function tableExists(schema) {
    try {
        await dynamodb.describeTable({ TableName: schema.TableName }).promise();
        logger.info(`table (${schema.TableName}) found.`);
        return true;
    } catch (ex) {
        throw new Error(`table (${schema.TableName}) not exists!`);
    }
}

async function deleteTable(schema) {
    try {
        await tableExists(schema);
    } catch (ex) {
        logger.warn(`table (${schema.TableName}) not exists. no need to delete`);
    }
    try {
        await dynamodb.deleteTable({ TableName: schema.TableName }).promise();
        await dynamodb.waitFor('tableNotExists', { TableName: schema.TableName }).promise();
    } catch (ex) {
        logger.warn(`cannot delete table (${schema.TableName}) due to error:`, ex);
    }
}

exports.handler = async (event, context, callback) => {

};

/**
 * This function handles CloudFormation custom resource creation
 */
exports.createService = async () => {
    try {
        return await tableExists(dbTables.NICATTACHMENT);
    } catch (error) {
        logger.warn(`table ${dbTables.NICATTACHMENT.TableName} not exist:`, error);
        return false;
    }
};

/**
 * This function handles CloudFormation custom resource updating
 */
exports.updateService = async () => {
    await Promise.resolve(() => logger.warn('Do nothing on custom resource updating.'));
};

/**
 * This function handles CloudFormation custom resource deletion
 */
exports.deleteService = async () => {
    try {
        const
            platform = new ftgtAutoscaleAws.AwsPlatform(),
            response = await docClient.scan({
                TableName: dbTables.NICATTACHMENT.TableName
            }).promise(),
            items = response.Items;
        if (Array.isArray(items) && items.length) {
            await Promise.all(items.map(item => {
                return platform.detachNetworkInterface(item);
            }));
        }
        // await deleteTable(dbTables.NICATTACHMENT);
    } catch (error) {
        logger.warn(`error occurred in deleting table: ${JSON.stringify(error)}`);
    }
};

exports.ftgtAutoscaleAws = ftgtAutoscaleAws;
