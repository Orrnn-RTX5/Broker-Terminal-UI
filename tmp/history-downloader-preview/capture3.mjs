import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  
  const fileUrl = 'file://' + path.resolve(__dirname, 'preview3.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  
  const outputPath = path.resolve(__dirname, 'preview3.png');
  await page.screenshot({ path: outputPath });
  console.log(outputPath);
  
  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
