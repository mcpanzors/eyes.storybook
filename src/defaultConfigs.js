module.exports = {
    apiKey: process.env.APPLITOOLS_API_KEY,
    appName: null,
    viewportSize: null, // can be array of objects or single object, e.g. {width: 800, height: 600}

    storybookAddress: null, // if null, then we will try to run storybook server using settings below
    storybookPort: 9001,
    storybookConfigDir: '.storybook',
    storybookStaticDir: null,

    storybookApp: null, // [react, vue]
    storybookVersion: null, // [2, 3]

    maxRunningBrowsers: 5, // can be used multiple in case of headless

    seleniumAddress: 'http://localhost:4444/wd/hub',
    capabilities: {
        browserName: 'chrome',
        chromeOptions: {
            'args': ['--headless', '--disable-gpu']
        }
    },
};