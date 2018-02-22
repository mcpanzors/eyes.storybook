'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const {BatchInfo, RGridResource, RGridDom, Logger, ConsoleLogHandler} = require('@applitools/eyes.sdk.core');

const EyesStorybook = require('./EyesStorybook');
const StorybookUtils = require('./StorybookUtils');
const EyesRenderingUtils = require('./EyesRenderingUtils');

class EyesRenderingRunner {

    constructor(logger, promiseFactory, configs) {
        /** @type {Logger} */
        this._logger = logger;
        /** @type {PromiseFactory} */
        this._promiseFactory = promiseFactory;
        /** @type {Object} */
        this._configs = configs;

        this._testBatch = new BatchInfo(configs.appName);
        this._rGridDom = undefined;
    }

    /**
     * @param {StorybookStory[]} stories
     * @returns {Promise.<TestResults[]>}
     */
    testStories(stories) {
        this._logger.log('Splitting stories for multiple parts...');

        const maxThreads = this._configs.maxConcurrency;
        const threadsCount = (maxThreads === 0 || maxThreads > stories.length) ? stories.length : maxThreads;

        const storiesParts = [];
        const storiesMod = stories.length % threadsCount;
        const storiesPerThread = (stories.length - storiesMod) / threadsCount;
        let startStory = 0, endStory = 0, modLeft = storiesMod;
        for (let i = 0; i < threadsCount; ++i) {
            startStory = endStory;
            if (modLeft > 0) {
                modLeft--;
                endStory = startStory + storiesPerThread + 1;
            } else {
                endStory = startStory + storiesPerThread;
            }
            storiesParts.push(stories.slice(startStory, endStory));
        }

        this._logger.log(`Stories were slitted for ${threadsCount} parts. Stories per thread: ${storiesPerThread}${storiesMod ? ('-' + (storiesPerThread + 1)) : ''}`);

        const firstStory = storiesParts[0][0];
        storiesParts[0].shift();

        const that = this;
        const storiesPromises = [];
        let firstStoryPromise;

        that._logger.log(`Collecting resources...`);
        return readResources(that._configs.storybookOutputDir, that._promiseFactory).then(resources => {
            that._logger.log(`Resources were collected.`);

            that._logger.log(`Preparing DOM...`);
            const iframeResource = resources.get('iframe.html');
            resources.delete('iframe.html');

            return StorybookUtils.getDocumentFromHtml(that._promiseFactory, iframeResource.getContent()).then(document => {
                const nodes = document.querySelectorAll('*');

                that._rGridDom = new RGridDom();
                that._rGridDom.setResources(Array.from(resources.values()));
                that._rGridDom.setDomNodes(EyesRenderingUtils.domNodesToCdt(Array.from(nodes).slice(0, 1)));
                that._logger.log(`DOM was prepared and cached.`);
            });
        }).then(() => {
            return that._promiseFactory.makePromise(resolve => {
                that._logger.verbose('Starting processing first story, to send resources and DOM to server...');
                firstStoryPromise = that.testStory(firstStory, 0, 0, () => resolve());
                storiesPromises.push(firstStoryPromise);
            });
        }).then(() => {
            that._logger.verbose('Resources and DOM were sent to the server.');
            const threadsPromises = [];
            that._logger.verbose(`Starting rest ${stories.length} threads for processing stories...`);
            storiesParts.forEach((stories, i) => {
                let threadPromise = i === 0 ? firstStoryPromise : that._promiseFactory.resolve();
                stories.forEach((story, j) => {
                    threadPromise = threadPromise.then(() => {
                        const promise = that.testStory(story, i, j);
                        storiesPromises.push(promise);
                        return promise;
                    });
                });
                threadsPromises.push(threadPromise);
            });
            return that._promiseFactory.all(threadsPromises);
        }).then(() => {
            that._logger.log(`All stories were processed.`);
            return that._promiseFactory.all(storiesPromises);
        });
    }

    /**
     * @private
     * @param {StorybookStory} story
     * @param {int} i Thread number
     * @param {int} j Story number in thread
     * @param {function} [startNextCallback]
     * @returns {Promise.<TestResults>}
     */
    testStory(story, i, j, startNextCallback) {
        const that = this;
        return this._promiseFactory.resolve().then(() => {
            that._logger.log(`[${i}] Starting processing story ${story.getCompoundTitleWithViewportSize()}...`);

            const eyes = new EyesStorybook(that._configs.serverUrl, that._promiseFactory);
            eyes.setApiKey(that._configs.apiKey);
            eyes.setRender(true);
            eyes.setBatch(that._testBatch);
            eyes.addProperty("Component name", story.getComponentName());
            eyes.addProperty("State", story.getState());
            eyes.setHostOS("Linux");
            eyes.setHostApp("Chrome");
            if (that._configs.showEyesSdkLogs) {
                eyes.setLogHandler(new ConsoleLogHandler(that._configs.showEyesSdkLogs === 'verbose'));
            }

            that._logger.verbose(`[${i}] Opening Eyes session...`);
            return eyes.open(that._configs.appName, story.getCompoundTitle(), story.getViewportSize()).then(() => {
                that._logger.verbose(`[${i}] Session was created.`);
                that._logger.verbose(`[${i}] Sending Rendering requests...`);
                return eyes.renderWindow(story.getStorybookUrl('http://localhost/'), that._rGridDom);
            }).then(imageLocation => {
                that._logger.verbose(`[${i}] Render was finished.`);
                if (startNextCallback) {
                    startNextCallback();
                }

                that._logger.verbose(`[${i}] Sending check request...`);
                return eyes.checkUrl(imageLocation, story.getCompoundTitle());
            }).then(() => {
                that._logger.verbose(`[${i}] Screenshot was sent.`);

                that._logger.verbose(`[${i}] Sending close request...`);
                return eyes.close(false);
            }).then(results => {
                that._logger.verbose(`[${i}] Session was closed.`);

                that._logger.log(`[${i}] Story ${story.getCompoundTitleWithViewportSize()} was processed.`);
                return results;
            });
        });
    }
}

/**
 * @param {string} outputDir
 * @param {PromiseFactory} promiseFactory
 * @return {Promise<Map<String, RGridResource>>}
 */
const readResources = (outputDir, promiseFactory) => {
    const resources = new Map();
    const promises = [];

    const storeResource = (fullPath, localPath, fileName) => {
        return promiseFactory.makePromise((resolve, reject) => {
            fs.readFile(fullPath, (err, data) => {
                if (err) return reject(err);

                const resource = new RGridResource();
                resource.setUrl('http://localhost/' + localPath);
                resource.setContentType(mime.lookup(fileName));
                resource.setContent(data);
                resources.set(localPath, resource);
                return resolve();
            });
        });
    };

    const readResourcesRecursive = (fullPathToDir, localPathToDir) => {
        fs.readdirSync(fullPathToDir).forEach(fileName => {
            const fullPath = path.join(fullPathToDir, fileName);
            const localPath = localPathToDir ? (localPathToDir + '/' + fileName) : fileName;

            if (fs.statSync(fullPath).isDirectory()) {
                readResourcesRecursive(fullPath, localPath);
            } else if (!filterResources(localPath)) {
                promises.push(storeResource(fullPath, localPath, fileName));
            }
        });
    };

    readResourcesRecursive(outputDir);

    return promiseFactory.all(promises).then(() => resources);
};

const filterResources = (path) => {
    return path === 'index.html' || path.endsWith('.map');
};

module.exports = EyesRenderingRunner;
