'use strict';

const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');
const {Logger, ConsoleLogHandler} = require('eyes.sdk');

const defaultConfigs = require('./defaultConfigs');
const {StorybookUtils} = require('./storybook');
const {SeleniumUtils} = require('./selenium');
const {EyesStorybook} = require('./eyes-storybook');

const VERSION = require('../package.json').version;
const DEFAULT_CONFIG_PATH = 'applitools.config.js';

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
            default: DEFAULT_CONFIG_PATH
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
    process.stdout.write(`Version ${VERSION}\n`);
    process.exit(1);
}

const logger = new Logger();
logger.setLogHandler(new ConsoleLogHandler(yargs.debug));

let configs, storybookAddress, storybookProcess;
const configsPath = path.resolve(process.cwd(), yargs.conf);
if (fs.existsSync(configsPath)) {
    logger.log('Loading configuration from "' + configsPath + '"...');
    configs = Object.assign(defaultConfigs, require(configsPath));
} else if (yargs.conf !== DEFAULT_CONFIG_PATH) {
    throw new Error('Config file cannot be found in "' + configsPath + '".');
} else {
    configs = defaultConfigs;
}

configs.debug = yargs.debug;

if (configs.storybookApp && !['react', 'vue'].includes(configs.storybookApp)) {
    throw new Error('storybookApp should be "react" or "vue".');
}

if (configs.storybookVersion && ![2, 3].includes(configs.storybookVersion)) {
    throw new Error('storybookVersion should be 2 or 3.');
}

const packageJsonPath = process.cwd() + '/package.json';
if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found on path: ' + packageJsonPath);
}
const packageJson = require(packageJsonPath);
const packageVersion = StorybookUtils.retrieveStorybookVersion(packageJson);
if (!configs.appName) {
    configs.appName = packageJson.name;
}
if (!configs.storybookApp) {
    configs.storybookApp = packageVersion.app;
}
if (!configs.storybookVersion) {
    configs.storybookVersion = packageVersion.version;
}

if (!configs.apiKey) {
    throw new Error('The Applitools API Key is missing. Please add it to your configuration file or set ENV key.');
}

if (!configs.maxRunningBrowsers) {
    throw new Error("maxRunningBrowsers should be defined and at least 1.");
}

if (configs.viewportSize) {
    if (!Array.isArray(configs.viewportSize)) {
        configs.viewportSize = [configs.viewportSize];
    }

    for (let i = 0, l = configs.viewportSize.length; i < l; ++i) {
        if (!configs.viewportSize[i].width || !configs.viewportSize[i].height) {
            throw new Error("ViewportSize object should contains width and height properties.");
        }
    }
}

let promise = Promise.resolve();
if (!configs.storybookAddress) {
    promise = promise.then(() => {
        logger.log('Starting Storybook server...');

        return StorybookUtils.startServer(configs, logger).then((process) => {
            storybookProcess = process;
            storybookAddress = 'http://localhost:' + configs.storybookPort + '/';
        });
    });
} else {
    logger.log('You set Storybook url, starting server skipped.');
    storybookAddress = configs.storybookAddress.endsWith('/') ? configs.storybookAddress : configs.storybookAddress + '/';
}

function testStories(stories, testBatch) {
    return Promise.resolve().then(() => {
        const eyes = new EyesStorybook(configs, testBatch, logger);
        return eyes.testStories(stories);
    });
}

promise = promise.then(() => {
    logger.log('Getting stories from storybook instance...');

    return StorybookUtils.getStorybookPreviewBundle(storybookAddress, logger).then((previewCode) => {
        return StorybookUtils.getStorybook(previewCode, configs);
    });
}).then((storybook) => {
    logger.log('Preparing stories...');

    const stories = StorybookUtils.prepareStories(storybookAddress, storybook);
    return StorybookUtils.mixStories(stories, configs.viewportSize);
}).then((stories) => {
    logger.log('Initializing webdrivers...');
    const testBatch = SeleniumUtils.createTestBatch(configs.appName);

    const browsersCount = stories.length > configs.maxRunningBrowsers ? configs.maxRunningBrowsers : stories.length;
    let storiesMod = stories.length % browsersCount;
    const storiesPerBrowser = (stories.length - storiesMod) / browsersCount;

    let startStory, endStory = 0;
    const browsers = new Array(browsersCount);
    for (let i = 0; i < browsersCount; ++i) {
        startStory = endStory;
        endStory = startStory + storiesPerBrowser + (storiesMod-- > 0 ? 1 : 0);
        browsers[i] = testStories(stories.slice(startStory, endStory), testBatch);
    }

    return Promise.all(browsers);
}).then((results) => {
    logger.log('Test finished.');
    results = [].concat.apply([], results);

    if (results.length > 0) {
        console.log('\n');
        console.log('[EYES: TEST RESULTS]:');
        results.forEach((result) => {
            if (result.isNew) {
                console.log(result.story.compoundTitle, EyesStorybook._vsToStr(result.story.viewportSize), ' - ', colors.green("New"));
            } else if (result.isPassed) {
                console.log(result.story.compoundTitle, EyesStorybook._vsToStr(result.story.viewportSize), ' - ', colors.green("Passed"));
            } else {
                console.log(result.story.compoundTitle, EyesStorybook._vsToStr(result.story.viewportSize), ' - ', colors.red("Failed " + result.failedSteps + " of " + result.totalSteps));
            }
        });
        console.log("See details at", results[0].batchUrl);
    } else {
        console.log("Test is finished but no results returned. Run with --debug flag to see more logs.");
    }

    process.exit();
}).catch(function(err) {
    if (yargs.debug && err.stack) {
        console.error('DEBUG:', err.stack);
    } else {
        console.error(err.message || err.toString());
    }

    console.log('Run with --debug flag to see more logs.');
    process.exit(1);
});
