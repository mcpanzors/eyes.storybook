#!/usr/bin/env node

'use strict';

/* eslint-disable no-console, global-require */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');

const { Logger, ConsoleLogHandler, PromiseFactory, TestResultsFormatter } = require('@applitools/eyes.sdk.core');

const defaultConfig = require('../lib/DefaultConfig');
const { EyesStorybookUtils } = require('../lib/EyesStorybookUtils');
const VERSION = require('../package.json').version;

const DEFAULT_CONFIG_PATH = 'applitools.config.js';
const EYES_TEST_FAILED_EXIT_CODE = 130;
const SUPPORTED_STORYBOOK_APPS = ['react', 'vue', 'react-native', 'angular', 'polymer'];
const SUPPORTED_VISUALGRID_BROWSERS = ['chrome', 'firefox'];

/* --- Create CLI --- */
const yargs = require('yargs')
  .usage('Usage: $0 [options]')
  .epilogue('Check our documentation here: https://applitools.com/resources/tutorial')
  .showHelpOnFail(false, 'Specify --help for available options')
  .alias('help', 'h')
  .version('version', 'Show the version number', `Version ${VERSION}`)
  .alias('version', 'v')
  .options({
    conf: {
      alias: 'c',
      description: 'Path to configuration file',
      requiresArg: true,
      default: DEFAULT_CONFIG_PATH,
    },
    exitcode: {
      alias: 'e',
      description: 'If tests failed close with non-zero exit code',
      requiresArg: false,
      boolean: true,
    },
    legacy: {
      description: 'Use old implementation of VisualGrid test runner',
      requiresArg: false,
      boolean: true,
    },
    local: {
      alias: 'l',
      description: 'Force to use Selenium mode',
      requiresArg: false,
      boolean: true,
    },
    'skip-build': {
      alias: 's',
      description: 'Disable building Storybook app before testing',
      requiresArg: false,
      boolean: true,
    },
    info: {
      alias: 'd',
      description: 'Display info about current running story',
      requiresArg: false,
      boolean: true,
    },
    verbose: {
      alias: 'dd',
      description: 'Display data about current running method',
      requiresArg: false,
      boolean: true,
    },
    debug: {
      alias: 'ddd',
      description: 'Display all possible logs and debug information',
      requiresArg: false,
      boolean: true,
    },
  })
  .argv;


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
  console.log('No configuration file found. Use default.');
  configs = defaultConfig;
}


// Set log level according to specified CLI options
if (yargs.debug) {
  configs.showLogs = 'verbose';
  configs.showEyesSdkLogs = 'verbose';
  configs.showStorybookOutput = true;
} else if (yargs.verbose) {
  configs.showLogs = 'verbose';
  configs.showEyesSdkLogs = true;
} else if (yargs.info) {
  configs.showLogs = true;
}


/* --- Init common interfaces --- */
const promiseFactory = new PromiseFactory(asyncAction => new Promise(asyncAction));
const logger = new Logger();
if (configs.showLogs) {
  logger.setLogHandler(new ConsoleLogHandler(configs.showLogs === 'verbose'));
}


/* --- Validating configuration --- */
if (yargs.local) {
  configs.useSelenium = true;
  logger.verbose('Forced Selenium mode, due to --local option.');
}
if (yargs.skipBuild) {
  configs.skipStorybookBuild = true;
  logger.verbose('Build Storybook skipped, due to --skip-build option.');
}
if (!configs.apiKey) {
  console.info(chalk.red('\nEnvironment variable APPLITOOLS_API_KEY is not set.'));
  console.info(chalk.green('\nTo fix:'));
  console.info(chalk.green('1. Register for Applitools developer account at www.applitools.com/devreg'));
  console.info(chalk.green('2. Get API key from menu'));
  console.info(chalk.green('3. Set APPLITOOLS_API_KEY environment variable\n' +
    'Mac/Linux: export APPLITOOLS_API_KEY=Your_API_Key_Here\n' +
    'Windows: set APPLITOOLS_API_KEY=Your_API_Key_Here'));
  process.exit(1);
}
if (!configs.maxConcurrency && configs.maxConcurrency !== 0) {
  throw new Error('maxConcurrency should be defined.');
}
if (configs.storybookApp && !SUPPORTED_STORYBOOK_APPS.includes(configs.storybookApp)) {
  throw new Error(`storybookApp should be one of [${SUPPORTED_STORYBOOK_APPS}].`);
}
if (configs.storybookVersion && ![2, 3].includes(configs.storybookVersion)) {
  throw new Error('storybookVersion should be 2 or 3.');
}
if (configs.storybookUrl) {
  if (!configs.storybookUrl.endsWith('/')) {
    configs.storybookUrl += '/';
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

if (configs.useSelenium) { // local mode rules
  if (Array.isArray(configs.capabilities.browserName)) {
    throw new Error('browserName should be single item, array is not supported in Browser (local) mode.');
  }
} else if (yargs.legacy) { // remote (legacy) mode rules
  if (Array.isArray(configs.capabilities.browserName)) {
    throw new Error('browserName should be single item, array is not supported in VisualGrid-legacy mode.');
  }
  if (!SUPPORTED_VISUALGRID_BROWSERS.includes(configs.capabilities.browserName)) {
    throw new Error(`Given browserName is not supported, possible values [${SUPPORTED_VISUALGRID_BROWSERS}].`);
  }
} else { // remote mode rules
  if (!Array.isArray(configs.capabilities.browserName)) {
    configs.capabilities.browserName = [configs.capabilities.browserName];
  }
  configs.capabilities.browserName.forEach(browserName => {
    if (!SUPPORTED_VISUALGRID_BROWSERS.includes(browserName)) {
      throw new Error(`Given browserName is not supported, possible values [${SUPPORTED_VISUALGRID_BROWSERS}].`);
    }
  });
}


/* --- Parsing package.json, retrieving appName, storybookApp and storybookVersion --- */
const packageJsonPath = `${process.cwd()}/package.json`;
if (!fs.existsSync(packageJsonPath)) {
  throw new Error(`package.json not found on path: ${packageJsonPath}`);
}
const packageJson = require(packageJsonPath); // eslint-disable-line import/no-dynamic-require
const packageVersion = EyesStorybookUtils.retrieveStorybookVersion(packageJson, SUPPORTED_STORYBOOK_APPS);
if (!configs.appName) configs.appName = packageJson.name;
if (!configs.storybookApp) configs.storybookApp = packageVersion.app;
if (!configs.storybookVersion) configs.storybookVersion = packageVersion.version;


/* --- Main execution flow --- */
let testRunner;
return promiseFactory.resolve()
  .then(() => {
    if (configs.useSelenium) {
      try {
        const { EyesSeleniumRunner } = require('../lib/EyesSeleniumRunner');
        testRunner = new EyesSeleniumRunner(logger, promiseFactory, configs);
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
          console.info(chalk.red('\nYou are trying to run Selenium (local) mode with missing dependencies.'));
          console.info(chalk.green('\nTo fix:'));
          console.info(chalk.green('npm install selenium-webdriver@^3.0.0 --save-dev'));
          console.info(chalk.green('npm install chromedriver@^2.0.0 --save-dev'));
          process.exit(1);
        }

        throw e;
      }

      const spinner = ora('Starting Storybook');
      if (!configs.showLogs) spinner.start();
      return EyesStorybookUtils.startServer(logger, promiseFactory, configs)
        .then(storybookUrl => { spinner.stop(); configs.storybookUrl = storybookUrl; })
        .catch(err => { spinner.stop(); throw err; });
    }

    // eslint-disable-next-line max-len
    const { EyesVisualGridRunner } = yargs.legacy ? require('../lib/EyesVisualGridLegacyRunner') : require('../lib/EyesVisualGridRunner');
    testRunner = new EyesVisualGridRunner(logger, promiseFactory, configs);

    const spinner = ora('Building Storybook');
    if (!configs.showLogs) spinner.start();
    return EyesStorybookUtils.buildStorybook(logger, promiseFactory, configs)
      .then(() => { spinner.stop(); })
      .catch(err => { spinner.stop(); throw err; });
  })
  .then(() => EyesStorybookUtils.getStories(logger, promiseFactory, configs))
  .then(stories => {
    const spinner = ora('Processing stories');
    if (!configs.showLogs) spinner.start();
    return testRunner.testStories(stories, spinner)
      .then(results => { spinner.stop(); return results; })
      .catch(err => { spinner.stop(); throw err; });
  })
  .then(/** TestResults[] */ results => {
    const resultsFormatter = new TestResultsFormatter();

    let exitCode = 0;
    if (results.length > 0) {
      console.log('\n[EYES: TEST RESULTS]:');
      results.forEach(result => {
        resultsFormatter.addResults(result);

        const storyTitle = `${result.getName()} [${result.getHostDisplaySize().toString()}] - `;

        if (result.getIsNew()) {
          console.log(storyTitle, chalk.blue('New'));
        } else if (result.isPassed()) {
          console.log(storyTitle, chalk.green('Passed'));
        } else {
          const stepsFailed = result.getMismatches() + result.getMissing();
          console.log(storyTitle, chalk.red(`Failed ${stepsFailed} of ${result.getSteps()}`));

          if (exitCode < EYES_TEST_FAILED_EXIT_CODE) {
            exitCode = EYES_TEST_FAILED_EXIT_CODE;
          }
        }
      });
      console.log('See details at', results[0].getAppUrls().getBatch());
    } else {
      console.log('Test is finished but no results returned.');
    }

    if (configs.tapFilePath) {
      EyesStorybookUtils.writeResultsFile(configs.tapFilePath, resultsFormatter.asHierarchicTAPString(false, true));
    }

    process.exit(yargs.exitcode ? exitCode : 0);
  })
  .catch(err => {
    console.error(err);
    if (!yargs.debug) {
      console.log('Run with `--debug` flag to see more logs.');
    }

    process.exit(1);
  });
