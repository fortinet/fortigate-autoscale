#!/usr/bin/env node
'use strict';

const path = require('path'),
    fs = require('fs');
let { exec, spawn } = require('child_process');
// the argument index for the packaging script
const ARGV_PROCESS_PACKAGING_SCRIPT_NAME = 2;
const REAL_PROJECT_ROOT = path.resolve(__dirname, '../');
const REAL_PROJECT_DIRNAME = path.parse(path.resolve(__dirname, '../')).base;
let _tempDir;

function runCmd(cmd, args = [], cwd = process.cwd(), options) {
    let output = '';
    return new Promise((resolve, reject) => {
        console.log(`run command:${cmd} ${args.join(' ')} on dir: ${cwd}`);
        let cproc = spawn(cmd, args, { cwd: cwd, shell: process.env.shell});

        cproc.stdout.on('data', function(data) {
            output += data;
            if (options && options.printStdout) {
                console.log(`stdout: ${data}`);
            }
        });

        cproc.stderr.on('data', function(data) {
            if (options && !options.supressError) {
                console.log(`stderr: ${data}`);
            } else {
                reject(data);
            }
        });

        cproc.on('error', err => {
            if (options && !options.supressError) {
                console.log(`error : ${err}`);
            } else {
                reject(err);
            }
        });

        cproc.on('close', function() {
            resolve(output);
        });
    }).catch(error => {
        // TODO: npm install can generate warning. how to handle warnings here?
        console.log(error.toString());
    });
}

// eslint-disable-next-line no-unused-vars
function execCmd(cmd, cwd = process.cwd(), options) {
    return new Promise((resolve, reject) => {
        console.log(`run command:${cmd} on dir: ${cwd}`);
        exec(cmd, { cwd: cwd}, (error, stdout, stderr) => {
            if (error) {
                if (options && !options.supressError) {
                    console.error(`exec error: ${error}`);
                } else {
                    reject(error);
                }
            }
            if (stdout && options && options.printStdout) {
                console.log(`stdout: ${stdout}`);
            }
            if (stderr && options && options.printStderr) {
                console.log(`stderr: ${stderr}`);
            }
            resolve(stdout || stderr);
        });
    }).catch(err => {
        // TODO: npm install can generate warning. how to handle warnings here?
        console.log(err.toString());
    });

}

async function isGNUBash() {
    try {
        let bashVersion = await execCmd('bash --version', process.cwd(), {
            mute: true
        });
        return bashVersion.trim().indexOf('GNU bash') !== -1;
    } catch (error) {
        return false;
    }
}

async function makeTempDir(options = {}) {
    if (!_tempDir) {
        _tempDir = await runCmd('mktemp', ['-d'], process.cwd(), options);
        _tempDir = _tempDir.trim();
    }
    return _tempDir;
}

async function removeTempDir(options = {}) {
    if (_tempDir) {
        await execCmd(`rm -rf ${_tempDir}`, process.cwd(), options);
        _tempDir = null;
    }
    return true;
}

function resetTempDir() {
    _tempDir = null;
    return true;
}

async function makeDir(location, cwd = process.cwd(), options = {}) {
    await execCmd(`mkdir -p ${path.resolve(cwd, location)}`, cwd, options);
}

async function copy(src, des, cwd = process.cwd(), options = {}) {
    if (!await isGNUBash()) {
        throw new Error('Sorry, this script can only run on a GNU bash shell.');
    }
    if (path.resolve(des).indexOf(path.resolve(src)) === 0) {
        throw new Error(`\n\n( ͡° ͜ʖ ͡°) copying <${src}> to its subdir <${des}> creates` +
        ' a circular reference. I won\'t allow this happen.');
    }
    return new Promise((resolve, reject) => {
        execCmd(`cp -rL ${src} ${des}`, cwd, options).then(output => resolve(output))
            .catch(error => reject(error));
    });
}

async function copyAndDelete(src, des, excludeList = [], options = {}) {
    // copy funcapp module to temp dir
    await copy(src, des, process.cwd(), options);
    // remove unnecessary files and directories
    await remove(excludeList, des, process.cwd(), options);
    return true;
}

async function deleteSafe(location, onDir, options = {}) {
    if (!onDir) {
        console.error('<onDir> must be provided.');
        return false;
    }
    let realPath = path.resolve(onDir, location);
    if (realPath.indexOf(onDir) !== 0 || realPath === onDir || realPath === '/') {
        console.error(`\n\n( ͡° ͜ʖ ͡°) the locaton (${location}) falls outside directories ` +
        `allowed: ${onDir}, or in somewhere inappropriate to delete.`);
        console.error('( ͡° ͜ʖ ͡°) I don\'t allow you to delete it');
        return false;
    }
    await execCmd(`rm -rf ${realPath}`, onDir, options);
}

async function remove(search, cwd = process.cwd(), options = {}) {
    if (typeof search === 'string') {
        search = [search];
    }
    if (search instanceof Array) {
        for (let index in search) {
            if (typeof search[index] !== 'string') {
                break;
            }
            let foundArray = await find(search[index], cwd);
            for (let location of foundArray) {
                if (location) {
                    await deleteSafe(location, cwd, options);
                }
            }
            if (++index === search.length) {
                return true;
            }
        }
    }
    console.error('( ͡° ͜ʖ ͡°) <search> only accepts string or string array when remove.');
}

async function find(search, onDir) {
    return await execCmd(`find . -name "${search}"`, onDir, {
        printStdout: false,
        printStderr: false
    }).then(output => {
        return output.split('\n').filter(line => line.trim());
    }).catch(error => {
        console.log(error.message);
        return [];
    });
}

function readPackageJsonAt(location) {
    let packPath = path.resolve(process.cwd(), location);
    try {
        let stat = fs.statSync(packPath),
            pathInfo = path.parse(packPath);
        if (stat.isFile()) {
            return require(path.join(pathInfo.dir, 'package.json'));
        } else if (stat.isDirectory()) {
            return require(path.join(pathInfo.dir, pathInfo.base, 'package.json'));
        } else {
            return {};
        }
    } catch (error) {
        return {};
    }
}

function readJSONTemplateAt(filePath) {
    filePath = path.resolve(process.cwd(), filePath);
    try {
        let stat = fs.statSync(filePath);
        if (stat.isFile()) {
            return require(filePath);
        } else {
            return {};
        }
    } catch (error) {
        return {};
    }
}

function saveJSONTemplateAt(filePath, jsonObject) {
    filePath = path.resolve(process.cwd(), filePath);
    try {
        if (typeof jsonObject === 'string') {
            jsonObject = JSON.parse(jsonObject);
        }
        fs.writeFileSync(filePath, JSON.stringify(jsonObject, null, 4));
        return true;
    } catch (error) {
        return false;
    }
}

async function moveSafe(src, des, options = {}) {
    if (!(src && des)) {
        console.error('<src> and <des> must be provided.');
        return false;
    }
    if (path.resolve(des).indexOf(path.resolve(src)) === 0) {
        throw new Error(`\n\n( ͡° ͜ʖ ͡°) moving <${src}> to its subdir <${des}> creates` +
        ' a circular reference. I won\'t allow this happen.');
    }
    if (options.moveSourceFiles) {
        return await execCmd(`mv ${path.resolve(src)}/* ${path.resolve(des)}`,
        process.cwd(), options);
    } else {
        return await execCmd(`mv ${path.resolve(src)} ${path.resolve(des)}`,
        process.cwd(), options);
    }
}

async function zipSafe(fileName, src, excludeList = [], options = {}) {
    let des, args = [],
        realPath = path.resolve(src);
    // allow to create zip file in cwd, otherwise, create in the temp dir
    if (realPath.indexOf(process.cwd()) === 0) {
        des = realPath;
    } else {
        des = path.resolve(await makeTempDir(), src);
    }
    args = args.concat(['-r', fileName, '.']);
    if (Array.isArray(excludeList) && excludeList.length > 0) {
        args.push('-x');
        args = args.concat(excludeList);
    }
    await runCmd('zip', args, des, options);
    return path.resolve(des, fileName);
}

async function npmInstallAt(location, args = [], options = {}) {
    let packageInfo = readPackageJsonAt(location);
    if (packageInfo.name) {
        let pathInfo = path.parse(path.resolve(location)),
            packPath = path.join(pathInfo.dir, pathInfo.ext ? '' : pathInfo.base);
        Object.assign(options, {
            supressError: true
        });
        return await runCmd('npm', ['install'].concat(args), packPath, {
            supressError: true
        });
    } else {
        return false;
    }
}

function oldWayMakeDist() {
    var pkg = require('../package.json'),
        os = require('os'),
        dpl = require('dpl'),
        rimraf = require('rimraf');

    process.env.TMPDIR = fs
        .mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `${pkg.name}-`)) + path.sep;

    // Shorter version of node_modules/dpl/dpl.js which avoids the 'upload' phase

    // var dpl = require('dpl/lib/index.js');
    // 'upload' into the ./dist folder instead.
    dpl.upload = function() {
        var fileName = `${pkg.name}.zip`;
        var zipFile = path.normalize(process.env.TMPDIR + fileName);
        var distDir = path.normalize(path.join(__dirname, '..', 'dist'));
        try {
            fs.mkdirSync(distDir);
        } catch (ex) { }
        copyFile(zipFile, path.join(distDir, fileName), function() {
            rimraf.sync(path.dirname(zipFile));
            console.log(`zipped to ${path.relative(process.cwd(), path.join(distDir, fileName))}`);
        });
    };
    require('dpl/dpl.js');

    function copyFile(src, dest, cb) {
        fs.createReadStream(src).pipe(fs.createWriteStream(dest))
            .on('error', console.error)
            .on('close', cb);
    }
}

// TODO: save for later. to make a fortigate-autoscale-core node module distribution
function makeDistCore() {

}

// TODO: save for later. to make a fortigate-autoscale-aws node module distribution
function makeDistAWS() {

}

// TODO: save for later. to make a fortigate-autoscale-azure node module distribution
function makeDistAzure() {

}

async function makeDistAWSLambda(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS Lambda');
    let rTempDir = await makeTempDir(),
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
    await makeDir(rTempDirSrc);
    await makeDir(rDirDist);
    // copy lambda module to temp dir
    await copyAndDelete(rDirSrcLambda, rTempDirSrcLambda, ['node_modules', 'local*', 'test',
        '.nyc_output', '.vscode', 'package-lock.json']);
    // create library dir on funcapp
    await makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy aws module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcAws, rTempDirSrcAws,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws as dependency
    await npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcAws.replace(rTempDirSrcLambda, '.')]);

    // read package info of module lambda
    packageInfo = readPackageJsonAt(rTempDirSrcLambda);
    zipFileName = `${packageInfo.name}.zip`;
    // if only make zip file distribution file
    if (options && options.saveToDist === 'zip') {
    // zip
        zipFilePath = await zipSafe(zipFileName, rTempDirSrcLambda, ['*.git*', '*.vsc*']);
        // copy the zip file to distribution directory
        await copy(zipFilePath, rDirDist);
        // move zip file to upper level directory
        await moveSafe(zipFilePath, path.resolve(rTempDirSrcLambda, '..'));
        saveAs = path.resolve(rDirDist, zipFileName);
    } else if (options && options.saveToDist === 'directory') {
        // copy folder to distribution directory
        await copy(rTempDirSrcLambda, rDirDist);
        saveAs = rDirSrcLambda;
    } else {
        saveAs = rTempDirSrcLambda;
    }
    // if keep temp is true, the kept temp dir will be return and the calle is responsible for
    // deleteing it after use.
    if (options && options.keepTemp) {
        resetTempDir();
    } else {
        await removeTempDir();
    }
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAs}`);
    return options && options.keepTemp ? rTempDirSrcLambda : null;
}

async function makeDistAwsCloudFormation(options = {excludeList: [], quickstart: false}) {
    // create the aws cloud formation package
    console.info('Making distribution zip package for: AWS Cloud Formation');
    // create the aws lambda pacakge (directory)
    let lambdaTempDir = await makeDistAWSLambda({saveToDist: 'none', keepTemp: true}),
        rTempDir = await makeTempDir(), // create temp folder
        rTempDirCloudFormation = path.resolve(rTempDir, 'aws_cloudformation'),
        rTempDirFunctionPackages = path.resolve(rTempDirCloudFormation, 'functions/packages'),
        rTempDirFunctionSources = path.resolve(rTempDirCloudFormation, 'functions/source'),
        rDirSrcCloudFormation = path.resolve(REAL_PROJECT_ROOT, './aws_cloudformation'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, 'dist'),
        zipFileName,
        zipFilePath;

    let excludeList = ['local*', '.gitignore', 'autoscale_params.txt'];
    if (Array.isArray(options.excludeList)) {
        excludeList = excludeList.concat(options.excludeList);
    }
    if (options.quickstart) {
        excludeList = excludeList.concat(['LICENSE', 'README.md', 'NOTICE.txt',
            'deploy_autoscale.sh']);
    }
    // copy aws cloud formation to temp dir
    await copyAndDelete(rDirSrcCloudFormation, rTempDirCloudFormation,
        excludeList);

    // create /functions/packages folder
    await makeDir(rTempDirFunctionPackages);
    await makeDir(rTempDirFunctionSources);
    // remove aws-quickstart unwanted files
    await remove(excludeList, lambdaTempDir);
    // zip the aws lambda
    zipFilePath = await zipSafe('lambda.zip', lambdaTempDir);
    // move the lambda.zip to  into functions/packages/lambda.zip
    await moveSafe(zipFilePath, rTempDirFunctionPackages);
    // move the aws lambda source into functions/source
    await moveSafe(lambdaTempDir, rTempDirFunctionSources, {moveSourceFiles: true});
    // move the aws lambda init configset pacakge into the cloud formation dir
    // await moveSafe(lambdaInitConfigSetTempDir, rTempDirCloudFormation);
    // zip the aws cloud formation dir
    zipFileName = options.quickstart ? 'fortigate-autoscale-aws-quickstart.zip' :
        'fortigate-autoscale-aws-cloudformation.zip';
    zipFilePath = await zipSafe(zipFileName, rTempDirCloudFormation);
    // copy the zip file to dist
    await moveSafe(zipFilePath, rDirDist);
    await removeTempDir();
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${path.resolve(rDirDist, zipFileName)}`);
}

async function makeDistAzureFuncApp() {
    console.info('Making distribution zip package');
    let rTempDir = await makeTempDir(),
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
    await makeDir(rTempDirSrc);
    await makeDir(rDirDist);
    // copy funcapp module to temp dir
    await copyAndDelete(rDirSrcFuncapp, rTempDirSrcFuncApp, ['node_modules', 'local', 'test',
        '.nyc_output', '.vscode', 'host.json', 'local.settings.json', 'package-lock.json']);
    // create library dir on funcapp
    await makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy azure module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcAzure, rTempDirSrcAzure,
        ['node_modules', 'local', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install azure as dependency
    await npmInstallAt(rTempDirSrcFuncApp,
        ['--save', rTempDirSrcAzure.replace(rTempDirSrcFuncApp, '.')]);
    // read package info of module funcapp
    packageInfo = readPackageJsonAt(rTempDirSrcFuncApp);
    zipFileName = `${packageInfo.name}.zip`;
    saveAsFile = path.resolve(rDirDist, zipFileName);
    // zip
    zipFilePath =
        await zipSafe(zipFileName, rTempDirSrcFuncApp, ['*.git*', '*.vsc*']);
    // move it to dist directory
    await moveSafe(zipFilePath, rDirDist);
    await removeTempDir();
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAsFile}`);
}

async function makeDistProject() {
    console.info('Making distribution zip package');
    // create temp folder
    let realTmpDir = await makeTempDir(),
        realTmpSrcDir = path.resolve(realTmpDir, 'src'),
        realDistDir = path.resolve(REAL_PROJECT_ROOT, './dist'),
        packageInfo,
        zipFileName,
        realZipFilePath,
        saveAsFilePath;

    // create a temp dir for making files
    // done by makeTempDir() already
    // create a src dir under the temp dir
    await makeDir(realTmpSrcDir);
    // copy all files from project root to temp src dir,
    // excluding some files not need to distribute
    await copyAndDelete(REAL_PROJECT_ROOT, realTmpSrcDir, ['node_modules', 'dist', 'local',
        '.nyc_output', '.vscode', '.tmp', '*.git', 'package-lock.json', '*workspace*',
        '*local.settings.json*']);
    // change the temp src dir to autoscale
    realTmpSrcDir = path.join(realTmpSrcDir, REAL_PROJECT_DIRNAME);
    // read the package and determine the distribution zip file name
    packageInfo = readPackageJsonAt(realTmpSrcDir);
    // determine the zip file name
    zipFileName = `${packageInfo.name}.zip`;
    // pack to a zip file
    realZipFilePath = await zipSafe(zipFileName, realTmpSrcDir);
    saveAsFilePath = path.resolve(realDistDir, zipFileName);
    // move this file to distribution dir
    await moveSafe(realZipFilePath, saveAsFilePath);
    await removeTempDir();

    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${saveAsFilePath}`);
}

async function makeDistAzureQuickStart() {
    // create the azure function app
    await makeDistAzureFuncApp();
    console.info('Making Azure QuickStart zip package');
    // create temp folder
    let rTempDir = await makeTempDir(),
        rTempDirQuickStart = path.resolve(rTempDir, 'azure_quickstart'),
        rDirSrcFuncapp = path.resolve(REAL_PROJECT_ROOT, './azure_funcapp'),
        rDirSrcQuickStart = path.resolve(REAL_PROJECT_ROOT, './azure_quickstart'),
        rDirDist = path.resolve(REAL_PROJECT_ROOT, 'dist'),
        packageInfo,
        zipFileName,
        zipFilePath,
        rDistZipFuncapp;

    // copy azure quick start to temp dir
    await copyAndDelete(rDirSrcQuickStart, rTempDirQuickStart,
        ['local*']);
    // read package info of azure funcapp module
    packageInfo = readPackageJsonAt(rDirSrcFuncapp);
    zipFileName = `${packageInfo.name}.zip`;
    rDistZipFuncapp = path.resolve(rDirDist, zipFileName);
    // copy azure function app zip to the temp quick start dir
    await copy(rDistZipFuncapp, rTempDirQuickStart);
    // zip the quick start dir
    zipFileName = 'fortigate-autoscale-azure-quickstart.zip';
    zipFilePath = await zipSafe(zipFileName, rTempDirQuickStart);
    // copy the zip file to dist
    await moveSafe(zipFilePath, rDirDist);
    await removeTempDir();
    console.info('\n\n( ͡° ͜ʖ ͡°) package is saved as:');
    console.info(`${path.resolve(rDirDist, zipFileName)}`);
}

async function makeDistAll() {
    await makeDistCore();
    // await makeDistAWS();
    await makeDistAWSLambda();
    await makeDistAzure();
    await makeDistAzureFuncApp();
    await makeDistAzureQuickStart();
    await makeDistProject();
    await makeDistAwsCloudFormation();
}

let scrptName = process.argv[ARGV_PROCESS_PACKAGING_SCRIPT_NAME] || 'default';
// make distribution package
switch (scrptName.toLowerCase()) {
    case 'core':
        makeDistCore();
        break;
    case 'aws':
        makeDistAWS();
        break;
    case 'azure':
        makeDistAzure();
        break;
    case 'azure-quickstart':
        makeDistAzureQuickStart();
        break;
    case 'azure-funcapp':
        makeDistAzureFuncApp();
        break;
    case 'aws-lambda':
        makeDistAWSLambda();
        break;
    case 'aws-cloudformation':
        makeDistAwsCloudFormation();
        break;
    case 'aws-quickstart-special':
        makeDistAwsCloudFormation({quickstart: true});
        break;
    case 'project':
        makeDistProject();
        break;
    case 'old-way':
        // if no script argument given, use the old making process
        oldWayMakeDist();
        break;
    case 'all':
        makeDistAll();
        break;
    default:
        console.warn('( ͡° ͜ʖ ͡°) Usage: please use one of these commands:');
        console.warn('npm run build-all');
        console.warn('npm run build-project');
        console.warn('npm run build-core');
        console.warn('npm run build-azure');
        console.warn('npm run build-azure-funcapp');
        console.warn('npm run build-azure-quickstart');
        console.warn('npm run build-aws-lambda');
        console.warn('npm run build-aws-cloudformation');
        console.warn('npm run build-aws-quickstart-special');
        break;
}
