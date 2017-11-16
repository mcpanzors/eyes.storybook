'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const jsdom = require("jsdom/lib/old-api");
const request = require('request');
const spawn = require('child_process').spawn;

class StorybookUtils {

    static startServer(configs, logger) {
        return new Promise((resolve, reject) => {
            const isWindows = (os.platform() === 'win32');
            let storybookPath = path.resolve(process.cwd(), 'node_modules/.bin/start-storybook' + (isWindows ? '.cmd' : ''));

            // start Storybook dev server
            let storybookPort = 9001;
            if (configs.storybookPort) {
                storybookPort = configs.storybookPort;
                logger.log('Use custom Storybook port: ' + storybookPort);
            }

            const args = ['--port', storybookPort, '--config-dir', configs.storybookConfigDir];

            if (configs.storybookStaticDir) {
                args.push('--static-dir');
                args.push(configs.storybookStaticDir);
                logger.log('Use custom Storybook staticDir: ' + configs.storybookStaticDir);
            }

            const storybookConfigPath = path.resolve(process.cwd(), configs.storybookConfigDir, 'config.js');
            if (!fs.existsSync(storybookConfigPath)) {
                return reject(new Error('Storybook config file not found: ' + storybookConfigPath));
            }

            const storybookConfigBody = fs.readFileSync(storybookConfigPath, 'utf8');
            if (!storybookConfigBody.includes("__storybook_stories__")) {
                const newStorybookConfig = storybookConfigBody + "\nif (typeof window === 'object') {\n  window.__storybook_stories__ = require('" + (configs.storybookVersion === 3 ? '@storybook/' + configs.storybookApp : '@kadira/storybook') + "').getStorybook();\n}";
                fs.writeFileSync(storybookConfigPath, newStorybookConfig, 'utf8');
            }

            logger.log(storybookPath.toString() + ' ' + args.join(' '), '\n');
            const storybookProcess = spawn(storybookPath, args, {detached: false});

            // exit on terminate
            process.on('exit', function () {
                if (fs.readFileSync(storybookConfigPath, 'utf8') !== storybookConfigBody) {
                    fs.writeFileSync(storybookConfigPath, storybookConfigBody, 'utf8');
                }

                try {
                    storybookProcess.kill();
                    process.kill(-storybookProcess.pid);
                } catch (e) {}
            });
            process.on('SIGINT', function () {
                process.exit();
            });
            process.on('uncaughtException', function (e) {
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

            request.get(storybookAddress + 'static/preview.bundle.js', function (err, response, body) {
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
     * @returns {Array<Story>}
     */
    static prepareStories(storybookAddress, storybook) {
        const stories = [];
        for (const group of storybook) {
            for (const story of group.stories) {
                const componentName = group.kind;
                const state = story.name;
                const compoundTitle = componentName + ': ' + state;
                const url = storybookAddress + 'iframe.html?selectedKind=' + encodeURIComponent(componentName) + '&selectedStory=' + encodeURIComponent(state);
                stories.push({componentName, state, compoundTitle, url, viewportSize: null});
            }
        }

        return stories;
    }

    /**
     * @param {Array<Story>} stories
     * @param {Array<{width: number, height: number}>} viewportSizes
     * @returns {Array<Story>}
     */
    static mixStories(stories, viewportSizes) {
        if (!viewportSizes) {
            return stories;
        }

        const newStories = [];
        for (const viewportSize of viewportSizes) {
            for (const story of stories) {
                newStories.push(Object.assign(story, {viewportSize}));
            }
        }

        return newStories;
    }

    /**
     * @param {object} json
     * @returns {{ app: string, version: number}}
     */
    static retrieveStorybookVersion(json) {
        const dependencies = json.dependencies || {};
        const devDependencies = json.devDependencies || {};

        if (dependencies['@kadira/storybook'] || devDependencies['@kadira/storybook']) {
            return {app: 'react', version: 2};
        } else if (dependencies['@storybook/react'] || devDependencies['@storybook/react']) {
            return {app: 'react', version: 3};
        } else if (dependencies['@storybook/vue'] || devDependencies['@storybook/vue']) {
            return {app: 'vue', version: 3};
        } else {
            throw new Error('Storybook module not found in package.json!');
        }
    }
}

module.exports = {
    StorybookUtils: StorybookUtils
};
