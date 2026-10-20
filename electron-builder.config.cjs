'use strict';

// electron-builder configuration. package.json "build" holds the neutral
// defaults ('Terminal'); BRAND_PRODUCT_NAME overlays the product name, artifact
// name and shortcut. An unset brand never breaks the build: it keeps the
// neutral name and logs a warning. appId stays exactly as package.json defines it.

const { createBuilderConfig } = require('./electron-brand.cjs');

module.exports = createBuilderConfig(require('./package.json').build);
