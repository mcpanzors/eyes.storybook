'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const {
  BatchInfo,
  RGridResource,
  RGridDom,
  ConsoleLogHandler,
  GeneralUtils,
  RenderInfo,
  RenderRequest,
} = require('@applitools/eyes.sdk.core');

const { EyesStorybook } = require('./EyesStorybook');
const { EyesVisualGridUtils } = require('./EyesVisualGridUtils');

/**
 * @param {string} resourcePath
 * @return {boolean}
 */
const filterResources = resourcePath => resourcePath === 'index.html' || resourcePath.endsWith('.map');

/**
 * @param {string} outputDir
 * @param {PromiseFactory} promiseFactory
 * @return {Promise<Map<string, RGridResource>>}
 */
const readResources = (outputDir, promiseFactory) => {
  const resources = new Map();
  const promises = [];

  const storeResource = (fullPath, localPath, fileName) => promiseFactory.makePromise((resolve, reject) => {
    fs.readFile(fullPath, (err, data) => {
      if (err) return reject(err);

      const resource = new RGridResource();
      resource.setUrl(`http://localhost/${localPath}`);
      resource.setContentType(mime.lookup(fileName));
      resource.setContent(data);
      resources.set(localPath, resource);
      return resolve();
    });
  });

  const readResourcesRecursive = (fullPathToDir, localPathToDir) => {
    fs.readdirSync(fullPathToDir).forEach(fileName => {
      const fullPath = path.join(fullPathToDir, fileName);
      const localPath = localPathToDir ? `${localPathToDir}/${fileName}` : fileName;

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

class EyesVisualGridRunner {
  constructor(logger, promiseFactory, configs) {
    /** @type {Logger} */
    this._logger = logger;
    /** @type {PromiseFactory} */
    this._promiseFactory = promiseFactory;
    /** @type {object} */
    this._configs = configs;

    this._testBatch = new BatchInfo(configs.appName);
    this._rGridDom = new RGridDom();
    this._renderInfo = undefined;

    this._totalStories = undefined;
    this._doneStories = undefined;
    this._spinner = undefined;
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
    const threadsCount = (maxThreads === 0 || maxThreads > this._totalStories) ? this._totalStories : maxThreads;

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
    let firstStoryPromise;

    that._logger.log('Collecting resources...');
    return readResources(that._configs.storybookOutputDir, that._promiseFactory)
      .then(resources => {
        that._logger.log('Resources were collected.');

        that._logger.log('Preparing DOM...');
        const iframeResource = resources.get('iframe.html');
        resources.delete('iframe.html');
        that._rGridDom.setResources(Array.from(resources.values()));

        return EyesVisualGridUtils.getDocumentFromHtml(that._promiseFactory, iframeResource.getContent());
      })
      .then(document => {
        const nodes = document.querySelectorAll('*');
        that._rGridDom.setDomNodes(EyesVisualGridUtils.domNodesToCdt(Array.from(nodes).slice(0, 1)));
        that._logger.log('DOM was prepared and cached.');
      })
      .then(() => {
        that._logger.log('Requesting RenderingInfo...');
        const eyes = new EyesStorybook(that._configs, that._promiseFactory);
        return eyes.getRenderingInfo()
          .then(renderingInfo => {
            that._renderInfo = renderingInfo;
            that._logger.log('RenderingInfo was received.');
          });
      })
      .then(() => that._promiseFactory.makePromise(resolve => {
        that._logger.verbose('Starting processing first story, to send resources and DOM to server...');
        firstStoryPromise = that.testStory(firstStory, 0, 0, () => resolve());
        storiesPromises.push(firstStoryPromise);
      }))
      .then(() => {
        that._logger.verbose('Resources and DOM were sent to the server.');
        const threadsPromises = [];
        that._logger.verbose(`Starting rest ${that._totalStories} threads for processing stories...`);
        storiesParts.forEach((storiesPart, i) => {
          let threadPromise = i === 0 ? firstStoryPromise : that._promiseFactory.resolve();
          storiesPart.forEach((story, j) => {
            threadPromise = threadPromise.then(() => {
              const promise = that.testStory(story, i, j);
              storiesPromises.push(promise);
              return promise;
            });
          });
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
   * @param {EyesStorybookStory} story
   * @param {number} i Thread number
   * @param {number} j Story number in thread
   * @param {function} [startNextCallback]
   * @returns {Promise<TestResults>}
   */
  testStory(story, i, j, startNextCallback) {
    let eyes, imageUrl;
    const that = this;
    return this._promiseFactory.resolve()
      .then(() => {
        that._logger.log(`[${i}] Starting processing story ${story.toString()}...`);

        eyes = new EyesStorybook(that._configs, that._promiseFactory);
        eyes.setBatch(that._testBatch);
        eyes.addProperty('Component name', story.getComponentName());
        eyes.addProperty('State', story.getState());
        eyes.setHostOS('Linux');
        eyes.setHostApp(that._configs.capabilities.browserName);
        if (that._configs.showEyesSdkLogs) {
          eyes.setLogHandler(new ConsoleLogHandler(that._configs.showEyesSdkLogs === 'verbose'));
        }

        that._logger.verbose(`[${i}] Sending Rendering requests...`);
        const renderRequest = new RenderRequest(
          that._renderInfo.getResultsUrl(),
          story.getStoryUrl('http://localhost/'),
          that._rGridDom,
          RenderInfo.fromRectangleSize(story.getViewportSize()),
          that._configs.capabilities.browserName
        );

        return eyes.renderWindow(renderRequest, that._renderInfo);
      }).then(imageLocation => {
        imageUrl = imageLocation;
        that._logger.verbose(`[${i}] Render was finished.`);
        if (startNextCallback) {
          startNextCallback();
        }

        that._logger.verbose(`[${i}] Preforming screenshot validation...`);
        return eyes.open(that._configs.appName, story.getCompoundTitle(), story.getViewportSize());
      })
      .then(() => eyes.checkUrl(imageUrl, story.getCompoundTitle()))
      .then(testResults => {
        that._logger.verbose(`[${i}] Screenshot was validated.`);
        that._logger.log(`[${i}] Story ${story.toString()} was processed.`);
        that.onStoryDone();
        return testResults;
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
}

exports.EyesVisualGridRunner = EyesVisualGridRunner;
