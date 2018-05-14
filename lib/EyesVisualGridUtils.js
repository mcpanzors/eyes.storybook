'use strict';

const jsdom = require('jsdom/lib/old-api');

/* eslint-disable no-use-before-define */
const NODE_TYPES = {
  ELEMENT: 1,
  TEXT: 3,
  DOCUMENT: 9,
  DOCUMENT_TYPE: 10,
};

class EyesVisualGridUtils {
  /**
   * @param {PromiseFactory} promiseFactory
   * @param {Buffer} htmlContent
   * @returns {Promise<any>}
   */
  static getDocumentFromHtml(promiseFactory, htmlContent) {
    return promiseFactory.makePromise((resolve, reject) => {
      const jsdomConfig = {
        html: htmlContent,
        done: (err, window) => {
          if (err) return reject(err);
          return resolve(window.document);
        },
      };
      jsdom.env(jsdomConfig);
    });
  }

  static domNodesToCdt(elementNodes) {
    const domNodes = [
      {
        nodeType: NODE_TYPES.DOCUMENT,
      },
    ];
    domNodes[0].childNodeIndexes = childrenFactory(domNodes, elementNodes);
    return domNodes;
  }
}

const childrenFactory = (domNodes, elementNodes) => {
  if (!elementNodes || elementNodes.length === 0) return null;

  const childIndexes = [];
  elementNodes.forEach(elementNode => {
    const index = elementNodeFactory(domNodes, elementNode);
    childIndexes.push(index);
  });

  return childIndexes;
};

const elementNodeFactory = (domNodes, elementNode) => {
  let node;
  if (elementNode.nodeType === NODE_TYPES.ELEMENT) {
    node = {
      nodeType: NODE_TYPES.ELEMENT,
      nodeName: elementNode.nodeName,
      attributes: Object.keys(elementNode.attributes)
        .map(key => ({ name: elementNode.attributes[key].localName, value: elementNode.attributes[key].value })),
      childNodeIndexes: elementNode.childNodes.length ? childrenFactory(domNodes, elementNode.childNodes) : [],
    };
  } else if (elementNode.nodeType === NODE_TYPES.TEXT) {
    node = {
      nodeType: NODE_TYPES.TEXT,
      nodeValue: elementNode.nodeValue,
    };
  } else if (elementNode.nodeType === NODE_TYPES.DOCUMENT) {
    node = {
      nodeType: NODE_TYPES.DOCUMENT_TYPE,
      nodeName: 'HTML',
    };
  } else {
    throw new Error(`Unknown nodeType: ${elementNode.nodeType}`);
  }

  domNodes.push(node);
  return domNodes.length - 1;
};

exports.EyesVisualGridUtils = EyesVisualGridUtils;
