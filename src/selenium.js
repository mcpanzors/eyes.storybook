'use strict';

const {ContextBasedScaleProviderFactory, FixedScaleProviderFactory, MutableImage} = require('eyes.sdk');
const {SimplePropertyHandler, GeometryUtils, GeneralUtils, ImageUtils} = require('eyes.utils');

const JS_GET_VIEWPORT_SIZE =
    "var height = undefined; " +
    "var width = undefined; " +
    "if (window.innerHeight) { height = window.innerHeight; } " +
    "else if (document.documentElement && document.documentElement.clientHeight) { height = document.documentElement.clientHeight; } " +
    "else { var b = document.getElementsByTagName('body')[0]; if (b.clientHeight) {height = b.clientHeight;} }; " +
    "if (window.innerWidth) { width = window.innerWidth; } " +
    "else if (document.documentElement && document.documentElement.clientWidth) { width = document.documentElement.clientWidth; } " +
    "else { var b = document.getElementsByTagName('body')[0]; if (b.clientWidth) { width = b.clientWidth;} }; " +
    "return [width, height];";

const JS_GET_CURRENT_SCROLL_POSITION =
    "var doc = document.documentElement; " +
    "var x = window.scrollX || ((window.pageXOffset || doc.scrollLeft) - (doc.clientLeft || 0)); " +
    "var y = window.scrollY || ((window.pageYOffset || doc.scrollTop) - (doc.clientTop || 0)); " +
    "return [x, y];";

const JS_GET_CONTENT_ENTIRE_SIZE =
    "var scrollWidth = document.documentElement.scrollWidth; " +
    "var bodyScrollWidth = document.body.scrollWidth; " +
    "var totalWidth = Math.max(scrollWidth, bodyScrollWidth); " +
    "var clientHeight = document.documentElement.clientHeight; " +
    "var bodyClientHeight = document.body.clientHeight; " +
    "var scrollHeight = document.documentElement.scrollHeight; " +
    "var bodyScrollHeight = document.body.scrollHeight; " +
    "var maxDocElementHeight = Math.max(clientHeight, scrollHeight); " +
    "var maxBodyHeight = Math.max(bodyClientHeight, bodyScrollHeight); " +
    "var totalHeight = Math.max(maxDocElementHeight, maxBodyHeight); " +
    "return [totalWidth, totalHeight];";

class SeleniumUtils {

    static createTestBatch(appName) {
        return {
            id: GeneralUtils.guid(),
            name: appName,
            startedAt: new Date().toUTCString()
        }
    }

    static sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, ms);
        });
    };

    static setWindowSize(driver, requiredSize, retries) {
        return driver.manage().window().setSize(requiredSize.width, requiredSize.height).then(() => {
            return SeleniumUtils.sleep(1000);
        }).then(() => {
            return driver.manage().window().getSize();
        }).then((currentSize) => {
            if (currentSize.width === requiredSize.width && currentSize.height === requiredSize.height) {
                return true;
            }

            if (retries === 0) {
                return false;
            } else if (!retries) {
                retries = 3;
            }

            return SeleniumUtils.setWindowSize(driver, requiredSize, retries - 1);
        });
    };

    static getViewportSize(driver) {
        return driver.executeScript(JS_GET_VIEWPORT_SIZE).then((results) => {
            return {
                width: parseInt(results[0], 10) || 0,
                height: parseInt(results[1], 10) || 0
            };
        });
    };

    static setViewportSize(driver, requiredSize) {
        return new Promise((resolve, reject) => {
            SeleniumUtils.getViewportSize(driver).then((viewportSize) => {
                // If the viewport size is already the required size
                if (viewportSize.width === requiredSize.width && viewportSize.height === requiredSize.height) {
                    resolve();
                    return;
                }

                // We move the window to (0,0) to have the best chance to be able to set the viewport size as requested.
                driver.manage().window().setPosition(0, 0).catch(() => {
                    console.error("Warning: Failed to move the browser window to (0,0)");
                }).then(() => {
                    return SeleniumUtils.setBrowserSizeByViewportSize(driver, viewportSize, requiredSize);
                }).then(() => {
                    return SeleniumUtils.getViewportSize(driver);
                }).then((actualViewportSize) => {
                    if (actualViewportSize.width === requiredSize.width && actualViewportSize.height === requiredSize.height) {
                        resolve();
                        return;
                    }

                    // Additional attempt. This Solves the "maximized browser" bug
                    // (border size for maximized browser sometimes different than non-maximized,
                    // so the original browser size calculation is wrong).
                    console.info("Trying workaround for maximization...");
                    return SeleniumUtils.setBrowserSizeByViewportSize(driver, actualViewportSize, requiredSize).then(() => {
                        return SeleniumUtils.getViewportSize(driver);
                    }).then((viewportSize) => {
                        actualViewportSize = viewportSize;
                        console.info("Current viewport size:", actualViewportSize);

                        if (actualViewportSize.width === requiredSize.width && actualViewportSize.height === requiredSize.height) {
                            resolve();
                            return;
                        }

                        return driver.manage().window().getSize().then((browserSize) => {
                            let MAX_DIFF = 3;
                            let widthDiff = actualViewportSize.width - requiredSize.width;
                            let widthStep = widthDiff > 0 ? -1 : 1; // -1 for smaller size, 1 for larger
                            let heightDiff = actualViewportSize.height - requiredSize.height;
                            let heightStep = heightDiff > 0 ? -1 : 1;

                            let currWidthChange = 0;
                            let currHeightChange = 0;
                            // We try the zoom workaround only if size difference is reasonable.
                            if (Math.abs(widthDiff) <= MAX_DIFF && Math.abs(heightDiff) <= MAX_DIFF) {
                                console.info("Trying workaround for zoom...");
                                let retriesLeft = Math.abs((widthDiff === 0 ? 1 : widthDiff) * (heightDiff === 0 ? 1 : heightDiff)) * 2;
                                let lastRequiredBrowserSize = null;
                                return SeleniumUtils._setWindowSize(driver, requiredSize, actualViewportSize, browserSize,
                                    widthDiff, widthStep, heightDiff, heightStep, currWidthChange, currHeightChange,
                                    retriesLeft, lastRequiredBrowserSize).then(() => {
                                    resolve();
                                }, () => {
                                    reject("Zoom workaround failed.");
                                });
                            }

                            reject("Failed to set viewport size!");
                        });
                    });
                });
            }).catch((err) => {
                reject(err);
            });
        });
    };

    static _setWindowSize(driver, requiredSize, actualViewportSize, browserSize, widthDiff, widthStep, heightDiff, heightStep, currWidthChange, currHeightChange, retriesLeft, lastRequiredBrowserSize) {
        return new Promise((resolve, reject) => {
            console.info("Retries left: " + retriesLeft);
            // We specifically use "<=" (and not "<"), so to give an extra resize attempt
            // in addition to reaching the diff, due to floating point issues.
            if (Math.abs(currWidthChange) <= Math.abs(widthDiff) && actualViewportSize.width !== requiredSize.width) {
                currWidthChange += widthStep;
            }

            if (Math.abs(currHeightChange) <= Math.abs(heightDiff) && actualViewportSize.height !== requiredSize.height) {
                currHeightChange += heightStep;
            }

            let requiredBrowserSize = {
                width: browserSize.width + currWidthChange,
                height: browserSize.height + currHeightChange
            };

            if (lastRequiredBrowserSize && requiredBrowserSize.width === lastRequiredBrowserSize.width && requiredBrowserSize.height === lastRequiredBrowserSize.height) {
                console.info("Browser size is as required but viewport size does not match!");
                console.info("Browser size: " + requiredBrowserSize + " , Viewport size: " + actualViewportSize);
                console.info("Stopping viewport size attempts.");
                resolve();
                return;
            }

            return SeleniumUtils.setWindowSize(driver, requiredBrowserSize).then(() => {
                lastRequiredBrowserSize = requiredBrowserSize;
                return SeleniumUtils.getViewportSize(driver);
            }).then((actualViewportSize) => {
                console.info("Current viewport size:", actualViewportSize);
                if (actualViewportSize.width === requiredSize.width && actualViewportSize.height === requiredSize.height) {
                    resolve();
                    return;
                }

                if ((Math.abs(currWidthChange) <= Math.abs(widthDiff) || Math.abs(currHeightChange) <= Math.abs(heightDiff)) && (--retriesLeft > 0)) {
                    return SeleniumUtils._setWindowSize(driver, requiredSize, actualViewportSize, browserSize, widthDiff, widthStep, heightDiff, heightStep, currWidthChange, currHeightChange, retriesLeft, lastRequiredBrowserSize).then(() => {
                        resolve();
                    }, () => {
                        reject();
                    });
                }

                reject();
            });
        });
    }

    static getViewportSizeOrDisplaySize(driver) {
        return SeleniumUtils.getViewportSize(driver).catch((err) => {
            console.error("Failed to extract viewport size using Javascript:", err);
            console.info("Using window size as viewport size.");
            return driver.manage().window().getSize();
        });
    };

    static setBrowserSizeByViewportSize(driver, actualViewportSize, requiredViewportSize) {
        return driver.manage().window().getSize().then((browserSize) => {
            const requiredBrowserSize = {
                width: browserSize.width + (requiredViewportSize.width - actualViewportSize.width),
                height: browserSize.height + (requiredViewportSize.height - actualViewportSize.height)
            };
            return SeleniumUtils.setWindowSize(driver, requiredBrowserSize, 3);
        });
    };

    static getEntirePageSize(driver) {
        return driver.executeScript(JS_GET_CONTENT_ENTIRE_SIZE).then((result) => {
            return {
                width: parseInt(result[0], 10) || 0,
                height: parseInt(result[1], 10) || 0
            }
        });
    };

    static getScrollPosition(driver) {
        return driver.executeScript(JS_GET_CURRENT_SCROLL_POSITION).then((result) => {
            return {
                x: parseInt(result[0], 10) || 0,
                y: parseInt(result[1], 10) || 0
            }
        });
    };

    static setScrollPosition(driver, point) {
        let script = 'window.scrollTo(' + parseInt(point.x, 10) + ', ' + parseInt(point.y, 10) + ');';
        return driver.executeScript(script);
    };

    static getDevicePixelRatio(driver) {
        return driver.executeScript("return window.devicePixelRatio;").then((result) => {
            return parseFloat(result);
        });
    };

    static updateScalingParams(driver) {
        const propertyHandler = new SimplePropertyHandler();
        let factory, enSize, vpSize, devicePixelRatio;
        return SeleniumUtils.getDevicePixelRatio(driver).then((ratio) => {
            devicePixelRatio = ratio;
        }, () => {
            devicePixelRatio = 1;
        }).then(() => {
            return SeleniumUtils.getEntirePageSize(driver);
        }).then((entireSize) => {
            enSize = entireSize;
            return SeleniumUtils.getViewportSizeOrDisplaySize(driver);
        }).then((viewportSize) => {
            vpSize = viewportSize;
            factory = new ContextBasedScaleProviderFactory(enSize, vpSize, devicePixelRatio, propertyHandler);
        }, () => {
            factory = new FixedScaleProviderFactory(1 / devicePixelRatio, propertyHandler);
        }).then(() => {
            return factory;
        });
    };

    static takeScreenshot(driver, promiseFactory) {
        return SeleniumUtils.sleep(100).then(() => {
            return driver.takeScreenshot();
        }).then((screenshot) => {
            return MutableImage.fromBase64(screenshot, promiseFactory);
        });
    };

    static captureViewport(driver, scaleProviderFactory, promiseFactory) {
        let parsedImage, imageSize, scaleProvider;
        return SeleniumUtils.takeScreenshot(driver, promiseFactory).then((image) => {
            parsedImage = image;
            return parsedImage.getSize();
        }).then((imgSize) => {
            imageSize = imgSize;
            scaleProvider = scaleProviderFactory.getScaleProvider(imageSize.width);
            if (scaleProvider && scaleProvider.getScaleRatio() !== 1) {
                let scaleRatio = scaleProvider.getScaleRatio();
                return parsedImage.scaleImage(scaleRatio);
            }
        }).then(() => {
            return parsedImage;
        });
    };

    static getScreenshot(driver, scaleProviderFactory, promiseFactory) {
        let entirePageSize, originalPosition, screenshot;
        return SeleniumUtils.getEntirePageSize(driver).then((result) => {
            entirePageSize = result;
            return SeleniumUtils.getScrollPosition(driver);
        }).then((result) => {
            originalPosition = result;
            return SeleniumUtils.captureViewport(driver, scaleProviderFactory, promiseFactory);
        }).then((image) => {
            screenshot = image;
            return image.asObject();
        }).then((imageObject) => {
            return new Promise((resolve2) => {
                if (imageObject.width >= entirePageSize.width && imageObject.height >= entirePageSize.height) {
                    resolve2();
                    return;
                }

                let screenshotPartSize = {
                    width: imageObject.width,
                    height: Math.max(imageObject.height - 50, 10)
                };

                let screenshotParts = GeometryUtils.getSubRegions({
                    left: 0, top: 0, width: entirePageSize.width,
                    height: entirePageSize.height
                }, screenshotPartSize, false);

                let parts = [];
                let promise = Promise.resolve();
                screenshotParts.forEach((part) => {
                    promise = promise.then(() => {
                        return new Promise((resolve4) => {
                            if (part.left === 0 && part.top === 0) {
                                parts.push({
                                    image: imageObject.imageBuffer,
                                    size: {width: imageObject.width, height: imageObject.height},
                                    position: {x: 0, y: 0}
                                });

                                resolve4();
                                return;
                            }

                            let currentPosition;
                            let partCoords = {x: part.left, y: part.top};
                            return SeleniumUtils.setScrollPosition(driver, partCoords).then(() => {
                                return SeleniumUtils.getScrollPosition(driver).then((position) => {
                                    currentPosition = position;
                                });
                            }).then(() => {
                                return SeleniumUtils.captureViewport(driver, scaleProviderFactory, promiseFactory);
                            }).then((partImage) => {
                                return partImage.asObject().then((newImageObjects) => {
                                    parts.push({
                                        image: newImageObjects.imageBuffer,
                                        size: {width: newImageObjects.width, height: newImageObjects.height},
                                        position: {x: currentPosition.x, y: currentPosition.y}
                                    });

                                    resolve4();
                                });
                            });
                        });
                    });
                });

                return promise.then(() => {
                    return ImageUtils.stitchImage(entirePageSize, parts, promiseFactory).then((stitchedBuffer) => {
                        screenshot = new MutableImage(stitchedBuffer, promiseFactory);
                        resolve2();
                    });
                });
            });
        }).then(() => {
            return SeleniumUtils.setScrollPosition(driver, originalPosition);
        }).then(() => {
            return screenshot;
        });
    };
}

module.exports = {
    SeleniumUtils: SeleniumUtils,
};

