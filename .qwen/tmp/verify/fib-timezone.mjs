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

const box = await page.$eval('[data-chart-panel-id] canvas', canvas => {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});

await page.evaluate(() => {
  const rail = Array.from(document.querySelectorAll('button'))
    .find(button => /Gann and Fibonacci Tools$/.test(button.getAttribute('aria-label') || ''));
  if (rail) rail.click();
});
await sleep(500);
const armed = await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('button'))
    .find(button => (button.textContent || '').trim().startsWith('Fib time zone'));
  if (item) item.click();
  return Boolean(item);
});
await sleep(300);
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
await sleep(400);
await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5);
await sleep(1000);

const dump = await page.evaluate(() => {
  const lines = Array.from(document.querySelectorAll('line[data-geometry-role^="fib-time-zone-level-"]'))
    .map(line => ({ role: line.getAttribute('data-geometry-role'), x1: Number(line.getAttribute('x1')), x2: Number(line.getAttribute('x2')), y1: Number(line.getAttribute('y1')), y2: Number(line.getAttribute('y2')) }));
  const priceBand = document.querySelector('rect[data-geometry-role="price-scale-range"]');
  const timeBand = document.querySelector('rect[data-geometry-role="time-scale-range"]');
  const plot = document.querySelector('[data-chart-panel-id] canvas').getBoundingClientRect();
  return {
    armed: true,
    plot: { x: plot.x, width: plot.width },
    lines,
    priceBand: priceBand ? { y: Number(priceBand.getAttribute('y')), height: Number(priceBand.getAttribute('height')) } : null,
    timeBand: timeBand ? { x: Number(timeBand.getAttribute('x')), width: Number(timeBand.getAttribute('width')) } : null,
    timeLabels: Array.from(document.querySelectorAll('rect[data-geometry-role$="-time-scale-label"]')).length,
  };
});
console.log('FIB TIME ZONE DUMP:', JSON.stringify(dump, null, 2));
await page.screenshot({ path: `${OUT}12-fib-time-zone.png` });
await browser.close();
