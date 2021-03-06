const command = require('@wavemaker/wm-cordova-cli/src/command');
const logger = require('@wavemaker/wm-cordova-cli/src/logger');
const fs = require('fs-extra');

const loggerLabel = 'cook';

class Cook {

    constructor(kitchen) {
        this.kitchen = kitchen; 
    }

    async doWork(buildTaskToken) {
        const start = Date.now();
        const buildFolder = `${this.kitchen.wsDir}${buildTaskToken}/`;
        logger.info({
            label: loggerLabel,
            message: "build is about to start in the next milliseconds."
        });
        let result = {};
        const settingsFile = buildFolder + '_br/settings.json';
        const settings = require(settingsFile);
        fs.removeSync(settingsFile);
        try {
            if (settings.platform === 'ios') {
                result = await command.build({
                    platform: settings.platform,
                    src: `${buildFolder}src/`,
                    dest: `${buildFolder}build/`,
                    iCertificate: buildFolder + settings.codesign.certificate,
                    iCertificatePassword: settings.codesign.unlockPassword,
                    iProvisioningFile: buildFolder + settings.codesign.provisioningProfile,
                    packageType: settings.packageType,
                    cordovaVersion: settings.cordovaVersion,
                    cordovaIosVersion: settings.cordovaIosVersion
                });
            } else if (settings.platform === 'android') {
                result = await command.build({
                    platform: settings.platform,
                    src: `${buildFolder}src/`,
                    dest: `${buildFolder}build/`,
                    aKeyStore: settings.codesign.keyStore ? buildFolder + settings.codesign.keyStore : null,
                    aStorePassword: settings.codesign.storePassword,
                    aKeyAlias: settings.codesign.keyAlias,
                    aKeyPassword: settings.codesign.keyPassword,
                    packageType: settings.packageType,
                    cordovaVersion: settings.cordovaVersion,
                    cordovaAndroidVersion: settings.cordovaAndroidVersion,
                    androidXMigrationEnabled: true
                });
            };
        } catch (e) {
            logger.error({
                label: loggerLabel,
                message: "build failed."
            });
            console.error(e);
        }
        logger.info({
            label: loggerLabel,
            message: `Build took ${(Date.now() - start)/1000}s`
        });
        await this.kitchen.waiter.serve(result && result.success, buildTaskToken, buildFolder, settings);
    }
}

module.exports = Cook;