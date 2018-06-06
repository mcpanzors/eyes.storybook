'use strict';

const {
  RenderRequest,
  RenderInfo,
} = require('@applitools/eyes.sdk.core');

class EyesStorybookRenderRequest extends RenderRequest {
  /**
   * @param {string} webhook
   * @param {EyesStorybookStory} story
   * @param {RGridDom} dom
   * @param {string} [platform]
   * @param {string} [browserName]
   */
  constructor(webhook, story, dom, platform, browserName) {
    super(
      webhook,
      story.getStoryUrl('http://localhost/'),
      dom,
      RenderInfo.fromRectangleSize(story.getViewportSize()),
      platform,
      browserName
    );

    this._story = story;
  }

  // noinspection JSUnusedGlobalSymbols
  // TODO: remove when eyes.sdk.core will be updated (this method should be a part of parent class)
  /** @return {string} */
  getPlatform() {
    return this._platform;
  }

  // noinspection JSUnusedGlobalSymbols
  /** @return {EyesStorybookStory} */
  getStory() {
    return this._story;
  }
}

exports.EyesStorybookRenderRequest = EyesStorybookRenderRequest;
