module.exports = {
    /* Server configuration */
    serverUrl: null, // if null, then we will use EyesBase.DEFAULT_EYES_SERVER
    proxy: null, // should be a string like 'http://user:pass@lcoalhost:8888/', used only for remote requests to eyes services
    apiKey: process.env.APPLITOOLS_API_KEY,

    /* App and test configuration */
    appName: null, // you can specify it directly, otherwise it will be extracted from your package.json
    viewportSize: [ // can be array of objects or single object, e.g. {width: 800, height: 600}
        {width: 800, height: 600},
        {width: 1200, height: 720}
    ],
    maxConcurrency: 0, // number of parallel browsers or connections to rendering server,
                       // default 0, it means not limited for rendering server or 10 for headless browsers (should be 1 in case of non-headless browser)

    /* Storybook configuration */
    storybookApp: null, // usually should be extracted from your package.json automatically, possible values [react, vue, react-native, angular, polymer]
    storybookVersion: null, // usually should be extracted from your package.json automatically, possible values [2, 3]
    storybookConfigDir: '.storybook',
    storybookStaticDir: null,

    /* Only for renderer */
    useRenderer: false, // if true, then will be used render server instead of running browsers locally
    skipStorybookBuild: false, // if true, will skip building storybook app, make sure the app build is exists
    storybookOutputDir: 'storybook-static',

    /* Only for browser */
    storybookAddress: null, // if you already run storybook server, then use address like 'http://localhost:9001/', it will skipp starting storybook
    storybookPort: 9001, // on which port we will to start storybook server, not used when storybookAddress specified
    storybookHost: 'localhost', // on which host we will to start storybook server, not used when storybookAddress specified
    seleniumAddress: null, // if you run remote selenium server, then use 'http://localhost:4444/wd/hub'
    capabilities: {
        browserName: 'chrome',
        chromeOptions: {
            'args': ['--headless', '--disable-gpu'] // '--force-device-scale-factor=2'
        }
    },

    /* Logging  */
    showLogs: true, // [false, true, 'verbose'] // change to 'verbose' if you want to have more detailed logs
    showEyesSdkLogs: false, // [false, true, 'verbose'] // enable if you want to see logs from eyes.sdk.core
    showStorybookOutput: false, // enable if you want to see storybook server output
};
