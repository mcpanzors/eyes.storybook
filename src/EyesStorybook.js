'use strict';

const {EyesBase, NullScaleProvider} = require('eyes.sdk');
const VERSION = require('../package.json').version;

class Eyes extends EyesBase {

    /**
     * @constructor
     *
     * @param {PromiseFactory} [promiseFactory] If not specified will be created using RSVP lib
     * @param serverUrl
     * @augments EyesBase
     **/
    constructor(promiseFactory, serverUrl) {
        super(promiseFactory, serverUrl || EyesBase.DEFAULT_EYES_SERVER, false);

        this._screenshot = undefined;
        this._title = undefined;
        this._inferredEnvironment = undefined;
        this._globalFlow = Promise.resolve();
    }

    //noinspection JSMethodCanBeStatic,JSUnusedGlobalSymbols
    _getBaseAgentId() {
        return 'eyes.storybook/' + VERSION;
    }

    // noinspection JSUnusedGlobalSymbols
    open(appName, testName) {
        this._logger.getLogHandler().open();
        // noinspection JSUnusedGlobalSymbols
        this._isOpen = true;
        // noinspection JSUnusedGlobalSymbols
        this._userInputs = [];
        // noinspection JSUnusedGlobalSymbols
        this._scaleProviderHandler.set(new NullScaleProvider());
        // noinspection JSUnusedGlobalSymbols
        this._testName = testName;
        // noinspection JSUnusedGlobalSymbols
        this._appName = appName;
        // noinspection JSUnusedGlobalSymbols
        this._validationId = -1;
    }

    //noinspection JSUnusedGlobalSymbols
    /**
     * Perform visual validation for the current image.
     *
     * @param {MutableImage} screenshot The image png bytes or ImageProvider.
     * @param {string} [title] An optional tag to be associated with the validation checkpoint.
     *
     * @return {Promise}
     */
    checkImage(screenshot, title) {
        this._screenshot = screenshot;
        this._title = title || '';

        this._logger.verbose('checkImage(screenshot, "' + title + '")');
        return this._globalFlow = this._globalFlow.then(() => {
            return super.checkWindow(title, false, 0);
        });
    };

    //noinspection JSUnusedGlobalSymbols
    /**
     * Ends the currently running test.
     *
     * @param {boolean} throwEx If true, then the returned promise will 'reject' for failed/aborted tests.
     * @returns {Promise} A promise which resolves/rejects (depending on the value of 'throwEx') to the test results.
     */
    close(throwEx) {
        return this._globalFlow = this._globalFlow.then(() => {
            return super.close(throwEx);
        });
    };

    //noinspection JSUnusedGlobalSymbols
    /**
     * @return {Promise.<MutableImage>} An updated screenshot.
     */
    getScreenShot() {
        return Promise.resolve(this._screenshot);
    };

    //noinspection JSUnusedGlobalSymbols
    /**
     * @return {Promise} The current title of of the AUT.
     */
    getTitle() {
        return Promise.resolve(this._title);
    };

    //noinspection JSUnusedGlobalSymbols
    /**
     * Set the inferred environment string.
     * @param {string} inferredEnvironment The inferred environment string.
     */
    setInferredEnvironment(inferredEnvironment) {
        this._inferredEnvironment = inferredEnvironment;
    };

    //noinspection JSUnusedGlobalSymbols
    /**
     * @return {Promise} A promise which resolves to the inferred environment string.
     */
    getInferredEnvironment() {
        return Promise.resolve(this._inferredEnvironment);
    };

    //noinspection JSUnusedGlobalSymbols
    _waitTimeout(ms) {
        return new Promise((resolve) => {
            setTimeout(function () {
                resolve();
            }, ms);
        });
    };

    //noinspection JSUnusedGlobalSymbols
    getViewportSize() {
        if (this._screenshot) {
            return this._screenshot.getSize().then((imageSize) => {
                return {
                    width: imageSize.width,
                    height: imageSize.height
                }
            });
        }

        return Promise.resolve(undefined);
    };

    //noinspection JSUnusedGlobalSymbols
    setViewportSize(size) {
        //noinspection JSUnusedGlobalSymbols
        this._viewportSize = size;
        return Promise.resolve();
    };

    //noinspection JSUnusedGlobalSymbols
    setBatch(batch) {
        // noinspection JSUnusedGlobalSymbols
        this._batch = batch;
    }

    //noinspection JSUnusedGlobalSymbols,JSMethodCanBeStatic
    getAUTSessionId() {
        return Promise.resolve(undefined);
    };
}

module.exports = {
    Eyes: Eyes
};
