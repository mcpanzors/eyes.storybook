module.exports = {
    serverUrl: null, // if null, then we will use EyesBase.DEFAULT_EYES_SERVER
    apiKey: process.env.APPLITOOLS_API_KEY,
    appName: null,
    viewportSize: [ // can be array of objects or single object, e.g. {width: 800, height: 600}
        {width: 800, height: 600},
        {width: 1200, height: 720}
    ],

    /* Storybook configuration */
    storybookApp: null, // [react, vue]
    storybookVersion: null, // [2, 3]
    storybookConfigDir: '.storybook',
    storybookStaticDir: null,

    /* Only for render */
    useRenderServer: false, // if true, then will be used render server instead of running browsers locally
    storybookOutputDir: 'storybook-static',

    /* Only for browser */
    maxRunningBrowsers: 2, // can be used multiple in case of headless
    storybookAddress: null, // if you already run storybook server, then use 'http://localhost:9001/'
    storybookPort: 9001,
    seleniumAddress: null, // if you run remote selenium server, then use 'http://localhost:4444/wd/hub'
    capabilities: {
        browserName: 'chrome',
        chromeOptions: {
            'args': ['--headless', '--disable-gpu']
        }
    },
};