'use strict';

const {Builder} = require('selenium-webdriver');
const {Eyes, Target} = require('eyes.selenium');

class EyesSelenium {

    constructor(configs) {
        this.configs = configs;

        const builder = new Builder();
        builder.usingServer(this.configs.seleniumAddress);
        if (this.configs.capabilities && Object.keys(this.configs.capabilities).length) {
            for (const key in this.configs.capabilities) {
                if (this.configs.capabilities.hasOwnProperty(key)) {
                    builder.getCapabilities().set(key, this.configs.capabilities[key]);
                }
            }
        }

        this.driver = builder.build();

        this.eyes = new Eyes();
        this.eyes.setApiKey(this.configs.apiKey);
    }

    testStories(stories) {
        let current = 0;
        const eyes = this.eyes;
        const viewportSize = this.configs.viewportSize;

        return eyes.open(this.driver, this.configs.appName, this.configs.testName, null).then(function (driver) {
            if (viewportSize && viewportSize.width && viewportSize.height) {
                eyes.setViewportSize(viewportSize);
            }

            stories.forEach((story) => {
                driver.controlFlow().execute(() => {
                    current++;
                    console.log("Capturing screenshot of '" + story.title + "' story... " + current + " of " + stories.length + ".");
                });

                driver.get(story.storyUrl);

                eyes.check(story.title, Target.window().fully());

                driver.controlFlow().execute(() => {
                    console.log("Capturing screenshot of '" + story.title + "' done.");
                });
            });

            driver.quit();
            return eyes.close();
        });
    }
}

module.exports = {
    EyesSelenium: EyesSelenium
};

