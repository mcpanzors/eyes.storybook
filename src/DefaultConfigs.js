module.exports = {
    serverUrl: null, // if null, then we will use EyesBase.DEFAULT_EYES_SERVER
    apiKey: process.env.APPLITOOLS_API_KEY,
    appName: null,
    viewportSize: [ // can be array of objects or single object, e.g. {width: 800, height: 600}
        {width: 800, height: 600},
        {width: 1200, height: 720}
    ],

    /* Number of parallel browsers or connections to rendering server  */
    maxRunningBrowsers: 0, // should be 1 in case of non-headless browser,
                           // default 0 - is not limited for rendering server or number of viewportSizes for browsers

    /* Storybook configuration */
    storybookApp: null, // [react, vue]
    storybookVersion: null, // [2, 3]
    storybookConfigDir: '.storybook',
    storybookStaticDir: null,

    /* Only for renderer */
    useRenderer: false, // if true, then will be used render server instead of running browsers locally
    storybookOutputDir: 'storybook-static',

    /* Only for browser */
    storybookAddress: null, // if you already run storybook server, then use 'http://localhost:9001/'
    storybookPort: 9001,
    seleniumAddress: null, // if you run remote selenium server, then use 'http://localhost:4444/wd/hub'
    capabilities: {
        browserName: 'chrome',
        chromeOptions: {
            'args': ['--headless', '--disable-gpu']
        }
    },

    /* Logging  */
    showLogs: true, // [false, true, 'verbose'] // change to 'verbose' if you want to have more detailed logs
    showEyesSdkLogs: false, // [false, true, 'verbose'] // enable if you want to see logs from eyes.sdk
    showStorybookOutput: false, // enable if you want to see storybook output together with other logs
};