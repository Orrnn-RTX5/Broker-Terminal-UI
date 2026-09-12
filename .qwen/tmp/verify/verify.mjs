import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const LOGIN = process.env.RTX_LOGIN;
const PASS = process.env.RTX_PASS;
const SERVER = 'Achiever Financials';
const results = [];
const note = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  defaultViewport: { width: 1600, height: 900 },
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
page.on('pageerror', error => console.log('PAGEERROR:', error.message));

try {
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[placeholder="Enter Account ID"]', { timeout: 60000 });
  await page.type('input[placeholder="Enter Account ID"]', LOGIN);
  await page.type('input[placeholder="Enter Password"]', PASS);
  await page.screenshot({ path: `${OUT}01-login.png` });
  const submitted = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(candidate => candidate.textContent.trim().startsWith('Login'));
    if (!button) return false;
    button.click();
    return true;
  });
  if (!submitted) throw new Error('login submit button not found');

  await page.waitForSelector('[data-rtx-authenticated-viewport="true"]', { timeout: 120000 });
  await page.waitForSelector('[data-chart-panel-id]', { timeout: 120000 });
  await sleep(8000);
  await page.screenshot({ path: `${OUT}02-terminal.png` });
  note('login and terminal shell', true);

  // A) Arrange Windows steps one chart per click
  const countPanels = () => page.$$eval('[data-chart-panel-id]', nodes => nodes.length);
  const clickArrange = () => page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(candidate => /arrange windows/i.test(candidate.getAttribute('title') || '')
        || /arrange windows/i.test(candidate.getAttribute('aria-label') || ''));
    if (!button) return false;
    button.click();
    return true;
  });
  const before = await countPanels();
  const arrangeFound = await clickArrange();
  if (!arrangeFound) {
    const titles = await page.$$eval('button', buttons => buttons
      .map(button => button.getAttribute('title') || button.getAttribute('aria-label') || '')
      .filter(Boolean).slice(0, 60));
    note('arrange windows button present', false, JSON.stringify(titles));
  }
  await sleep(1200);
  const afterOne = await countPanels();
  await clickArrange();
  await sleep(1200);
  const afterTwo = await countPanels();
  await page.screenshot({ path: `${OUT}03-arrange-windows.png` });
  note('arrange windows steps 1->2->3', arrangeFound && afterOne === before + 1 && afterTwo === before + 2,
    `panels ${before} -> ${afterOne} -> ${afterTwo}`);

  // B) OHLC legend via F8 -> Chart Properties -> Show section -> Show OHLC
  const panelBox = await page.$eval('[data-chart-panel-id]', node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.click(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
  await sleep(500);
  await page.evaluate(() => {
    globalThis.__keys = [];
    document.addEventListener('keydown', event => globalThis.__keys.push(event.key), true);
  });
  await page.keyboard.press('F8');
  await sleep(1500);
  const probe = await page.evaluate(() => ({
    keys: globalThis.__keys,
    dialog: Boolean(Array.from(document.querySelectorAll('[role="dialog"], .rtx-chart-properties, [class*="properties"]'))
      .find(node => (node.textContent || '').includes('Show OHLC'))),
  }));
  console.log('F8 PROBE:', JSON.stringify(probe));
  let toggled = null;
  if (probe.dialog) {
    toggled = await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .find(input => (input.closest('label')?.textContent || '').includes('Show OHLC'));
      if (!target) return null;
      target.click();
      return 'checkbox';
    });
    await sleep(800);
    await page.evaluate(() => {
      const close = document.querySelector('button[aria-label="Close chart properties"]')
        || Array.from(document.querySelectorAll('[role="dialog"] button, button'))
          .find(button => ['Close', 'OK', 'Apply'].includes(button.textContent.trim()));
      if (close) close.click();
    });
  } else {
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyL');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    toggled = 'alt-shift-l';
  }
  console.log('OHLC TOGGLE:', toggled);
  await sleep(1200);
  const ohlcDebug = await page.evaluate(() => ({
    huds: Array.from(document.querySelectorAll('.rtx-chart-hud')).map(hud => hud.textContent),
    stored: (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem('rtx-chart-settings') || '{}');
        const state = parsed.state || parsed;
        return Object.entries(state.symbolProperties || {})
          .filter(([, value]) => value && value.showOHLC === true)
          .map(([key]) => key);
      } catch { return 'parse-error'; }
    })(),
  }));
  console.log('OHLC DEBUG:', JSON.stringify(ohlcDebug));
  const ohlcOn = ohlcDebug.huds.some(text => text.includes('O:'));
  await sleep(25000);
  const ohlcStillOn = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.rtx-chart-hud')).some(hud => hud.textContent.includes('O:')));
  await page.screenshot({ path: `${OUT}04-ohlc.png` });
  note('OHLC visible right after F8', ohlcOn);
  note('OHLC still visible after 25s settle', ohlcStillOn);

  // C) Price-scale range band for a selected ray
  const findAndClickRay = () => page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button'))
      .filter(button => (button.textContent || '').trim().startsWith('Ray'));
    if (!candidates.length) return false;
    candidates[0].click();
    return true;
  });
  await page.click('[aria-label$="Trend Line Tools"]').catch(() => {});
  await sleep(800);
  let rayClicked = await findAndClickRay();
  if (!rayClicked) {
    await page.evaluate(() => {
      const rail = Array.from(document.querySelectorAll('button'))
        .find(button => /Trend Line Tools$/.test(button.getAttribute('aria-label') || ''));
      if (rail) rail.click();
    });
    await sleep(800);
    rayClicked = await findAndClickRay();
  }
  const rayDebug = await page.evaluate(() => ({
    portals: document.querySelectorAll('[class*="web-drawing-tools"]').length,
    menuButtons: Array.from(document.querySelectorAll('[class*="web-drawing-tools"] button'))
      .map(button => (button.textContent || '').trim()).slice(0, 30),
  }));
  console.log('RAY DEBUG:', JSON.stringify({ clicked: rayClicked, ...rayDebug }));
  note('ray tool selectable from trend menu', rayClicked);
  await sleep(400);
  let box = null;
  try {
    await page.waitForSelector('[data-chart-panel-id] canvas', { timeout: 60000 });
    box = await page.$eval('[data-chart-panel-id] canvas', canvas => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  } catch {
    note('chart canvas ready for drawing', false, 'chart still preparing or market data unavailable');
  }
  if (box) {
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await sleep(500);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await sleep(1200);
  }
  const band = await page.evaluate(() => {
    const rect = document.querySelector('rect[data-geometry-role="price-scale-range"]');
    if (!rect) return null;
    return { y: Number(rect.getAttribute('y')), height: Number(rect.getAttribute('height')) };
  });
  await page.screenshot({ path: `${OUT}05-ray-band.png` });
  note('price-scale range band rendered for selected ray', Boolean(band), JSON.stringify(band));

  // D) TradingView reference page state
  const tv = await browser.newPage();
  await tv.setViewport({ width: 1600, height: 900 });
  const response = await tv.goto('https://in.tradingview.com/chart/P8prO2VP/?symbol=BITSTAMP%3ABTCUSD',
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(error => null);
  await sleep(12000);
  await tv.screenshot({ path: `${OUT}06-tradingview.png` });
  note('tradingview reference captured', true, `status=${response ? response.status() : 'no-response'}`);
} catch (error) {
  note('verification flow', false, error.message);
  await page.screenshot({ path: `${OUT}99-error.png` }).catch(() => {});
}

writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
await browser.close();
