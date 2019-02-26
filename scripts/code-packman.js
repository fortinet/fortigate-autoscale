#!/usr/bin/env node
'use strict';
/* eslint-disable no-unused-vars */
exports = module.exports;
const path = require('path'),
    fs = require('fs');
let { exec, spawn } = require('child_process');

class Packman {
    constructor() {
        this._tempDir = null;
    }

    static spawn() {
        return new Packman();
    }

    runCmd(cmd, args = [], cwd = process.cwd(), options) {
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
    execCmd(cmd, cwd = process.cwd(), options) {
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

    async isGNUBash() {
        try {
            let bashVersion = await this.execCmd('bash --version', process.cwd(), {
                mute: true
            });
            return bashVersion.trim().indexOf('GNU bash') !== -1;
        } catch (error) {
            return false;
        }
    }

    async makeTempDir(options = {}) {
        if (!this._tempDir) {
            this._tempDir = await this.runCmd('mktemp', ['-d'], process.cwd(), options);
            this._tempDir = this._tempDir.trim();
        }
        return this._tempDir;
    }

    async removeTempDir(options = {}) {
        if (this._tempDir) {
            await this.execCmd(`rm -rf ${this._tempDir}`, process.cwd(), options);
            this._tempDir = null;
        }
        return true;
    }

    resetTempDir() {
        this._tempDir = null;
        return true;
    }

    async makeDir(location, cwd = process.cwd(), options = {}) {
        await this.execCmd(`mkdir -p ${path.resolve(cwd, location)}`, cwd, options);
    }

    async copy(src, des, cwd = process.cwd(), options = {}) {
        if (!await this.isGNUBash()) {
            throw new Error('Sorry, this script can only run on a GNU bash shell.');
        }
        if (path.resolve(des).indexOf(path.resolve(src)) === 0) {
            throw new Error(`\n\n( ͡° ͜ʖ ͡°) copying <${src}> to its subdir <${des}> creates` +
            ' a circular reference. I won\'t allow this happen.');
        }
        return new Promise((resolve, reject) => {
            this.execCmd(`cp -rL ${src} ${des}`, cwd, options).then(output => resolve(output))
                .catch(error => reject(error));
        });
    }

    async copyAndDelete(src, des, excludeList = [], options = {}) {
        // copy funcapp module to temp dir
        await this.copy(src, des, process.cwd(), options);
        // remove unnecessary files and directories
        await this.remove(excludeList, des, process.cwd(), options);
        return true;
    }

    async deleteSafe(location, onDir, options = {}) {
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
        await this.execCmd(`rm -rf ${realPath}`, onDir, options);
    }

    async remove(search, cwd = process.cwd(), options = {}) {
        if (typeof search === 'string') {
            search = [search];
        }
        if (search instanceof Array) {
            for (let index in search) {
                if (typeof search[index] !== 'string') {
                    break;
                }
                let foundArray = await this.find(search[index], cwd);
                for (let location of foundArray) {
                    if (location) {
                        await this.deleteSafe(location, cwd, options);
                    }
                }
                if (++index === search.length) {
                    return true;
                }
            }
        }
        console.error('( ͡° ͜ʖ ͡°) <search> only accepts string or string array when remove.');
    }

    async find(search, onDir) {
        return await this.execCmd(`find . -name "${search}"`, onDir, {
            printStdout: false,
            printStderr: false
        }).then(output => {
            return output.split('\n').filter(line => line.trim());
        }).catch(error => {
            console.log(error.message);
            return [];
        });
    }

    readPackageJsonAt(location) {
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

    async moveSafe(src, des, options = {}) {
        if (!(src && des)) {
            console.error('<src> and <des> must be provided.');
            return false;
        }
        if (path.resolve(des).indexOf(path.resolve(src)) === 0) {
            throw new Error(`\n\n( ͡° ͜ʖ ͡°) moving <${src}> to its subdir <${des}> creates` +
            ' a circular reference. I won\'t allow this happen.');
        }
        if (options.moveSourceFiles) {
            return await this.execCmd(`mv ${path.resolve(src)}/* ${path.resolve(des)}`,
            process.cwd(), options);
        } else {
            return await this.execCmd(`mv ${path.resolve(src)} ${path.resolve(des)}`,
            process.cwd(), options);
        }
    }

    async zipSafe(fileName, src, excludeList = [], options = {}) {
        let des, args = [],
            realPath = path.resolve(src);
        // allow to create zip file in cwd, otherwise, create in the temp dir
        if (realPath.indexOf(process.cwd()) === 0) {
            des = realPath;
        } else {
            des = path.resolve(await this.makeTempDir(), src);
        }
        args = args.concat(['-r', fileName, '.']);
        if (Array.isArray(excludeList) && excludeList.length > 0) {
            args.push('-x');
            args = args.concat(excludeList);
        }
        await this.runCmd('zip', args, des, options);
        return path.resolve(des, fileName);
    }


    async npmInstallLocal(location, args = [], options = {}, cachePath = null,
    pacache = {}) {
        let dependencies = [];
        let packageInfo = this.readPackageJsonAt(location);
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
                    // recursively check if the local package depends
                    // on any other local package or not
                    if (depPath && Array.isArray(depPath) && depPath.length > 0) {
                        depPath = depPath[0];
                        // ignore if it's already in the package cache list
                        if (pacache.hasOwnProperty(depKey)) {
                            continue;
                        }
                        pacache[depKey] = null;
                        pacache = await this.npmInstallLocal(path.resolve(packPath, depPath),
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
            await this.npmInstallAt(location, args, options);
            let packageFileName =
                await this.runCmd('npm', ['pack'].concat(args), packPath, options);
            this.moveSafe(path.resolve(packPath, packageFileName), cachePath);
            if (pacache.hasOwnProperty(packageInfo.name)) {
                pacache[packageInfo.name] = path.resolve(cachePath, packageFileName);
                console.log(pacache[packageInfo.name]);
            }
            return pacache;

        } else {
            return false;
        }
    }

    async npmInstallAt(location, args = [], options = {}) {
        let packageInfo = this.readPackageJsonAt(location);
        if (packageInfo.name) {
            let pathInfo = path.parse(path.resolve(location)),
                packPath = path.join(pathInfo.dir, pathInfo.ext ? '' : pathInfo.base);
            Object.assign(options, {
                supressError: true
            });
            return await this.runCmd('npm', ['install'].concat(args), packPath, options);
        } else {
            return false;
        }
    }
}


module.exports = Packman;
