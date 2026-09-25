const path = require('node:path');

// The minimum hold only needs to prevent a strobe-like splash flash on fast
// machines; every millisecond beyond that delays an already-ready terminal.
const MIN_SPLASH_MS = 300;
const MAX_SPLASH_MS = 10_000;
const FADE_TIMEOUT_MS = 500;

/** A full-size launch surface inside the terminal's one native window. */
function createDesktopStartup({ WebContentsView, ipcMain, mainWindow, appRoot }) {
    const mainContents = mainWindow.webContents;
    const backgroundThrottling = mainContents.getBackgroundThrottling();
    // The overlay occludes the terminal. Keep its readiness animation frames
    // running until the splash is removed, then restore the normal setting.
    mainContents.setBackgroundThrottling(false);
    const splashView = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
        },
    });
    const splashContents = splashView.webContents;
    // An opaque native backing also covers the terminal before the HTML paints.
    splashView.setBackgroundColor('#2d2c31');
    mainWindow.contentView.addChildView(splashView);

    let finished = false;
    let transitioning = false;
    let shown = false;
    let mainPainted = false;
    let splashLoaded = false;
    let rendererReady = false;
    let minimumElapsed = false;
    let minimumTimer;
    let watchdogTimer;
    let fadeTimer;

    function resizeSplash() {
        if (finished || mainWindow.isDestroyed()) return;
        const { width, height } = mainWindow.getContentBounds();
        splashView.setBounds({ x: 0, y: 0, width, height });
    }

    function showWindowOnce() {
        if (shown || mainWindow.isDestroyed()) return;
        shown = true;
        mainWindow.show();
    }

    function blockUnderlyingInput(event) {
        event.preventDefault();
    }

    function cleanup() {
        clearTimeout(minimumTimer);
        clearTimeout(watchdogTimer);
        clearTimeout(fadeTimer);
        ipcMain.removeListener('desktop-startup-ready', onRendererReady);
        mainWindow.removeListener('resize', resizeSplash);
        mainWindow.removeListener('ready-to-show', onMainPainted);
        mainWindow.removeListener('closed', finish);
        mainContents.removeListener('before-input-event', blockUnderlyingInput);
        mainContents.removeListener('did-fail-load', onLoadFailed);
        mainContents.removeListener('render-process-gone', finish);
        splashContents.removeListener('did-finish-load', onSplashLoaded);
        splashContents.removeListener('did-fail-load', onLoadFailed);
        splashContents.removeListener('render-process-gone', finish);
        splashContents.removeListener('destroyed', finish);
    }

    function finish() {
        if (finished) return;
        finished = true;
        cleanup();
        if (!mainWindow.isDestroyed()) {
            mainWindow.contentView.removeChildView(splashView);
            showWindowOnce();
            // Do not restore or steal focus if the user switched away.
            if (mainWindow.isFocused() && !mainContents.isDestroyed()) mainContents.focus();
        }
        if (!mainContents.isDestroyed()) mainContents.setBackgroundThrottling(backgroundThrottling);
        // Child web contents are not automatically destroyed with their window.
        if (!splashContents.isDestroyed()) splashContents.close();
    }

    function revealWhenReady() {
        if (finished || transitioning || !mainPainted || !rendererReady || !minimumElapsed) return;
        transitioning = true;
        splashView.setBackgroundColor('#00000000');
        // Fading the HTML backdrop reveals the already-painted terminal below.
        fadeTimer = setTimeout(finish, FADE_TIMEOUT_MS);
        void splashContents.executeJavaScript(`(() => {
            if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            return document.body.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                { duration: 160, easing: 'ease-out', fill: 'forwards' }
            ).finished.then(() => undefined);
        })()`).then(finish, finish);
    }

    function onRendererReady(event) {
        if (event.sender !== mainContents || event.senderFrame !== mainContents.mainFrame) return;
        rendererReady = true;
        revealWhenReady();
    }

    function onMainPainted() {
        mainPainted = true;
        showSplashWhenReady();
        revealWhenReady();
    }

    function onSplashLoaded() {
        splashLoaded = true;
        showSplashWhenReady();
    }

    function showSplashWhenReady() {
        // The parent needs its first compositor frame before a child view can
        // be presented. Start the logo hold only when that window can appear.
        if (!mainPainted || !splashLoaded || shown) return;
        if (finished) return;
        showWindowOnce();
        splashContents.focus();
        minimumTimer = setTimeout(() => {
            minimumElapsed = true;
            revealWhenReady();
        }, MIN_SPLASH_MS);
    }

    function onLoadFailed(_event, errorCode, _description, _url, isMainFrame) {
        if (isMainFrame && errorCode !== -3) finish();
    }

    resizeSplash();
    ipcMain.on('desktop-startup-ready', onRendererReady);
    mainWindow.on('resize', resizeSplash);
    mainWindow.once('ready-to-show', onMainPainted);
    mainWindow.once('closed', finish);
    mainContents.on('before-input-event', blockUnderlyingInput);
    mainContents.on('did-fail-load', onLoadFailed);
    mainContents.once('render-process-gone', finish);
    splashContents.once('did-finish-load', onSplashLoaded);
    splashContents.on('did-fail-load', onLoadFailed);
    splashContents.once('render-process-gone', finish);
    splashContents.once('destroyed', finish);

    watchdogTimer = setTimeout(finish, MAX_SPLASH_MS);
    void splashContents.loadFile(path.join(appRoot, 'desktop-splash.html')).catch(finish);
    return splashView;
}

module.exports = { createDesktopStartup, MIN_SPLASH_MS, MAX_SPLASH_MS, FADE_TIMEOUT_MS };
