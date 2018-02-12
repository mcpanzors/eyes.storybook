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
    GeneralUtils
} = require('@applitools/eyes.sdk.core');

class EyesSeleniumUtils extends EyesJsBrowserUtils {

    /**
     * @param {Logger} logger The logger to use.
     * @param {IWebDriver} driver The web driver to use.
     * @return {Promise.<RectangleSize>} The viewport size of the current context, or the display size if the viewport size cannot be retrieved.
     */
    static getViewportSizeOrDisplaySize(logger, driver) {
        logger.verbose("getViewportSizeOrDisplaySize()");
        return EyesSeleniumUtils.getViewportSize(driver).catch(err => {
            logger.verbose("Failed to extract viewport size using Javascript:", err);
            logger.verbose("Using window size as viewport size.");
            return driver.manage().window().getSize().then(/** {width: number, height: number} */ result => {
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
        return driver.manage().window().getSize().then(/** {width: number, height: number} */ browserSize => {
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
        ArgumentGuard.notNull(requiredSize, "requiredSize");

        // First we will set the window size to the required size.
        // Then we'll check the viewport size and increase the window size accordingly.
        logger.verbose(`setViewportSize(${requiredSize})`);
        return EyesSeleniumUtils.getViewportSize(driver).then(actualViewportSize => {
            logger.verbose(`Initial viewport size: ${actualViewportSize}`);

            // If the viewport size is already the required size
            if (actualViewportSize.equals(requiredSize)) {
                logger.verbose("Required size already set.");
                return;
            }

            // We move the window to (0,0) to have the best chance to be able to set the viewport size as requested.
            return driver.manage().window().setPosition(0, 0).catch(ignore => {
                logger.verbose("Warning: Failed to move the browser window to (0,0)");
            }).then(() => {
                return EyesSeleniumUtils.setBrowserSizeByViewportSize(logger, driver, actualViewportSize, requiredSize);
            }).then(() => {
                return EyesSeleniumUtils.getViewportSize(driver);
            }).then(actualViewportSize => {
                if (actualViewportSize.equals(requiredSize)) {
                    return;
                }

                // Additional attempt. This Solves the "maximized browser" bug
                // (border size for maximized browser sometimes different than non-maximized, so the original browser size calculation is  wrong).
                logger.verbose("Trying workaround for maximization...");
                return EyesSeleniumUtils.setBrowserSizeByViewportSize(logger, driver, actualViewportSize, requiredSize).then(() => {
                    return EyesSeleniumUtils.getViewportSize(driver);
                }).then(/** RectangleSize */ actualViewportSize => {
                    logger.verbose(`Current viewport size: ${actualViewportSize}`);
                    if (actualViewportSize.equals(requiredSize)) {
                        return;
                    }

                    const MAX_DIFF = 3;
                    const widthDiff = actualViewportSize.getWidth() - requiredSize.getWidth();
                    const widthStep = widthDiff > 0 ? -1 : 1; // -1 for smaller size, 1 for larger
                    const heightDiff = actualViewportSize.getHeight() - requiredSize.getHeight();
                    const heightStep = heightDiff > 0 ? -1 : 1;

                    return driver.manage().window().getSize().then(/** {width: number, height: number} */ result => {
                        const browserSize = new RectangleSize(result.width, result.height);
                        const currWidthChange = 0;
                        const currHeightChange = 0;
                        // We try the zoom workaround only if size difference is reasonable.
                        if (Math.abs(widthDiff) <= MAX_DIFF && Math.abs(heightDiff) <= MAX_DIFF) {
                            logger.verbose("Trying workaround for zoom...");
                            const retriesLeft = Math.abs((widthDiff === 0 ? 1 : widthDiff) * (heightDiff === 0 ? 1 : heightDiff)) * 2;
                            const lastRequiredBrowserSize = null;
                            return setViewportSizeLoop(logger, driver, requiredSize, actualViewportSize, browserSize, widthDiff, widthStep,
                                heightDiff, heightStep, currWidthChange, currHeightChange, retriesLeft, lastRequiredBrowserSize);
                        }

                        throw new Error("EyesError: failed to set window size!");
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
        return EyesSeleniumUtils.getDevicePixelRatio(driver).then(ratio => ratio, () => 1).then(devicePixelRatio => {
            return EyesSeleniumUtils.getCurrentFrameContentEntireSize(driver).then(entireSize => {
                return EyesSeleniumUtils.getViewportSizeOrDisplaySize(logger, driver).then(viewportSize => {
                    return new ContextBasedScaleProviderFactory(logger, entireSize, viewportSize, devicePixelRatio, false, propertyHandler);
                }, () => {
                    return new FixedScaleProviderFactory(1 / devicePixelRatio, propertyHandler);
                });
            });
        });
    };

    /**
     * @param driver
     * @param {PromiseFactory} promiseFactory
     * @return {Promise<MutableImage>}
     */
    static takeScreenshot(driver, promiseFactory) {
        return driver.sleep(100).then(() => {
            return driver.takeScreenshot();
        }).then(screenshot => {
            return MutableImage.fromBase64(screenshot, promiseFactory);
        });
    };

    /**
     * @param driver
     * @param {ScaleProviderFactory} scaleProviderFactory
     * @param {PromiseFactory} promiseFactory
     * @return {Promise<MutableImage>}
     */
    static captureViewport(driver, scaleProviderFactory, promiseFactory) {
        return EyesSeleniumUtils.takeScreenshot(driver, promiseFactory).then(parsedImage => {
            const scaleProvider = scaleProviderFactory.getScaleProvider(parsedImage.getSize().getWidth());
            if (scaleProvider && scaleProvider.getScaleRatio() !== 1) {
                let scaleRatio = scaleProvider.getScaleRatio();
                return parsedImage.scale(scaleRatio);
            }

            return parsedImage;
        });
    };

    /**
     * @param driver
     * @param {ScaleProviderFactory} scaleProviderFactory
     * @param {PromiseFactory} promiseFactory
     * @return {Promise<MutableImage>}
     */
    static getScreenshot(driver, scaleProviderFactory, promiseFactory) {
        let entireSize, originalPosition, screenshot;
        return EyesSeleniumUtils.getCurrentFrameContentEntireSize(driver).then(contentSize => {
            entireSize = contentSize;
            return EyesSeleniumUtils.getCurrentScrollPosition(driver);
        }).then(scrollPosition => {
            originalPosition = scrollPosition;
            return EyesSeleniumUtils.captureViewport(driver, scaleProviderFactory, promiseFactory);
        }).then(image => {
            screenshot = image;
            if (image.getWidth() >= entireSize.getWidth() && image.getHeight() >= entireSize.getHeight()) {
                return;
            }

            const partImageSize = new RectangleSize(image.getWidth(), Math.max(image.getHeight() - 50, 10));
            const entirePage = new Region(Location.ZERO, entireSize);
            let imageParts = entirePage.getSubRegions(partImageSize);

            screenshot = MutableImage.newImage(entireSize.getWidth(), entireSize.getHeight(), promiseFactory);
            return imageParts.reduce((promise, partRegion) => {
                return promise.then(() => {
                    if (partRegion.getLeft() === 0 && partRegion.getTop() === 0) {
                        return screenshot.copyRasterData(0, 0, screenshot);
                    }

                    let currentPosition;
                    return EyesSeleniumUtils.setCurrentScrollPosition(driver, partRegion.getLocation()).then(() => {
                        return GeneralUtils.sleep(100, promiseFactory).then(() => {
                            return EyesSeleniumUtils.getCurrentScrollPosition(driver).then(currentPosition_ => {
                                currentPosition = currentPosition_;
                            });
                        });
                    }).then(() => {
                        return EyesSeleniumUtils.captureViewport(driver, scaleProviderFactory, promiseFactory);
                    }).then(partImage => {
                        return screenshot.copyRasterData(currentPosition.getX(), currentPosition.getY(), partImage);
                    });
                });
            }, promiseFactory.resolve());
        }).then(() => {
            return EyesSeleniumUtils.setCurrentScrollPosition(driver, originalPosition);
        }).then(() => {
            return screenshot;
        });
    };
}

const setBrowserSizeLoop = (logger, driver, requiredSize, sleep, retriesLeft) => {
    logger.verbose(`Trying to set browser size to: ${requiredSize}`);
    return driver.manage().window().setSize(requiredSize.getWidth(), requiredSize.getHeight()).then(() => {
        return driver.sleep(sleep);
    }).then(() => {
        return driver.manage().window().getSize();
    }).then(/** {width: number, height: number} */ result => {
        const currentSize = new RectangleSize(result.width, result.height);
        logger.verbose(`Current browser size: ${currentSize}`);
        if (currentSize.equals(requiredSize)) {
            return true;
        }

        --retriesLeft;
        if (retriesLeft === 0) {
            logger.verbose("Failed to set browser size: retries is out.");
            return false;
        }

        return setBrowserSizeLoop(logger, driver, requiredSize, sleep, retriesLeft);
    });
};

// noinspection OverlyComplexFunctionJS
const setViewportSizeLoop = (logger, driver, requiredSize, actualViewportSize, browserSize, widthDiff, widthStep,
                             heightDiff, heightStep, currWidthChange, currHeightChange, retriesLeft, lastRequiredBrowserSize) => {
    logger.verbose(`Retries left: ${retriesLeft}`);
    // We specifically use "<=" (and not "<"), so to give an extra resize attempt in addition to reaching the diff, due to floating point issues.
    if (Math.abs(currWidthChange) <= Math.abs(widthDiff) && actualViewportSize.getWidth() !== requiredSize.getWidth()) {
        currWidthChange += widthStep;
    }

    if (Math.abs(currHeightChange) <= Math.abs(heightDiff) && actualViewportSize.getHeight() !== requiredSize.getHeight()) {
        currHeightChange += heightStep;
    }

    const requiredBrowserSize = new RectangleSize(browserSize.getWidth()+ currWidthChange, browserSize.getHeight() + currHeightChange);
    if (requiredBrowserSize.equals(lastRequiredBrowserSize)) {
        logger.verbose("Browser size is as required but viewport size does not match!");
        logger.verbose(`Browser size: ${requiredBrowserSize} , Viewport size: ${actualViewportSize}`);
        logger.verbose("Stopping viewport size attempts.");
        return driver.controlFlow().promise(resolve => resolve());
    }

    return EyesSeleniumUtils.setBrowserSize(logger, driver, requiredBrowserSize).then(() => {
        lastRequiredBrowserSize = requiredBrowserSize;
        return EyesSeleniumUtils.getViewportSize(driver);
    }).then(actualViewportSize => {
        logger.verbose(`Current viewport size: ${actualViewportSize}`);
        if (actualViewportSize.equals(requiredSize)) {
            return;
        }

        --retriesLeft;

        if ((Math.abs(currWidthChange) <= Math.abs(widthDiff) || Math.abs(currHeightChange) <= Math.abs(heightDiff)) && (retriesLeft > 0)) {
            return setViewportSizeLoop(logger, driver, requiredSize, actualViewportSize, browserSize, widthDiff, widthStep,
                heightDiff, heightStep, currWidthChange, currHeightChange, retriesLeft, lastRequiredBrowserSize);
        }

        throw new Error("EyesError: failed to set window size! Zoom workaround failed.");
    });
};

module.exports = EyesSeleniumUtils;
