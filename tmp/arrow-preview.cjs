const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
  const html = path.resolve(__dirname, 'arrow-preview.html');
  const out = path.resolve(__dirname, 'arrow-preview.png');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 980, height: 420, deviceScaleFactor: 2 });
  await page.goto('file:///' + html.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  fs.statSync(out);
  console.log(out);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
