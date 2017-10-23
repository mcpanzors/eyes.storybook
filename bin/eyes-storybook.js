#!/usr/bin/env node

const fs = require('fs');

if (fs.existsSync('../dist/bundle.js')) {
    require('../dist/bundle');
} else {
    require('../src/cli');
}

