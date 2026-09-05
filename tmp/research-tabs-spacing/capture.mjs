import puppeteer from 'puppeteer';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const html = pathToFileURL(resolve('tmp/research-tabs-spacing/preview.html')).href;
const out = resolve('tmp/research-tabs-spacing/preview.png');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--disable-gpu', '--no-sandbox', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1480, height: 760, deviceScaleFactor: 1 });
await page.goto(html, { waitUntil: 'networkidle0' });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
