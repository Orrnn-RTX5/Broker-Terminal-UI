import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function capture() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 600, deviceScaleFactor: 2 });
  const previewPath = path.join(__dirname, 'preview.html');
  await page.goto(`file://${previewPath}`, { waitUntil: 'networkidle0' });
  const outPath = path.join(__dirname, 'preview.png');
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
  console.log(outPath);
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
