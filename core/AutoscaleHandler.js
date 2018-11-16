'use strict';

/*
Author: Fortinet
*
* AutoscaleHandler contains the core used to handle serving configuration files and
* manage the autoscale events from multiple cloud platforms.
*
* Use this class in various serverless cloud contexts. For each serverless cloud
* implementation extend this class and implement the handle() method. The handle() method
* should call other methods as needed based on the input events from that cloud's
* autoscale mechanism and api gateway requests from the fortigate's callback-urls.
* (see reference AWS implementation {@link AwsAutoscaleHandler})
*
* Each cloud implementation should also implement a concrete version of the abstract
* {@link CloudPlatform} class which should be passed to super() in the constructor. The
* CloudPlatform interface should abstract each specific cloud's api. The reference
* implementation {@link AwsPlatform} handles access to the dynamodb for persistence and
* locking, interacting with the aws autoscaling api and determining the api endpoint url
* needed for the fortigate config's callback-url parameter.
*/
const
    AUTOSCALE_SECTION_EXPR =
    /(?:^|\n)\s*config?\s*system?\s*auto-scale[\s\n]*((?:.|\n)*)\bend\b/,
    SET_SECRET_EXPR = /(set\s+(?:psksecret|password)\s+).*/g;

module.exports = class AutoscaleHandler {

    constructor(platform, baseConfig) {
        this.platform = platform;
        this._baseConfig = baseConfig;
    }

    throwNotImplementedException() {
        throw new Error('Not Implemented');
    }

    async handle() {
        await this.throwNotImplementedException();
    }

    async init() {
        await this.platform.init();
    }

    async getConfig(ip) {
        await this.throwNotImplementedException();
        return ip;
    }

    async getMasterConfig(callbackUrl) {
        return await this._baseConfig.replace(/\$\{CALLBACK_URL}/, callbackUrl);
    }

    async getSlaveConfig(masterIp, callbackUrl) {
        const
            autoScaleSectionMatch = AUTOSCALE_SECTION_EXPR.exec(this._baseConfig),
            autoScaleSection = autoScaleSectionMatch && autoScaleSectionMatch[1],
            matches = [
                /set\s+sync-interface\s+(.+)/.exec(autoScaleSection),
                /set\s+psksecret\s+(.+)/.exec(autoScaleSection),
                /set\s+admin-sport\s+(.+)/.exec(autoScaleSection)
            ];
        const [syncInterface, pskSecret, adminPort] = matches.map(m => m && m[1]),
            apiEndpoint = callbackUrl,
            config = `
                        config system auto-scale
                            set status enable
                            set sync-interface ${syncInterface ? syncInterface : 'port1'}
                            set role slave
                            set master-ip ${masterIp}
                            set callback-url ${apiEndpoint}
                            set psksecret ${pskSecret}
                        end
                        config system dns
                            unset primary
                            unset secondary
                        end
                        config system global
                            set admin-console-timeout 300
                        end
                        config system global
                            set admin-sport ${adminPort ? adminPort : '8443'}
                        end
                    `;
        let errorMessage;
        if (!apiEndpoint) {
            errorMessage = 'Api endpoint is missing';
        }
        if (!masterIp) {
            errorMessage = 'Master ip is missing';
        }
        if (!pskSecret) {
            errorMessage = 'psksecret is missing';
        }
        if (!pskSecret || !apiEndpoint || !masterIp) {
            throw new Error(`Base config is invalid (${errorMessage}): ${
                JSON.stringify({
                    syncInterface,
                    apiEndpoint,
                    masterIp,
                    pskSecret: pskSecret && typeof pskSecret
                })}`);
        }
        await config.replace(SET_SECRET_EXPR, '$1 *');
        return config;
    }

    async holdMasterElection(ip) {
        await this.throwNotImplementedException();
        return ip;
    }

    async completeMasterInstance(instanceId) {
        await this.throwNotImplementedException();
        return instanceId;
    }

    responseToHeartBeat(masterIp) {
        let response = {};
        if (masterIp) {
            response['master-ip'] = masterIp;
        }
        return JSON.stringify(response);
    }
};
