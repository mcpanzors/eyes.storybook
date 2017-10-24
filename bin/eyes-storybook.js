#!/usr/bin/env node

const fs = require('fs');

if (fs.existsSync(__dirname + '/../dist/bundle.js')) {
    require('../dist/bundle');
} else {
    require('../src/cli');
}

