// Isolated Electron renderer verification. Test credentials and responses never
// reach a broker. Run from the repository root after npm run build:electron.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(__dirname, 'electron-test-profile'));
ipcMain.on('get-app-runtime-info', event => { event.returnValue = { isPackaged: false }; });
ipcMain.on('get-app-version', event => { event.returnValue = '1.0.25'; });
ipcMain.handle('window-is-maximized', () => false);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
const brokers = [
  { broker_id: 'achiever-financials', broker_name: 'Achiever Financials', server_url: 'https://service.achieverfinancials.com' },
  { broker_id: 'gta_broker', broker_name: 'Grow Trading Academy', server_url: 'https://gta.desktop-test.invalid' },
  { broker_id: 'myprop-trade', broker_name: 'MyProp', server_url: 'https://myprop.desktop-test.invalid' },
].map(row => ({ ...row, logo_url: '', enabled: true, active: true }));
let testMode = false;
const events = [];
let window;
const evaluate = source => window.webContents.executeJavaScript(source, true);
async function until(source, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await evaluate(source)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
async function capture(name) {
  await until(`Array.from(document.querySelectorAll('.rtx-login-visual img')).every(img => img.complete && img.naturalWidth > 0)`, 'hero asset loaded');
  await delay(500);
  writeFileSync(path.join(__dirname, name), (await window.webContents.capturePage({ stayHidden: true, stayAwake: true })).toPNG());
}
async function choose(name) {
  await evaluate(`document.querySelector('#rtxBrokerServer').click()`);
  await until(`document.querySelectorAll('[role="option"]').length === 3`, 'broker directory open');
  await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(row => row.textContent.includes(${JSON.stringify(name)})).click()`);
  await until(`document.querySelector('[data-rtx-login-submit]')?.disabled === false`, `${name} healthy`);
}
app.whenReady().then(async () => {
  const isolated = session.fromPartition('desktop-broker-login-verification');
  isolated.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*'] }, (details, callback) => {
    if (testMode) events.push({ phase: 'fixture', kind: 'socket-target', url: details.url.split('?')[0] });
    callback({ cancel: testMode });
  });
  isolated.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (!testMode) {
      const response = await isolated.fetch(request, { bypassCustomProtocolHandlers: true });
      if (url.pathname.endsWith('/broker/servers')) {
        const rows = await response.clone().json();
        events.push({ phase: 'live', kind: 'directory', status: response.status, brokers: rows.map(row => ({ broker_id: row.broker_id, broker_name: row.broker_name, server_url: row.server_url })) });
      } else if (url.pathname === '/health') {
        events.push({ phase: 'live', kind: 'health', url: request.url, status: response.status });
      }
      return response;
    }
    if (url.pathname.endsWith('/broker/servers')) return json(brokers);
    if (url.pathname === '/health') {
      events.push({ phase: 'fixture', kind: 'health', url: request.url });
      await delay(150);
      return json({ status: 'ok' });
    }
    if (url.pathname === '/api/v2/auth/login') {
      const body = await request.json();
      assert.equal(url.origin, brokers[1].server_url);
      assert.equal(body.broker_id, 'gta_broker');
      assert.equal(body.login, 990011);
      events.push({ phase: 'fixture', kind: 'login', url: request.url, broker_id: body.broker_id });
      const token = `test.${Buffer.from(JSON.stringify({ sub: '990011', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
      return json({ access_token: token, broker_id: 'gta_broker', account_login: 990011, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    // Fixture sessions never send credentials, tokens, or trading traffic out.
    if (request.method !== 'GET') return json({ error: 'Fixture request blocked' }, 403);
    if (/\/(logo|logos)(\/|$)/.test(url.pathname)) return new Response(readFileSync(path.join(root, 'public/brand/rtx5-app-icon.png')), { headers: { 'Content-Type': 'image/png' } });
    return json([]);
  });
  window = new BrowserWindow({ width: 1600, height: 1000, show: false, frame: false, webPreferences: { session: isolated, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: true } });
  await window.loadFile(path.join(root, 'dist/index.html'));
  await until(`document.querySelector('[data-rtx-login-submit]')?.disabled === false`, 'live directory and health');
  assert.equal(await evaluate(`document.querySelector('#rtxBrokerServer').value`), 'Achiever Financials');
  await evaluate(`document.querySelector('#rtxBrokerServer').click()`);
  await capture('live-achiever-directory.png');
  events.push({ phase: 'live', options: await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).map(row => row.textContent)`)});

  testMode = true;
  await isolated.clearStorageData();
  await window.loadFile(path.join(root, 'dist/index.html'));
  await until(`document.querySelector('[data-rtx-login-submit]')?.disabled === false`, 'fixture directory and health');
  await evaluate(`document.querySelector('#rtxBrokerServer').click()`);
  await capture('fixture-broker-directory.png');
  await choose('Grow Trading Academy');
  assert.match(await evaluate(`document.querySelector('.rtx-login-visual img').src`), /gta-hero/);
  await capture('fixture-gta-login.png');
  await choose('MyProp');
  assert.match(await evaluate(`document.querySelector('.rtx-login-visual img').src`), /myprop-hero/);
  await capture('fixture-myprop-login.png');
  await choose('Grow Trading Academy');
  await evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [id, value] of [['rtxAccountId', '990011'], ['rtxPassword', 'fixture-password']]) {
      const input = document.getElementById(id);
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await evaluate(`document.querySelector('[data-rtx-login-submit]').click()`);
  await until(`!!document.querySelector('[data-rtx-authenticated-viewport="true"]')`, 'authenticated terminal handoff');
  const routing = await evaluate(`({ broker_id: localStorage.getItem('broker_id'), server_url: localStorage.getItem('server_url'), ws_url: localStorage.getItem('ws_url'), feed_url: localStorage.getItem('feed_url') })`);
  assert.equal(routing.broker_id, 'gta_broker');
  assert.equal(routing.server_url, brokers[1].server_url);
  assert.equal(routing.ws_url, 'wss://gta.desktop-test.invalid/ws/v2');
  assert.equal(routing.feed_url, 'wss://gta.desktop-test.invalid/ws/feed');
  events.push({ phase: 'fixture', kind: 'authenticated-handoff', ...routing });
  writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify({ passed: true, events }, null, 2));
  console.log(JSON.stringify({ passed: true, events }, null, 2));
  window.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify({ passed: false, error: error.message, events }, null, 2));
  if (window) window.destroy();
  app.exit(1);
});
