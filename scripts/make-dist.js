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
    let output = '', errout = '';
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
            data = data.toString();
            errout += data;
            if (options && options.supressError) {
                console.warn(`stderr: ${data.trim()}`);
            }
        });

        cproc.on('error', err => {
            if (options && options.supressError) {
                console.error(`error : ${err}`);
            } else {
                reject(err);
            }
        });

        cproc.on('close', function() {
            if (errout && options && !options.supressError) {
                reject(errout.trim());
            } else {
                resolve(output.trim());
            }
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

async function npmInstallLocal(location, args = [], options = {}, cachePath = null,
pacache = {}) {
    let dependencies = [];
    let packageInfo = readPackageJsonAt(location);
    if (packageInfo.name) {
        let pathInfo = path.parse(path.resolve(location)),
            packPath = path.join(pathInfo.dir, pathInfo.ext ? '' : pathInfo.base);
        Object.assign(options, {
            supressError: true
        });
        // parse each dependency
        if (packageInfo && packageInfo.dependencies) {
            dependencies = Object.keys(packageInfo.dependencies);
            while (dependencies.length > 0) {
                let depKey = dependencies.shift();
                let depPath = packageInfo.dependencies[depKey].match('(?<=file:).*');
                // should install from a local package
                // recursively check if the local package depends on any other local package or not
                if (depPath && Array.isArray(depPath) && depPath.length > 0) {
                    depPath = depPath[0];
                    // ignore if it's already in the package cache list
                    if (pacache.hasOwnProperty(depKey)) {
                        continue;
                    }
                    pacache[depKey] = null;
                    pacache = await npmInstallLocal(path.resolve(packPath, depPath),
                        args, options, cachePath, pacache);
                }
            }
        }
        let pKeys = Object.keys(pacache), packageInfoUpdated = false;
        if (packageInfo.dependencies) {
            Object.keys(packageInfo.dependencies).forEach(key => {
                if (pKeys.includes(key)) {
                    packageInfo.dependencies[key] = path.relative(location, pacache[key]);
                    packageInfoUpdated = true;
                }
            });
            if (packageInfoUpdated) {
                fs.writeFileSync(path.resolve(location, 'package.json'),
                    JSON.stringify(packageInfo, null, 4));
            }
        }
        options.noSymlink = false;
        await npmInstallAt(location, args, options);
        let packageFileName = await runCmd('npm', ['pack'].concat(args), packPath, options);
        moveSafe(path.resolve(packPath, packageFileName), cachePath);
        if (pacache.hasOwnProperty(packageInfo.name)) {
            pacache[packageInfo.name] = path.resolve(cachePath, packageFileName);
            console.log(pacache[packageInfo.name]);
        }
        return pacache;

    } else {
        return false;
    }
}

async function npmInstallAt(location, args = [], options = {}) {
    let packageInfo = readPackageJsonAt(location);
    if (packageInfo.name) {
        let pathInfo = path.parse(path.resolve(location)),
            packPath = path.join(pathInfo.dir, pathInfo.ext ? '' : pathInfo.base);
        Object.assign(options, {
            supressError: true
        });
        return await runCmd('npm', ['install'].concat(args), packPath, options);
    } else {
        return false;
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

async function makeDistAWSLambdaFgtAsgHandler(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS Lambda');
    let rTempDir = await makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcLambda = path.resolve(rTempDirSrc, 'aws_lambda_fgt_asg_handler'),
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
    // TODO: the following two function calls should be removed once async-cfn-response module is
    // published to npm
    // copy aws_cfn_response module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcCfnResponse, rTempDirSrcCfnResponse,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws_cfn_response as dependency
    await npmInstallAt(rTempDirSrcLambda,
        ['--save', rTempDirSrcCfnResponse.replace(rTempDirSrcLambda, '.')]);

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

async function makeDistAWSLambdaFazHandler(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS Lambda FAZ Handler');
    let rTempDir = await makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcLambda = path.resolve(rTempDirSrc, 'aws_lambda_fazhandler'),
        rTempDirSrcLib = path.resolve(rTempDirSrcLambda, 'lib'),
        rTempDirSrcCore = path.resolve(rTempDirSrcLib, 'core'),
        rTempDirSrcAws = path.resolve(rTempDirSrcLib, 'aws'),
        packageInfo,
        zipFilePath,
        rDirSrcCore = path.resolve(REAL_PROJECT_ROOT, './core'),
        rDirSrcAws = path.resolve(REAL_PROJECT_ROOT, './aws'),
        rDirSrcLambda = path.resolve(REAL_PROJECT_ROOT, './aws_lambda_fazhandler'),
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

async function makeDistAWSLambdaNicAttachment(options = {saveToDist: 'zip', keepTemp: false}) {
    console.info('Making distribution zip package for: AWS Lambda Nic attachment');
    let rTempDir = await makeTempDir(),
        rTempDirSrc = path.resolve(rTempDir, 'src'),
        rTempDirSrcLambda = path.resolve(rTempDirSrc, 'aws_lambda_nic_attachment'),
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
    // TODO: the following two function calls should be removed once async-cfn-response module is
    // published to npm
    // copy aws_cfn_response module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcCfnResponse, rTempDirSrcCfnResponse,
        ['node_modules', 'local*', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install aws_cfn_response as dependency
    await npmInstallAt(rTempDirSrcCfnResponse,
        ['--save', rTempDirSrcCfnResponse.replace(rTempDirSrcLambda, '.')]);

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

async function makeDistAwsCloudFormation(options = {excludeList: [], quickstart: false,
    fazhandler: true}) {
    // create the aws cloud formation package
    console.info('Making distribution zip package for: AWS Cloud Formation');
    // create the aws lambda pacakge (directory)
    let lambdaTempDir = await makeDistAWSLambdaFgtAsgHandler({saveToDist: 'none', keepTemp: true}),
        nicAttachmentTempDir = await makeDistAWSLambdaNicAttachment(
            {saveToDist: 'none', keepTemp: true}),
        rTempDir = await makeTempDir(), // create temp folder
        rTempDirCloudFormation = path.resolve(rTempDir, 'aws_cloudformation'),
        rTempDirFunctionPackages = path.resolve(rTempDirCloudFormation, 'functions', 'packages'),
        rTempDirFunctionSources =
            path.resolve(rTempDirCloudFormation, 'functions', 'source', 'asg-handler'),
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

    // create /functions/packages & source folder
    await makeDir(rTempDirFunctionPackages);
    await makeDir(rTempDirFunctionSources);

    // remove aws-quickstart unwanted files
    await remove(excludeList, lambdaTempDir);
    // zip the aws lambda
    zipFilePath = await zipSafe('asg-handler.zip', lambdaTempDir);
    // move the zip to functions/packages/
    await moveSafe(zipFilePath, rTempDirFunctionPackages);
    // move the source into functions/source/
    await moveSafe(lambdaTempDir, rTempDirFunctionSources, {moveSourceFiles: true});

    // nic attachment
    // remove aws-quickstart unwanted files
    await remove(excludeList, nicAttachmentTempDir);
    // zip the aws lambda
    zipFilePath = await zipSafe('nic-attachment.zip', nicAttachmentTempDir);
    // move the zip to functions/packages/
    await moveSafe(zipFilePath, rTempDirFunctionPackages);
    // move the source into functions/source/
    await moveSafe(lambdaTempDir, rTempDirFunctionSources, {moveSourceFiles: true});

    if (options.fazhandler) {
        let fazHandlerTempDir =
        await makeDistAWSLambdaFazHandler({saveToDist: 'none', keepTemp: true}),
            rTempDirFazFuncPackages = path.resolve(rTempDirCloudFormation,
            'functions', 'packages'),
            rTempDirFazFuncSources = path.resolve(rTempDirCloudFormation,
            'functions', 'source', 'faz-handler');
        // create faz-handler/functions/packages & source folder
        await makeDir(rTempDirFazFuncPackages);
        await makeDir(rTempDirFazFuncSources);
        // remove aws-quickstart unwanted files
        await remove(excludeList, fazHandlerTempDir);
        // zip the faz-handler lambda
        zipFilePath = await zipSafe('faz-handler.zip', fazHandlerTempDir);
        // move the faz-handler lambda.zip to into faz-handler/functions/packages/lambda.zip
        await moveSafe(zipFilePath, rTempDirFazFuncPackages);
        // move the faz-handler lambda source into faz-handler/functions/source
        await moveSafe(fazHandlerTempDir, rTempDirFazFuncSources, {moveSourceFiles: true});
    }

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
        '.nyc_output', '.vscode', 'bin', 'obj',
        '*.csproj', 'proxies.json', 'host.json', 'local.settings.json', 'package-lock.json']);
    // create library dir on funcapp
    await makeDir(rTempDirSrcLib);
    // copy core module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcCore, rTempDirSrcCore,
        ['node_modules', 'local', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // copy azure module to temp dir and remove unnecessary files
    await copyAndDelete(rDirSrcAzure, rTempDirSrcAzure,
        ['node_modules', 'local', 'test', '.nyc_output', '.vscode', 'package-lock.json']);
    // install azure as dependency

    // await npmInstallLocal(rTempDirSrcFuncApp,
    //     [], {noSymlink: true}, rTempDirSrcLib);
    await npmInstallAt(rTempDirSrcFuncApp,
        ['--save', rTempDirSrcAzure.replace(rTempDirSrcFuncApp, '.')], {noSymlink: true});
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
    case 'aws-lambda-faz-handler':
        makeDistAWSLambdaFazHandler();
        break;
    case 'build-aws-lambda-nic-attachment':
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
        console.warn('npm run build-core');
        console.warn('npm run build-azure');
        console.warn('npm run build-azure-funcapp');
        console.warn('npm run build-azure-quickstart');
        console.warn('npm run build-aws-lambda');
        console.warn('npm run build-aws-lambda-faz-handler');
        console.warn('npm run build-aws-lambda-nic-attachment');
        console.warn('npm run build-aws-cloudformation');
        console.warn('npm run build-aws-quickstart-special');
        break;
}
