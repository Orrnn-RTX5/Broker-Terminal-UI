import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9225' });
try {
  const page = (await b.pages()).find(x => x.url().startsWith('file:'));
  const res = await page.evaluate(async () => {
    const script = [...document.querySelectorAll('script')].find(s => s.src.includes('index-'));
    const txt = await (await fetch(script.src)).text();
    const matches = [];
    let idx = 0;
    const target = '"Broker"';
    while ((idx = txt.indexOf(target, idx + 1)) >= 0) {
      matches.push(txt.slice(Math.max(0, idx - 120), idx + 120));
    }
    return matches;
  });
  console.log(JSON.stringify(res, null, 2));
} finally {
  await b.disconnect();
}
