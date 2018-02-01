'use strict';

const fs = require('fs');
const path = require('path');
const jsdom = require("jsdom/lib/old-api");
const axios = require('axios');
const {spawn, execSync} = require('child_process');
const {RectangleSize} = require('eyes.sdk');

const StorybookStory = require('./StorybookStory');

const IS_WINDOWS = process.platform.startsWith('win');

class StorybookUtils {

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @return {Promise<String>}
     */
    static startServer(logger, promiseFactory, configs) {
        if (configs.storybookAddress) {
            logger.log('storybookAddress set, starting server skipped.');
            return promiseFactory.resolve(configs.storybookAddress);
        }

        logger.log('Starting Storybook server...');
        let storybookPath = path.resolve(process.cwd(), 'node_modules/.bin/start-storybook' + (IS_WINDOWS ? '.cmd' : ''));

        // start Storybook dev server
        let storybookHost = 'localhost';
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
            return promiseFactory.reject(new Error('Storybook config file not found: ' + storybookConfigPath));
        }

        let isConfigOverridden = false;
        const storybookConfigBody = fs.readFileSync(storybookConfigPath, 'utf8');
        if (!storybookConfigBody.includes("__storybook_stories__")) {
            isConfigOverridden = true;
            let template = fs.readFileSync(`${__dirname}/configTemplates/storybook.v${configs.storybookVersion}.js`, 'utf8');
            template = template.replace('${configBody}', storybookConfigBody).replace('${app}', configs.storybookApp);
            fs.writeFileSync(storybookConfigPath, template, 'utf8');
        }

        logger.log(storybookPath.toString() + ' ' + args.join(' '), '\n');
        const storybookProcess = spawn(storybookPath, args, {detached: !IS_WINDOWS});

        storybookProcess.stderr.on('data', data => { console.error(data.toString('utf8').trim()) });
        if (configs.showStorybookOutput) {
            storybookProcess.stdout.on('data', data => { console.log(data.toString('utf8').trim()) });
        }

        // exit on terminate
        process.on('exit', function () {
            if (isConfigOverridden) {
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

        return waitForStorybookStarted(logger, promiseFactory, storybookProcess, `http://${storybookHost}:${storybookPort}/`);
    };

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @return {Promise<void>}
     */
    static buildStorybook(logger, promiseFactory, configs) {
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
            fs.writeFileSync(storybookConfigPath, template, 'utf8');
        }

        logger.log(storybookPath.toString() + ' ' + args.join(' '), '\n');
        execSync(storybookPath, args);

        logger.log('Building Storybook done.');
        if (isConfigOverridden) {
            fs.writeFileSync(storybookConfigPath, storybookConfigBody, 'utf8');
        }

        return promiseFactory.resolve();
    };

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @returns {Promise.<StorybookStory[]>}
     */
    static getStoriesFromWeb(logger, promiseFactory, configs) {
        logger.log('Getting stories from running storybook...');
        return axios.get(configs.storybookAddress + 'static/preview.bundle.js', {timeout: 5000}).then(response => {
            const previewCode = response.data;
            return prepareStories(logger, promiseFactory, configs, previewCode);
        });
    }

    /**
     * @param {Logger} logger
     * @param {PromiseFactory} promiseFactory
     * @param {Object} configs
     * @returns {Promise.<StorybookStory[]>}
     */
    static getStoriesFromStatic(logger, promiseFactory, configs) {
        logger.log('Getting stories from storybook build...');

        const staticDirPath = path.resolve(process.cwd(), configs.storybookOutputDir, 'static');
        const previewFile = fs.readdirSync(staticDirPath).find(filename => {
            return filename.startsWith("preview.") && filename.endsWith(".bundle.js");
        });

        const previewCode = fs.readFileSync(path.resolve(staticDirPath, previewFile), 'utf8');
        return prepareStories(logger, promiseFactory, configs, previewCode);
    }

    /**
     * @param {PromiseFactory} promiseFactory
     * @param {String} htmlContent
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
    logger.log('Getting stories from storybook instance...');

    return getStorybookInstance(promiseFactory, configs, previewCode).then(storybook => {
        logger.log('Extracting stories...');

        const stories = [];
        for (const group of storybook) {
            for (const story of group.stories) {
                stories.push(new StorybookStory(group.kind, story.name));
            }
        }

        if (!configs.viewportSize) {
            return stories;
        }

        logger.log('Mixing stories with viewportSize...');
        const newStories = [];
        for (const viewportSize of configs.viewportSize) {
            for (const story of stories) {
                newStories.push(new StorybookStory(story.getComponentName(), story.getState(), new RectangleSize(viewportSize)));
            }
        }
        return newStories;
    });
};

/**
 * @param {Logger} logger
 * @param {PromiseFactory} promiseFactory
 * @param {any} storybookProcess
 * @param {String} storybookAddress
 * @return {Promise<String>}
 */
const waitForStorybookStarted = (logger, promiseFactory, storybookProcess, storybookAddress) => {
    return promiseFactory.makePromise((resolve, reject) => {
        storybookProcess.stdout.on('data', data => {
            const str = data.toString('utf8').trim();
            if (str.includes(storybookAddress)) {
                logger.log('Starting Storybook server done.');
                resolve(storybookAddress);
            }
        });

        // Set up the timeout
        setTimeout(function() {
            reject('Storybook din\'t start after 5 min waiting.');
        }, 5 * 60 * 1000);
    });
};

module.exports = StorybookUtils;
