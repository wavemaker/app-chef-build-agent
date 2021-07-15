const CordovaCook = require('./cordovaCook');
const ReactnativeCook = require('./reactnativeCook');
const logger = require('@wavemaker/wm-cordova-cli/src/logger');
const fs = require('fs');

const loggerLabel = 'Manager';

class Manager {
    constructor(kitchen) {
        this.kitchen = kitchen;
        this.ownsLock = false;
    }

    async manage() {
        if (!this.ownsLock && fs.existsSync(this.kitchen.lockFile)) {
            process.exit();
            return;
        }
        this.ownsLock = true;
        fs.writeFileSync(this.kitchen.lockFile, 'locked');
        return this.kitchen.waiter.takeOrder().then(orderId => {
            fs.unlinkSync(this.kitchen.lockFile);
            this.ownsLock = false;
            if (!orderId) {
                logger.info({
                    label: loggerLabel,
                    message: "No Work !!!"
                });
                return;
            }
            return this.processOrder(orderId).then(() => {
                logger.info({
                    label: loggerLabel,
                    message: "Work is completed ."
                });
            }, () => {
                logger.info({
                    label: loggerLabel,
                    message: "Failed to complete Work."
                });
            });
        }, (e) => {
            logger.info({
                label: loggerLabel,
                message: "Failed to due to : " + e
            });
        }).then(() => {
            logger.info({
                label: loggerLabel,
                message: "Will check for work after " + this.kitchen.orderPullInterval + " ms"
            });
            if (this.ownsLock && fs.existsSync(this.kitchen.lockFile)) {
                fs.unlinkSync(this.kitchen.lockFile);
            }
        }).then(() => process.exit(), (e) => {
            console.error(e);
            process.exit();
        });
    }

    async process() {
        const orderId = await this.kitchen.waiter.takeOrder();
        await this.processOrder(orderId);
    }

    async processOrder(orderId) {
        const buildFolder = `${this.kitchen.wsDir}${orderId}/`;
        const settingsFile = buildFolder + '_br/settings.json';
        const settings = require(settingsFile);
        fs.removeSync(settingsFile);
        if (settings.recipe === 'REACT_NATIVE') {
            await new ReactnativeCook(this.kitchen).doWork(orderId, settings, buildFolder);
        } else {
            await new CordovaCook(this.kitchen).doWork(orderId, settings, buildFolder);
        }
    }
}

module.exports = Manager;
