'use strict';

// Desktop brand identity for the white-label build.
//
// The product name is deployment configuration, never a vendor literal:
//   1. BRAND_PRODUCT_NAME from the environment (build or launch time);
//   2. brandProductName stamped into the packaged package.json by
//      electron-builder.config.cjs when the build had BRAND_PRODUCT_NAME set;
//   3. the neutral fallback 'Terminal', with a console warning so a missing
//      brand config is visible to operators but never to end users.
//
// An unset brand must never break a build or show an error string in the UI.

const NEUTRAL_PRODUCT_NAME = 'Terminal';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

function resolveBrandProductName({ env = process.env, packageMetadata = null, warn = console.warn } = {}) {
    const fromEnv = clean(env && env.BRAND_PRODUCT_NAME);
    if (fromEnv) return fromEnv;
    const stamped = clean(packageMetadata && packageMetadata.brandProductName);
    if (stamped) return stamped;
    if (typeof warn === 'function') {
        warn(`[Brand] BRAND_PRODUCT_NAME is not configured; using the neutral name '${NEUTRAL_PRODUCT_NAME}'.`);
    }
    return NEUTRAL_PRODUCT_NAME;
}

// Renderer-supplied window titles fall back to the resolved product name.
function resolveWindowTitle(title, fallbackTitle, warn = console.warn) {
    const requested = clean(title);
    if (requested) return requested;
    if (typeof warn === 'function') {
        warn('[Brand] Window title was empty; using the configured product name.');
    }
    return clean(fallbackTitle) || NEUTRAL_PRODUCT_NAME;
}

const toArtifactPrefix = (name) => clean(name).replace(/[^A-Za-z0-9_-]+/g, '.').replace(/^\.+|\.+$/g, '') || NEUTRAL_PRODUCT_NAME;

// electron-builder overlay: package.json "build" keeps neutral defaults and
// this applies BRAND_PRODUCT_NAME when set. appId is never touched here.
function createBuilderConfig(baseBuild = {}, env = process.env, warn = console.warn) {
    const base = baseBuild || {};
    const configured = clean(env && env.BRAND_PRODUCT_NAME);
    const productName = resolveBrandProductName({ env, warn });
    const config = {
        ...base,
        productName,
        artifactName: `${toArtifactPrefix(productName)}.Setup.\${version}.\${ext}`,
        nsis: { ...(base.nsis || {}), shortcutName: productName },
    };
    // Stamp the configured name into the packaged package.json so the
    // installed app shows it without a launch-time environment variable.
    if (configured) config.extraMetadata = { ...(base.extraMetadata || {}), brandProductName: configured };
    // Optional broker icon (.ico) for the executable, installer and shortcuts;
    // otherwise the neutral build/icon.ico from package.json stays.
    const icon = clean(env && env.BRAND_ICON);
    if (icon) config.win = { ...(base.win || {}), icon };
    return config;
}

module.exports = { NEUTRAL_PRODUCT_NAME, resolveBrandProductName, resolveWindowTitle, toArtifactPrefix, createBuilderConfig };
