'use strict';

class StorybookStory {

    /**
     * @param {String} componentName
     * @param {String} state
     * @param {RectangleSize} [viewportSize]
     */
    constructor(componentName, state, viewportSize) {
        this._componentName = componentName;
        this._state = state;
        this._viewportSize = viewportSize;
    }

    /**
     * @return {String}
     */
    getComponentName() {
        return this._componentName;
    }

    /**
     * @param {String} value
     */
    setComponentName(value) {
        this._componentName = value;
    }

    /**
     * @return {String}
     */
    getState() {
        return this._state;
    }

    /**
     * @param {String} value
     */
    setState(value) {
        this._state = value;
    }

    /**
     * @return {RectangleSize}
     */
    getViewportSize() {
        return this._viewportSize;
    }

    /**
     * @param {RectangleSize} value
     */
    setViewportSize(value) {
        this._viewportSize = value;
    }

    /**
     * @return {String}
     */
    getCompoundTitle() {
        if (!this._compoundTitle) {
            this._compoundTitle = `${this._componentName}: ${this._state}`;
        }
        return this._compoundTitle;
    }

    /**
     * @return {String}
     */
    getCompoundTitleWithViewportSize() {
        if (!this._viewportSize) {
            return this.getCompoundTitle();
        }

        return `${this.getCompoundTitle()} [${this._viewportSize.getWidth()}x${this._viewportSize.getHeight()}]`;
    }

    /**
     * @param {String} storybookAddress
     * @return {String}
     */
    getStorybookUrl(storybookAddress) {
        return `${storybookAddress}iframe.html?selectedKind=${encodeURIComponent(this._componentName)}&selectedStory=${encodeURIComponent(this._state)}`;
    }
}

module.exports = StorybookStory;
