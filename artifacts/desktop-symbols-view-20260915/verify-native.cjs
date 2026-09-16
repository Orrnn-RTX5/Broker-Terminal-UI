// Isolated native Electron preview of the current MenuBar and SymbolsDialog.
// Sample instruments come from fixture.tsx; native external requests are blocked.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rtx-symbols-preview-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const report = {
  fixture: true,
  description: 'Real MenuBar and SymbolsDialog in hidden native Electron, with sample instrument responses from fixture.tsx. Isolated storage; native external network requests blocked. This is not the installed authenticated trading app.',
  passed: false, cases: [], blockedNetwork: [], consoleErrors: [],
};
let win;
const pause = () => new Promise(resolve => setTimeout(resolve, 120));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await evaluate(code)) return;
    await pause();
  }
  throw new Error('Preview did not become ready: ' + code);
}
async function clickText(label, selector = 'button') {
  await evaluate(`(() => { const button = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(button => button.textContent.trim() === ${JSON.stringify(label)}); if (!button) throw new Error('Missing control: ' + ${JSON.stringify(label)}); button.click(); })()`);
  await pause();
}
async function capture(name) {
  await pause();
  await evaluate('document.fonts.ready.then(() => true)');
  fs.writeFileSync(path.join(__dirname, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}
async function metrics() {
  return evaluate(`(() => {
    const dialog = document.querySelector('.rtx-symbols-dialog');
    const rect = element => { const r = element.getBoundingClientRect(); const s = getComputedStyle(element); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, clientWidth:element.clientWidth, scrollWidth:element.scrollWidth, clientHeight:element.clientHeight, scrollHeight:element.scrollHeight, overflowX:s.overflowX, overflowY:s.overflowY, fontSize:s.fontSize }; };
    const panels = Object.fromEntries(['titlebar','tabs','body','sidebar','filters','catalog','details','footer'].map(name => [name, rect(dialog.querySelector('.rtx-symbols-dialog__' + name))]));
    const footerButtons = Array.from(dialog.querySelectorAll('.rtx-symbols-dialog__footer button')).map(button => ({ text:button.textContent.trim(), ...rect(button) }));
    const visibleButtons = footerButtons.filter(button => button.width > 0 && button.height > 0);
    const d = rect(dialog);
    return { viewport:{width:innerWidth,height:innerHeight,devicePixelRatio}, dialog:d, panels, footerButtons:visibleButtons, pageHorizontalOverflow:document.documentElement.scrollWidth > innerWidth, fitsViewport:d.left>=0 && d.top>=0 && d.right<=innerWidth && d.bottom<=innerHeight, footerButtonsFit:visibleButtons.every(button=>button.left>=d.left && button.right<=d.right && button.top>=d.top && button.bottom<=d.bottom), horizontalOverflow:Object.entries(panels).filter(([name,panel]) => panel.scrollWidth > panel.clientWidth + 1).map(([name])=>name), selectedSymbol:dialog.querySelector('.rtx-symbols-dialog__selected-name')?.textContent, rootClasses:document.documentElement.className };
  })()`);
}

app.whenReady().then(async () => {
  const previewUrl = 'http://127.0.0.1:5189/artifacts/desktop-symbols-view-20260915/index.html';
  report.styleSource = 'Current source styles served by isolated local Vite preview; built CSS and current SymbolsDialog.css are also snapshotted for reference.';
  report.previewUrl = previewUrl;
  const assets = fs.readdirSync(path.join(root, 'dist/assets'));
  const css = ['index-', 'authenticatedStyles-', 'App-'].map(prefix => {
    const name = assets.find(name => name.startsWith(prefix) && name.endsWith('.css'));
    assert(name, 'Missing application CSS: ' + prefix);
    return name;
  });
  const snapshot = path.join(__dirname, 'native-css-snapshot');
  fs.mkdirSync(snapshot, { recursive: true });
  report.css = css.map(name => {
    const original = fs.readFileSync(path.join(root, 'dist/assets', name));
    const content = original.toString('utf8').replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, quote, url) => {
      if (/^(data:|https?:|#)/.test(url)) return match;
      const assetName = path.basename(url.split(/[?#]/)[0]);
      const source = path.join(root, 'dist/assets', assetName);
      if (!fs.existsSync(source)) return match;
      fs.copyFileSync(source, path.join(snapshot, assetName));
      return `url("./${assetName}")`;
    });
    fs.writeFileSync(path.join(snapshot, name), content);
    return { name, sha256: crypto.createHash('sha256').update(original).digest('hex') };
  });
  const currentCss = fs.readFileSync(path.join(root, 'src/components/SymbolsDialog.css'));
  fs.writeFileSync(path.join(__dirname, 'native-current-symbols.css'), currentCss);
  report.sourceCss = { path: 'src/components/SymbolsDialog.css', sha256: crypto.createHash('sha256').update(currentCss).digest('hex') };
  const links = css.map(name => `<link rel="stylesheet" href="./native-css-snapshot/${name}">`).join('') + '<link rel="stylesheet" href="./native-current-symbols.css">';
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
    .replace('</head>', links + '</head>').replace('./fixture.tsx', './native-component.js');
  const previewFile = path.join(__dirname, 'native-preview.html');
  fs.writeFileSync(previewFile, html);
  const isolated = session.fromPartition(`symbols-preview-${Date.now()}`);
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*','ws://*/*','wss://*/*'] }, (details, callback) => {
    if (new URL(details.url).host === '127.0.0.1:5189') { callback({ cancel: false }); return; }
    report.blockedNetwork.push(details.url); callback({ cancel: true });
  });
  win = new BrowserWindow({ width: 1000, height: 760, useContentSize: true, show: false, frame: false,
    webPreferences: { session: isolated, offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) report.consoleErrors.push(message); });
  for (const settings of [
    { theme: 'light', width: 1000, height: 760, font: 'normal' },
    { theme: 'dark', width: 1000, height: 760, font: 'normal' },
    { theme: 'light', width: 760, height: 600, font: 'large' },
  ]) {
    const id = `native-${settings.theme}-${settings.width}x${settings.height}-${settings.font}`;
    win.setContentSize(settings.width, settings.height);
    await win.loadURL(previewUrl);
    await until(`!!document.querySelector('.preview-toolbar button')`);
    if (settings.theme === 'dark') await clickText('Preview dark theme');
    if (settings.font === 'large') {
      await clickText('View', '[data-desktop-menu-button]');
      await clickText('Font Size', '[role="menuitem"]');
      await clickText('Large', '[role="menuitemradio"]');
      await until(`document.documentElement.classList.contains('rtx-advanced-font-large')`);
    }
    if (settings.theme === 'light' && settings.font === 'normal') {
      await clickText('View', '[data-desktop-menu-button]');
      const viewLabels = await evaluate(`Array.from(document.querySelector('[aria-label="View menu"]').querySelectorAll('button')).map(button=>button.textContent.trim())`);
      assert(viewLabels.includes('Font Size') && viewLabels.includes('Focus Chart'));
      assert(!viewLabels.includes('Hide drawing tools') && !viewLabels.includes('Show drawing tools'));
      await capture('native-view-menu');
      await clickText('Theme', '[role="menuitem"]');
      const themeLabels = await evaluate(`Array.from(document.querySelector('[aria-label="Theme menu"]').querySelectorAll('button')).map(button=>button.textContent.trim())`);
      assert.deepEqual(themeLabels, ['Dark Theme', 'Light Theme']);
      await capture('native-view-theme-menu');
      await clickText('View', '[data-desktop-menu-button]');
      report.menu = { viewLabels, themeLabels };
    }
    await clickText('Open Symbols', '.preview-toolbar button');
    await until(`document.querySelector('.rtx-symbols-dialog__selected-name')?.textContent === 'XAUUSD.rtx'`);
    const measured = await metrics();
    report.cases.push({ id, ...measured });
    await capture(id);
    assert(measured.fitsViewport && measured.footerButtonsFit && !measured.pageHorizontalOverflow, JSON.stringify(measured));
    assert.equal(measured.horizontalOverflow.length, 0, id + ': unexpected horizontal overflow');
    console.log(JSON.stringify({ id, dialog: measured.dialog, horizontalOverflow: measured.horizontalOverflow, footerButtonsFit: measured.footerButtonsFit }));
  }
  report.passed = true;
  report.electron = process.versions.electron;
  report.chromium = process.versions.chrome;
}).catch(error => { report.error = error.stack; }).finally(() => {
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, 'native-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, error: report.error }));
  if (win) win.destroy();
  app.exit(report.passed ? 0 : 1);
});
