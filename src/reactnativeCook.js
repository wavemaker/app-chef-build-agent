const command = require('@wavemaker/wm-reactnative-cli/src/command');
const logger = require('@wavemaker/wm-reactnative-cli/src/logger');
const fs = require('fs-extra');

const loggerLabel = 'ReactnativeCook';

class ReactnativeCook {

    constructor(kitchen) {
        this.kitchen = kitchen;
    }

    setAndroidEnvironment() {
        if (process.env.JAVA_11_HOME) {
            process.env.JAVA_HOME = process.env.JAVA_11_HOME;
            process.env.PATH = process.env.JAVA_HOME + ':' + process.env.PATH;
        }
    }

    async doWork(buildTaskToken, settings, buildFolder) {
        const start = Date.now();
        logger.info({
            label: loggerLabel,
            message: "build is about to start in the next milliseconds."
        });
        const buildType = settings.buildType === 'production' ? 'release' : 'debug';
        let result = {};
        try {
            if (settings.platform === 'ios') {
                result = await command.build({
                    src: `${buildFolder}src/`,
                    dest: `${buildFolder}build/`,
                    iCertificate: buildFolder + settings.codesign.certificate,
                    iCertificatePassword: settings.codesign.unlockPassword,
                    iProvisioningFile: buildFolder + settings.codesign.provisioningProfile,
                    buildType: buildType,
                    autoEject: true,
                    platform: 'ios'
                });
            } else if (settings.platform === 'android') {
                this.setAndroidEnvironment();
                result = await command.build({
                    src: `${buildFolder}src/`,
                    dest: `${buildFolder}build/`,
                    aKeyStore: settings.codesign.keyStore ? buildFolder + settings.codesign.keyStore : null,
                    aStorePassword: settings.codesign.storePassword,
                    aKeyAlias: settings.codesign.keyAlias,
                    aKeyPassword: settings.codesign.keyPassword,
                    buildType: buildType,
                    packageType: settings.packageType,
                    autoEject: true,
                    platform: 'android'
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

module.exports = ReactnativeCook;
