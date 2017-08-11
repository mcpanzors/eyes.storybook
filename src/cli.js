'use strict';

const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');

const defaultConfigs = require('./defaultConfigs');
const {StorybookUtils} = require('./storybook');
const {EyesStorybook} = require('./eyes-storybook');

const VERSION = require('../package.json').version;

let yargs = require('yargs')
    .usage('Usage: $0 --conf applitools.config.js')
    .epilogue('Check our documentation here: https://applitools.com/resources/tutorial')
    .showHelpOnFail(false, 'Specify --help for available options')
    .help()
    .alias('help', 'h')
    .options({
        version: {
            alias: 'v',
            description: 'Show version number',
            requiresArg: false,
            boolean: true
        },
        conf: {
            alias: 'c',
            description: 'Path to Configuration File',
            requiresArg: true,
            default: 'applitools.config.js'
        },
        debug: {
            alias: 'd',
            description: 'Debug mode',
            requiresArg: false,
            boolean: true
        }
    })
    .argv;

if (yargs.help) {
    yargs.showHelp();
}

if (yargs.version) {
    console.log('Version: ' + VERSION);
    return;
}

const configsPath = path.resolve(process.cwd(), yargs.conf);
if (!fs.existsSync(configsPath)) {
    throw new Error('Config file cannot be found in "' + configsPath + '".');
}

// load configs from file and merge with defaults
let configs = require(configsPath);
configs = Object.assign(defaultConfigs, configs);
if (!configs.apiKey) {
    throw new Error('The Applitools API Key is missing. Please add it to your configuration file.');
}

let storybookAddress, storybookProcess;

let promise = Promise.resolve();
if (!configs.storybookAddress) {
    promise = promise.then(() => {
        console.log('Starting Storybook server...');

        return StorybookUtils.startServer(configs).then((process) => {
            storybookProcess = process;
            storybookAddress = 'http://localhost:' + configs.storybookPort + '/';
        });
    });
} else {
    console.log('You set Storybook url, starting server skipped.');
    storybookAddress = configs.storybookAddress.endsWith('/') ? configs.storybookAddress : configs.storybookAddress + '/';
}

promise = promise.then(() => {
    console.log('Getting storybook preview code...');

    return StorybookUtils.getStorybookPreviewBundle(storybookAddress);
}).then((previewCode) => {
    console.log('Preparing Storybook DOM...');

    return StorybookUtils.getStorybook(previewCode, configs);
}).then((storybook) => {
    console.log('Retrieving stories...');

    return StorybookUtils.prepareStories(storybookAddress, storybook);
}).then((stories) => {
    console.log('Initializing webdriver...');

    const eyes = new EyesStorybook(configs);
    console.log("Initialization finished, capturing screenshots...");
    return eyes.testStories(stories);
}).then((results) => {
    if (results.length > 0) {
        console.log('\n');
        console.log('[EYES: TEST RESULTS]:');
        results.forEach((result) => {
            if (result.isPassed) {
                console.log(result.name, ' - ', colors.green("Passed"));
            } else {
                console.log(result.name, ' - ', colors.red("Failed " + result.failedSteps + " of " + result.totalSteps));
            }
        });
        console.log("See details at", results[0].batchUrl);
    } else {
        console.log("Test is finished but no results returned. Run with --debug flag to see more logs.");
    }
});

return promise;