'use strict';

class EyesStorybookStory {
  /**
   * @param {string} componentName
   * @param {string} state
   * @param {RectangleSize} [viewportSize]
   */
  constructor(componentName, state, viewportSize) {
    this._componentName = componentName;
    this._state = state;
    this._viewportSize = viewportSize;
  }

  /**
   * @return {string}
   */
  getComponentName() {
    return this._componentName;
  }

  /**
   * @return {string}
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
   * @return {string}
   */
  getCompoundTitle() {
    if (!this._compoundTitle) {
      this._compoundTitle = `${this._componentName}: ${this._state}`;
    }
    return this._compoundTitle;
  }

  /**
   * @param {string} storybookUrl
   * @return {string}
   */
  getStoryUrl(storybookUrl) {
    return `${storybookUrl}iframe.html?selectedKind=${encodeURIComponent(this._componentName)}&` +
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
