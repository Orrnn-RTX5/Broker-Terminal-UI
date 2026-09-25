const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { test } = require('node:test');
const { createDesktopStartup, MIN_SPLASH_MS, MAX_SPLASH_MS, FADE_TIMEOUT_MS } = require('../electron-startup.cjs');

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function setup(t, { splashLoadError, backgroundThrottling = true } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const calls = [];
  const ipcMain = new EventEmitter();
  let resolveFade;
  let rejectFade;
  const fadeFinished = new Promise((resolve, reject) => {
    resolveFade = resolve;
    rejectFade = reject;
  });

  function makeWebContents(name) {
    const contents = new EventEmitter();
    contents.mainFrame = {};
    contents.destroyed = false;
    contents.scripts = [];
    contents.backgroundThrottling = name === 'main' ? backgroundThrottling : true;
    contents.getBackgroundThrottling = () => contents.backgroundThrottling;
    contents.setBackgroundThrottling = (enabled) => {
      assert.equal(contents.destroyed, false, 'cannot change throttling on destroyed contents');
      contents.backgroundThrottling = enabled;
      calls.push(name + ':throttle:' + enabled);
    };
    contents.isDestroyed = () => contents.destroyed;
    contents.loadFile = (filename) => {
      contents.loadedFile = filename;
      return splashLoadError ? Promise.reject(splashLoadError) : Promise.resolve();
    };
    contents.executeJavaScript = (script) => {
      assert.equal(contents.destroyed, false, 'cannot animate destroyed contents');
      contents.scripts.push(script);
      calls.push(name + ':animate');
      return fadeFinished;
    };
    contents.focus = () => {
      assert.equal(contents.destroyed, false, 'cannot focus destroyed contents');
      calls.push(name + ':focus');
    };
    contents.close = () => {
      if (contents.destroyed) return;
      calls.push(name + ':close');
      contents.destroyed = true;
      contents.emit('destroyed');
    };
    return contents;
  }

  class FakeWebContentsView extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = makeWebContents('splash');
    }
    setBounds(bounds) { this.bounds = bounds; }
    setBackgroundColor(color) { this.backgroundColor = color; }
  }

  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.visible = false;
      this.focused = false;
      this.bounds = { x: 80, y: 60, width: 1400, height: 900 };
      this.webContents = makeWebContents('main');
      this.contentView = {
        children: [],
        addChildView: (view) => {
          this.contentView.children.push(view);
          calls.push('main:attach');
        },
        removeChildView: (view) => {
          this.contentView.children = this.contentView.children.filter((child) => child !== view);
          calls.push('main:detach');
        },
      };
    }
    getContentBounds() { return { ...this.bounds }; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isFocused() { return this.focused; }
    show() {
      assert.equal(this.destroyed, false, 'cannot show a destroyed window');
      this.visible = true;
      this.focused = true;
      calls.push('main:show');
    }
    focus() {
      assert.equal(this.destroyed, false, 'cannot focus a destroyed window');
      this.focused = true;
      calls.push('main:window-focus');
    }
    close() {
      if (this.destroyed) return;
      this.emit('close');
      this.destroyed = true;
      this.visible = false;
      this.webContents.destroyed = true;
      this.contentView.children = [];
      calls.push('main:close');
      this.emit('closed');
    }
  }

  const mainWindow = new FakeWindow();
  const appRoot = path.resolve(__dirname, '..');
  const splashView = createDesktopStartup({
    WebContentsView: FakeWebContentsView, ipcMain, mainWindow, appRoot,
  });
  const signalReady = (overrides = {}) => ipcMain.emit('desktop-startup-ready', {
    sender: mainWindow.webContents,
    senderFrame: mainWindow.webContents.mainFrame,
    ...overrides,
  });
  const showSplash = () => splashView.webContents.emit('did-finish-load');
  const beginFade = () => {
    showSplash();
    mainWindow.emit('ready-to-show');
    signalReady();
    t.mock.timers.tick(MIN_SPLASH_MS);
  };
  t.after(() => {
    mainWindow.close();
    t.mock.timers.reset();
  });
  return {
    calls, ipcMain, mainWindow, splashView, appRoot, signalReady,
    showSplash, beginFade, resolveFade, rejectFade, backgroundThrottling,
  };
}

function assertDisposed({ mainWindow, splashView, ipcMain, backgroundThrottling }) {
  assert.equal(splashView.webContents.isDestroyed(), true);
  assert.equal(mainWindow.contentView.children.includes(splashView), false);
  assert.equal(ipcMain.listenerCount('desktop-startup-ready'), 0);
  if (!mainWindow.webContents.isDestroyed()) {
    assert.equal(mainWindow.webContents.getBackgroundThrottling(), backgroundThrottling,
      'restores the original terminal background throttling after all release paths');
  }
  for (const event of ['ready-to-show', 'closed', 'resize']) {
    assert.equal(mainWindow.listenerCount(event), 0, event + ' listener was removed');
  }
  for (const event of ['did-fail-load', 'render-process-gone', 'before-input-event']) {
    assert.equal(mainWindow.webContents.listenerCount(event), 0, 'main ' + event + ' listener was removed');
  }
  for (const event of ['did-finish-load', 'did-fail-load', 'render-process-gone']) {
    assert.equal(splashView.webContents.listenerCount(event), 0, 'splash ' + event + ' listener was removed');
  }
}

test('loads a sandboxed splash over the entire content of the same desktop window', (t) => {
  const { mainWindow, splashView, appRoot, showSplash } = setup(t);
  assert.equal(splashView.webContents.loadedFile, path.join(appRoot, 'desktop-splash.html'));
  assert.deepEqual(mainWindow.contentView.children, [splashView]);
  assert.deepEqual(splashView.bounds, { x: 0, y: 0, width: 1400, height: 900 });
  assert.equal(splashView.options.webPreferences.nodeIntegration, false);
  assert.equal(splashView.options.webPreferences.contextIsolation, true);
  assert.equal(splashView.options.webPreferences.sandbox, true);
  assert.equal(mainWindow.webContents.getBackgroundThrottling(), false);
  assert.equal(splashView.webContents.getBackgroundThrottling(), true);
  assert.equal(mainWindow.isVisible(), false);
  showSplash();
  assert.equal(mainWindow.isVisible(), false, 'waits for the parent native paint surface');
  mainWindow.emit('ready-to-show');
  t.mock.timers.tick(MIN_SPLASH_MS + 1);
  assert.equal(mainWindow.isVisible(), true);
  assert.equal(splashView.webContents.isDestroyed(), false);
  assert.equal(splashView.webContents.scripts.length, 0);
});

test('keeps the logo visible for its minimum duration and detaches only after its fade finishes', async (t) => {
  const fixture = setup(t);
  const { calls, mainWindow, splashView, showSplash, signalReady, resolveFade } = fixture;
  showSplash();
  mainWindow.emit('ready-to-show');
  signalReady();
  t.mock.timers.tick(MIN_SPLASH_MS - 1);
  assert.equal(splashView.webContents.scripts.length, 0);
  t.mock.timers.tick(1);
  assert.equal(splashView.webContents.scripts.length, 1);
  assert.equal(mainWindow.contentView.children.includes(splashView), true);
  assert.equal(splashView.webContents.isDestroyed(), false);
  resolveFade();
  await flushPromises();
  assertDisposed(fixture);
  assert.equal(mainWindow.isVisible(), true);
  assert.ok(calls.indexOf('main:detach') < calls.indexOf('splash:close'));
  assert.ok(calls.indexOf('main:detach') < calls.indexOf('main:focus'));
  assert.ok(calls.indexOf('main:detach') < calls.indexOf('main:throttle:true'));
  signalReady();
  t.mock.timers.tick(MAX_SPLASH_MS);
  assert.equal(calls.filter((call) => call === 'main:show').length, 1);
  assert.equal(calls.filter((call) => call === 'splash:close').length, 1);
  assert.equal(calls.filter((call) => call === 'main:throttle:true').length, 1);
});

test('preserves a terminal that already disabled background throttling', async (t) => {
  const fixture = setup(t, { backgroundThrottling: false });
  fixture.beginFade();
  assert.equal(fixture.mainWindow.webContents.getBackgroundThrottling(), false);
  assert.equal(fixture.splashView.webContents.getBackgroundThrottling(), true);
  fixture.resolveFade();
  await flushPromises();
  assertDisposed(fixture);
  assert.equal(fixture.mainWindow.webContents.getBackgroundThrottling(), false);
  assert.equal(fixture.calls.includes('main:throttle:true'), false);
});

test('measures the minimum logo duration from when the splash is shown', (t) => {
  const { mainWindow, splashView, showSplash, signalReady } = setup(t);
  mainWindow.emit('ready-to-show');
  signalReady();
  t.mock.timers.tick(2_000);
  assert.equal(mainWindow.isVisible(), false);
  showSplash();
  t.mock.timers.tick(MIN_SPLASH_MS - 1);
  assert.equal(splashView.webContents.scripts.length, 0);
  t.mock.timers.tick(1);
  assert.equal(splashView.webContents.scripts.length, 1);
});

test('waits for main first paint before showing splash and starting its minimum duration', (t) => {
  const { mainWindow, splashView, showSplash, signalReady } = setup(t);
  showSplash();
  signalReady();
  t.mock.timers.tick(MIN_SPLASH_MS);
  assert.equal(mainWindow.isVisible(), false);
  assert.equal(splashView.webContents.scripts.length, 0);
  mainWindow.emit('ready-to-show');
  assert.equal(mainWindow.isVisible(), true);
  assert.equal(splashView.webContents.scripts.length, 0);
  t.mock.timers.tick(MIN_SPLASH_MS - 1);
  assert.equal(splashView.webContents.scripts.length, 0);
  t.mock.timers.tick(1);
  assert.equal(splashView.webContents.scripts.length, 1);
});

test('rejects readiness from another renderer or child frame and starts only one fade', (t) => {
  const { mainWindow, splashView, showSplash, signalReady } = setup(t);
  showSplash();
  mainWindow.emit('ready-to-show');
  t.mock.timers.tick(MIN_SPLASH_MS);
  signalReady({ sender: new EventEmitter() });
  signalReady({ sender: splashView.webContents });
  signalReady({ senderFrame: {} });
  signalReady({ senderFrame: undefined });
  assert.equal(splashView.webContents.scripts.length, 0);
  signalReady();
  signalReady();
  assert.equal(splashView.webContents.scripts.length, 1);
});

test('resizes the splash with its desktop window and stops watching after disposal', async (t) => {
  const { mainWindow, splashView, beginFade, resolveFade } = setup(t);
  mainWindow.bounds = { x: 10, y: 20, width: 1920, height: 1080 };
  mainWindow.emit('resize');
  assert.deepEqual(splashView.bounds, { x: 0, y: 0, width: 1920, height: 1080 });
  beginFade();
  resolveFade();
  await flushPromises();
  mainWindow.bounds.width = 1000;
  mainWindow.emit('resize');
  assert.equal(splashView.bounds.width, 1920);
});

test('blocks keyboard actions underneath the splash, including during its fade', async (t) => {
  const { mainWindow, beginFade, resolveFade } = setup(t);
  let prevented = 0;
  const keyEvent = { preventDefault: () => { prevented += 1; } };
  mainWindow.webContents.emit('before-input-event', keyEvent, { key: 'Enter' });
  assert.equal(prevented, 1);
  beginFade();
  mainWindow.webContents.emit('before-input-event', keyEvent, { key: 'Enter' });
  assert.equal(prevented, 2);
  resolveFade();
  await flushPromises();
  mainWindow.webContents.emit('before-input-event', keyEvent, { key: 'Enter' });
  assert.equal(prevented, 2);
});

test('does not steal focus when another application is active at handoff', async (t) => {
  const { calls, mainWindow, beginFade, resolveFade } = setup(t);
  beginFade();
  mainWindow.focused = false;
  resolveFade();
  await flushPromises();
  assert.equal(mainWindow.focused, false);
  assert.equal(calls.includes('main:focus'), false);
  assert.equal(calls.includes('main:window-focus'), false);
});

test('does not restore a window minimized while the splash was active', async (t) => {
  const { calls, mainWindow, beginFade, resolveFade } = setup(t);
  beginFade();
  mainWindow.visible = false;
  mainWindow.focused = false;
  resolveFade();
  await flushPromises();
  assert.equal(mainWindow.isVisible(), false);
  assert.equal(calls.filter((call) => call === 'main:show').length, 1);
});

test('unexpected splash destruction releases the visible main window and listeners', (t) => {
  const fixture = setup(t);
  fixture.showSplash();
  fixture.splashView.webContents.close();
  assert.equal(fixture.mainWindow.isVisible(), true);
  assertDisposed(fixture);
  t.mock.timers.tick(MAX_SPLASH_MS);
  assert.equal(fixture.calls.filter((call) => call === 'splash:close').length, 1);
});

test('escapes at the maximum timeout when neither page reports ready', (t) => {
  const fixture = setup(t);
  t.mock.timers.tick(MAX_SPLASH_MS - 1);
  assert.equal(fixture.mainWindow.isVisible(), false);
  t.mock.timers.tick(1);
  assert.equal(fixture.mainWindow.isVisible(), true);
  assert.equal(fixture.splashView.webContents.scripts.length, 0);
  assertDisposed(fixture);
});

test('escapes at the maximum timeout when application readiness never arrives', (t) => {
  const fixture = setup(t);
  fixture.showSplash();
  fixture.mainWindow.emit('ready-to-show');
  t.mock.timers.tick(MAX_SPLASH_MS);
  assert.equal(fixture.mainWindow.isVisible(), true);
  assertDisposed(fixture);
});

test('keeps the overall watchdog active when a late fade is still pending', async (t) => {
  const fixture = setup(t);
  fixture.showSplash();
  fixture.mainWindow.emit('ready-to-show');
  t.mock.timers.tick(MAX_SPLASH_MS - 100);
  fixture.signalReady();
  assert.equal(fixture.splashView.webContents.scripts.length, 1);
  t.mock.timers.tick(100);
  assertDisposed(fixture);
  fixture.resolveFade();
  await flushPromises();
  assert.equal(fixture.calls.filter((call) => call === 'splash:close').length, 1);
});

for (const failingTarget of ['mainWindow', 'splashView']) {
  test('a main-frame load failure in ' + failingTarget + ' releases the splash immediately', (t) => {
    const fixture = setup(t);
    fixture.showSplash();
    fixture[failingTarget].webContents.emit('did-fail-load', {}, -105, 'Failed', 'file:///missing.html', true);
    assert.equal(fixture.mainWindow.isVisible(), true);
    assert.equal(fixture.splashView.webContents.scripts.length, 0);
    assertDisposed(fixture);
  });
  test('a renderer crash in ' + failingTarget + ' releases the splash immediately', (t) => {
    const fixture = setup(t);
    fixture.showSplash();
    fixture[failingTarget].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(fixture.mainWindow.isVisible(), true);
    assertDisposed(fixture);
  });
}

test('aborted navigation and child-frame load errors do not bypass readiness', (t) => {
  const { mainWindow, splashView, showSplash } = setup(t);
  showSplash();
  mainWindow.emit('ready-to-show');
  for (const contents of [mainWindow.webContents, splashView.webContents]) {
    contents.emit('did-fail-load', {}, -3, 'Aborted', 'file:///index.html', true);
    contents.emit('did-fail-load', {}, -105, 'Failed', 'https://missing.invalid', false);
  }
  t.mock.timers.tick(MIN_SPLASH_MS);
  assert.equal(splashView.webContents.isDestroyed(), false);
  assert.equal(splashView.webContents.scripts.length, 0);
});

test('a rejected splash load releases the hidden main window', async (t) => {
  const fixture = setup(t, { splashLoadError: new Error('Missing splash file') });
  await flushPromises();
  assert.equal(fixture.mainWindow.isVisible(), true);
  assertDisposed(fixture);
});

test('a rejected animation still releases the splash', async (t) => {
  const fixture = setup(t);
  fixture.beginFade();
  fixture.rejectFade(new Error('Animation failed'));
  await flushPromises();
  assert.equal(fixture.mainWindow.isVisible(), true);
  assertDisposed(fixture);
});

test('a hung animation is removed at its bounded fallback timeout', async (t) => {
  const fixture = setup(t);
  fixture.beginFade();
  t.mock.timers.tick(FADE_TIMEOUT_MS - 1);
  assert.equal(fixture.splashView.webContents.isDestroyed(), false);
  t.mock.timers.tick(1);
  assertDisposed(fixture);
  fixture.resolveFade();
  await flushPromises();
  assert.equal(fixture.calls.filter((call) => call === 'splash:close').length, 1);
});

test('closing before splash load disposes the overlay and never reopens the window', (t) => {
  const fixture = setup(t);
  fixture.mainWindow.close();
  assertDisposed(fixture);
  fixture.showSplash();
  fixture.signalReady();
  t.mock.timers.tick(MAX_SPLASH_MS + MIN_SPLASH_MS);
  assert.equal(fixture.calls.includes('main:show'), false);
});

test('closing during fade disposes resources and ignores its late completion', async (t) => {
  const fixture = setup(t);
  fixture.beginFade();
  fixture.mainWindow.close();
  assertDisposed(fixture);
  fixture.resolveFade();
  await flushPromises();
  t.mock.timers.tick(MAX_SPLASH_MS + FADE_TIMEOUT_MS);
  assert.equal(fixture.calls.filter((call) => call === 'main:show').length, 1);
  assert.equal(fixture.calls.filter((call) => call === 'splash:close').length, 1);
  assert.equal(fixture.calls.includes('main:focus'), false);
});
