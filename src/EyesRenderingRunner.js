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
        this._domNodes = null;
        this._resources = null;
    }

    /**
     * @param {StorybookStory[]} stories
     * @returns {Promise.<TestResults[]>}
     */
    testStories(stories) {
        this._logger.log('Splitting stories for multiple parts...');
        const maxThreads = this._configs.maxRunningBrowsers;
        const threadsCount = (maxThreads === 0 || maxThreads > stories.length) ? stories.length : maxThreads;

        const storiesParts = [];
        let storiesMod = stories.length % threadsCount;
        const storiesPerThread = (stories.length - storiesMod) / threadsCount;
        let startStory, endStory = 0;
        for (let i = 0; i < threadsCount; ++i) {
            startStory = endStory;
            endStory = startStory + storiesPerThread + (storiesMod-- > 0 ? 1 : 0);
            storiesParts.push(stories.slice(startStory, endStory));
        }
        this._logger.log(`Stories have been slitted for ${threadsCount} parts.`);
        this._logger.verbose(`Stories per thread: ${storiesPerThread}${storiesMod ? ('-' + (storiesPerThread + 1)) : ''}`);

        const firstStory = storiesParts[0][0];
        storiesParts[0].shift();

        const that = this;
        const storiesPromises = [];
        let firstStoryPromise;
        return that._promiseFactory.makePromise(resolve => {
            that._logger.log('Starting processing first story, to prepare resources and DOM...');
            firstStoryPromise = that.testStory(firstStory, 0, 0, () => resolve());
            storiesPromises.push(firstStoryPromise);
        }).then(() => {
            that._logger.log('Resources and DOM have been prepared and sent to the server.');
            const threadsPromises = [];
            that._logger.log(`Starting rest ${stories.length} threads for processing stories...`);
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
            that._logger.log(`All stories have been processed.`);
            return Promise.all(storiesPromises);
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
        this._logger.verbose(`[${i}] Starting processing story ${story.getCompoundTitleWithViewportSize()}...`);

        const that = this;
        let promise = this._promiseFactory.resolve();
        if (!that._domNodes) {
            promise = promise.then(() => {
                that._logger.verbose(`[${i}] Collecting resources...`);
                that._resources = readResourcesFromDir(that._configs.storybookOutputDir);
                that._logger.verbose(`[${i}] Resources have been collected and cached.`);
                that._logger.verbose(`[${i}] Preparing DOM...`);
                const domRootHtml = fs.readFileSync(path.join(that._configs.storybookOutputDir, 'iframe.html'));
                return StorybookUtils.getDocumentFromHtml(that._promiseFactory, domRootHtml).then(document => {
                    const nodes = document.querySelectorAll('*');
                    that._domNodes = EyesRenderingUtils.domNodesToCdt(Array.from(nodes).slice(0, 1));
                    that._logger.verbose(`[${i}] DOM have been prepared and cached.`);
                });
            });
        }

        return promise.then(() => {
            that._logger.verbose(`[${i}] Preparing Eyes instance...`);
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
                const dom = new RGridDom();
                dom.setResources(that._resources);
                dom.setDomNodes(that._domNodes);
                dom.setUrl(story.getStorybookUrl('http://localhost/'));

                that._logger.verbose(`[${i}] Sending Rendering requests...`);
                return eyes.renderWindow(dom);
            }).then(imageLocation => {
                that._logger.verbose(`[${i}] Render have been finished.`);
                if (startNextCallback) {
                    startNextCallback();
                }

                that._logger.verbose(`[${i}] Sending check request...`);
                return eyes.checkUrl(imageLocation, story.getCompoundTitle());
            }).then(() => {
                that._logger.verbose(`[${i}] Sending close request...`);
                return eyes.close(false);
            }).then(results => {
                that._logger.log(`[${i}] Story ${story.getCompoundTitleWithViewportSize()} have been processed.`);
                return results;
            });
        });
    }
}

const readResourcesFromDir = (parentDir, dir, resources = []) => {
    const files = fs.readdirSync(parentDir);
    files.forEach(file => {
        const longPathToFile = path.join(parentDir, file);
        const pathToFile = dir ? (dir + '/' + file) : file;

        if (fs.statSync(longPathToFile).isDirectory()) {
            resources = readResourcesFromDir(longPathToFile, pathToFile, resources);
        } else {
            if (pathToFile === 'index.html' || pathToFile === 'iframe.html' || file.endsWith('.map')) {
                return;
            }

            const resource = new RGridResource();
            resource.setUrl('http://localhost/' + pathToFile);
            resource.setContentType(mime.lookup(file));
            resource.setContent(fs.readFileSync(longPathToFile));
            resources.push(resource);
        }
    });
    return resources;
};

module.exports = EyesRenderingRunner;
