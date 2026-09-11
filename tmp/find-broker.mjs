import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9225' });
try {
  const page = (await b.pages()).find(x => x.url().startsWith('file:'));
  const res = await page.evaluate(async () => {
    const scripts = [...document.querySelectorAll('script')].map(s => s.src).filter(Boolean);
    const results = [];
    for (const src of scripts) {
      const txt = await (await fetch(src)).text();
      let idx = 0;
      while (true) {
        const found = txt.indexOf('Broker', idx);
        if (found === -1) break;
        results.push({ src: src.split('/').pop(), snippet: txt.slice(Math.max(0, found - 60), found + 80) });
        idx = found + 1;
        if (results.length >= 10) break;
      }
      if (results.length >= 10) break;
    }
    return results;
  });
  console.log(JSON.stringify(res, null, 2));
} finally {
  await b.disconnect();
}
