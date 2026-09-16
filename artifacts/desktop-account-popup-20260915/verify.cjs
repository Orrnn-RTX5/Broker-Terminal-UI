// Real DesktopQuickActions component in an isolated native Electron fixture.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rtx-account-popup-')));
let win;
const report = { fixture: true, passed: false, cases: [] };
const evaluate = code => win.webContents.executeJavaScript(code, true);
const until = async code => {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await evaluate(code)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Fixture did not become ready: ' + code);
};
app.whenReady().then(async () => {
  await require('esbuild').build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { DesktopQuickActions } from './src/components/layout/DesktopQuickActions';
      window.fixtureAccounts = 0; window.fixtureLogouts = 0;
      window.addEventListener('toggleAccountPanel', () => window.fixtureAccounts++);
      createRoot(document.getElementById('root')).render(<DesktopQuickActions
        accountId="900001" accountName="Example Account Holder"
        accountServer="Example Financial Services - Live Trading Server"
        savedAccountCount={Number(new URLSearchParams(location.search).get('count') || 1)}
        onLogout={() => window.fixtureLogouts++} />);
    ` }, bundle: true, jsx: 'automatic', outfile: path.join(__dirname, 'component.js'),
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'fixture-english-copy', setup(build) {
      build.onResolve({ filter: /useUiTranslation$/ }, () => ({ path: 'translation', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const translateUi = (text, values = {}) => typeof text === 'string' ? text.replace(/{{(.*?)}}/g, (_, key) => values[key] ?? key) : text;
        export const useUiTranslation = () => translateUi;
      ` }));
    } }],
  });
  const assets = fs.readdirSync(path.join(root, 'dist/assets'));
  const links = ['index-', 'authenticatedStyles-', 'App-'].map(prefix => {
    const name = assets.find(name => name.startsWith(prefix) && name.endsWith('.css'));
    assert(name, 'Missing built CSS ' + prefix);
    return `<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'dist/assets', name)).href}">`;
  }).join('');
  const isolated = session.fromPartition('account-popup-fixture');
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_, callback) => callback({ cancel: true }));
  win = new BrowserWindow({ width: 460, height: 430, show: false, frame: false,
    webPreferences: { session: isolated, offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (_event, ...details) => console.error(...details));
  for (const [size, count, width] of [['normal', 1, 460], ['large', 120, 320], ['small', 1, 460]]) {
    win.setSize(width, 430);
    const html = `<!doctype html><html class="rtx-desktop-shell-active rtx-advanced-view rtx-skin-untitled-light rtx-advanced-font-${size}"><head>${links}</head><body><div style="padding:10px">Account popup fixture</div><div id="root" style="position:fixed;top:42px;right:10px;height:32px"></div><script src="component.js"></script></body></html>`;
    const fixture = path.join(__dirname, `fixture-${size}.html`);
    fs.writeFileSync(fixture, html);
    await win.loadFile(fixture, { query: { count: String(count) } });
    await until(`!!document.querySelector('.rtx-desktop-account-button')`);
    await evaluate(`document.querySelector('.rtx-desktop-account-button').click()`);
    await until(`!!document.querySelector('.rtx-desktop-quick-menu')`);
    const measured = await evaluate(`(() => {
      const menu = document.querySelector('.rtx-desktop-quick-menu');
      const badge = document.querySelector('.rtx-desktop-account-badge');
      const heading = document.querySelector('.rtx-desktop-quick-menu__heading');
      const id = document.querySelector('.rtx-desktop-quick-menu__account-id');
      const danger = document.querySelector('.rtx-desktop-quick-menu__item--danger');
      const bounds = menu.getBoundingClientRect();
      return { size: ${JSON.stringify(size)}, count: badge.textContent, badgeFont: getComputedStyle(badge).fontSize,
        badgeFits: badge.scrollWidth <= badge.clientWidth && badge.scrollHeight <= badge.clientHeight,
        menuFits: bounds.left >= 8 && bounds.right <= innerWidth - 8 && bounds.bottom <= innerHeight - 8,
        textFits: Array.from(menu.querySelectorAll('.rtx-desktop-quick-menu__identity, .rtx-desktop-quick-menu__meta')).every(el => el.scrollWidth <= el.clientWidth),
        aligned: heading.getBoundingClientRect().left === id.getBoundingClientRect().left,
        nameLines: menu.querySelectorAll('.rtx-desktop-quick-menu__meta').length,
        dangerColor: getComputedStyle(danger).color,
        expectedDanger: getComputedStyle(document.documentElement).getPropertyValue('--color-loss').trim(),
        textSize: getComputedStyle(id).fontSize, headingWeight: getComputedStyle(heading).fontWeight };
    })()`);
    assert(measured.badgeFits && measured.menuFits && measured.textFits && measured.aligned, JSON.stringify(measured));
    assert.equal(measured.badgeFont, '10px');
    assert.equal(measured.nameLines, 2);
    assert.equal(measured.headingWeight, '500');
    assert.equal(measured.textSize, { small: '13px', normal: '14px', large: '15px' }[size]);
    const expectedDanger = measured.expectedDanger.replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`);
    assert.equal(measured.dangerColor, expectedDanger);
    fs.writeFileSync(path.join(__dirname, `desktop-account-${size}.png`), (await win.webContents.capturePage({ stayHidden: true, stayAwake: true })).toPNG());
    await evaluate(`document.querySelector('.rtx-desktop-quick-menu__item').click()`);
    await until(`!document.querySelector('.rtx-desktop-quick-menu')`);
    assert.equal(await evaluate('window.fixtureAccounts'), 1);
    await evaluate(`document.querySelector('.rtx-desktop-account-button').click()`);
    await until(`!!document.querySelector('.rtx-desktop-quick-menu')`);
    await evaluate(`document.querySelector('.rtx-desktop-quick-menu__item--danger').click()`);
    await until(`!document.querySelector('.rtx-desktop-quick-menu')`);
    assert.equal(await evaluate('window.fixtureLogouts'), 1);
    report.cases.push(measured);
  }
  report.passed = true;
}).catch(error => { report.error = error.stack; }).finally(() => {
  fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (win) win.destroy();
  app.exit(report.passed ? 0 : 1);
});
