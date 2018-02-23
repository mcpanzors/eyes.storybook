'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const jsdom = require("jsdom/lib/old-api");
const {spawn, execSync} = require('child_process');
const {RectangleSize, GeneralUtils} = require('@applitools/eyes.sdk.core');

const StorybookStory = require('./StorybookStory');

const IS_WINDOWS = process.platform.startsWith('win');
const REQUEST_TIMEOUT = 5000; // ms
const WAIT_BETWEEN_REQUESTS = 500; // ms
const REQUEST_RETRY = 3;
const isHttps = /https:?/;

class StorybookUtils {

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @return {Promise<String>}
     */
    static startServer(logger, promiseFactory, configs) {
        if (configs.storybookAddress) {
            logger.log('storybookAddress set, starting Storybook skipped.');
            return promiseFactory.resolve(configs.storybookAddress);
        }

        logger.log('Starting Storybook...');

        let storybookPath = path.resolve(process.cwd(), 'node_modules/.bin/start-storybook' + (IS_WINDOWS ? '.cmd' : ''));

        // start Storybook dev server
        const storybookHost = 'localhost';
        let storybookPort = 9001;
        if (configs.storybookPort) {
            storybookPort = configs.storybookPort;
        }

        const args = ['--port', storybookPort, '--config-dir', configs.storybookConfigDir];

        if (configs.storybookStaticDir) {
            args.push('--static-dir');
            args.push(configs.storybookStaticDir);
            logger.log('Use custom Storybook staticDir: ' + configs.storybookStaticDir);
        }

        const storybookConfigPath = path.resolve(process.cwd(), configs.storybookConfigDir, 'config.js');
        if (!fs.existsSync(storybookConfigPath)) {
            return promiseFactory.reject(new Error('Storybook config file not found: ' + storybookConfigPath));
        }

        let isConfigOverridden = false;
        const storybookConfigBody = fs.readFileSync(storybookConfigPath, 'utf8');
        if (!storybookConfigBody.includes("__storybook_stories__")) {
            isConfigOverridden = true;
            let template = fs.readFileSync(`${__dirname}/configTemplates/storybook.v${configs.storybookVersion}.js`, 'utf8');
            template = template.replace('${configBody}', storybookConfigBody).replace('${app}', configs.storybookApp);
            fs.writeFileSync(storybookConfigPath, template, {encoding: 'utf8'});
        }

        logger.log(storybookPath.toString() + ' ' + args.join(' '), '\n');
        const storybookProcess = spawn(storybookPath, args, {detached: !IS_WINDOWS});

        storybookProcess.stderr.on('data', data => console.error(bufferToString(data)));
        if (configs.showStorybookOutput) {
            storybookProcess.stdout.on('data', data => console.log(bufferToString(data)));
        }

        // exit on terminate
        process.on('exit', () => {
            if (isConfigOverridden) {
                fs.writeFileSync(storybookConfigPath, storybookConfigBody, {encoding: 'utf8'});
            }

            try {
                if (IS_WINDOWS) {
                    spawn("taskkill", ["/pid", storybookProcess.pid, '/f', '/t']);
                } else {
                    process.kill(-storybookProcess.pid);
                }
            } catch (e) {
                console.error("Can't kill child (Storybook) process.", e);
            }
        });

        process.on('SIGINT', () => process.exit());
        process.on('SIGTERM', () => process.exit());
        process.on('uncaughtException', () => process.exit(1));

        return waitForStorybookStarted(promiseFactory, storybookProcess).then(() => {
            logger.log('Storybook was started.');
            return `http://${storybookHost}:${storybookPort}/`;
        });
    };

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @return {Promise<void>}
     */
    static buildStorybook(logger, promiseFactory, configs) {
        if (configs.skipStorybookBuild) {
            logger.log('Building storybook skipped due to skipStorybookBuild config.');
            return promiseFactory.resolve();
        }

        logger.log('Building Storybook...');
        let storybookPath = path.resolve(process.cwd(), 'node_modules/.bin/build-storybook' + (IS_WINDOWS ? '.cmd' : ''));

        const args = ['--config-dir', configs.storybookConfigDir, '--output-dir', configs.storybookOutputDir];

        if (configs.storybookStaticDir) {
            args.push('--static-dir');
            args.push(configs.storybookStaticDir);
            logger.log('Use custom Storybook staticDir: ' + configs.storybookStaticDir);
        }

        const storybookConfigPath = path.resolve(process.cwd(), configs.storybookConfigDir, 'config.js');
        if (!fs.existsSync(storybookConfigPath)) {
            return promiseFactory.reject(new Error('Storybook config file not found: ' + storybookConfigPath));
        }

        let isConfigOverridden = false;
        const storybookConfigBody = fs.readFileSync(storybookConfigPath, 'utf8');
        if (!storybookConfigBody.includes("__storybook_stories__")) {
            isConfigOverridden = true;
            let template = fs.readFileSync(`${__dirname}/configTemplates/storybook.v${configs.storybookVersion}.js`, 'utf8');
            template = template.replace('${configBody}', storybookConfigBody).replace('${app}', configs.storybookApp);
            fs.writeFileSync(storybookConfigPath, template, {encoding: 'utf8'});
        }

        logger.log(storybookPath.toString() + ' ' + args.join(' '), '\n');
        execSync(storybookPath, args);

        if (isConfigOverridden) {
            fs.writeFileSync(storybookConfigPath, storybookConfigBody, {encoding: 'utf8'});
        }

        logger.log('Storybook was built.');
        return promiseFactory.resolve();
    };

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @param {int} [retry]
     * @returns {Promise.<StorybookStory[]>}
     */
    static getStoriesFromWeb(logger, promiseFactory, configs, retry = REQUEST_RETRY) {
        logger.log('Getting stories from storybook server...', retry !== REQUEST_RETRY ? (` ${retry} retries left.`) : '');

        return getRemoteContent(configs.storybookAddress + 'static/preview.bundle.js', REQUEST_TIMEOUT, promiseFactory).then(response => {
            logger.log('Storybook code was received from server.');
            return prepareStories(logger, promiseFactory, configs, response).then(stories => {
                logger.log('Stories were prepared.');
                return stories;
            });
        }, err => {
            if (retry > 1) {
                logger.log("Error on getting stories: " + err);
                return StorybookUtils.getStoriesFromWeb(logger, promiseFactory, configs, --retry);
            }

            throw err;
        });
    }

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @returns {Promise.<StorybookStory[]>}
     */
    static getStoriesFromStatic(logger, promiseFactory, configs) {
        return promiseFactory.makePromise((resolve, reject) => {
            logger.log('Getting stories from storybook build...');
            const staticDirPath = path.resolve(process.cwd(), configs.storybookOutputDir, 'static');
            fs.readdir(staticDirPath, (err, files) => {
                if (err) return reject(err);

                const previewFile = files.find(filename => filename.startsWith("preview.") && filename.endsWith(".bundle.js"));
                fs.readFile(path.resolve(staticDirPath, previewFile), 'utf8', (err, data) => {
                    if (err) return reject(err);

                    logger.log('Storybook code was loaded from build.');
                    return resolve(data);
                });
            });
        }).then(previewCode => {
            return prepareStories(logger, promiseFactory, configs, previewCode);
        }).then(stories => {
            logger.log('Stories were prepared.');
            return stories;
        });
    }

    /**
     * @param {PromiseFactory} promiseFactory
     * @param {Buffer} htmlContent
     * @returns {Promise.<any>}
     */
    static getDocumentFromHtml(promiseFactory, htmlContent) {
        return promiseFactory.makePromise((resolve, reject) => {
            const jsdomConfig = {
                html: htmlContent,
                done: (err, window) => {
                    if (err) return reject(err.response.body);
                    resolve(window.document);
                }
            };
            jsdom.env(jsdomConfig);
        });
    }

    /**
     * @param {object} json
     * @param {array<string>} supportedStorybookApps
     * @returns {{app: string, version: number}}
     */
    static retrieveStorybookVersion(json, supportedStorybookApps) {
        // noinspection JSUnresolvedVariable
        const dependencies = json.dependencies || {};
        // noinspection JSUnresolvedVariable
        const devDependencies = json.devDependencies || {};

        if (dependencies['@kadira/storybook'] || devDependencies['@kadira/storybook']) {
            return {app: 'react', version: 2};
        } else {
            const version = 3;
            for (let i = 0, l = supportedStorybookApps.length; i < l; ++i) {
                const app = supportedStorybookApps[i];

                if (dependencies['@storybook/' + app] || devDependencies['@storybook/' + app]) {
                    return {app, version};
                }
            }
        }

        throw new Error('Storybook module not found in package.json!');
    }
}

/**
 * @param {PromiseFactory} promiseFactory
 * @param {Object} configs
 * @param {string} previewCode
 * @returns {Promise.<any>}
 */
const getStorybookInstance = (promiseFactory, configs, previewCode) => {
    return promiseFactory.makePromise((resolve, reject) => {
        // JSDom is node-parser for javascript and therefore it doesn't support some browser's API.
        // The Applitools Storybook API itself don't require them, but they needed to run clients' applications correctly.
        const mocksCode = [
            fs.readFileSync(__dirname + '/mocks/event-source.js', 'utf8'),
            fs.readFileSync(__dirname + '/mocks/local-storage.js', 'utf8'),
            fs.readFileSync(__dirname + '/mocks/match-media.js', 'utf8'),
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

        if (configs.showStorybookOutput) {
            jsdomConfig.virtualConsole = jsdom.createVirtualConsole().sendTo(console);
        }

        jsdom.env(jsdomConfig);
    });
};

/**
 * @param {Logger} logger
 * @param {PromiseFactory} promiseFactory
 * @param {Object} configs
 * @param {string} previewCode
 * @returns {Promise<StorybookStory[]>}
 */
const prepareStories = (logger, promiseFactory, configs, previewCode) => {
    return getStorybookInstance(promiseFactory, configs, previewCode).then(storybook => {
        logger.log('Storybook instance was created.');

        const stories = [];
        for (const group of storybook) {
            for (const story of group.stories) {
                stories.push(new StorybookStory(group.kind, story.name));
            }
        }

        logger.log('Storied were extracted.');

        if (!configs.viewportSize) {
            return stories;
        }

        const newStories = [];
        for (const viewportSize of configs.viewportSize) {
            for (const story of stories) {
                newStories.push(new StorybookStory(story.getComponentName(), story.getState(), new RectangleSize(viewportSize)));
            }
        }

        logger.log('Storied were mixed with viewportSize(s).');
        return newStories;
    });
};

/**
 * @param {PromiseFactory} promiseFactory
 * @param {ChildProcess} storybookProcess
 * @return {Promise<string>}
 */
const waitForStorybookStarted = (promiseFactory, storybookProcess) => {
    return promiseFactory.makePromise((resolve, reject) => {
        storybookProcess.stdout.on('data', data => stdoutListener(bufferToString(data)));
        storybookProcess.stderr.on('data', data => stderrListener(bufferToString(data)));

        const stderrListener = (str) => {
            if (str.includes('Error: listen EADDRINUSE :::')) {
                return reject("Storybook port already in use.");
            }
        };

        const stdoutListener = (str) => {
            if (str.includes('webpack built')) {
                return resolve();
            }
        };

        // Set up the timeout
        setTimeout(() => reject('Storybook din\'t start after 5 min waiting.'), 5 * 60 * 1000); // 5 min
    });
};

/**
 * @param {string} url
 * @param {int} timeout
 * @param {PromiseFactory} promiseFactory
 * @return {Promise<String>}
 */
const getRemoteContent = (url, timeout, promiseFactory) => {
    return promiseFactory.makePromise((resolve, reject) => {
        const agent = isHttps.test(url) ? https : http;
        const request = agent.get(url, res => {
            res.setEncoding("utf8");
            let content = "";
            res.on("data", data => {content += data});
            res.on("end", () => resolve(content));
            res.on('error', (e) => reject(e));
        });

        request.on('socket', socket => {
            socket.setTimeout(timeout, () => request.abort());
        });

        request.on('error', err => {
            if (err.code === "ECONNRESET") return reject("Request timeout reached.");
            return reject(err);
        });
    });
};

/**
 * @param {Buffer} data
 * @return {string}
 */
const bufferToString = (data) => data.toString('utf8').trim();

module.exports = StorybookUtils;
