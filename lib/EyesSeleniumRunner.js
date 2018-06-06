'use strict';

require('chromedriver'); // eslint-disable-line import/no-extraneous-dependencies
const { Builder } = require('selenium-webdriver'); // eslint-disable-line import/no-extraneous-dependencies
const { BatchInfo, ConsoleLogHandler, Logger, GeneralUtils } = require('@applitools/eyes.sdk.core');

const { EyesStorybook } = require('./EyesStorybook');
const { EyesSeleniumUtils } = require('./EyesSeleniumUtils');

const DEFAULT_CONCURRENCY = 10;

class EyesSeleniumRunner {
  constructor(logger, promiseFactory, configs) {
    /** @type {Logger} */
    this._logger = logger;
    /** @type {PromiseFactory} */
    this._promiseFactory = promiseFactory;
    /** @type {object} */
    this._configs = configs;

    this._testBatch = new BatchInfo(configs.appName);
    this._inferred = undefined;
    this._providerFactory = undefined;

    this._totalStories = undefined;
    this._doneStories = undefined;
    this._spinner = undefined;

    this._sdkLogger = new Logger();
    if (this._configs.showEyesSdkLogs) {
      this._sdkLogger.setLogHandler(new ConsoleLogHandler(this._configs.showEyesSdkLogs === 'verbose'));
    }
  }

  /**
   * @param {EyesStorybookStory[]} stories
   * @param {Ora} spinner
   * @returns {Promise<TestResults[]>}
   */
  testStories(stories, spinner) {
    const elapsedTimeStart = GeneralUtils.currentTimeMillis();
    this._logger.log('Splitting stories for multiple parts...');

    this._totalStories = stories.length;
    this._doneStories = 0;
    this._spinner = spinner;

    const maxThreads = this._configs.maxConcurrency;
    const defaultConcurrency = DEFAULT_CONCURRENCY > this._totalStories ? this._totalStories : DEFAULT_CONCURRENCY;
    const maxConcurrency = maxThreads > this._totalStories ? this._totalStories : maxThreads;
    const threadsCount = maxThreads === 0 ? defaultConcurrency : maxConcurrency;

    const storiesParts = [];
    const storiesMod = this._totalStories % threadsCount;
    const storiesPerThread = (this._totalStories - storiesMod) / threadsCount;

    let startStory = 0;
    let endStory = 0;
    let modLeft = storiesMod;
    for (let i = 0; i < threadsCount; i += 1) {
      startStory = endStory;
      if (modLeft > 0) {
        modLeft -= 1;
        endStory = startStory + storiesPerThread + 1;
      } else {
        endStory = startStory + storiesPerThread;
      }
      storiesParts.push(stories.slice(startStory, endStory));
    }

    const perThread = storiesPerThread + (storiesMod ? `-${storiesPerThread + 1}` : '');
    this._logger.log(`Stories were slitted for ${threadsCount} parts. ` +
      `Stories per thread: ${perThread}, total stories: ${this._totalStories}.`);

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
    })
      .then(() => {
        that._logger.verbose('UserAgent and scaling factor were retrieved from the server.');
        const threadsPromises = [];
        that._logger.verbose(`Starting rest ${that._totalStories} threads for processing stories...`);
        storiesParts.forEach((storiesPart, i) => {
          let threadPromise, driver;
          if (i === 0) {
            threadPromise = firstStoryPromise;
            driver = firstStoryDriver;
          } else {
            threadPromise = that._promiseFactory.resolve();
            driver = this.createWebDriver();
          }

          storiesPart.forEach((story, j) => {
            threadPromise = threadPromise.then(() => {
              const promise = that.testStory(driver, story, i, j);
              storiesPromises.push(promise);
              return promise;
            });
          });

          threadPromise = threadPromise.then(() => driver.quit());
          threadsPromises.push(threadPromise);
        });
        return that._promiseFactory.all(threadsPromises);
      })
      .then(() => {
        const elapsedTime = GeneralUtils.currentTimeMillis() - elapsedTimeStart;
        that._logger.log(`All stories were processed. Elapsed time ${GeneralUtils.elapsedString(elapsedTime)}`);
        return that._promiseFactory.all(storiesPromises);
      });
  }

  /**
   * @private
   * @param driver
   * @param {EyesStorybookStory} story
   * @param {number} i Thread number
   * @param {number} j Story number in thread
   * @param {function} [startNextCallback]
   * @returns {Promise<TestResults>}
   */
  testStory(driver, story, i, j, startNextCallback) {
    this._logger.log(`[${i}] Starting processing story ${story.toString()}...`);

    const that = this;
    let promise = this._promiseFactory.resolve();
    if (!that._inferred) {
      promise = promise
        .then(() => {
          that._logger.log(`[${i}] Retrieving userAgent...`);
          return driver.executeScript('return navigator.userAgent;');
        })
        .then(userAgent => {
          that._inferred = `useragent:${userAgent}`;
          that._logger.log(`[${i}] UserAgent was retrieved and cached.`);

          that._logger.log(`[${i}] Retrieving scaling params...`);
          return EyesSeleniumUtils.updateScalingParams(that._sdkLogger, driver);
        })
        .then(scaleProviderFactory => {
          that._providerFactory = scaleProviderFactory;
          that._logger.log(`[${i}] Scaling params were retrieved and cached.`);
        });
    }

    return promise
      .then(() => {
        if (startNextCallback) {
          startNextCallback();
        }

        if (story.getViewportSize()) {
          that._logger.verbose(`[${i}] Changing viewport size of the browser...`);
          return EyesSeleniumUtils.setViewportSize(that._sdkLogger, driver, story.getViewportSize())
            .then(() => {
              that._logger.verbose(`[${i}] Viewport size was changed.`);
            });
        }
      })
      .then(() => {
        const navigateTo = story.getStoryUrl(that._configs.storybookUrl);
        that._logger.verbose(`[${i}] Navigation browser to ${navigateTo}...`);
        return driver.get(navigateTo);
      })
      .then(() => {
        that._logger.verbose(`[${i}] Page was opened.`);

        that._logger.verbose(`[${i}] Capturing screenshot...`);
        return EyesSeleniumUtils.getScreenshot(that._sdkLogger, driver, that._providerFactory, that._promiseFactory);
      })
      .then(screenshot => {
        that._logger.verbose(`[${i}] Screenshot was created.`);

        const eyes = new EyesStorybook(that._configs, that._promiseFactory);
        eyes.setBatch(that._testBatch);
        eyes.addProperty('Component name', story.getComponentName());
        eyes.addProperty('State', story.getState());
        eyes.setInferredEnvironment(that._inferred);
        eyes.setLogHandler(that._sdkLogger.getLogHandler());

        that._logger.verbose(`[${i}] Preforming screenshot validation...`);
        return eyes.open(that._configs.appName, story.getCompoundTitle(), story.getViewportSize())
          .then(() => eyes.checkImage(screenshot, story.getCompoundTitle()))
          .then(testResults => {
            that._logger.verbose(`[${i}] Screenshot was validated.`);
            that._logger.log(`[${i}] Story ${story.toString()} was processed.`);
            that.onStoryDone();
            return testResults;
          });
      });
  }

  /**
   * @private
   */
  onStoryDone() {
    this._doneStories += 1;

    // eslint-disable-next-line
    this._spinner.text = `Done ${this._doneStories} stor${this._doneStories > 1 ? 'ies' : 'y'} out of ${this._totalStories}`;
  }

  /**
   * @private
   * @return {*}
   */
  createWebDriver() {
    const builder = new Builder();
    if (this._configs.seleniumUrl) {
      builder.usingServer(this._configs.seleniumUrl);
    }

    if (this._configs.capabilities) {
      Object.keys(this._configs.capabilities).forEach(key => {
        builder.getCapabilities().set(key, this._configs.capabilities[key]);
      });
    }

    return builder.build();
  }
}

exports.EyesSeleniumRunner = EyesSeleniumRunner;
