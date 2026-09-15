import puppeteer from 'puppeteer-core';

const OUT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const LOGIN = process.env.RTX_LOGIN;
const PASS = process.env.RTX_PASS;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  defaultViewport: { width: 1600, height: 900 },
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', error => console.log('PAGEERROR:', error.message));
page.on('console', message => {
  const text = message.text();
  if (/error|fail|denied|invalid/i.test(text)) console.log('CONSOLE:', text.slice(0, 200));
});

await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[placeholder="Enter Account ID"]', { timeout: 60000 });
await page.type('input[placeholder="Enter Account ID"]', LOGIN);
await page.type('input[placeholder="Enter Password"]', PASS);
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('button'))
    .find(candidate => candidate.textContent.trim().startsWith('Login'));
  if (button) button.click();
});
await sleep(20000);
const state = await page.evaluate(() => ({
  loginForm: Boolean(document.querySelector('input[placeholder="Enter Account ID"]')),
  errorText: Array.from(document.querySelectorAll('div'))
    .map(node => node.textContent || '')
    .find(text => /invalid|failed|denied|error/i.test(text) && text.length < 200) || null,
  authenticated: Boolean(document.querySelector('[data-rtx-authenticated-viewport="true"]')),
  panels: document.querySelectorAll('[data-chart-panel-id]').length,
  bodySnippet: (document.body.textContent || '').slice(0, 300),
}));
console.log('STATE:', JSON.stringify(state, null, 2));
await page.screenshot({ path: `${OUT}11-login-probe.png` });
await browser.close();
