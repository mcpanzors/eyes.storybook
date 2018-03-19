'use strict';

/** @typedef {EyesJsExecutor} IWebDriver */

const {
  ContextBasedScaleProviderFactory,
  FixedScaleProviderFactory,
  SimplePropertyHandler,
  Region,
  RectangleSize,
  MutableImage,
  EyesJsBrowserUtils,
  ArgumentGuard,
  Location,
  GeneralUtils,
} = require('@applitools/eyes.sdk.core');

const setBrowserSizeLoop = (logger, driver, requiredSize, sleep, retriesLeft) => {
  logger.verbose(`Trying to set browser size to: ${requiredSize}`);
  return driver.manage().window()
    .setSize(requiredSize.getWidth(), requiredSize.getHeight())
    .then(() => driver.sleep(sleep))
    .then(() => driver.manage().window().getSize())
    .then(/** {width: number, height: number} */ result => {
      const currentSize = new RectangleSize(result.width, result.height);
      logger.verbose(`Current browser size: ${currentSize}`);
      if (currentSize.equals(requiredSize)) {
        return true;
      }

      if (retriesLeft <= 1) {
        logger.verbose('Failed to set browser size: retries is out.');
        return false;
      }

      return setBrowserSizeLoop(logger, driver, requiredSize, sleep, retriesLeft - 1);
    });
};

// noinspection OverlyComplexFunctionJS
const setViewportSizeLoop = (
  logger, driver, requiredSize, actualViewportSize, browserSize, widthDiff, widthStep,
  heightDiff, heightStep, lastWidthChange, lastHeightChange, retriesLeft, lastRequiredBrowserSize
) => {
  let widthChange = lastWidthChange;
  let heightChange = lastHeightChange;
  logger.verbose(`Retries left: ${retriesLeft}`);
  // We specifically use "<=" (and not "<"), so to give an extra resize attempt in addition to reaching the diff, due
  // to floating point issues.
  if (Math.abs(widthChange) <= Math.abs(widthDiff) && actualViewportSize.getWidth() !== requiredSize.getWidth()) {
    widthChange += widthStep;
  }

  if (Math.abs(heightChange) <= Math.abs(heightDiff) && actualViewportSize.getHeight() !== requiredSize.getHeight()) {
    heightChange += heightStep;
  }

  const requiredBrowserSize = new RectangleSize(
    browserSize.getWidth() + widthChange,
    browserSize.getHeight() + heightChange
  );
  if (requiredBrowserSize.equals(lastRequiredBrowserSize)) {
    logger.verbose('Browser size is as required but viewport size does not match!');
    logger.verbose(`Browser size: ${requiredBrowserSize} , Viewport size: ${actualViewportSize}`);
    logger.verbose('Stopping viewport size attempts.');
    return driver.controlFlow().promise(resolve => resolve());
  }

  return EyesSeleniumUtils.setBrowserSize(logger, driver, requiredBrowserSize)
    .then(() => EyesSeleniumUtils.getViewportSize(driver)
      .then(newViewportSize => {
        logger.verbose(`Current viewport size: ${newViewportSize}`);
        if (newViewportSize.equals(requiredSize)) {
          return true;
        }

        if (
          (Math.abs(widthChange) <= Math.abs(widthDiff) || Math.abs(heightChange) <= Math.abs(heightDiff)) &&
          (retriesLeft > 1)
        ) {
          return setViewportSizeLoop(
            logger, driver, requiredSize, newViewportSize, browserSize, widthDiff, widthStep,
            heightDiff, heightStep, widthChange, heightChange, retriesLeft - 1, requiredBrowserSize
          );
        }

        throw new Error('EyesError: failed to set window size! Zoom workaround failed.');
      }));
};

class EyesSeleniumUtils extends EyesJsBrowserUtils {
  /**
   * @param {Logger} logger The logger to use.
   * @param {IWebDriver} driver The web driver to use.
   * @return {Promise.<RectangleSize>} The viewport size of the current context, or the display size if the viewport
   *   size cannot be retrieved.
   */
  static getViewportSizeOrDisplaySize(logger, driver) {
    logger.verbose('getViewportSizeOrDisplaySize()');
    return EyesSeleniumUtils.getViewportSize(driver)
      .catch(err => {
        logger.verbose('Failed to extract viewport size using Javascript:', err);
        logger.verbose('Using window size as viewport size.');
        return driver.manage().window().getSize()
          .then(/** {width: number, height: number} */ result => {
            logger.verbose(`Done! Size ${result.width} x ${result.height}`);
            return new RectangleSize(result);
          });
      });
  }

  /**
   * @param {Logger} logger The logger to use.
   * @param {IWebDriver} driver The web driver to use.
   * @param {RectangleSize} requiredSize The size to set
   * @return {Promise.<Boolean>}
   */
  static setBrowserSize(logger, driver, requiredSize) {
    // noinspection MagicNumberJS
    const SLEEP = 1000;
    const RETRIES = 3;
    return setBrowserSizeLoop(logger, driver, requiredSize, SLEEP, RETRIES);
  }

  /**
   * @param {Logger} logger The logger to use.
   * @param {IWebDriver} driver The web driver to use.
   * @param {RectangleSize} actualViewportSize
   * @param {RectangleSize} requiredViewportSize
   * @return {Promise.<Boolean>}
   */
  static setBrowserSizeByViewportSize(logger, driver, actualViewportSize, requiredViewportSize) {
    return driver.manage().window().getSize()
      .then(/** {width: number, height: number} */browserSize => {
        const currentSize = new RectangleSize(browserSize);
        logger.verbose(`Current browser size: ${currentSize}`);
        const requiredBrowserSize = new RectangleSize(
          currentSize.getWidth() + (requiredViewportSize.getWidth() - actualViewportSize.getWidth()),
          currentSize.getHeight() + (requiredViewportSize.getHeight() - actualViewportSize.getHeight())
        );
        return EyesSeleniumUtils.setBrowserSize(logger, driver, requiredBrowserSize);
      });
  }

  /**
   * Tries to set the viewport size
   *
   * @param {Logger} logger The logger to use.
   * @param {IWebDriver} driver The web driver to use.
   * @param {RectangleSize} requiredSize The viewport size.
   * @return {Promise}
   */
  static setViewportSize(logger, driver, requiredSize) {
    ArgumentGuard.notNull(requiredSize, 'requiredSize');

    // First we will set the window size to the required size.
    // Then we'll check the viewport size and increase the window size accordingly.
    logger.verbose(`setViewportSize(${requiredSize})`);
    return EyesSeleniumUtils.getViewportSize(driver)
      .then(actualViewportSize => {
        logger.verbose(`Initial viewport size: ${actualViewportSize}`);

        // If the viewport size is already the required size
        if (actualViewportSize.equals(requiredSize)) {
          logger.verbose('Required size already set.');
          return true;
        }

        // We move the window to (0,0) to have the best chance to be able to set the viewport size as requested.
        return driver.manage().window().setPosition(0, 0)
          .catch(err => logger.verbose('Warning: Failed to move the browser window to (0,0)', err))
          .then(() => EyesSeleniumUtils.setBrowserSizeByViewportSize(logger, driver, actualViewportSize, requiredSize))
          .then(() => EyesSeleniumUtils.getViewportSize(driver))
          .then(newViewportSize => {
            if (newViewportSize.equals(requiredSize)) {
              return true;
            }

            // Additional attempt. This Solves the "maximized browser" bug (border size for maximized browser sometimes
            // different than non-maximized, so the original browser size calculation is  wrong).
            logger.verbose('Trying workaround for maximization...');
            return EyesSeleniumUtils.setBrowserSizeByViewportSize(logger, driver, newViewportSize, requiredSize)
              .then(() => EyesSeleniumUtils.getViewportSize(driver))
              .then(/** RectangleSize */ lastViewportSize => {
                logger.verbose(`Current viewport size: ${lastViewportSize}`);
                if (lastViewportSize.equals(requiredSize)) {
                  return true;
                }

                const MAX_DIFF = 3;
                const widthDiff = lastViewportSize.getWidth() - requiredSize.getWidth();
                const widthStep = widthDiff > 0 ? -1 : 1; // -1 for smaller size, 1 for larger
                const heightDiff = lastViewportSize.getHeight() - requiredSize.getHeight();
                const heightStep = heightDiff > 0 ? -1 : 1;

                return driver.manage().window().getSize()
                  .then(/** {width: number, height: number} */result => {
                    const browserSize = new RectangleSize(result.width, result.height);
                    const currWidthChange = 0;
                    const currHeightChange = 0;
                    // We try the zoom workaround only if size difference is reasonable.
                    if (Math.abs(widthDiff) <= MAX_DIFF && Math.abs(heightDiff) <= MAX_DIFF) {
                      logger.verbose('Trying workaround for zoom...');
                      const retriesLeft = Math.abs((widthDiff === 0 ? 1 : widthDiff) *
                        (heightDiff === 0 ? 1 : heightDiff)) * 2;

                      return setViewportSizeLoop(
                        logger, driver, requiredSize, lastViewportSize, browserSize, widthDiff, widthStep,
                        heightDiff, heightStep, currWidthChange, currHeightChange, retriesLeft, undefined
                      );
                    }

                    throw new Error('EyesError: failed to set window size!');
                  });
              });
          });
      });
  }

  /**
   * @param {IWebDriver} driver The web driver to use.
   * @param {Logger} logger The logger to use.
   * @return {Promise<ScaleProviderFactory>}
   */
  static updateScalingParams(logger, driver) {
    const propertyHandler = new SimplePropertyHandler();
    return EyesSeleniumUtils.getDevicePixelRatio(driver)
      .then(ratio => ratio, () => 1)
      .then(devicePixelRatio => EyesSeleniumUtils.getCurrentFrameContentEntireSize(driver)
        .then(entireSize => EyesSeleniumUtils.getViewportSizeOrDisplaySize(logger, driver)
          .then(viewportSize => new ContextBasedScaleProviderFactory(
            logger, entireSize, viewportSize,
            devicePixelRatio, false, propertyHandler
          ))
          .catch(() => new FixedScaleProviderFactory(1 / devicePixelRatio, propertyHandler))));
  }

  /**
   * @param driver
   * @param {PromiseFactory} promiseFactory
   * @return {Promise<MutableImage>}
   */
  static takeScreenshot(driver, promiseFactory) {
    return driver.sleep(100)
      .then(() => driver.takeScreenshot()
        .then(screenshot => MutableImage.fromBase64(screenshot, promiseFactory)));
  }

  /**
   * @param driver
   * @param {ScaleProviderFactory} scaleProviderFactory
   * @param {PromiseFactory} promiseFactory
   * @return {Promise<MutableImage>}
   */
  static captureViewport(driver, scaleProviderFactory, promiseFactory) {
    return EyesSeleniumUtils.takeScreenshot(driver, promiseFactory)
      .then(parsedImage => {
        const scaleProvider = scaleProviderFactory.getScaleProvider(parsedImage.getSize().getWidth());
        if (scaleProvider && scaleProvider.getScaleRatio() !== 1) {
          const scaleRatio = scaleProvider.getScaleRatio();
          return parsedImage.scale(scaleRatio);
        }

        return parsedImage;
      });
  }

  /**
   * @param logger
   * @param driver
   * @param {ScaleProviderFactory} scaleProviderFactory
   * @param {PromiseFactory} promiseFactory
   * @return {Promise<MutableImage>}
   */
  static getScreenshot(logger, driver, scaleProviderFactory, promiseFactory) {
    let entireSize, originalPosition, screenshot;
    return EyesSeleniumUtils.getCurrentFrameContentEntireSize(driver)
      .then(contentSize => {
        entireSize = contentSize;
        return EyesSeleniumUtils.getCurrentScrollPosition(driver);
      })
      .then(scrollPosition => {
        originalPosition = scrollPosition;
        return EyesSeleniumUtils.captureViewport(driver, scaleProviderFactory, promiseFactory);
      })
      .then(image => {
        screenshot = image;
        if (image.getWidth() >= entireSize.getWidth() && image.getHeight() >= entireSize.getHeight()) {
          return true;
        }

        const partImageSize = new RectangleSize(image.getWidth(), Math.max(image.getHeight() - 50, 10));
        const entirePage = new Region(Location.ZERO, entireSize);
        const imageParts = entirePage.getSubRegions(partImageSize);

        screenshot = MutableImage.newImage(entireSize.getWidth(), entireSize.getHeight(), promiseFactory);
        return imageParts.reduce((promise, partRegion) => promise.then(() => {
          if (partRegion.getLeft() === 0 && partRegion.getTop() === 0) {
            return screenshot.copyRasterData(0, 0, screenshot);
          }

          let currentPosition;
          return EyesSeleniumUtils.setCurrentScrollPosition(driver, partRegion.getLocation())
            .then(() => GeneralUtils.sleep(100, promiseFactory)
              .then(() => EyesSeleniumUtils.getCurrentScrollPosition(driver)
                .then(currentPosition_ => {
                  currentPosition = currentPosition_;
                })))
            .then(() => EyesSeleniumUtils.captureViewport(driver, scaleProviderFactory, promiseFactory))
            .then(partImage => screenshot.copyRasterData(currentPosition.getX(), currentPosition.getY(), partImage));
        }), promiseFactory.resolve());
      })
      .then(() => EyesSeleniumUtils.setCurrentScrollPosition(driver, originalPosition))
      .then(() => screenshot);
  }
}

module.exports = EyesSeleniumUtils;
