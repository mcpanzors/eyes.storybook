'use strict';

require('chromedriver');
const {Builder} = require('selenium-webdriver');
const {BatchInfo, ConsoleLogHandler} = require('eyes.sdk.core');

const EyesStorybook = require('./EyesStorybook');
const EyesSeleniumUtils = require('./EyesSeleniumUtils');

class EyesWebDriverRunner {

    constructor(logger, promiseFactory, configs) {
        /** @type {Logger} */
        this._logger = logger;
        /** @type {PromiseFactory} */
        this._promiseFactory = promiseFactory;
        /** @type {Object} */
        this._configs = configs;

        this._testBatch = new BatchInfo(configs.appName);
        this._inferred = null;
        this._scaleProviderFactory = null;
    }

    /**
     * @param {StorybookStory[]} stories
     * @returns {Promise.<TestResults[]>}
     */
    testStories(stories) {
        this._logger.log('Splitting stories for multiple parts...');
        const maxThreads = this._configs.maxRunningBrowsers;
        const defaultThreads = this._configs.viewportSize ? this._configs.viewportSize.length : 1;
        const threadsCount = maxThreads === 0 ? defaultThreads : (maxThreads > stories.length ? stories.length : maxThreads);

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
        let firstStoryDriver, firstStoryPromise;
        return that._promiseFactory.makePromise(resolve => {
            that._logger.log('Starting processing first story, to retrieve userAgent and scaling factor...');
            firstStoryDriver = this.createWebDriver();
            firstStoryPromise = that.testStory(firstStoryDriver, firstStory, 0, 0, () => resolve());
            storiesPromises.push(firstStoryPromise);
        }).then(() => {
            that._logger.log('UserAgent and scaling factor have been retrieved.');
            const threadsPromises = [];
            that._logger.log(`Starting rest ${stories.length} threads for processing stories...`);
            storiesParts.forEach((stories, i) => {
                let threadPromise, driver;
                if (i === 0) {
                    threadPromise = firstStoryPromise;
                    driver = firstStoryDriver;
                } else {
                    threadPromise = that._promiseFactory.resolve();
                    driver = this.createWebDriver();
                }

                stories.forEach((story, j) => {
                    threadPromise = threadPromise.then(() => {
                        const promise = that.testStory(driver, story, i, j);
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
     * @param driver
     * @param {StorybookStory} story
     * @param {int} i Thread number
     * @param {int} j Story number in thread
     * @param {function} [startNextCallback]
     * @returns {Promise.<TestResults>}
     */
    testStory(driver, story, i, j, startNextCallback) {
        this._logger.verbose(`[${i}] Starting processing story ${story.getCompoundTitleWithViewportSize()}...`);

        const that = this;
        let promise = this._promiseFactory.resolve();
        if (!that._inferred) {
            promise = promise.then(() => {
                that._logger.verbose(`[${i}] Retrieving userAgent...`);
                return driver.executeScript('return navigator.userAgent;');
            }).then(userAgent => {
                that._inferred = 'useragent:' + userAgent;
                that._logger.verbose(`[${i}] UserAgent have been retrieved and cached.`);
                that._logger.verbose(`[${i}] Retrieving scaling params...`);
                return EyesSeleniumUtils.updateScalingParams(that._logger, driver);
            }).then(scaleProviderFactory => {
                that._scaleProviderFactory = scaleProviderFactory;
                that._logger.verbose(`[${i}] Scaling params have been retrieved and cached.`);
            });
        }

        return promise.then(() => {
            if (startNextCallback) {
                startNextCallback();
            }

            if (story.getViewportSize()) {
                that._logger.verbose(`[${i}] Changing viewport size of the driver...`);
                return EyesSeleniumUtils.setViewportSize(that._logger, driver, story.getViewportSize()).then(() => {
                    that._logger.verbose(`[${i}] Viewport size have been changed.`);
                });
            }
        }).then(() => {
            const navigateTo = story.getStorybookUrl(that._configs.storybookAddress);
            that._logger.verbose(`[${i}] Navigation driver to ${navigateTo}...`);
            return driver.get(navigateTo);
        }).then(() => {
            that._logger.verbose(`[${i}] Capturing screenshot...`);
            return EyesSeleniumUtils.getScreenshot(driver, that._scaleProviderFactory, that._promiseFactory);
        }).then(screenshot => {
            that._logger.log(`[${i}] Screenshot have been created.`);

            that._logger.verbose(`[${i}] Preparing Eyes instance...`);
            const eyes = new EyesStorybook(that._configs.serverUrl, that._promiseFactory);
            eyes.setApiKey(that._configs.apiKey);
            eyes.setBatch(that._testBatch);
            eyes.addProperty("Component name", story.getComponentName());
            eyes.addProperty("State", story.getState());
            eyes.setInferredEnvironment(that._inferred);
            if (that._configs.showEyesSdkLogs) {
                eyes.setLogHandler(new ConsoleLogHandler(that._configs.showEyesSdkLogs === 'verbose'));
            }

            that._logger.verbose(`[${i}] Opening Eyes session...`);
            return eyes.open(that._configs.appName, story.getCompoundTitle(), story.getViewportSize()).then(() => {
                that._logger.verbose(`[${i}] Sending check request...`);
                return eyes.checkImage(screenshot, story.getCompoundTitle());
            }).then(() => {
                that._logger.verbose(`[${i}] Sending close request...`);
                return eyes.close(false);
            }).then(results => {
                that._logger.log(`[${i}] Story ${story.getCompoundTitleWithViewportSize()} have been processed.`);
                return results;
            });
        });
    }

    /**
     * @private
     * @return {*}
     */
    createWebDriver() {
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

        return builder.build();
    }
}

module.exports = EyesWebDriverRunner;
