'use strict';

const {Builder} = require('selenium-webdriver');
const {PromiseFactory} = require('eyes.utils');
const {SeleniumUtils} = require('./selenium');
const {Eyes} = require('./eyes');

class EyesStorybook {

    constructor(configs) {
        this.configs = configs;

        const builder = new Builder();
        builder.usingServer(this.configs.seleniumAddress);
        if (this.configs.capabilities && Object.keys(this.configs.capabilities).length) {
            for (const key in this.configs.capabilities) {
                if (this.configs.capabilities.hasOwnProperty(key)) {
                    builder.getCapabilities().set(key, this.configs.capabilities[key]);
                }
            }
        }

        this._driver = builder.build();

        this._promiseFactory = new PromiseFactory((asyncAction) => {
            return new Promise(asyncAction);
        }, null);

        this._sessions = {};
        this._testBatch = SeleniumUtils.createTestBatch(this.configs.appName);
    }

    /**
     * @param {{groupName: string, storyName: string, storyUrl: string, compoundTitle: string}[]} stories
     * @returns {Promise.<{name: string, isPassed: string, totalSteps: string, failedSteps: string, batchUrl: string}[]>}
     */
    testStories(stories) {
        const that = this;

        let scaleProviderFactory;
        let promise = Promise.resolve(), results = [];
        if (that.configs.viewportSize && that.configs.viewportSize.width && that.configs.viewportSize.height) {
            promise = promise.then(() => {
                return SeleniumUtils.setViewportSize(that._driver, that.configs.viewportSize);
            });
        }

        promise = promise.then(() => {
            return SeleniumUtils.updateScalingParams(that._driver).then((result) => {
                scaleProviderFactory = result;
            });
        });

        return promise.then(() => {
            const promises = [];
            stories.forEach((story) => {
                const storyPromise = that.getScreenshotOfStory(story, scaleProviderFactory).then((screenshot) => {
                    const eyes = that.getEyesSession(story.groupName);
                    return eyes.checkImage(screenshot, story.compoundTitle);
                });

                promises.push(storyPromise);
            });

            return Promise.all(promises);
        }).then(() => {
            console.log("All screenshots captured, waiting results from Applitools...");
            const promises = [];
            Object.keys(that._sessions).forEach(function(key) {
                const eyesPromise = that._sessions[key].close().then((sessionResults) => {
                    pushToResults(sessionResults);
                    //console.log("[EYES: TEST PASSED]: See details at", sessionResults.appUrls.session);
                }, (error) => {
                    pushToResults(error.results);
                    //console.error(error.message);
                });

                promises.push(eyesPromise);
            });

            return Promise.all(promises)
        }).then(() => {
            return results;
        });

        function pushToResults(sessionResults) {
            results.push({
                name: sessionResults.name,
                isPassed: sessionResults.isPassed,
                totalSteps: sessionResults.steps,
                failedSteps: sessionResults.mismatches + sessionResults.missing,
                batchUrl: sessionResults.appUrls.batch
            });
        }
    }



    /**
     * @param {{groupName: string, storyName: string, storyUrl: string, compoundTitle: string}} story
     * @param scaleProviderFactory
     * @returns {Promise.<MutableImage>}
     */
    getScreenshotOfStory(story, scaleProviderFactory) {
        const that = this;

        that._driver.get(story.storyUrl);

        return that._driver.controlFlow().execute(() => {
            console.log("Capturing screenshot of '" + story.compoundTitle + "'...");
            return SeleniumUtils.getScreenshot(that._driver, scaleProviderFactory, that._promiseFactory).then((screenshot) => {
                console.log("Capturing screenshot of '" + story.compoundTitle + "' done.");
                return screenshot;
            });
        });
    }

    /**
     * @param {string} groupName
     * @returns {Eyes}
     */
    getEyesSession(groupName) {
        if (!this._sessions[groupName]) {
            const eyes = new Eyes(this._promiseFactory);
            eyes.setApiKey(this.configs.apiKey);
            eyes.setBatch(this._testBatch);
            eyes.open(this.configs.appName, groupName);
            this._sessions[groupName] = eyes;
        }

        return this._sessions[groupName];
    }
}

module.exports = {
    EyesStorybook: EyesStorybook
};

