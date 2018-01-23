module.exports = {
    serverUrl: null,
    apiKey: process.env.APPLITOOLS_API_KEY,
    appName: null,
    viewportSize: [ // can be array of objects or single object, e.g. {width: 800, height: 600}
        {width: 800, height: 600}
    ],

    storybookApp: null, // [react, vue]
    storybookVersion: null, // [2, 3]
    storybookConfigDir: '.storybook',
    storybookStaticDir: null,

    maxRunningBrowsers: 5, // can be used multiple in case of headless
    storybookAddress: null, // if null, then we will try to run storybook server using settings below
    storybookPort: 9001,
    seleniumAddress: null,
    capabilities: {
        browserName: 'chrome',
        chromeOptions: {
            'args': ['--headless', '--disable-gpu']
        }
    },
};