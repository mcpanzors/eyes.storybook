# Eyes.Storybook

Applitools Eyes SDK For Storybook
## Installation

Install eyes.storybook as a local dev dependency in your tested project:

    npm install --save-dev eyes.storybook
    
Add the following line to the end of .storybook/config.js:
#####Storybook v2:

    if (typeof window === 'object') window.__storybook_stories__ = require('@kadira/storybook').getStorybook();
#####Storybook v3:

    if (typeof window === 'object') window.__storybook_stories__ = require('@storybook/react').getStorybook();
    
Create configuration file in your project directory `applitools.config.js` (more options available, see [defaultConfig.js](src/defaultConfig.js)):

    module.exports = {
        apiKey: process.env.APPLITOOLS_API_KEY,
        appName: 'My Storybook Application',
        testName: 'My Storybook Test',
        viewportSize: {width: 1000, height: 600},

        seleniumAddress: 'http://localhost:4444/wd/hub',
        capabilities: {
            browserName: 'chrome',
            chromeOptions: {
                'args': ['--headless', '--disable-gpu']
            }
        },
    };

Open your package.json, and add a script:

    "eyes-storybook": "eyes-storybook --conf applitools.config.js"


## Usage

When your project is setup, you can run a test with the following command:

```
$ npm run eyes-storybook
```

Please check the applitools website for more instructions:

- https://applitools.com/resources/tutorial

