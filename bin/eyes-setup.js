#!/usr/bin/env node

'use strict';

/* eslint-disable no-console, global-require */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const { Logger, ConsoleLogHandler, PromiseFactory } = require('@applitools/eyes.sdk.core');

const defaultConfig = require('../lib/DefaultConfig');
const { EyesStorybookUtils } = require('../lib/EyesStorybookUtils');
const VERSION = require('../package.json').version;

const DEFAULT_CONFIG_PATH = 'applitools.config.js';
const SUPPORTED_STORYBOOK_APPS = ['react', 'vue', 'react-native', 'angular', 'polymer'];

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
    debug: {
      alias: 'd',
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


/* --- Init common interfaces --- */
const promiseFactory = new PromiseFactory(asyncAction => new Promise(asyncAction));
const logger = new Logger();
if (yargs.debug) {
  logger.setLogHandler(new ConsoleLogHandler(true));
}


/* --- Validating configuration --- */
if (configs.storybookApp && !SUPPORTED_STORYBOOK_APPS.includes(configs.storybookApp)) {
  throw new Error(`storybookApp should be one of [${SUPPORTED_STORYBOOK_APPS}].`);
}
if (configs.storybookVersion && ![2, 3].includes(configs.storybookVersion)) {
  throw new Error('storybookVersion should be 2 or 3.');
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
const storybookConfigPath = path.resolve(process.cwd(), configs.storybookConfigDir, 'config.js');
if (!fs.existsSync(storybookConfigPath)) {
  return promiseFactory.reject(new Error(`Storybook config file not found: ${storybookConfigPath}`));
}

const storybookConfigBody = EyesStorybookUtils.readFile(storybookConfigPath);
if (storybookConfigBody.includes('__storybook_stories__')) {
  console.info(chalk.green('\nYour Storybook\'s config file already contains exporting of Storybook to window object.'));
  console.info(chalk.green('No changes required.'));
  process.exit();
}

logger.verbose('Rewriting configuration...');
const template = EyesStorybookUtils.updateStorybookConfig(configs, storybookConfigBody);
EyesStorybookUtils.writeFile(storybookConfigPath, template);

console.info(chalk.green('\nYour Storybook\'s config file updated.'));
process.exit();
