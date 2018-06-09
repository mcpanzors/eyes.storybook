'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const jsdom = require('jsdom/lib/old-api');
const { spawn, exec } = require('child_process');
const { RectangleSize, GeneralUtils } = require('@applitools/eyes.sdk.core');

const { EyesStorybookStory } = require('./EyesStorybookStory');

const IS_WINDOWS = process.platform.startsWith('win');
const REQUEST_TIMEOUT = 10000; // ms
const WAIT_BETWEEN_REQUESTS = 1000; // ms
const REQUEST_RETRY = 3;

/**
 * @param {Buffer} data
 * @return {string}
 */
const bufferToString = data => data.toString('utf8').trim();

/**
 * @param {PromiseFactory} promiseFactory
 * @param {object} configs
 * @param {string} storybookCode
 * @returns {Promise<array<object>>}
 */
const getStorybookInstance = (promiseFactory, configs, storybookCode) =>
  promiseFactory.makePromise((resolve, reject) => {
    // JSDom is node-parser for javascript and therefore it doesn't support some browser's API.
    // The Applitools Storybook API itself don't require them, but they needed to run clients' applications correctly.
    const mocksCode = [
      EyesStorybookUtils.readFile(`${__dirname}/mocks/event-source.js`),
      EyesStorybookUtils.readFile(`${__dirname}/mocks/local-storage.js`),
      EyesStorybookUtils.readFile(`${__dirname}/mocks/match-media.js`),
    ];

    const jsdomConfig = {
      html: '',
      src: mocksCode.concat(storybookCode),
      done: (err, window) => {
        if (err) return reject(err.response.body);
        if (!window || !window.__storybook_stories__) {
          const message = 'Storybook object not found on window. ' +
            'Check window.__storybook_stories__ is set in your Storybook\'s config.js.\n' +
            'You need to set it manually or use `--build` option to set it automatically.';
          return reject(new Error(message));
        }

        return resolve(window.__storybook_stories__);
      },
    };

    if (configs.showStorybookOutput) {
      jsdomConfig.virtualConsole = jsdom.createVirtualConsole().sendTo(console);
    }

    jsdom.env(jsdomConfig);
  });

/**
 * @param {Logger} logger
 * @param {PromiseFactory} promiseFactory
 * @param {object} configs
 * @param {string} previewCode
 * @returns {Promise<EyesStorybookStory[]>}
 */
const prepareStories = (logger, promiseFactory, configs, previewCode) =>
  getStorybookInstance(promiseFactory, configs, previewCode).then(storybook => {
    logger.log('Storybook instance was created.');

    const stories = [];
    Array.from(storybook).forEach(group => {
      Array.from(group.stories).forEach(story => {
        stories.push(new EyesStorybookStory(group.kind, story.name));
      });
    });

    logger.log('Storied were extracted.');

    if (!configs.viewportSize) {
      return stories;
    }

    const newStories = [];
    configs.viewportSize.forEach(viewportSize => {
      stories.forEach(story => {
        newStories.push(new EyesStorybookStory(
          story.getComponentName(),
          story.getState(),
          new RectangleSize(viewportSize)
        ));
      });
    });

    logger.log('Storied were mixed with viewportSize(s).');
    return newStories;
  });

/**
 * @param {PromiseFactory} promiseFactory
 * @param {ChildProcess} childProcess
 * @return {Promise<string>}
 */
const waitForStorybookStarted = (promiseFactory, childProcess) =>
  promiseFactory.makePromise((resolve, reject) => {
    const portBusyListener = str => {
      if (str.includes('Error: listen EADDRINUSE')) {
        reject('Storybook port already in use.');
      }
    };

    const webpackBuiltListener = str => {
      if (str.includes('webpack built')) {
        resolve();
      }
    };

    childProcess.stdout.on('data', data => webpackBuiltListener(bufferToString(data)));
    childProcess.stderr.on('data', data => portBusyListener(bufferToString(data)));

    // Set up the timeout
    setTimeout(() => reject('Storybook din\'t start after 5 min waiting.'), 5 * 60 * 1000); // 5 min
  });

class EyesStorybookUtils {
  /**
   * @param {Logger} logger
   * @param {PromiseFactory} promiseFactory
   * @param {object} configs
   * @return {Promise<string>}
   */
  static startServer(logger, promiseFactory, configs) {
    if (configs.storybookUrl) {
      logger.log('storybookUrl set, starting Storybook skipped.');
      return promiseFactory.resolve(configs.storybookUrl);
    }

    logger.log('Starting Storybook...');

    const storybookPath = path.resolve(process.cwd(), `node_modules/.bin/start-storybook${IS_WINDOWS ? '.cmd' : ''}`);
    const args = ['-p', configs.storybookPort, '-h', configs.storybookHost, '-c', configs.storybookConfigDir];

    if (configs.storybookStaticDir) {
      args.push('-s');
      args.push(configs.storybookStaticDir);
    }

    const storybookConfigPath = path.resolve(process.cwd(), configs.storybookConfigDir, 'config.js');
    if (!fs.existsSync(storybookConfigPath)) {
      return promiseFactory.reject(new Error(`Storybook config file not found: ${storybookConfigPath}`));
    }

    let isConfigOverridden = false;
    const storybookConfigBody = EyesStorybookUtils.readFile(storybookConfigPath);
    if (!storybookConfigBody.includes('__storybook_stories__')) {
      logger.verbose('Rewriting configuration...');
      const template = EyesStorybookUtils.updateStorybookConfig(configs, storybookConfigBody);
      EyesStorybookUtils.writeFile(storybookConfigPath, template);
      isConfigOverridden = true;
    }

    logger.log(`${storybookPath.toString()} ${args.join(' ')}`);
    const childProcess = spawn(storybookPath, args, { detached: !IS_WINDOWS });

    if (configs.showStorybookOutput) {
      childProcess.stderr.on('data', data => console.error(bufferToString(data))); // eslint-disable-line no-console
      childProcess.stdout.on('data', data => console.log(bufferToString(data))); // eslint-disable-line no-console
    }

    // exit on terminate
    process.on('exit', () => {
      if (isConfigOverridden) {
        logger.verbose('Restoring configuration...');
        EyesStorybookUtils.writeFile(storybookConfigPath, storybookConfigBody);
      }

      try {
        if (IS_WINDOWS) {
          spawn('taskkill', ['/pid', childProcess.pid, '/f', '/t']);
        } else {
          process.kill(-childProcess.pid);
        }
      } catch (e) {
        logger.log('Can\'t kill child (Storybook) process.', e);
      }
    });

    process.on('SIGINT', () => process.exit());
    process.on('SIGTERM', () => process.exit());
    process.on('uncaughtException', () => process.exit(1));

    return waitForStorybookStarted(promiseFactory, childProcess)
      .then(() => {
        logger.log('Storybook was started.');
        return `http://${configs.storybookHost}:${configs.storybookPort}/`;
      });
  }

  /**
   * @param {Logger} logger
   * @param {PromiseFactory} promiseFactory
   * @param {object} configs
   * @return {Promise<void>}
   */
  static buildStorybook(logger, promiseFactory, configs) {
    if (configs.skipStorybookBuild) {
      return promiseFactory.resolve();
    }

    logger.log('Building Storybook...');
    const storybookPath = path.resolve(process.cwd(), `node_modules/.bin/build-storybook${IS_WINDOWS ? '.cmd' : ''}`);
    const args = ['-c', configs.storybookConfigDir, '-o', configs.storybookOutputDir];

    if (configs.storybookStaticDir) {
      args.push('-s');
      args.push(configs.storybookStaticDir);
    }

    const storybookConfigPath = path.resolve(process.cwd(), configs.storybookConfigDir, 'config.js');
    if (!fs.existsSync(storybookConfigPath)) {
      return promiseFactory.reject(new Error(`Storybook config file not found: ${storybookConfigPath}`));
    }

    let isConfigOverridden = false;
    const storybookConfigBody = EyesStorybookUtils.readFile(storybookConfigPath);
    if (!storybookConfigBody.includes('__storybook_stories__')) {
      logger.verbose('Rewriting configuration...');
      const template = EyesStorybookUtils.updateStorybookConfig(configs, storybookConfigBody);
      EyesStorybookUtils.writeFile(storybookConfigPath, template);
      isConfigOverridden = true;
    }

    logger.log(`${storybookPath.toString()} ${args.join(' ')}`);
    const childProcess = exec(storybookPath, args);

    return promiseFactory.makePromise((resolve, reject) => {
      childProcess.on('error', reject);
      childProcess.on('exit', () => {
        logger.log('Storybook was built.');

        if (isConfigOverridden) {
          logger.verbose('Restoring configuration...');
          EyesStorybookUtils.writeFile(storybookConfigPath, storybookConfigBody);
        }

        return resolve();
      });
    });
  }

  /**
   * @param {Logger} logger
   * @param {PromiseFactory} promiseFactory
   * @param {object} configs
   * @returns {Promise<EyesStorybookStory[]>}
   */
  static getStories(logger, promiseFactory, configs) {
    if (configs.useSelenium) {
      return EyesStorybookUtils.getStoriesFromWeb(logger, promiseFactory, configs);
    }

    return EyesStorybookUtils.getStoriesFromStatic(logger, promiseFactory, configs);
  }

  /**
   * @param {Logger} logger
   * @param {PromiseFactory} promiseFactory
   * @param {object} configs
   * @param {number} [retry]
   * @returns {Promise<EyesStorybookStory[]>}
   */
  static getStoriesFromWeb(logger, promiseFactory, configs, retry = REQUEST_RETRY) {
    logger.log('Getting stories from storybook server...', retry !== REQUEST_RETRY ? (` ${retry} retries left.`) : '');

    return axios.get(`${configs.storybookUrl}static/preview.bundle.js`, { timeout: REQUEST_TIMEOUT })
      .then(previewResponse => { // eslint-disable-line arrow-body-style
        return axios.get(`${configs.storybookUrl}static/vendor.bundle.js`, { timeout: REQUEST_TIMEOUT })
          .then(vendorResponse => `${vendorResponse.data};\n${previewResponse.data}`)
          .catch(err => {
            if (err && err.response.status !== 404) {
              logger.verbose('Getting vendor.bundle.js file failed.');
            }

            return previewResponse.data;
          })
          .then(storybookCode => {
            logger.log('Storybook code was received from server.');
            return prepareStories(logger, promiseFactory, configs, storybookCode)
              .then(stories => {
                logger.log('Stories were prepared.');
                return stories;
              });
          });
      }, err => {
        logger.log('Error on getting stories: ', err);
        if (retry <= 1) throw err;

        return GeneralUtils.sleep(WAIT_BETWEEN_REQUESTS, promiseFactory)
          .then(() => EyesStorybookUtils.getStoriesFromWeb(logger, promiseFactory, configs, retry - 1));
      });
  }

  /**
   * @param {Logger} logger
   * @param {PromiseFactory} promiseFactory
   * @param {object} configs
   * @returns {Promise<EyesStorybookStory[]>}
   */
  static getStoriesFromStatic(logger, promiseFactory, configs) {
    return promiseFactory.makePromise((resolve, reject) => {
      logger.log('Getting stories from storybook build...');
      const staticDirPath = path.resolve(process.cwd(), configs.storybookOutputDir, 'static');
      fs.readdir(staticDirPath, (err, files) => {
        if (err) {
          if (String.prototype.includes.call(err.message, 'ENOENT: no such file or directory, scandir')) {
            return reject('Storybook Build folder not found. ' +
              'Build Storybook before running the command or add `--build` option');
          }
          return reject(err);
        }

        const previewFile = files.find(filename => filename.startsWith('preview.') && filename.endsWith('.bundle.js'));
        const vendorFile = files.find(filename => filename.startsWith('vendor.') && filename.endsWith('.bundle.js'));
        return fs.readFile(path.resolve(staticDirPath, previewFile), 'utf8', (previewErr, previewCode) => {
          if (previewErr) return reject(previewErr);
          if (!vendorFile) {
            return resolve(previewCode);
          }

          return fs.readFile(path.resolve(staticDirPath, vendorFile), 'utf8', (vendorErr, vendorCode) => {
            if (vendorErr) {
              logger.verbose('Getting vendor.bundle.js file failed.');
              return reject(vendorErr);
            }
            return resolve(`${vendorCode};\n${previewCode}`);
          });
        });
      });
    })
      .then(storybookCode => {
        logger.log('Storybook code was loaded from build.');
        return prepareStories(logger, promiseFactory, configs, storybookCode);
      })
      .then(stories => {
        logger.log('Stories were prepared.');
        return stories;
      });
  }

  /**
   * @param {object} json
   * @param {array<string>} supportedStorybookApps
   * @returns {{app: string, version: number}}
   */
  static retrieveStorybookVersion(json, supportedStorybookApps) {
    // noinspection JSUnresolvedVariable
    const dependencies = json.dependencies || {};
    // noinspection JSUnresolvedVariable
    const devDependencies = json.devDependencies || {};

    if (dependencies['@kadira/storybook'] || devDependencies['@kadira/storybook']) {
      return { app: 'react', version: 2 };
    }

    const version = undefined;
    for (let i = 0, l = supportedStorybookApps.length; i < l; i += 1) {
      const app = supportedStorybookApps[i];

      if (dependencies[`@storybook/${app}`] || devDependencies[`@storybook/${app}`]) {
        return { app, version };
      }
    }

    throw new Error('Storybook module not found in package.json!');
  }

  /**
   * @param {string} filePath
   */
  static readFile(filePath) {
    return fs.readFileSync(filePath, 'utf8');
  }

  /**
   * @param {string} filePath
   * @param {string} fileBody
   */
  static writeFile(filePath, fileBody) {
    fs.writeFileSync(filePath, fileBody, { encoding: 'utf8' });
  }

  /**
   * @param {object} configs
   * @param {string} configBody
   */
  static updateStorybookConfig(configs, configBody) {
    let templateName = 'storybook';
    if (configs.storybookVersion === 2) {
      templateName = 'storybook.v2';
    }

    const template = EyesStorybookUtils.readFile(`${__dirname}/configTemplates/${templateName}.js`);
    // eslint-disable-next-line no-template-curly-in-string
    return template.replace('${configBody}', configBody).replace('${app}', configs.storybookApp);
  }
}

exports.EyesStorybookUtils = EyesStorybookUtils;
