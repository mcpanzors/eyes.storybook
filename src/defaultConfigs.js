module.exports = {
    apiKey: null,
    appName: 'My Storybook Application',
    testName: 'My Storybook Test',
    viewportSize: {width: 800, height: 600},

    storybookAddress: null,
    storybookPort: 9001,
    storybookConfigDir: null,
    storybookStaticDir: null,

    seleniumAddress: 'http://localhost:4444/wd/hub',
    capabilities: {
        browserName: 'chrome',
        chromeOptions: {
            'args': ['--headless', '--disable-gpu']
        }
    },
};