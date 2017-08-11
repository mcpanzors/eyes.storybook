'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const jsdom = require("jsdom/lib/old-api");
const request = require('request');
const spawn = require('child_process').spawn;

class StorybookUtils {

    static startServer(configs) {
        return new Promise((resolve) => {
            const isWindows = (os.platform() === 'win32');
            let storybookPath = path.resolve(process.cwd(), 'node_modules/.bin/start-storybook' + (isWindows ? '.cmd' : ''));

            // start Storybook dev server
            let storybookPort = 9001;
            if (configs.storybookPort) {
                storybookPort = configs.storybookPort;
                console.log('Use custom Storybook port: ' + storybookPort);
            }

            const args = ['--port', storybookPort];

            if (configs.storybookConfigDir) {
                args.push('--config-dir');
                args.push(configs.storybookConfigDir);
                console.log('Use custom Storybook configDir: ' + configs.storybookConfigDir);
            }

            if (configs.storybookStaticDir) {
                args.push('--static-dir');
                args.push(configs.storybookStaticDir);
                console.log('Use custom Storybook staticDir: ' + configs.storybookStaticDir);
            }

            console.log(storybookPath.toString() + ' ' + args.join(' '), '\n');
            const storybookProcess = spawn(storybookPath, args, {detached: true});

            // exit on terminate
            process.on('exit', function() {
                try {
                    process.kill(-storybookProcess.pid);
                } catch (e) {}
            });
            process.on('SIGINT', function () {
                process.exit();
            });
            process.on('uncaughtException', function(e) {
                console.error('An error during staring Storebook', e);
                process.exit(1);
            });

            resolve(storybookProcess);
        });
    };

    /**
     * @param {string} storybookAddress
     * @param {number} [retries]
     * @returns {Promise.<string>}
     */
    static getStorybookPreviewBundle(storybookAddress, retries) {
        const that = this;
        return new Promise((resolve, reject) => {
            if (retries === 0) {
                const message = 'Error fetching preview.bundle.js from Storybook server';
                return reject(new Error(message));
            } else if (retries) {
                retries--;
            } else {
                retries = 2; // this and 2 additionally
            }

            request.get(storybookAddress + 'static/preview.bundle.js', function(err, response, body) {
                if (err || response.statusCode !== 200 || !body) {
                    setTimeout(() => {
                        return that.getStorybookPreviewBundle(storybookAddress, retries).then((body) => {
                            resolve(body);
                        }, (err) => {
                            reject(err);
                        });
                    }, 1000);
                    return;
                }

                resolve(body);
            });
        });
    }

    /**
     * @param {string} previewCode
     * @param {object} configs
     * @returns {Promise.<object>}
     */
    static getStorybook(previewCode, configs) {
        return new Promise((resolve, reject) => {

            // JSDom is node-parser for javascript and therefore it doesn't support some browser's API.
            // The Applitools Storybook API itself don't require them, but they needed to run clients' applications correctly.
            const mocksCode = [
                fs.readFileSync(__dirname + '/mocks/match-media.js', 'utf8'),
                fs.readFileSync(__dirname + '/mocks/local-storage.js', 'utf8'),
            ];

            const jsdomConfig = {
                html: '',
                src: mocksCode.concat(previewCode),
                done: (err, window) => {
                    if (err) return reject(err.response.body);
                    if (!window || !window.__storybook_stories__) {
                        const message = 'Storybook object not found on window. Check window.__storybook_stories__ is set in your Storybook\'s config.js.';
                        return reject(new Error(message));
                    }

                    resolve(window.__storybook_stories__);
                }
            };

            if (configs && configs.debug) {
                jsdomConfig.virtualConsole = jsdom.createVirtualConsole().sendTo(console);
            }

            jsdom.env(jsdomConfig);
        });
    }

    /**
     * @param {string} storybookAddress
     * @param {object} storybook
     * @returns {Array<{groupName: string, storyName: string, storyUrl: string, compoundTitle: string}>}
     */
    static prepareStories(storybookAddress, storybook) {
        const stories = [];
        for (const group of storybook) {
            for (const story of group.stories) {
                const groupName = group.kind;
                const storyName = story.name;
                const storyUrl = storybookAddress + 'iframe.html?selectedKind=' + encodeURIComponent(groupName) + '&selectedStory=' + encodeURIComponent(storyName);
                const compoundTitle = groupName + ': ' + storyName;
                stories.push({groupName, storyName, storyUrl, compoundTitle});
            }
        }

        return stories;
    }
}

module.exports = {
    StorybookUtils: StorybookUtils
};
