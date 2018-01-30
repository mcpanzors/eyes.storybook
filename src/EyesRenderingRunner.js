'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const {BatchInfo, RGridResource, RGridDom} = require('eyes.sdk');

const EyesStorybook = require('./EyesStorybook');
const StorybookUtils = require('./StorybookUtils');
const EyesRenderingUtils = require('./EyesRenderingUtils');

class EyesStorybookRunner {

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
        this._logger.log('Splitting stories for parallel threads...');

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

        const firstStory = storiesParts[0][0];
        storiesParts[0].shift();

        const that = this;
        const storiesPromises = [];
        let firstStoryPromise;
        this._logger.log('Splitting stories for parallel threads...');
        return that._promiseFactory.makePromise(resolve => {
            firstStoryPromise = that.testStory(firstStory, () => resolve());
            storiesPromises.push(firstStoryPromise);
        }).then(() => {
            const threadsPromises = [];
            storiesParts.forEach((stories, i) => {
                let threadPromise = i === 1 ? firstStoryPromise : that._promiseFactory.resolve();
                stories.forEach(story => {
                    threadPromise = threadPromise.then(() => {
                        const promise = that.testStory(story);
                        storiesPromises.push(promise);
                        return promise;
                    });
                });
                threadsPromises.push(threadPromise);
            });
            return that._promiseFactory.all(threadsPromises);
        }).then(() => {
            return Promise.all(storiesPromises);
        });
    }

    /**
     * @param {StorybookStory} story
     * @param {function} [startNextCallback]
     * @returns {Promise.<TestResults>}
     */
    testStory(story, startNextCallback) {
        this._logger.verbose('Starting collecting resources...');

        let promise = this._promiseFactory.resolve();

        const that = this;
        if (!that._domNodes) {
            promise = promise.then(() => {
                that._logger.verbose('Collecting resources...');
                that._resources = readResourcesFromDir(that._configs.storybookOutputDir);
                that._logger.verbose('Collecting resources - done.');
                that._logger.verbose('Preparing DOM...');
                const domRootHtml = fs.readFileSync(path.join(that._configs.storybookOutputDir, 'iframe.html'));

                return StorybookUtils.getDocumentFromHtml(that._promiseFactory, domRootHtml).then(document => {
                    const nodes = document.querySelectorAll('*');
                    that._domNodes = EyesRenderingUtils.domNodesToCdt(Array.from(nodes).slice(0, 1));
                    that._logger.verbose('Preparing DOM - done.');
                });
            });
        }

        return promise.then(() => {
            that._logger.verbose('Preparing Eyes instance...');
            const eyes = new EyesStorybook(that._configs.serverUrl, that._promiseFactory);
            eyes.setApiKey(that._configs.apiKey);
            eyes.setRender(true);
            eyes.setBatch(that._testBatch);
            eyes.addProperty("Component name", story.getComponentName());
            eyes.addProperty("State", story.getState());
            if (that._configs.debug) {
                eyes.setLogHandler(that._logger.getLogHandler());
            }

            return eyes.open(that._configs.appName, story.getCompoundTitle(), story.getViewportSize()).then(() => {
                const dom = new RGridDom();
                dom.setResources(that._resources);
                dom.setDomNodes(that._domNodes);
                dom.setUrl(story.getStorybookUrl('http://localhost/'));
                that._logger.verbose('Preparing Eyes instance - done.');
                that._logger.verbose('Sending requests...');
                return eyes.checkByRender(dom, story.getCompoundTitle(), startNextCallback);
            }).then(() => {
                return eyes.close(false);
            }).then(results => {
                that._logger.verbose('Sending requests - done.');
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

module.exports = EyesStorybookRunner;
