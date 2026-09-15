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
const dumpBand = () => page.evaluate(() => {
  const rect = document.querySelector('rect[data-geometry-role="price-scale-range"]');
  return rect ? { y: Number(rect.getAttribute('y')), height: Number(rect.getAttribute('height')) } : null;
});

const cases = [
  { tool: 'Fib retracement', clicks: [[0.3, 0.35], [0.55, 0.55]] },
  { tool: 'Trend-based fib extension', clicks: [[0.25, 0.5], [0.45, 0.3], [0.6, 0.45]] },
];
for (const { tool, clicks } of cases) {
  await page.evaluate(() => {
    const rail = Array.from(document.querySelectorAll('button'))
      .find(button => /Gann and Fibonacci Tools$/.test(button.getAttribute('aria-label') || ''));
    if (rail) rail.click();
  });
  await sleep(500);
  const armed = await page.evaluate((wanted) => {
    const item = Array.from(document.querySelectorAll('button'))
      .find(button => (button.textContent || '').trim().startsWith(wanted));
    if (item) item.click();
    return Boolean(item);
  }, tool);
  await sleep(300);
  for (const [fx, fy] of clicks.slice(0, -1)) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await sleep(300);
  }
  const construction = clicks.length > 2 ? await dumpBand() : 'n/a';
  const [lx, ly] = clicks[clicks.length - 1];
  await page.mouse.click(box.x + box.width * lx, box.y + box.height * ly);
  await sleep(900);
  console.log(`${tool} :: armed=${armed} :: construction=${JSON.stringify(construction)} :: selected=${JSON.stringify(await dumpBand())}`);
  if (tool !== cases[cases.length - 1].tool) {
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.evaluate(() => {
      const cursor = Array.from(document.querySelectorAll('button'))
        .find(button => (button.getAttribute('aria-label') || '') === 'Cursor');
      if (cursor) cursor.click();
    });
    await sleep(200);
  }
}
await page.screenshot({ path: `${OUT}10-fibonacci.png` });
await browser.close();
