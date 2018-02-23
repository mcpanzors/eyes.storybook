# Eyes.Storybook

Applitools Eyes SDK For Storybook

[![npm](https://img.shields.io/npm/v/@applitools/eyes.storybook.svg?style=for-the-badge)](https://www.npmjs.com/package/@applitools/eyes.storybook)

## Installation

Add your Applitools API key to your environment variables as `APPLITOOLS_API_KEY`

Install eyes.storybook as a local dev dependency in your tested project:

    npm install --save-dev @applitools/eyes.storybook

Open your package.json, and add a script:

    "eyes-storybook": "eyes-storybook"

## Usage

When your project is setup, you can run a test with the following command:

```
$ npm run eyes-storybook
```

## Advanced configuration

To change browser, viewport sizes etc., or use the rendering service, you can use a configuration file. 

Create configuration file called `applitools.config.js` in your project directory (the name can be changed using command argument, e.g. `npm run eyes-storybook -- --conf myconfig.js`).

The default values and all available options, you can find in [DefaultConfigs.js](src/DefaultConfigs.js)

Common example:

    module.exports = {
        useRenderer: true, // Use the rendering service 
        appName: 'My Storybook Application',
        viewportSize: [
            {width: 1000, height: 600}
        ],
        
        maxConcurrency: 5,

        seleniumAddress: 'http://localhost:4444/wd/hub',
        capabilities: {
            browserName: 'chrome',
            chromeOptions: {
                'args': ['--headless', '--disable-gpu']
            }
        },
    };

---

If you would like to run storybook server out of the eyes-storybook execution, you should specify `storybookAddress` option in your `applitools.config.js` file and add the following line to the end of `.storybook/config.js`:

**Storybook v2:**

    if (typeof window === 'object') window.__storybook_stories__ = require('@kadira/storybook').getStorybook();

**Storybook v3** (for Vue, Angular and others, just replace @storybook/react according to yours):

    if (typeof window === 'object') window.__storybook_stories__ = require('@storybook/react').getStorybook();

---

Please check the applitools website for more instructions:

- https://applitools.com/resources/tutorial

