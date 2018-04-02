'use strict';

class EyesStorybookStory {
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
   * @return {String}
   */
  getState() {
    return this._state;
  }

  /**
   * @return {RectangleSize}
   */
  getViewportSize() {
    return this._viewportSize;
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
   * @param {String} storybookAddress
   * @return {String}
   */
  getStorybookUrl(storybookAddress) {
    return `${storybookAddress}iframe.html?selectedKind=${encodeURIComponent(this._componentName)}&` +
      `selectedStory=${encodeURIComponent(this._state)}`;
  }

  /** @override */
  toString() {
    if (!this._viewportSize) {
      return this.getCompoundTitle();
    }

    return `${this.getCompoundTitle()} [${this._viewportSize.toString()}]`;
  }
}

exports.EyesStorybookStory = EyesStorybookStory;
