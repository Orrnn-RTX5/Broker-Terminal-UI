import puppeteer from 'puppeteer';

const url = 'http://127.0.0.1:5173/artifacts/chart-grid-continuity-2026-08-31/index.html';
const screenshotPath = 'artifacts/chart-grid-continuity-2026-08-31/04-square-grid.png';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--disable-gpu'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.setViewport({ width: 1915, height: 917, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="grid-qa"]')?.dataset.ready === 'true',
    { timeout: 10_000 },
  );

  const qa = await page.evaluate(() => {
    const fixture = document.querySelector('[data-testid="grid-qa"]');
    return {
      cellSize: fixture?.dataset.cellSize ?? null,
      lastCandleCoordinate: fixture?.dataset.lastCandleCoordinate ?? null,
      visibleRange: fixture?.dataset.visibleRange ?? null,
      canvases: Array.from(document.querySelectorAll('canvas')).map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
      }),
    };
  });

  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({ url, screenshotPath, qa, errors }, null, 2));
} finally {
  await browser.close();
}
