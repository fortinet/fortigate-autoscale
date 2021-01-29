#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const semver = require('semver');

const verStr = process.env.npm_package_version;
const rootDir = path.resolve(path.basename(__filename), '../');

// validate version arg
if (!semver.valid(verStr)) {
    throw new Error(`${verStr} isn't a valid semver. Expect a valid semver from the 1st argument.`);
}

const version = semver.parse(verStr);

// update Azure templates version
const templateDir = path.resolve(rootDir, 'azure_template_deployment/templates');

const files = fs.readdirSync(templateDir);
files
    .filter(file => {
        const stat = fs.statSync(path.resolve(templateDir, file));
        return stat.isFile();
    })
    .forEach(file => {
        const filePath = path.resolve(templateDir, file);
        const templateJSON = JSON.parse(fs.readFileSync(filePath));
        if (templateJSON.contentVersion) {
            templateJSON.contentVersion = `${version.major}.${version.minor}.${version.patch}.0`;
            fs.writeFileSync(filePath, JSON.stringify(templateJSON, null, 4));
            console.log(
                `Template version updates to: ${templateJSON.contentVersion} on file: ${file}`
            );
        } else {
            console.log(`No contentVersion field found. Skip file: ${file}`);
        }
    });

// update function app package version
// NOTE: this script does not re-build the package-lock file. You need to do it manually.
const funcAppDir = path.resolve(rootDir, 'azure_funcapp');
const funcAppPackageFilePath = path.resolve(funcAppDir, 'package.json');
const funcAppPackage = require(funcAppPackageFilePath);
funcAppPackage.version = verStr;
fs.writeFileSync(funcAppPackageFilePath, JSON.stringify(funcAppPackage, null, 4));
