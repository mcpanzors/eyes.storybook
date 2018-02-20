'use strict';

const NODE_TYPES = {
    ELEMENT: 1,
    TEXT: 3,
    DOCUMENT: 9,
    DOCUMENT_TYPE: 10,
};

class EyesRenderingUtils {

    static domNodesToCdt(elementNodes) {
        const domNodes = [
            {
                nodeType: NODE_TYPES.DOCUMENT,
            },
        ];
        domNodes[0].childNodeIndexes = childrenFactory(domNodes, elementNodes);
        return domNodes;
    };

}

const childrenFactory = (domNodes, elementNodes) => {
    if (!elementNodes || elementNodes.length === 0) return undefined;

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
            attributes: objectEntries(elementNode.attributes).map(([name, value]) => ({name: value.localName, value: value.value})),
            childNodeIndexes: elementNode.childNodes.length ? childrenFactory(domNodes, elementNode.childNodes) : []
        };
    } else if (elementNode.nodeType === NODE_TYPES.TEXT) {
        node = {
            nodeType: NODE_TYPES.TEXT,
            nodeValue: elementNode.nodeValue
        };
    } else if (elementNode.nodeType === NODE_TYPES.DOCUMENT) {
        node = {
            nodeType: NODE_TYPES.DOCUMENT_TYPE,
            nodeName: 'HTML'
        };
    } else {
        console.log("else");
    }

    domNodes.push(node);
    return domNodes.length - 1;
};

const objectEntries = (obj) => {
    const keys = Object.keys(obj);
    let i = keys.length;
    const results = new Array(i);
    while (i--) results[i] = [keys[i], obj[keys[i]]];
    return results;
};

module.exports = EyesRenderingUtils;
