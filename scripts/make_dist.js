#!/usr/bin/env node

'use strict';

let { exec, spawn } = require('child_process');
const path = require('path');

// the argument index for the packaging script
const ARGV_PROCESS_PACKAGING_SCRIPT_NAME = 2;

function runCmd(cmd, args = [], cwd = process.cwd(), options) {
    let output = '';
    return new Promise((resolve, reject) => {
        console.log(`run command:${cmd} ${args.join(' ')} on dir: ${cwd}`);
        let cproc = spawn(cmd, args, { cwd: cwd});

        cproc.stdout.on('data', function(data) {
            output += data;
            if (options && options.printStdout) {
                console.log(`stdout: ${data}`);
            }
        });

        cproc.stderr.on('data', function(data) {
            if (options && !options.surpressError) {
                console.log(`stderr: ${data}`);
            } else {
                reject(data);
            }
        });

        cproc.on('error', err => {
            if (options && !options.surpressError) {
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
                if (options && !options.surpressError) {
                    console.error(`exec error: ${error}`);
                } else {
                    reject(error);
                }
            }
            console.log(`stdout: ${stdout}`);
            console.log(`stderr: ${stderr}`);
        });
    }).catch(err => {
        // TODO: npm install can generate warning. how to handle warnings here?
        console.log(err.toString());
    });

}

async function createTempDir() {
    // no error handling here
    let tmpDir = await runCmd('mktemp', ['-d']);
    return tmpDir.trim();
}

// eslint-disable-next-line no-unused-vars
function findAndDelete(pattern, dir) {
    // return execCmd('find ./ -type d -name "pattern" -exec rm -rf {} \\;', dir);
}

function oldWayMakeDist() {
    var pkg = require('../package.json'),
        os = require('os'),
        fs = require('fs'),
        path = require('path'), // eslint-disable-line no-shadow
        rimraf = require('rimraf');

    process.env.TMPDIR = fs
        .mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `${pkg.name}-`)) + path.sep;

    // Shorter version of node_modules/dpl/dpl.js which avoids the 'upload' phase

    var dpl = require('dpl/lib/index.js');
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

function makeDistCore() {

}

function makeDistAWS() {

}

function makeDistAzure() {

}

async function makeDistAzureFuncApp() {
    console.log('Making distribution zip package');
    // create temp folder
    let tmpDir = await createTempDir();
    console.log(tmpDir, process.cwd());
    let tmpSrc = path.resolve(tmpDir, 'src'),
        tmpSrcCore = path.resolve(tmpSrc, 'core'),
        tmpSrcAzure = path.resolve(tmpSrc, 'azure'),
        tmpSrcFuncapp = path.resolve(tmpSrc, 'azure_funcapp'),
        tmpDes = path.resolve(tmpDir, 'dist'),
        tmpDesFuncapp = path.resolve(tmpDes, 'azure_funcapp'),
        zipFileName = 'azure_funcapp.zip',
        saveAsFile = path.resolve('dist', zipFileName);


    await runCmd('rm', ['-rf', tmpSrc ? tmpSrc : '/tmp/tmp'],
        process.cwd(), {surpressError: true});
    await runCmd('mkdir', ['-p', tmpSrc]);
    // copy modules to temp dir
    await runCmd('cp', ['-rL', 'core', tmpSrc]);
    await runCmd('rm', ['-rf', path.resolve(tmpSrcCore, 'node_modules')],
    process.cwd(), {surpressError: true});
    await runCmd('cp', ['-rL', 'azure', tmpSrc]);
    await runCmd('rm', ['-rf', path.resolve(tmpSrcAzure, 'node_modules')],
    process.cwd(), {surpressError: true});
    await runCmd('cp', ['-rL', 'azure_funcapp', tmpSrc]);
    await runCmd('rm', ['-rf', path.resolve(tmpSrcFuncapp, 'node_modules')],
    process.cwd(), {surpressError: true});
    await runCmd('npm', ['install'], tmpSrcCore);
    await runCmd('npm', ['prune', '--production'], tmpSrcCore);

    await runCmd('npm', ['install'], tmpSrcAzure);
    await runCmd('npm', ['prune', '--production'], tmpSrcAzure);

    await runCmd('npm', ['install'], tmpSrcFuncapp);
    await runCmd('npm', ['prune', '--production'], tmpSrcFuncapp);

    await runCmd('rm', ['-rf', tmpDes ? tmpDes : '/tmp/tmp'],
        process.cwd(), {surpressError: true});
    await runCmd('mkdir', ['-p', tmpDes]);

    await runCmd('cp', ['-rL', tmpSrcFuncapp, tmpDes]);
    await runCmd('npm', ['prune', '--production'], tmpDesFuncapp);

    await runCmd('zip', ['-r', zipFileName, './', '-x', '*.git*', '*.v*'], tmpDesFuncapp);

    await runCmd('mv', [zipFileName, saveAsFile], tmpDesFuncapp);

    await runCmd('rm', ['-rf', tmpDir !== '/' ? tmpDir : '/tmp/tmp'],
            process.cwd(), {surpressError: true});
    await runCmd('rm', ['-rf', tmpDir !== '/' ? tmpDir : '/tmp/tmp'],
            process.cwd(), {surpressError: true});
    console.log(`package is saved as: ${saveAsFile}`);
}

async function makeDistAll() {
    console.log('Making distribution zip package');
    // create temp folder
    let tmpDir = await createTempDir();
    console.log(tmpDir, process.cwd());
    let tmpSrc = path.resolve(tmpDir, 'src'),
        zipFileName = 'multi_cloud_autoscale.zip',
        saveAsFile = path.resolve('dist', zipFileName);


    await runCmd('rm', ['-rf', tmpSrc ? tmpSrc : '/tmp/tmp'],
        process.cwd(), {surpressError: true});
    await runCmd('mkdir', ['-p', tmpSrc]);
    // copy modules to temp dir
    await runCmd('cp', ['-rL', '.', tmpSrc]);

    await findAndDelete('.nyc_output', tmpSrc);

    await runCmd('zip', ['-r', zipFileName, './',
        '-x', '*node_modules*', '*.eslint*', '*.eslint*', '*.travis*', '*workspace*',
        '*local.settings.json*', '*.tmp*', '*.git*', '*.v*', '*.nyc*'], tmpSrc);

    await runCmd('mv', [zipFileName, saveAsFile], tmpSrc);

    await runCmd('rm', ['-rf', tmpDir],
            process.cwd(), {surpressError: true});
    console.log(`package is saved as: ${saveAsFile}`);
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
    case 'azure_funcapp':
        makeDistAzureFuncApp();
        break;
    case 'old-way':
        // if no script argument given, use the old making process
        oldWayMakeDist();
        break;
    case 'all':
        makeDistAll();
        break;
    default:
        console.warn('Usage: please use one of these commands:');
        console.warn('npm run build-all');
        console.warn('npm run build-core');
        console.warn('npm run build-azure');
        console.warn('npm run build-azure-funcapp');
        break;
}
