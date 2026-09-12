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

await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[placeholder="Enter Account ID"]', { timeout: 60000 });
await page.type('input[placeholder="Enter Account ID"]', LOGIN);
await page.type('input[placeholder="Enter Password"]', PASS);
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('button'))
    .find(candidate => candidate.textContent.trim().startsWith('Login'));
  if (button) button.click();
});
await page.waitForSelector('[data-chart-panel-id]', { timeout: 120000 });
await sleep(8000);

await page.evaluate(() => {
  const rail = Array.from(document.querySelectorAll('button'))
    .find(button => /Trend Line Tools$/.test(button.getAttribute('aria-label') || ''));
  if (rail) rail.click();
});
await sleep(600);
const armed = await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('button'))
    .find(button => (button.textContent || '').trim().startsWith('Modified Schiff'));
  if (item) item.click();
  return Boolean(item);
});
console.log('tool armed:', armed);
await sleep(400);
const box = await page.$eval('[data-chart-panel-id] canvas', canvas => {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);
await sleep(400);
await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
await sleep(400);
await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.6);
await sleep(1200);

const dump = await page.evaluate(() => ({
  labels: Array.from(document.querySelectorAll('rect[data-geometry-role$="-price-scale-label"]'))
    .map(rect => ({ role: rect.getAttribute('data-geometry-role'), y: Number(rect.getAttribute('y')) })),
  band: (() => {
    const rect = document.querySelector('rect[data-geometry-role="price-scale-range"]');
    return rect ? { y: Number(rect.getAttribute('y')), height: Number(rect.getAttribute('height')) } : null;
  })(),
}));
console.log('PITCHFORK DUMP:', JSON.stringify(dump, null, 2));
await page.screenshot({ path: `${OUT}08-modified-schiff.png` });
await browser.close();
