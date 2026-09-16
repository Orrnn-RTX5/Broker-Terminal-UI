const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

app.setPath('userData', path.join(__dirname, 'isolated-user-data'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const report = {
  fixture: true,
  description: 'Actual OpenAccountDialog and brokerDirectory service in a hidden native Electron window, using sample broker metadata delayed 900 ms. Isolated storage and blocked external network. Timing is one local component-fixture sample, not live broker latency or an authenticated installed-app measurement.',
  timingMethod: 'performance.now() from open trigger until a MutationObserver sees an aria-pressed selected broker and enabled Next button; request start/end use performance.now() in the delayed mock fetch.',
  passed: false, cases: [], blockedNetwork: [], consoleErrors: [],
};
let win;
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await evaluate(code)) return;
    await pause();
  }
  throw new Error('Fixture did not reach: ' + code);
}
async function open(label) {
  await evaluate(`window.loadingPreview.open(${JSON.stringify(label)})`);
  await until('!!document.querySelector(".rtx-open-account-dialog")');
}
async function ready() {
  await until('window.loadingPreview.measurements.at(-1)?.readyAt !== undefined');
  const result = await evaluate('({state:window.loadingPreview.snapshot(), measurement:window.loadingPreview.measurements.at(-1), calls:window.loadingPreview.calls})');
  assert.equal(result.state.brokerCount, 2);
  assert(result.state.selected.includes('Example Financial Services'));
  assert.equal(result.state.nextEnabled, true);
  assert.equal(result.state.loading, false);
  return result;
}
async function close() {
  await evaluate('window.loadingPreview.close()');
  await until('!document.querySelector(".rtx-open-account-dialog")');
}

app.whenReady().then(async () => {
  const fixtureUrl = 'http://127.0.0.1:5189/artifacts/desktop-broker-loading-20260915/index.html';
  const isolated = session.fromPartition(`broker-loading-fixture-${Date.now()}`);
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    if (new URL(details.url).host === '127.0.0.1:5189') { callback({ cancel: false }); return; }
    report.blockedNetwork.push(details.url);
    callback({ cancel: true });
  });
  win = new BrowserWindow({ width: 1000, height: 760, useContentSize: true, show: false, frame: false,
    webPreferences: { session: isolated, offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) report.consoleErrors.push(message); });

  await win.loadURL(fixtureUrl);
  await until('!!window.loadingPreview && window.loadingPreview.calls.length === 1');
  assert.equal(await evaluate('window.loadingPreview.snapshot().open'), false);
  await open('cold-open-while-preload-pending');
  const coldInitial = await evaluate('window.loadingPreview.snapshot()');
  assert.equal(coldInitial.loading, true);
  assert.equal(coldInitial.nextEnabled, false);
  const cold = await ready();
  assert.equal(cold.state.requests, 1, 'Mount preload and cold opening must share one in-flight request');
  assert(cold.calls[0].startedAt < cold.measurement.openedAt, 'Closed mount must preload before opening');
  report.cases.push({ label: 'cold-open', initial: coldInitial, ...cold });

  await close();
  await open('warm-reopen');
  const warm = await ready();
  assert.equal(warm.state.requests, 1);
  assert.equal(warm.measurement.requestsBefore, warm.measurement.requestsAfter);
  report.cases.push({ label: 'warm-reopen', ...warm });
  await evaluate('document.fonts.ready.then(() => true)');
  fs.writeFileSync(path.join(__dirname, 'native-warm-selected-next-enabled.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());

  await win.loadURL(fixtureUrl + '?mode=preload');
  await until('!!window.loadingPreview && window.loadingPreview.snapshot().cached');
  assert.equal(await evaluate('window.loadingPreview.snapshot().open'), false);
  await open('first-open-after-closed-preload');
  const preloaded = await ready();
  assert.equal(preloaded.state.requests, 1);
  assert(preloaded.calls[0].resolvedAt < preloaded.measurement.openedAt);
  report.cases.push({ label: 'first-open-after-closed-preload', ...preloaded });

  await win.loadURL(fixtureUrl + '?mode=signin');
  await until('!!window.loadingPreview');
  assert.equal(await evaluate('window.loadingPreview.calls.length'), 0);
  const signInLoad = await evaluate('window.loadingPreview.signInLoad()');
  await evaluate('window.loadingPreview.mount()');
  await pause();
  await open('first-open-after-signin-cache');
  const signIn = await ready();
  assert.equal(signIn.state.requests, 1, 'The wizard should reuse the sign-in directory response');
  report.cases.push({ label: 'first-open-after-signin-cache', signInLoad, ...signIn });

  await close();
  const forceRefresh = await evaluate('window.loadingPreview.signInLoad()');
  assert.equal(forceRefresh.requests, 2, 'forceRefresh must bypass the still-fresh cached rows');
  await open('reopen-after-forced-signin-refresh');
  const refreshed = await ready();
  assert.equal(refreshed.state.requests, 2);
  report.cases.push({ label: 'reopen-after-forced-signin-refresh', forceRefresh, ...refreshed });
  report.electron = process.versions.electron;
  report.chromium = process.versions.chrome;
  report.passed = true;
}).catch(error => { report.error = error.stack; }).finally(() => {
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, 'native-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.map(item => ({ label: item.label, elapsedMs: item.measurement.elapsedMs, requests: item.state.requests })), error: report.error }));
  if (win) win.destroy();
  app.exit(report.passed ? 0 : 1);
});
