'use strict';

require('chromedriver');
const {Builder} = require('selenium-webdriver');
const {BatchInfo, ConsoleLogHandler, Logger} = require('@applitools/eyes.sdk.core');

const EyesStorybook = require('./EyesStorybook');
const StorybookUtils = require('./StorybookUtils');
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

        this._eyesSdkLogger = new Logger();
        if (this._configs.showEyesSdkLogs) {
            this._eyesSdkLogger.setLogHandler(new ConsoleLogHandler(this._configs.showEyesSdkLogs === 'verbose'));
        }
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
        let firstStoryDriver, firstStoryPromise;
        return that._promiseFactory.makePromise(resolve => {
            that._logger.verbose('Starting processing first story, to retrieve userAgent and scaling factor...');
            firstStoryDriver = this.createWebDriver();
            firstStoryPromise = that.testStory(firstStoryDriver, firstStory, 0, 0, () => resolve());
            storiesPromises.push(firstStoryPromise);
        }).then(() => {
            that._logger.verbose('UserAgent and scaling factor were retrieved from the server.');
            const threadsPromises = [];
            that._logger.verbose(`Starting rest ${stories.length} threads for processing stories...`);
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
            that._logger.log(`All stories were processed.`);
            return that._promiseFactory.all(storiesPromises);
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
        this._logger.log(`[${i}] Starting processing story ${story.getCompoundTitleWithViewportSize()}...`);

        const that = this;
        let promise = this._promiseFactory.resolve();
        if (!that._inferred) {
            promise = promise.then(() => {
                that._logger.log(`[${i}] Retrieving userAgent...`);
                return driver.executeScript('return navigator.userAgent;');
            }).then(userAgent => {
                that._inferred = 'useragent:' + userAgent;
                that._logger.log(`[${i}] UserAgent was retrieved and cached.`);

                that._logger.log(`[${i}] Retrieving scaling params...`);
                return EyesSeleniumUtils.updateScalingParams(that._eyesSdkLogger, driver);
            }).then(scaleProviderFactory => {
                that._scaleProviderFactory = scaleProviderFactory;
                that._logger.log(`[${i}] Scaling params were retrieved and cached.`);
            });
        }

        return promise.then(() => {
            if (startNextCallback) {
                startNextCallback();
            }

            if (story.getViewportSize()) {
                that._logger.verbose(`[${i}] Changing viewport size of the browser...`);
                return EyesSeleniumUtils.setViewportSize(that._eyesSdkLogger, driver, story.getViewportSize()).then(() => {
                    that._logger.verbose(`[${i}] Viewport size was changed.`);
                });
            }
        }).then(() => {
            const navigateTo = story.getStorybookUrl(that._configs.storybookAddress);
            that._logger.verbose(`[${i}] Navigation browser to ${navigateTo}...`);
            return driver.get(navigateTo);
        }).then(() => {
            that._logger.verbose(`[${i}] Page was opened.`);

            that._logger.verbose(`[${i}] Capturing screenshot...`);
            return EyesSeleniumUtils.getScreenshot(that._eyesSdkLogger, driver, that._scaleProviderFactory, that._promiseFactory);
        }).then(screenshot => {
            that._logger.verbose(`[${i}] Screenshot was created.`);

            const eyes = new EyesStorybook(that._configs.serverUrl, that._promiseFactory);
            eyes.setApiKey(that._configs.apiKey);
            eyes.setBatch(that._testBatch);
            eyes.addProperty("Component name", story.getComponentName());
            eyes.addProperty("State", story.getState());
            eyes.setInferredEnvironment(that._inferred);
            eyes.setLogHandler(that._eyesSdkLogger.getLogHandler());

            that._logger.verbose(`[${i}] Opening Eyes session...`);
            return eyes.open(that._configs.appName, story.getCompoundTitle(), story.getViewportSize()).then(() => {
                that._logger.verbose(`[${i}] Session was created.`);

                that._logger.verbose(`[${i}] Sending check request...`);
                return eyes.checkImage(screenshot, story.getCompoundTitle());
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
