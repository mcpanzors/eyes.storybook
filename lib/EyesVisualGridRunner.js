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
  RenderStatus,
} = require('@applitools/eyes.sdk.core');

const { EyesStorybook } = require('./EyesStorybook');
const { EyesVisualGridUtils } = require('./EyesVisualGridUtils');

/**
 * @param {string} resourcePath
 * @return {boolean}
 */
const filterResources = resourcePath => (resourcePath === 'index.html' || resourcePath.endsWith('.map'));

/**
 * @param {string} platform
 * @return {string}
 */
const getHostOSFromPlatform = platform => (platform && platform !== 'any' ? platform : 'Linux');

/**
 * @param {string} browserName
 * @return {string}
 */
const getHostAppFromBrowserName = browserName => (browserName.charAt(0).toUpperCase() + browserName.slice(1));

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

/**
 * @param {EyesStorybook} eyes
 * @param {string[]} renderIds
 * @param {function<string, string>} onCompleteAction
 * @return {Promise<string[]>}
 */
const processRendersRecursive = (eyes, renderIds, onCompleteAction) => {
  const renderingRenders = [];
  return eyes.getRenderStatusBatch(renderIds).then(renderStatusResults => {
    Array.from(renderStatusResults).forEach((renderStatusResult, i) => {
      if (renderStatusResult.getStatus() === RenderStatus.RENDERED) {
        onCompleteAction(renderIds[i], renderStatusResult.getImageLocation());
      } else if (renderStatusResult.getStatus() === RenderStatus.RENDERING) {
        renderingRenders.push(renderIds[i]);
      } else {
        throw new Error(`Error during rendering, renderId ${renderIds[i]}`);
      }
    });

    if (renderingRenders.length) {
      return GeneralUtils.sleep(100, eyes.getPromiseFactory())
        .then(() => processRendersRecursive(eyes, renderingRenders, onCompleteAction));
    }

    return null;
  });
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

    this._totalStories = stories.length;
    this._doneStories = 0;
    this._spinner = spinner;

    // const maxThreads = this._configs.maxConcurrency;

    this._logger.log(`Testing stories, total stories: ${this._totalStories}.`);

    const that = this;
    const storiesPromises = [];
    const renderIdStoryMap = new Map();

    const eyes = new EyesStorybook(that._configs, that._promiseFactory);
    if (that._configs.showEyesSdkLogs) {
      eyes.setLogHandler(new ConsoleLogHandler(that._configs.showEyesSdkLogs === 'verbose'));
    }

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
        that._logger.log('Requesting RenderingInfo from server...');
        return eyes.getRenderingInfo()
          .then(renderingInfo => {
            that._renderInfo = renderingInfo;
            eyes.setRenderingInfo(renderingInfo);
            that._logger.log('RenderingInfo was received.');
          });
      })
      .then(() => {
        that._logger.verbose('Sending resources and DOM to VisualGrid...');
        const renderRequest = new RenderRequest(that._renderInfo.getResultsUrl(), 'http://localhost/', that._rGridDom);
        return eyes.checkAndPutResources(renderRequest).then(() => {
          that._logger.verbose('Resources and DOM were sent.');
        });
      })
      .then(() => {
        that._logger.verbose('Sending render request to VisualGrid...');
        const renderRequests = Array.from(stories)
          .map(story => new RenderRequest(
            that._renderInfo.getResultsUrl(),
            story.getStoryUrl('http://localhost/'),
            that._rGridDom,
            RenderInfo.fromRectangleSize(story.getViewportSize()),
            that._configs.capabilities.platform,
            that._configs.capabilities.browserName
          ));

        return eyes.postRenderBatch(renderRequests).then(runningRenders => {
          that._logger.verbose('Render request sent, processing results...');

          Array.from(runningRenders).forEach((runningRender, i) => {
            if ([RenderStatus.RENDERING, RenderStatus.RENDERED].includes(runningRender.getRenderStatus())) {
              renderIdStoryMap.set(runningRender.getRenderId(), stories[i]);
            } else {
              throw new Error('An error during rendering, one of renders is not started.');
            }
          });

          that._logger.verbose('Render request results processed.');
        });
      })
      .then(() => processRendersRecursive(eyes, [...renderIdStoryMap.keys()], (renderId, imageLocation) => {
        storiesPromises.push(that.testStory(renderIdStoryMap.get(renderId), imageLocation));
      }))
      .then(() => {
        const elapsedTime = GeneralUtils.currentTimeMillis() - elapsedTimeStart;
        that._logger.log(`All stories were processed. Elapsed time ${GeneralUtils.elapsedString(elapsedTime)}`);
        return that._promiseFactory.all(storiesPromises);
      });
  }

  /**
   * @private
   * @param {EyesStorybookStory} story
   * @param {string} imageLocation
   * @returns {Promise<TestResults>}
   */
  testStory(story, imageLocation) {
    let eyes;
    const that = this;
    return this._promiseFactory.resolve()
      .then(() => {
        eyes = new EyesStorybook(that._configs, that._promiseFactory);
        eyes.setBatch(that._testBatch);
        eyes.addProperty('Component name', story.getComponentName());
        eyes.addProperty('State', story.getState());
        eyes.setHostOS(getHostOSFromPlatform(that._configs.capabilities.platform));
        eyes.setHostApp(getHostAppFromBrowserName(that._configs.capabilities.browserName));
        if (that._configs.showEyesSdkLogs) {
          eyes.setLogHandler(new ConsoleLogHandler(that._configs.showEyesSdkLogs === 'verbose'));
        }

        that._logger.verbose('Preforming screenshot validation...');
        return eyes.open(that._configs.appName, story.getCompoundTitle(), story.getViewportSize());
      })
      .then(() => eyes.checkUrl(imageLocation, story.getCompoundTitle()))
      .then(testResults => {
        that._logger.log(`Story ${story.toString()} was processed.`);
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
