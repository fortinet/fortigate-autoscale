#!/usr/bin/env node
'use strict';
/* eslint-disable no-unused-vars */
const path = require('path'),
    fs = require('fs'),
    Packman = require('./code-packman');
let { exec, spawn } = require('child_process');
// the argument index for the packaging script
const ARGV_PROCESS_PACKAGING_SCRIPT_NAME = 2;
const REAL_PROJECT_ROOT = path.resolve(__dirname, '../');
const REAL_PROJECT_DIRNAME = path.parse(path.resolve(__dirname, '../')).base;

async function makeDistAWSLambda(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS Lambda');
    let pm = Packman.spawn(),
        rTempDir = await pm.makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcLambda = path.resolve(rTempDirSrc, 'aws_lambda'),
        rTempDirSrcLib = path.resolve(rTempDirSrcLambda, 'lib'),
        rTempDirSrcCore = path.resolve(rTempDirSrcLib, 'core'),
        rTempDirSrcAws = path.resolve(rTempDirSrcLib, 'aws'),
        packageInfo,
        zipFilePath,
        rDirSrcCore = path.resolve(REAL_PROJECT_ROOT, './core'),
        rDirSrcAws = path.resolve(REAL_PROJECT_ROOT, './aws'),
        rDirSrcLambda = path.resolve(REAL_PROJECT_ROOT, './aws_lambda'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, './dist'),
        zipFileName,
        saveAs;

    // create temp dirs
    await pm.makeDir(rTempDirSrc);
    await pm.makeDir(rDirDist);
    // copy lambda module to temp dir
    await pm.copyAndDelete(rDirSrcLambda, rTempDirSrcLambda, ['node_modules', 'local*', 'test',
        '.nyc_output', '.vscode', 'package-lock.json']);
    // create library dir on funcapp
    await pm.makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy aws module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcAws, rTempDirSrcAws,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws as dependency
    await pm.npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcAws.replace(rTempDirSrcLambda, '.')]);

    // read package info of module lambda
    packageInfo = pm.readPackageJsonAt(rTempDirSrcLambda);
    zipFileName = `${packageInfo.name}.zip`;
    // if only make zip file distribution file
    if (options && options.saveToDist === 'zip') {
    // zip
        zipFilePath = await pm.zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // copy the zip file to distribution directory
        await pm.copy(zipFilePath, rDirDist);
        // move zip file to upper level directory
        await pm.moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        saveAs = path.resolve(rDirDist, zipFileName);
    } else if (options && options.saveToDist === 'directory') {
        // copy folder to distribution directory
        await pm.copy(rTempDirSrcLambda, rDirDist);
        saveAs = rDirSrcLambda;
    } else {
        saveAs = rTempDirSrcLambda;
    }
    // if keep temp is true, the kept temp dir will be return and the calle is responsible for
    // deleteing it after use.
    if (!(options && options.keepTemp)) {
        await pm.removeTempDir();
    }
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAs}`);
    return options && options.keepTemp ? rTempDirSrcLambda : null;
}

async function makeDistAWSLambdaFgtAsgHandler(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS FortiGate Autoscale Handler function');
    let pm = Packman.spawn(),
        packageName = options.packageName ? options.packageName : 'fgt_asg_handler',
        rTempDir = await pm.makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcLambda = path.resolve(rTempDirSrc, packageName),
        rTempDirSrcLib = path.resolve(rTempDirSrcLambda, 'lib'),
        rTempDirSrcCore = path.resolve(rTempDirSrcLib, 'core'),
        rTempDirSrcAws = path.resolve(rTempDirSrcLib, 'aws'),
        rTempDirSrcCfnResponse = path.resolve(rTempDirSrcLib, 'aws_cfn_response'),
        packageInfo,
        zipFilePath,
        rDirSrcCore = path.resolve(REAL_PROJECT_ROOT, './core'),
        rDirSrcAws = path.resolve(REAL_PROJECT_ROOT, './aws'),
        rDirSrcCfnResponse = path.resolve(REAL_PROJECT_ROOT, './aws_cfn_response'),
        rDirSrcLambda = path.resolve(REAL_PROJECT_ROOT, './aws_lambda_fgt_asg_handler'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, './dist'),
        zipFileName,
        packageType,
        saveAs;

    // create temp dirs
    await pm.makeDir(rTempDirSrc);
    await pm.makeDir(rDirDist);
    // copy lambda module to temp dir
    await pm.copyAndDelete(rDirSrcLambda, rTempDirSrcLambda, ['node_modules', 'local*', 'test',
        '.nyc_output', '.vscode', 'package-lock.json']);
    // create library dir on funcapp
    await pm.makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy aws module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcAws, rTempDirSrcAws,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws as dependency
    await pm.npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcAws.replace(rTempDirSrcLambda, '.')]);
    // TODO: the following two function calls should be removed once async-cfn-response module is
    // published to npm
    // copy aws_cfn_response module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCfnResponse, rTempDirSrcCfnResponse,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws_cfn_response as dependency
    await pm.npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcCfnResponse.replace(rTempDirSrcLambda, '.')]);

    // read package info of module lambda
    packageInfo = pm.readPackageJsonAt(rTempDirSrcLambda);
    // if a package name is given in the options, use the package name as zip name,
    // otherwise use the package name in the package.json
    zipFileName = options.packageName ? `${packageName}.zip` : `${packageInfo.name}.zip`;
    // if only make zip file distribution file
    if (options.saveToDist === 'zip') {
        // zip
        zipFilePath = await pm.zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // copy the zip file to distribution directory
        await pm.copy(zipFilePath, rDirDist);
        // move zip file to upper level directory
        await pm.moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        packageType = 'zip';
        saveAs = path.resolve(rDirDist, zipFileName);
    } else if (options && options.saveToDist === 'directory') {
        // copy folder to distribution directory
        await pm.copy(rTempDirSrcLambda, rDirDist);
        packageType = 'directory';
        saveAs = rDirSrcLambda;
    } else {
        // save the zip file to the temp directory
        zipFilePath = await pm.zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // move zip file to upper level directory
        await pm.moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        zipFilePath = path.resolve(rTempDirSrcLambda, '..', zipFileName);
        packageType = 'zip';
        saveAs = zipFilePath;
    }
    // if keep temp is true, the kept temp dir will be return and the calle is responsible for
    // deleteing it after use.
    if (!(options && options.keepTemp)) {
        await pm.removeTempDir();
    }
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAs}`);
    return {
        tempDir: rTempDir,
        packageInfo: packageInfo,
        packageFileName: zipFileName,
        packageName: packageName,
        packagePath: saveAs,
        packageType: packageType,
        sourceDir: rTempDirSrcLambda,
        removeTempDir: async () => {
            await pm.removeTempDir();
        } // this holds a reference to the function to remove temp
    };
}

async function makeDistAWSLambdaFazHandler(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS Lambda FAZ Handler function');
    let pm = Packman.spawn(),
        packageName = options.packageName ? options.packageName : 'aws_lambda_faz_handler',
        rTempDir = await pm.makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcLambda = path.resolve(rTempDirSrc, packageName),
        rTempDirSrcLib = path.resolve(rTempDirSrcLambda, 'lib'),
        rTempDirSrcCore = path.resolve(rTempDirSrcLib, 'core'),
        rTempDirSrcAws = path.resolve(rTempDirSrcLib, 'aws'),
        rTempDirSrcCfnResponse = path.resolve(rTempDirSrcLib, 'aws_cfn_response'),
        packageInfo,
        zipFilePath,
        rDirSrcCore = path.resolve(REAL_PROJECT_ROOT, './core'),
        rDirSrcAws = path.resolve(REAL_PROJECT_ROOT, './aws'),
        rDirSrcCfnResponse = path.resolve(REAL_PROJECT_ROOT, './aws_cfn_response'),
        rDirSrcLambda = path.resolve(REAL_PROJECT_ROOT, './aws_lambda_faz_handler'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, './dist'),
        zipFileName,
        packageType,
        saveAs;

    // create temp dirs
    await pm.makeDir(rTempDirSrc);
    await pm.makeDir(rDirDist);
    // copy lambda module to temp dir
    await pm.copyAndDelete(rDirSrcLambda, rTempDirSrcLambda, ['node_modules', 'local*', 'test',
        '.nyc_output', '.vscode', 'package-lock.json']);
    // create library dir on funcapp
    await pm.makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy aws module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcAws, rTempDirSrcAws,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws as dependency
    await pm.npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcAws.replace(rTempDirSrcLambda, '.')]);
    // TODO: the following two function calls should be removed once async-cfn-response module is
    // published to npm
    // copy aws_cfn_response module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCfnResponse, rTempDirSrcCfnResponse,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws_cfn_response as dependency
    await pm.npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcCfnResponse.replace(rTempDirSrcLambda, '.')]);

    // read package info of module lambda
    packageInfo = pm.readPackageJsonAt(rTempDirSrcLambda);
    // if a package name is given in the options, use the package name as zip name,
    // otherwise use the package name in the package.json
    zipFileName = options.packageName ? `${packageName}.zip` : `${packageInfo.name}.zip`;
    // if only make zip file distribution file
    if (options && options.saveToDist === 'zip') {
    // zip
        zipFilePath = await pm.zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // copy the zip file to distribution directory
        await pm.copy(zipFilePath, rDirDist);
        // move zip file to upper level directory
        await pm.moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        packageType = 'zip';
        saveAs = path.resolve(rDirDist, zipFileName);
    } else if (options && options.saveToDist === 'directory') {
        // copy folder to distribution directory
        await pm.copy(rTempDirSrcLambda, rDirDist);
        packageType = 'directory';
        saveAs = rDirSrcLambda;
    } else {
        // save the zip file to the temp directory
        zipFilePath = await pm.zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // move zip file to upper level directory
        await pm.moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        zipFilePath = path.resolve(rTempDirSrcLambda, '..', zipFileName);
        packageType = 'zip';
        saveAs = zipFilePath;
    }
    // if keep temp is true, the kept temp dir will be return and the calle is responsible for
    // deleteing it after use.
    if (!(options && options.keepTemp)) {
        await pm.removeTempDir();
    }
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAs}`);
    return {
        tempDir: rTempDir,
        packageInfo: packageInfo,
        packageFileName: zipFileName,
        packageName: packageName,
        packagePath: saveAs,
        packageType: packageType,
        sourceDir: rTempDirSrcLambda,
        removeTempDir: async () => {
            await pm.removeTempDir();
        } // this holds a reference to the function to remove temp
    };
}

async function makeDistAWSLambdaNicAttachment(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS Lambda Nic attachment function');
    let pm = Packman.spawn(),
        packageName = options.packageName ? options.packageName : 'aws_lambda_nic_attachment',
        rTempDir = await pm.makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcLambda = path.resolve(rTempDirSrc, packageName),
        rTempDirSrcLib = path.resolve(rTempDirSrcLambda, 'lib'),
        rTempDirSrcCore = path.resolve(rTempDirSrcLib, 'core'),
        rTempDirSrcAws = path.resolve(rTempDirSrcLib, 'aws'),
        rTempDirSrcCfnResponse = path.resolve(rTempDirSrcLib, 'aws_cfn_response'),
        packageInfo,
        zipFilePath,
        rDirSrcCore = path.resolve(REAL_PROJECT_ROOT, './core'),
        rDirSrcAws = path.resolve(REAL_PROJECT_ROOT, './aws'),
        rDirSrcCfnResponse = path.resolve(REAL_PROJECT_ROOT, './aws_cfn_response'),
        rDirSrcLambda = path.resolve(REAL_PROJECT_ROOT, './aws_lambda_nic_attachment'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, './dist'),
        zipFileName,
        packageType,
        saveAs;

    // create temp dirs
    await pm.makeDir(rTempDirSrc);
    await pm.makeDir(rDirDist);
    // copy lambda module to temp dir
    await pm.copyAndDelete(rDirSrcLambda, rTempDirSrcLambda, ['node_modules', 'local*', 'test',
        '.nyc_output', '.vscode', 'package-lock.json']);
    // create library dir on funcapp
    await pm.makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy aws module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcAws, rTempDirSrcAws,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws as dependency
    await pm.npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcAws.replace(rTempDirSrcLambda, '.')]);
    // TODO: the following two function calls should be removed once async-cfn-response module is
    // published to npm
    // copy aws_cfn_response module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCfnResponse, rTempDirSrcCfnResponse,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws_cfn_response as dependency
    await pm.npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcCfnResponse.replace(rTempDirSrcLambda, '.')]);

    // read package info of module lambda
    packageInfo = pm.readPackageJsonAt(rTempDirSrcLambda);
    // if a package name is given in the options, use the package name as zip name,
    // otherwise use the package name in the package.json
    zipFileName = options.packageName ? `${packageName}.zip` : `${packageInfo.name}.zip`;
    // if only make zip file distribution file
    if (options && options.saveToDist === 'zip') {
    // zip
        zipFilePath = await pm.zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // copy the zip file to distribution directory
        await pm.copy(zipFilePath, rDirDist);
        // move zip file to upper level directory
        await pm.moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        packageType = 'zip';
        saveAs = path.resolve(rDirDist, zipFileName);
    } else if (options && options.saveToDist === 'directory') {
        // copy folder to distribution directory
        await pm.copy(rTempDirSrcLambda, rDirDist);
        packageType = 'directory';
        saveAs = rDirSrcLambda;
    } else {
        // save the zip file to the temp directory
        zipFilePath = await pm.zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // move zip file to upper level directory
        await pm.moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        zipFilePath = path.resolve(rTempDirSrcLambda, '..', zipFileName);
        packageType = 'zip';
        saveAs = zipFilePath;
    }
    // if keep temp is true, the kept temp dir will be return and the calle is responsible for
    // deleteing it after use.
    if (!(options && options.keepTemp)) {
        await pm.removeTempDir();
    }
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAs}`);
    return {
        tempDir: rTempDir,
        packageInfo: packageInfo,
        packageFileName: zipFileName,
        packageName: packageName,
        packagePath: saveAs,
        packageType: packageType,
        sourceDir: rTempDirSrcLambda,
        removeTempDir: async () => {
            await pm.removeTempDir();
        } // this holds a reference to the function to remove temp
    };
}

async function makeDistAwsCloudFormation(options = {excludeList: [], quickstart: false,
    fazhandler: true}) {
    // create the aws cloud formation package
    console.info('Making distribution zip package for: AWS Cloud Formation');
    // create the aws lambda pacakge (directory)
    let pm = Packman.spawn(),
        fgtAsgHandlerTempDist =
            await makeDistAWSLambdaFgtAsgHandler({saveToDist: 'none',
                packageName: 'fgt-asg-handler', keepTemp: true}),
        nicAttachmentTempDist = await makeDistAWSLambdaNicAttachment({saveToDist: 'none',
            packageName: 'nic-attachment', keepTemp: true}),
        rTempDir = await pm.makeTempDir(), // create temp folder
        rTempDirCloudFormation = path.resolve(rTempDir, 'aws_cloudformation'),
        rTempDirFunctionPackages = path.resolve(rTempDirCloudFormation, 'functions', 'packages'),
        rTempDirFunctionSources =
            path.resolve(rTempDirCloudFormation, 'functions', 'source'),
        rDirSrcCloudFormation = path.resolve(REAL_PROJECT_ROOT, './aws_cloudformation'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, 'dist'),
        rTempDirPackage,
        zipFileName,
        zipFilePath,
        saveSource = !!(options && options.quickstart);

    let excludeList = ['local*', '.gitignore', 'autoscale_params.txt'];
    if (Array.isArray(options.excludeList)) {
        excludeList = excludeList.concat(options.excludeList);
    }
    if (options.quickstart) {
        excludeList = excludeList.concat(['LICENSE', 'README.md', 'NOTICE.txt',
            'deploy_autoscale.sh']);
    }
    // copy aws cloud formation to temp dir
    await pm.copyAndDelete(rDirSrcCloudFormation, rTempDirCloudFormation,
        excludeList);

    // create /functions/packages & source folder
    await pm.makeDir(rTempDirFunctionPackages);
    if (saveSource) {
        await pm.makeDir(rTempDirFunctionSources);
    }

    // fgt-asg-handler
    // remove aws-quickstart unwanted files
    await pm.remove(excludeList, fgtAsgHandlerTempDist.sourceDir);

    // move the zip to functions/packages/
    await pm.moveSafe(fgtAsgHandlerTempDist.packagePath, rTempDirFunctionPackages);
    // move the source into functions/source/
    if (saveSource) {
        rTempDirPackage = path.resolve(rTempDirFunctionSources, fgtAsgHandlerTempDist.packageName);
        await pm.makeDir(rTempDirPackage);
        await pm.moveSafe(fgtAsgHandlerTempDist.sourceDir, rTempDirPackage,
            {moveSourceFiles: saveSource});
    }
    // remove the temp file
    await fgtAsgHandlerTempDist.removeTempDir();

    // nic attachment
    // remove aws-quickstart unwanted files
    await pm.remove(excludeList, nicAttachmentTempDist.sourceDir);
    // move the zip to functions/packages/
    await pm.moveSafe(nicAttachmentTempDist.packagePath, rTempDirFunctionPackages);
    // move the source into functions/source/
    if (saveSource) {
        rTempDirPackage = path.resolve(rTempDirFunctionSources, nicAttachmentTempDist.packageName);
        await pm.makeDir(rTempDirPackage);
        await pm.moveSafe(nicAttachmentTempDist.sourceDir, rTempDirPackage,
            {moveSourceFiles: saveSource});
    }
    // remove the temp file
    nicAttachmentTempDist.removeTempDir();

    // faz-handler
    if (options.fazhandler) {
        let fazHandlerTempDist =
        await makeDistAWSLambdaFazHandler({saveToDist: 'none',
            packageName: 'faz-handler', keepTemp: true});

        // remove aws-quickstart unwanted files
        await pm.remove(excludeList, fazHandlerTempDist.sourceDir);

        // move the zip to functions/packages/
        await pm.moveSafe(fazHandlerTempDist.packagePath, rTempDirFunctionPackages);
        // move the source into functions/source/
        if (saveSource) {
            rTempDirPackage = path.resolve(rTempDirFunctionSources, fazHandlerTempDist.packageName);
            await pm.makeDir(rTempDirPackage);
            await pm.moveSafe(fazHandlerTempDist.sourceDir, rTempDirPackage,
                {moveSourceFiles: saveSource});
        }
        // remove the temp file
        fazHandlerTempDist.removeTempDir();
    }

    // zip the aws cloud formation dir
    zipFileName = options.quickstart ? 'fortigate-autoscale-aws-quickstart.zip' :
        'fortigate-autoscale-aws-cloudformation.zip';
    zipFilePath = await pm.zipSafe(zipFileName, rTempDirCloudFormation);
    // copy the zip file to dist
    await pm.moveSafe(zipFilePath, rDirDist);
    await pm.removeTempDir();
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${path.resolve(rDirDist, zipFileName)}`);
}

async function makeDistAzureFuncApp() {
    console.info('Making distribution zip package');
    let pm = Packman.spawn(),
        rTempDir = await pm.makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcFuncApp = path.resolve(rTempDirSrc, 'azure_funcapp'),
        rTempDirSrcLib = path.resolve(rTempDirSrcFuncApp, 'lib'),
        rTempDirSrcCore = path.resolve(rTempDirSrcLib, 'core'),
        rTempDirSrcAzure = path.resolve(rTempDirSrcLib, 'azure'),
        packageInfo,
        zipFilePath,
        rDirSrcCore = path.resolve(REAL_PROJECT_ROOT, './core'),
        rDirSrcAzure = path.resolve(REAL_PROJECT_ROOT, './azure'),
        rDirSrcFuncapp = path.resolve(REAL_PROJECT_ROOT, './azure_funcapp'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, './dist'),
        zipFileName,
        saveAsFile;

    // create temp dirs
    await pm.makeDir(rTempDirSrc);
    await pm.makeDir(rDirDist);
    // copy funcapp module to temp dir
    await pm.copyAndDelete(rDirSrcFuncapp, rTempDirSrcFuncApp, ['node_modules', 'local', 'test',
        '.nyc_output', '.vscode', 'bin', 'obj',
        '*.csproj', 'proxies.json', 'host.json', 'local.settings.json', 'package-lock.json']);
    // create library dir on funcapp
    await pm.makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy azure module to temp dir and remove unnecessary files
    await pm.copyAndDelete(rDirSrcAzure, rTempDirSrcAzure,
        ['node_modules', 'local', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install azure as dependency



    // await npmInstallLocal(rTempDirSrcFuncApp,
    //     [], {noSymlink: true}, rTempDirSrcLib);
    await pm.npmInstallAt(rTempDirSrcFuncApp,
        ['--save', rTempDirSrcAzure.replace(rTempDirSrcFuncApp, '.')], {noSymlink: true});
    // read package info of module funcapp
    packageInfo = pm.readPackageJsonAt(rTempDirSrcFuncApp);
    zipFileName = `${packageInfo.name}.zip`;
    saveAsFile = path.resolve(rDirDist, zipFileName);
    // zip
    zipFilePath =
        await pm.zipSafe(zipFileName, rTempDirSrcFuncApp, ['*.git*', '*.vsc*']);
    // move it to dist directory
    await pm.moveSafe(zipFilePath, rDirDist);
    await pm.removeTempDir();
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAsFile}`);
}

async function makeDistProject() {
    console.info('Making distribution zip package');
    // create temp folder
    let pm = Packman.spawn(),
        realTmpDir = await pm.makeTempDir(),
        realTmpSrcDir = path.resolve(realTmpDir, 'src'),
        realDistDir = path.resolve(REAL_PROJECT_ROOT, './dist'),
        packageInfo,
        zipFileName,
        realZipFilePath,
        saveAsFilePath;

    // create a temp dir for making files
    // done by makeTempDir() already
    // create a src dir under the temp dir
    await pm.makeDir(realTmpSrcDir);
    // copy all files from project root to temp src dir,
    // excluding some files not need to distribute
    await pm.copyAndDelete(REAL_PROJECT_ROOT, realTmpSrcDir, ['node_modules', 'dist', 'local',
        '.nyc_output', '.vscode', '.tmp', '*.git', 'package-lock.json', '*workspace*',
        '*local.settings.json*']);
    // change the temp src dir to autoscale
    realTmpSrcDir = path.join(realTmpSrcDir, REAL_PROJECT_DIRNAME);
    // read the package and determine the distribution zip file name
    packageInfo = pm.readPackageJsonAt(realTmpSrcDir);
    // determine the zip file name
    zipFileName = `${packageInfo.name}.zip`;
    // pack to a zip file
    realZipFilePath = await pm.zipSafe(zipFileName, realTmpSrcDir);
    saveAsFilePath = path.resolve(realDistDir, zipFileName);
    // move this file to distribution dir
    await pm.moveSafe(realZipFilePath, saveAsFilePath);
    await pm.removeTempDir();

    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAsFilePath}`);
}

async function makeDistAzureTemplateDeployment() {
    // create the azure function app
    await makeDistAzureFuncApp();
    console.info('Making Azure Template Deployment zip package');
    // create temp folder
    let pm = Packman.spawn(),
        rTempDir = await pm.makeTempDir(),
        rTempDirTemplateDeployment = path.resolve(rTempDir, 'azure_template_deployment'),
        rDirSrcFuncapp = path.resolve(REAL_PROJECT_ROOT, './azure_funcapp'),
        rDirSrcTemplateDeployment = path.resolve(REAL_PROJECT_ROOT, './azure_template_deployment'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, 'dist'),
        packageInfo,
        zipFileName,
        zipFilePath,
        rDistZipFuncapp;

    // copy azure quick start to temp dir
    await pm.copyAndDelete(rDirSrcTemplateDeployment, rTempDirTemplateDeployment,
        ['local*']);
    // read package info of azure funcapp module
    packageInfo = pm.readPackageJsonAt(rDirSrcFuncapp);
    zipFileName = `${packageInfo.name}.zip`;
    rDistZipFuncapp = path.resolve(rDirDist, zipFileName);
    // copy azure function app zip to the temp quick start dir
    await pm.copy(rDistZipFuncapp, rTempDirTemplateDeployment);
    // zip the quick start dir
    zipFileName = 'fortigate-autoscale-azure-template-deployment.zip';
    zipFilePath = await pm.zipSafe(zipFileName, rTempDirTemplateDeployment);
    // copy the zip file to dist
    await pm.moveSafe(zipFilePath, rDirDist);
    await pm.removeTempDir();
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${path.resolve(rDirDist, zipFileName)}`);
}

async function makeDistAll() {
    await makeDistAWSLambda();
    await makeDistAzureFuncApp();
    await makeDistAzureTemplateDeployment();
    await makeDistProject();
    await makeDistAwsCloudFormation();
}

let scrptName = process.argv[ARGV_PROCESS_PACKAGING_SCRIPT_NAME] || 'default';
// make distribution package
switch (scrptName.toLowerCase()) {
    case 'azure-template-deployment':
        makeDistAzureTemplateDeployment();
        break;
    case 'azure-funcapp':
        makeDistAzureFuncApp();
        break;
    case 'aws-lambda-fgt-asg-handler':
        makeDistAWSLambdaFgtAsgHandler();
        break;
    case 'aws-lambda-faz-handler':
        makeDistAWSLambdaFazHandler();
        break;
    case 'aws-lambda-nic-attachment':
        makeDistAWSLambdaNicAttachment();
        break;
    case 'aws-cloudformation':
        makeDistAwsCloudFormation({quickstart: false, fazhandler: false});
        break;
    case 'aws-quickstart-special':
        makeDistAwsCloudFormation({quickstart: true, fazhandler: false});
        break;
    case 'project':
        makeDistProject();
        break;
    case 'all':
        makeDistAll();
        break;
    default:
        console.warn('( ͡° ͜ʖ ͡°) Usage: please use one of these commands:');
        console.warn('npm run build-all');
        console.warn('npm run build-project');
        console.warn('npm run build-azure-funcapp');
        console.warn('npm run build-azure-template-deployment');
        console.warn('npm run build-aws-lambda-fgt-asg-handler');
        console.warn('npm run build-aws-lambda-faz-handler');
        console.warn('npm run build-aws-lambda-nic-attachment');
        console.warn('npm run build-aws-cloudformation');
        console.warn('npm run build-aws-quickstart-special');
        break;
}
/* eslint-enable no-unused-vars */
