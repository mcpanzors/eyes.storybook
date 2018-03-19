#!/usr/bin/env node

'use strict';

/* eslint-disable no-console, global-require */
const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');

const { Logger, ConsoleLogHandler, PromiseFactory } = require('@applitools/eyes.sdk.core');

const defaultConfig = require('../src/DefaultConfig');
const StorybookUtils = require('../src/StorybookUtils');
const VERSION = require('../package.json').version;

const DEFAULT_CONFIG_PATH = 'applitools.config.js';
const EYES_TEST_FAILED_EXIT_CODE = 130;
const SUPPORTED_STORYBOOK3_APPS = ['react', 'vue', 'react-native', 'angular', 'polymer'];

/* --- Create CLI --- */
const yargs = require('yargs')
  .usage('Usage: $0 [options]')
  .epilogue('Check our documentation here: https://applitools.com/resources/tutorial')
  .showHelpOnFail(false, 'Specify --help for available options')
  .help()
  .alias('help', 'h')
  .options({
    version: {
      alias: 'v',
      description: 'Show the version number',
      requiresArg: false,
      boolean: true,
    },
    conf: {
      alias: 'c',
      description: 'Path to configuration file',
      requiresArg: true,
      default: DEFAULT_CONFIG_PATH,
    },
    renderer: {
      alias: 'r',
      description: 'Use renderer mode',
      requiresArg: false,
      boolean: true,
    },
    verbose: {
      description: 'Display more logs',
      requiresArg: false,
      boolean: true,
    },
    debug: {
      description: 'Display all possible logs and debug information',
      requiresArg: false,
      boolean: true,
    },
  })
  .argv;

if (yargs.help) {
  yargs.showHelp();
  process.exit(1);
}

if (yargs.version) {
  process.stdout.write(`Version ${VERSION}\n`);
  process.exit(1);
}


/* --- Load configuration from config file --- */
let configs;
console.log(`Used eyes.storybook of version ${VERSION}.`);
const configsPath = path.resolve(process.cwd(), yargs.conf);
if (fs.existsSync(configsPath)) {
  const userDefinedConfig = require(configsPath); // eslint-disable-line import/no-dynamic-require
  configs = Object.assign(defaultConfig, userDefinedConfig);
  console.log(`Configuration was loaded from "${configsPath}".`);
} else if (yargs.conf !== DEFAULT_CONFIG_PATH) {
  throw new Error(`Configuration file cannot be found in "${configsPath}".`);
} else {
  console.log('No configuration file found. Use default configs.');
  configs = defaultConfig;
}

if (yargs.verbose || yargs.debug) {
  configs.showLogs = 'verbose';
  configs.showStorybookOutput = true;

  if (yargs.debug) {
    configs.showEyesSdkLogs = 'verbose';
  }
}


/* --- Init common interfaces --- */
const promiseFactory = new PromiseFactory(asyncAction => new Promise(asyncAction));
const logger = new Logger();
if (configs.showLogs) {
  logger.setLogHandler(new ConsoleLogHandler(configs.showLogs === 'verbose'));
}


/* --- Validating configuration --- */
if (yargs.renderer) {
  configs.useRenderer = true;
  logger.log('Forced renderer mode, because of --renderer argument.');
}
if (!configs.apiKey) {
  throw new Error('The Applitools API Key is missing. Please add it to your configuration file or set ENV key.');
}
if (!configs.maxConcurrency && configs.maxConcurrency !== 0) {
  throw new Error('maxConcurrency should be defined.');
}
if (configs.storybookApp && !SUPPORTED_STORYBOOK3_APPS.includes(configs.storybookApp)) {
  throw new Error(`storybookApp should be one of [${SUPPORTED_STORYBOOK3_APPS}].`);
}
if (configs.storybookVersion && ![2, 3].includes(configs.storybookVersion)) {
  throw new Error('storybookVersion should be 2 or 3.');
}
if (configs.storybookAddress) {
  if (!configs.storybookAddress.endsWith('/')) {
    configs.storybookAddress += '/';
  }
}
if (configs.viewportSize) {
  if (!Array.isArray(configs.viewportSize)) {
    configs.viewportSize = [configs.viewportSize];
  }
  configs.viewportSize.forEach(viewportSize => {
    if (!(viewportSize.width && viewportSize.height)) {
      throw new Error('ViewportSize object should contains width and height properties.');
    }
  });
}


/* --- Parsing package.json, retrieving appName, storybookApp and storybookVersion --- */
const packageJsonPath = `${process.cwd()}/package.json`;
if (!fs.existsSync(packageJsonPath)) {
  throw new Error(`package.json not found on path: ${packageJsonPath}`);
}
const packageJson = require(packageJsonPath); // eslint-disable-line import/no-dynamic-require
const packageVersion = StorybookUtils.retrieveStorybookVersion(packageJson, SUPPORTED_STORYBOOK3_APPS);
if (!configs.appName) configs.appName = packageJson.name;
if (!configs.storybookApp) configs.storybookApp = packageVersion.app;
if (!configs.storybookVersion) configs.storybookVersion = packageVersion.version;

/* --- Main execution flow --- */
let promise = promiseFactory.resolve();
if (configs.useRenderer) {
  /* --- Building Storybook and make screenshots remote using RenderingGrid --- */
  promise = promise
    .then(() => StorybookUtils.buildStorybook(logger, promiseFactory, configs))
    .then(() => StorybookUtils.getStoriesFromStatic(logger, promiseFactory, configs))
    .then(stories => {
      const EyesRenderingRunner = require('../src/EyesRenderingRunner');
      const runner = new EyesRenderingRunner(logger, promiseFactory, configs);
      return runner.testStories(stories);
    });
} else {
  /* --- Starting Storybook and make screenshots locally using WebDriver --- */
  promise = promise
    .then(() => StorybookUtils.startServer(logger, promiseFactory, configs))
    .then(storybookAddress => { configs.storybookAddress = storybookAddress; })
    .then(() => StorybookUtils.getStoriesFromWeb(logger, promiseFactory, configs))
    .then(stories => {
      const EyesWebDriverRunner = require('../src/EyesWebDriverRunner');
      const runner = new EyesWebDriverRunner(logger, promiseFactory, configs);
      return runner.testStories(stories);
    });
}


/* --- Prepare and display results --- */
return promise
  .then(/** TestResults[] */ results => {
    let exitCode = 0;
    if (results.length > 0) {
      console.log('\n[EYES: TEST RESULTS]:');
      results.forEach(result => {
        const storyTitle = `${result.getName()} [${result.getHostDisplaySize().width}x${result.getHostDisplaySize().height}] - `;

        if (result.getIsNew()) {
          console.log(storyTitle, colors.green('New'));
        } else if (result.isPassed()) {
          console.log(storyTitle, colors.green('Passed'));
        } else {
          const stepsFailed = result.getMismatches() + result.getMissing();
          console.log(storyTitle, colors.red(`Failed ${stepsFailed} of ${result.getSteps()}`));

          if (exitCode < EYES_TEST_FAILED_EXIT_CODE) {
            exitCode = EYES_TEST_FAILED_EXIT_CODE;
          }
        }
      });
      console.log('See details at', results[0].getAppUrls().batch);
    } else {
      console.log('Test is finished but no results returned.');
    }

    process.exit(exitCode);
  })
  .catch(err => {
    console.error(err);
    if (!yargs.debug) {
      console.log('Run with --debug flag to see more logs.');
    }

    process.exit(1);
  });
