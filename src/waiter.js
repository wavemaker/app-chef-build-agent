const fs = require('fs-extra');
const logger = require('@wavemaker/wm-cordova-cli/src/logger');
const {
    findFile
} = require('@wavemaker/wm-cordova-cli/src/utils');
const FormData = require('form-data');
const execa = require('execa');
const axios = require('axios');
const loggerLabel = 'Waiter';
const MAX_FILE_SIZE_FOR_UPLOAD = 200 * 1024 * 1024;
const MAX_REQUEST_ALLOWED_TIME = 3 * 60 * 1000;
const path = require('path');

const canUploadFile = (path) => {
    const stats = fs.statSync(path);
    return !!(stats && stats['size'] && stats['size'] < MAX_FILE_SIZE_FOR_UPLOAD);
};

class Waiter {
    constructor(kitchen) {
        this.kitchen = kitchen;
    }

    takeOrder() {
        const tempFile = this.kitchen.tempDir + `mobile_${Date.now()}.zip`;
        const fw = fs.createWriteStream(tempFile);
        let url = `${this.kitchen.appChef}services/chef/assignWork?`
        url += `platforms=${this.kitchen.targetPlatforms}&key=${this.kitchen.appChefKey}`;
        let buildTaskToken = null;
        return axios.get(url, {
            responseType: 'json'
        }).then(res => {
            if (!res.data.taskToken) {
                return;
            }
            return axios.get(res.data.zipUrl, {
                timeout: MAX_REQUEST_ALLOWED_TIME,
                responseType: 'stream'
            }).then(res => {
                return new Promise((resolve, reject) => {
                    res.data.pipe(fw);
                    fw.on('error', err => {
                        reject(err);
                        fw.close();
                    });
                    fw.on('close', resolve);
                });
            }).then(() => res.data.taskToken);
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
                    message: "unzipped the zip file at " + tempFile
                });
                fs.mkdirsSync(buildFolder + '_br');
                fs.renameSync(buildFolder + 'src/_br', buildFolder + '_br');
                return buildTaskToken;
            });
        });
    }

    async serve(success, buildTaskToken, buildFolder, settings) {
        success = !!success;
        const platform = settings.platform;
        const buildData = {};
        return Promise.resolve()
            .then(() => {
                let artifact = null;
                if (success && platform == "ios") {
                    artifact = findFile(buildFolder + "build/output/" + platform, /\.ipa?/);
                }
                if (success && platform == "android") {
                    artifact = findFile(buildFolder + "build/output/" + platform, /(\.apk?|\.aab?)/);
                }
                if (artifact) {
                    if (canUploadFile(artifact)) {
                        buildData['outputName'] = path.basename(artifact);
                        if (settings.upload && settings.upload.to === 's3') {
                            const params = settings.upload;
                            buildData['outputAt'] = params.key;
                            return axios.put(params.uploadUrl, fs.readFileSync(artifact), {
                                headers: {
                                    'Content-Type': 'application/octet-stream'
                                },
                                timeout: MAX_REQUEST_ALLOWED_TIME,
                                maxContentLength: Infinity,
                                maxBodyLength: Infinity
                            });
                        } else {
                            form.append("output", fs.createReadStream(artifact));
                        }
                    } else {
                        logger.error({
                            label: loggerLabel,
                            message: "Could not upload the archive as maximum size that can be uploaded is  " + (MAX_FILE_SIZE_FOR_UPLOAD / (1024 * 1024)) + " MB."
                        });
                        success = false;
                    }
                }
            }).then(() => {
                buildData['buildFolder'] = buildFolder;
                buildData['buildTaskToken'] = buildTaskToken;
                buildData['success'] = success;
                return this.upload(buildData, 5).then(() => {
                    logger.info({
                        label: loggerLabel,
                        message: "successfully served the order."
                    });
                }).catch((msg) => {
                    logger.error({
                        label: loggerLabel,
                        message: "failed to serve the order with response as follows : " + msg
                    });
                }).then(() => {
                    fs.removeSync(buildFolder + (success ? '' : '_br'));
                });
            });
    }


    upload(data, retryCount) {
        const buildLog = findFile(data.buildFolder + "build/output/logs/", /build.log?/);
        const form = new FormData();
        data.outputName && form.append('outputName', data.outputName);
        data.outputAt && form.append('outputAt', data.outputAt);
        form.append("log", fs.createReadStream(buildLog));
        form.append("success", "" + data.success);
        form.append("token", data.buildTaskToken);
        form.append("key", this.kitchen.appChefKey);
        return axios.post(`${this.kitchen.appChef}services/chef/onBuildFinish`, form, {
            headers : form.getHeaders()
        })
        .catch((msg) => {
            if (retryCount) {
                logger.error({
                    label: loggerLabel,
                    message: "failed to serve the order. Trying for another time."
                });
                return new Promise((res, rej) => {
                    setTimeout(() => {
                        this.upload(data, --retryCount).then(res, rej);
                    }, 30000);
                });
            } else {
                return Promise.reject(msg);
            }
        });
    }
}

module.exports = Waiter;
