## Eyes.Storybook

Applitools Eyes SDK for Storybook

[![npm](https://img.shields.io/npm/v/@applitools/eyes.storybook.svg?style=for-the-badge)](https://www.npmjs.com/package/@applitools/eyes.storybook)

### Installation

Add your Applitools API key to your environment variables as `APPLITOOLS_API_KEY`

Install eyes.storybook as a local dev dependency in your tested project:

    npm install --save-dev @applitools/eyes.storybook

### Usage

Before running your project's build, you should run:

```
$ npx eyes-setup
```

The above command will update your .storybook/config.js so that the Eyes Storybook SDK can automatically grab stories to test.

You should then run your project's build (e.g, ```npm run build```)

Now you can run visual tests for all your stories using the following command:

```
$ npx eyes-storybook
```

### Advanced configuration

To change viewport sizes, application name, test name, etc., you can use a configuration file. 

Create configuration file called `applitools.config.js` in your project directory (the name can be changed using `--conf` CLI option, e.g. `npm run eyes-storybook -- --conf myconfig.js`, or add it to your package.json).

All available options are listed below:

```js
module.exports = {
    /* Server configuration */

    // `serverUrl` is the Eyes server URL that will be used during matching screenshots
    serverUrl: undefined, // default address stored in eyes.sdk.core

    // `proxy` defines the proxy server that will be used for requests to Applitools services
    // Should be a string in following format 'http://username:password@hostname:port/'
    proxy: undefined, // default is not set

    // `apiKey` is the Applitools API Key which can be found in the Admin Panel on website
    apiKey: process.env.APPLITOOLS_API_KEY,  // as default used value from environment variable


    /* App and test configuration */

    // `appName` is your application name that will be shown in test results
    appName: undefined, // as default used your package name from package.json

    // `viewportSize` is the required browser's viewport size or a list of sizes. It can be
    // an array of objects or a single object, e.g. {width: 800, height: 600}
    viewportSize: [
        {width: 800, height: 600}, // by default we use the value
    ],

    // `maxConcurrency` is a number of parallel browsers or connections to VisualGrid service
    maxConcurrency: 0, // default is 0, which means not limited connections to VisualGrid service
                       // or 10 for headless browsers (should be set 1 for non-headless browser)

    // `tapFilePath` is a path to TAP results file, the path is relative to directory
    // from which you run the test and should contains filename, e.g. './results.tap'
    tapFilePath: undefined, // by default we don't create the file anywhere


    /* Storybook configuration */

    // `storybookApp` is used to modify config according to your app. Usually, we don't need
    // the value, but you can force it by use one of values [react, vue, react-native, angular, polymer]
    storybookApp: undefined, // default is extracted from dependencies of your package.json 

    // `storybookVersion` is related to `storybookApp` and handled in the similar way, defines
    // which version of Storybook are you using, possible values [2, 3, 4]
    storybookVersion: undefined, // default is extracted from dependencies of your package.json

    // `storybookConfigDir` defines directory where to load Storybook configurations from.
    // The value will be passed to Storybook via `--config-dir` option
    storybookConfigDir: process.env.SBCONFIG_CONFIG_DIR || './.storybook', // Storybook default

    // `storybookStaticDir` defines directory where to load static files from, comma-separated list.
    // The value will be passed to Storybook via `--static-dir` option
    storybookStaticDir: process.env.SBCONFIG_STATIC_DIR, // Storybook default


    /* Only for VisualGrid mode */

    // `skipStorybookBuild` defines whether or not will be run `build-storybook` command.
    skipStorybookBuild: true, // if you don't use custom build command, we can do that for you,
                              // just set this to `false` and we will run `build-storybook` every time

    // `storybookOutputDir` defines directory where to store built files.
    // The value will be passed to Storybook via `--output-dir` option
    storybookOutputDir: process.env.SBCONFIG_OUTPUT_DIR || './storybook-static', // Storybook default


    /* Only for Selenium mode */
    
    // `useSelenium` defines a mode in which to work. VisualGrid mode creates a Storybook build
    // and send it to a VisualGrid service which creates a screenshots of each story (in a cloud).
    // Selenium mode starts a browsers locally and makes screenshots locally, after that send
    // only images for validation
    useSelenium: false, // default mode is VisualGrid (remote) mode,
                        // change this to `true` to use Selenium (local) mode

    // `storybookUrl` defines an address to an external Storybook server. Define this value
    // only in case if you don't want that starting Storybook was part of our process.
    // The value should be like 'http://localhost:9001/'
    storybookUrl: undefined, // by default we will start Storybook server in the process

    // `storybookPort` defines port on which we will start Storybook server. The value
    // is not related to `storybookUrl` and will be ignored if you specify both values
    storybookPort: process.env.SBCONFIG_PORT || 9001, // Storybook default

    // `storybookHost` defines host on which we will start Storybook server. The value
    // is similar to `storybookPort`, can't be used with `storybookUrl`
    storybookHost: process.env.SBCONFIG_HOSTNAME || 'localhost', // Storybook default

    // `seleniumUrl` defines address to selenium server. You can use the next url as 
    // an example: 'http://localhost:4444/wd/hub'
    seleniumUrl: undefined, // by default we start build-in selenium server

    // `capabilities` defines capabilities that will be passed to WebDriver when using local
    // testing or will be send as configuration of VisualGrid when using remote testing.
    // In Browser mode the `capabilities` directly passed to Selenium server, see docs
    // https://github.com/SeleniumHQ/selenium/wiki/DesiredCapabilities
    capabilities: { // by default we use chrome in headless mode
        platform: 'any', // local: the current system platform will be used
                         // remote: [] no currently supported values, will be added soon
        browserName: 'chrome', // local: make sure that you have required WebDriver in your PATH
                               // remote: ['chrome', 'firefox'], an array is also possible
        chromeOptions: { // used to set arguments for browser in local-only mode
                         // the name can be different depends of browser, see Selenium docs
            args: ['--headless', '--disable-gpu'], // any, e.g. '--force-device-scale-factor=2'
        },
    },


    /* Logging  */

    // `showLogs` defines whether or not you want to see logs. There are three possible values:
    // false - means no logs, only test results
    // true - some logs, about which story processing at the moment
    // 'verbose' - all available logs, report about each operation in the SDK
    showLogs: false, // default is disabled

    // `showEyesSdkLogs` defines whether or not you want to see logs from eyes.sdk.core.
    // Can be useful if you want to see information about connections to the services.
    // Same as with `showLogs`, there possible three values [false, true, 'verbose']
    showEyesSdkLogs: false, // default is disabled

    // `showStorybookOutput` defines whether or not you want to see Storybook output.
    // If Storybook server can't be started, or started with errors, set this option to true
    showStorybookOutput: false, // default is disabled
};
```

You can use content above as template for your `applitools.config.js`

### CLI Options

There is no required options, but some can be used to simplify working experience.

Below you can see output of the `--help` option.

```
Usage: eyes-storybook [options]

Options:
  --help            Show help                                                              [boolean]
  --version, -v     Show the version number                                                [boolean]
  --conf, -f        Path to Applitools configuration file [string] [default: "applitools.config.js"]
  --static-dir, -s  Directory where to load static files from, comma-separated list         [string]
  --output-dir, -o  Directory where the built result files are stored                       [string]
  --config-dir, -c  Directory where to load Storybook configurations from                   [string]
  --port, -p        Port to run Storybook                                                   [number]
  --host, -h        Host to run Storybook                                                   [string]
  --local, -l       Force to use Selenium mode                                             [boolean]
  --legacy          Use old implementation of VisualGrid test runner                       [boolean]
  --build           Enable building Storybook before testing                               [boolean]
  --exitcode, -e    If tests failed close with non-zero exit code                          [boolean]
  --info, -d        Display info about current running story                               [boolean]
  --verbose, --dd   Display data about current running method                              [boolean]
  --debug, --ddd    Display all possible logs and debug information                        [boolean]
```

### Independent Storybook Server

If you would like to run Storybook server out of the `eyes-storybook` execution, you should specify `storybookUrl` option in your `applitools.config.js` file and update Storybook's config file according to rules below.

### Automatic Build

If you would Eyes storybook to to automatically run `build-storybook` command when it is run, you can use the `--build` parameter to the `eyes-storybook` command.

### 'eyes-setup'

The ```eyes-setup``` command updates your .storybook/config.js file to include the following lines:

```
if (typeof window === 'object' && window.navigator && (/node\.js/i).test(window.navigator.userAgent)) {
  let addons = require('@storybook/addons').default;
  let Channel = require('@storybook/channels').default;
  addons.setChannel(new Channel({
    transport: {
      setHandler: function() {},
      send: function() {}
    }
  }));
}
```
at the beginning of the file and

```
if (typeof window === 'object') {
  window.__storybook_stories__ = require('@storybook/react').getStorybook();
}
```
at the end.

Inserting these lines manually to your config.js file is the same as using the ```eyes-setup``` command.

To access list of stories we need a way to access Storybook from browser. Please add lines below to Storybook's config file (default path is `.storybook/config.js`).

---


This guide is also available in the Applitools website:

- https://applitools.com/resources/tutorial/other/react_storybook

