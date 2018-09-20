'use strict';

// See README for details
module.exports = {
  // Server
  serverUrl: undefined,
  proxy: undefined,
  apiKey: process.env.APPLITOOLS_API_KEY,

  // App & Test
  appName: process.env.APPLITOOLS_BATCH_NAME,
  batchName: process.env.APPLITOOLS_BATCH_NAME,
  viewportSize: [
    { width: 800, height: 600 },
  ],
  maxConcurrency: 0,
  tapFilePath: undefined,

  // Storybook
  storybookApp: undefined,
  storybookVersion: undefined,
  storybookConfigDir: process.env.SBCONFIG_CONFIG_DIR || './.storybook',
  storybookStaticDir: process.env.SBCONFIG_STATIC_DIR,

  // VisualGrid mode, default mode
  skipStorybookBuild: true,
  storybookOutputDir: process.env.SBCONFIG_OUTPUT_DIR || './storybook-static',

  // Selenium mode
  useSelenium: false,
  storybookUrl: undefined,
  storybookPort: process.env.SBCONFIG_PORT || 9001,
  storybookHost: process.env.SBCONFIG_HOSTNAME || 'localhost',
  seleniumUrl: undefined,
  capabilities: {
    platform: 'any',
    browserName: 'chrome',
    chromeOptions: {
      args: ['--headless', '--disable-gpu'],
    },
  },

  // Logs
  showLogs: false,
  showEyesSdkLogs: false,
  showStorybookOutput: false,
};
