'use strict';

const {Builder} = require('selenium-webdriver');
const {PromiseFactory} = require('eyes.utils');
const {SeleniumUtils} = require('./selenium');
const {Eyes} = require('./eyes');

class EyesStorybook {

    constructor(configs, testBatch, logger) {
        this._configs = configs;
        this._testBatch = testBatch;
        this._logger = logger;

        const builder = new Builder();
        if (this._configs.seleniumAddress) {
            builder.usingServer(this._configs.seleniumAddress);
        }

        if (this._configs.capabilities && Object.keys(this._configs.capabilities).length) {
            for (const key in this._configs.capabilities) {
                if (this._configs.capabilities.hasOwnProperty(key)) {
                    builder.getCapabilities().set(key, this._configs.capabilities[key]);
                }
            }
        }

        this._driver = builder.build();
        this._inferredEnvironment = null;

        this._promiseFactory = new PromiseFactory((asyncAction) => {
            return new Promise(asyncAction);
        }, null);
    }

    /**
     * @param {{componentName: string, state: string, url: string, compoundTitle: string, viewportSize: {width: number, height: number}}[]} stories
     * @returns {Promise.<{name: string, isPassed: string, totalSteps: string, failedSteps: string, batchUrl: string}[]>}
     */
    testStories(stories) {
        const that = this, storiesPromises = [];

        return Promise.resolve().then(() => {
            return that._driver.executeScript('return navigator.userAgent');
        }).then(function (userAgent) {
            that._inferredEnvironment = 'useragent:' + userAgent;
        }).then(() => {
            return SeleniumUtils.updateScalingParams(that._driver);
        }).then((scaleProviderFactory) => {
            let testPromise = Promise.resolve();
            stories.forEach((story) => {
                testPromise = testPromise.then(() => {
                    return new Promise((resolve) => {
                        const storyPromise = that.testStory(story, scaleProviderFactory, () => resolve());
                        storiesPromises.push(storyPromise);
                    });
                });
            });

            return testPromise;
        }).then(() => {
            return Promise.all(storiesPromises);
        }).then(results => {
            return that._driver.close().then(() => results);
        });
    }

    /**
     * @param {{componentName: string, state: string, url: string, compoundTitle: string, viewportSize: {width: number, height: number}}} story
     * @param {Object} scaleProviderFactory
     * @param {function} startNextCallback
     * @returns {Promise.<{name: string, isPassed: string, totalSteps: string, failedSteps: string, batchUrl: string}[]>}
     */
    testStory(story, scaleProviderFactory, startNextCallback) {
        const that = this;

        let eyes;
        return Promise.resolve().then(() => {
            return that.getScreenshotOfStory(story, scaleProviderFactory);
        }).then((screenshot) => {
            startNextCallback();

            return screenshot;
        }).then((screenshot) => {
            eyes = new Eyes(that._promiseFactory);
            eyes.setApiKey(that._configs.apiKey);
            eyes.setBatch(that._testBatch);
            eyes.addProperty("Component name", story.componentName);
            eyes.addProperty("State", story.state);
            eyes.setInferredEnvironment(that._inferredEnvironment);
            eyes.open(that._configs.appName, story.compoundTitle);

            return eyes.checkImage(screenshot, story.compoundTitle);
        }).then(() => {
            // logger.log("All screenshots captured, waiting results from Applitools...");
            return eyes.close().catch((error) => {
                return error.results;
            });
        }).then((results) => {
            return {
                name: results.name,
                isPassed: results.status === 'Passed',
                totalSteps: results.steps,
                failedSteps: results.mismatches + results.missing,
                batchUrl: results.appUrls.batch
            };
        });
    }

    /**
     * @param {{componentName: string, state: string, url: string, compoundTitle: string, viewportSize: {width: number, height: number}}} story
     * @param scaleProviderFactory
     * @returns {Promise.<MutableImage>}
     */
    getScreenshotOfStory(story, scaleProviderFactory) {
        if (story.viewportSize) {
            this._logger.verbose("Setting viewport size of '" + story.compoundTitle + "'...");
            SeleniumUtils.setViewportSize(this._driver, story.viewportSize);
        }

        this._logger.verbose("Opening url of '" + story.compoundTitle + "'...");
        this._driver.get(story.url);

        const that = this;
        return this._driver.controlFlow().execute(() => {
            that._logger.verbose("Capturing screenshot of '" + story.compoundTitle + "'...");
            return SeleniumUtils.getScreenshot(that._driver, scaleProviderFactory, that._promiseFactory).then((screenshot) => {
                that._logger.log("Capturing screenshot of '" + story.compoundTitle + "' done.");
                return screenshot;
            });
        });
    }
}

module.exports = {
    EyesStorybook: EyesStorybook
};

