// See README for details
module.exports = {
    // Server
    serverUrl: null,
    proxy: null,
    apiKey: process.env.APPLITOOLS_API_KEY,

    // App & Test
    appName: null,
    viewportSize: [
        {width: 750, height: 600},
        {width: 1366, height: 768}
    ],
    maxConcurrency: 0,

    // Storybook
    storybookApp: null,
    storybookVersion: null,
    storybookConfigDir: process.env.SBCONFIG_CONFIG_DIR || './.storybook',
    storybookStaticDir: process.env.SBCONFIG_STATIC_DIR,

    // Renderer mode
    useRenderer: false,
    skipStorybookBuild: false,
    storybookOutputDir: process.env.SBCONFIG_OUTPUT_DIR || './storybook-static',

    // Browser mode
    storybookAddress: null,
    storybookPort: process.env.SBCONFIG_PORT || 9001,
    storybookHost: process.env.SBCONFIG_HOSTNAME || 'localhost',
    seleniumAddress: null,
    capabilities: {
        browserName: 'chrome',
        chromeOptions: {
            'args': ['--headless', '--disable-gpu']
        }
    },

    // Logs
    showLogs: true,
    showEyesSdkLogs: false,
    showStorybookOutput: false
};
