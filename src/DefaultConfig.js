'use strict';

// See README for details
module.exports = {
  // Server
  serverUrl: undefined,
  proxy: undefined,
  apiKey: process.env.APPLITOOLS_API_KEY,

  // App & Test
  appName: undefined,
  viewportSize: [
    { width: 750, height: 600 },
    { width: 1366, height: 768 },
  ],
  maxConcurrency: 0,

  // Storybook
  storybookApp: undefined,
  storybookVersion: undefined,
  storybookConfigDir: process.env.SBCONFIG_CONFIG_DIR || './.storybook',
  storybookStaticDir: process.env.SBCONFIG_STATIC_DIR,

  // VisualGrid mode, default mode
  useVisualGrid: true,
  skipStorybookBuild: true,
  storybookOutputDir: process.env.SBCONFIG_OUTPUT_DIR || './storybook-static',

  // Browser mode
  storybookAddress: undefined,
  storybookPort: process.env.SBCONFIG_PORT || 9001,
  storybookHost: process.env.SBCONFIG_HOSTNAME || 'localhost',
  seleniumAddress: undefined,
  capabilities: {
    browserName: 'chrome',
    chromeOptions: {
      args: ['--headless', '--disable-gpu'],
    },
  },

  // Logs
  showLogs: true,
  showEyesSdkLogs: false,
  showStorybookOutput: false,
};
