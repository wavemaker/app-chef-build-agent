const fs = require('fs-extra');
const logger = require('wm-cordova-cli/src/logger');
const parseUrl = require('url').parse;
const {
    findFile
} = require('wm-cordova-cli/src/utils');
const FormData = require('form-data');
const execa = require('execa');
const loggerLabel = 'Waiter';
const MAX_FILE_SIZE_FOR_UPLOAD = 200 * 1024 * 1024;
const MAX_REQUEST_ALLOWED_TIME = 3 * 60 * 1000;
const path = require('path');
const {
    uploadToS3
} = require('./s3');

const canUploadFile = (path) => {
    const stats = fs.statSync(path);
    return !!(stats && stats['size'] && stats['size'] < MAX_FILE_SIZE_FOR_UPLOAD);
};

class Waiter {
    constructor(kitchen) {
        this.kitchen = kitchen;
    }

    takeOrder() {
        const tempFile = this.kitchen.tempDir + `cordova_${Date.now()}.zip`;
        return new Promise((resolve, reject) => {
            const fw = fs.createWriteStream(tempFile);
            let url = `${this.kitchen.appChef}services/chef/assignWork?`
            url += `platforms=${this.kitchen.targetPlatforms}&key=${this.kitchen.appChefKey}`;
            const req = this.kitchen.appChefHttp.get(url, res => {
                res.pipe(fw);
                fw.on('close', () => {
                    if (res.complete && res.statusCode == 200) {
                        resolve(res.headers['x-build_task_token']);
                    }else if (res.complete && res.statusCode == 204) {
                        resolve();
                    } else {
                        reject(res.statusCode);
                    }
                });
            });
            req.on('error', (reason) => {
                reject(reason);
            });
            req.setTimeout(MAX_REQUEST_ALLOWED_TIME, () => {
                req.abort();
                reject('request timedout');
            });
        }).catch((reason) => {
            fs.removeSync(tempFile);
            return Promise.reject(reason);
        }).then(buildTaskToken => {
            if (!buildTaskToken) {
                fs.existsSync(tempFile) && fs.removeSync(tempFile);
                return null;
            }
            const buildFolder = `${this.kitchen.wsDir}${buildTaskToken}/`;
            fs.emptyDirSync(buildFolder);
            fs.mkdirSync(buildFolder + "src", {
                recursive: true
            });
            logger.info({
                label: loggerLabel,
                message: "Work is found and required input is gonna be at " + buildFolder
            });
            return execa('unzip', [
                '-o',
                tempFile,
                '-d',
                buildFolder + 'src'
            ]).then(() => {
                fs.removeSync(tempFile);
                logger.info({
                    label: loggerLabel,
                    message: "unzipped cordova zip."
                });
                fs.mkdirsSync(buildFolder + '_br');
                fs.renameSync(buildFolder + 'src/_br', buildFolder + '_br');
                return buildTaskToken;
            });
        });
    }

    async serve(success, buildTaskToken, buildFolder) {
        success = !!success;
        const settings = require(buildFolder + '_br/settings.json');
        const platform = settings.platform;
        var form = new FormData();
        return Promise.resolve()
            .then(() => {
                let artifact = null;
                if (success && platform == "ios") {
                    artifact = findFile(buildFolder + "build/output/" + platform, /\.ipa?/);
                }
                if (success && platform == "android") {
                    artifact = findFile(buildFolder + "build/output/" + platform, /\.apk?/);
                }
                if (artifact) {
                    if (canUploadFile(artifact)) {
                        form.append('outputName', path.basename(artifact));
                        if (settings.upload && settings.upload.to === 's3') {
                            const params = settings.upload;
                            return uploadToS3(artifact, {
                                accessKeyId: params.accessKeyId,
                                secretAccessKey: params.secretAccessKey,
                                region: params.region,
                                bucketName: params.bucketName,
                                key: params.key
                            }).then(() => {
                                form.append('outputAt', params.key);
                                logger.info({
                                    label: loggerLabel,
                                    message: "successfully uploaded artifact to s3."
                                });
                            });
                        } else {
                            form.append("output", fs.createReadStream(artifact));
                        }
                    } else {
                        logger.error({
                            label: loggerLabel,
                            message: "Couldnot upload the archive as maximum size that can be uploaded is  " + (MAX_FILE_SIZE_FOR_UPLOAD / (1024 * 1024)) + " MB."
                        });
                        success = false;
                    }
                }
            }).then(() => {
                return new Promise((resolve, reject) => {
                    const buildLog = findFile(buildFolder + "build/output/logs/", /build.log?/);
                    form.append("log", fs.createReadStream(buildLog));
                    form.append("success", "" + success);
                    form.append("token", buildTaskToken);
                    form.append("key", this.kitchen.appChefKey);
                    const params = parseUrl(`${this.kitchen.appChef}services/chef/onBuildFinish`);
                    const request = this.kitchen.appChefHttp.request({
                        method: 'post',
                        host: params.hostname,
                        path: params.pathname,
                        headers: form.getHeaders()
                    });
                    form.pipe(request);
                    request.setTimeout(MAX_REQUEST_ALLOWED_TIME, () => {
                        request.abort();
                        reject('request timedout while serving the order.');
                    });
                    request.on('error', (reason) => {
                        reject(reason);
                    });
                    request.on('response', res => {
                        let body = '';
                        res.on('data', data => {
                            body += data;
                        });
                        res.on('error', data => {
                            body += data;
                        })
                        res.on('end', () => {
                            fs.removeSync(buildFolder + (success ? '' : '_br'));
                            if (res.complete && res.statusCode == 200) {
                                logger.info({
                                    label: loggerLabel,
                                    message: "successfully served the order."
                                });
                                resolve();
                            } else {
                                logger.error({
                                    label: loggerLabel,
                                    message: "failed to serve the order with response as follows : " + body
                                });
                                reject();
                            }
                        });
                        res.resume();
                    });
                });
            });
    }
}

module.exports = Waiter;