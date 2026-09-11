import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9225' });
try {
  const page = (await b.pages()).find(x => x.url().startsWith('file:'));
  const res = await page.evaluate(async () => {
    // Search all loaded JS text in memory
    const scripts = [...document.querySelectorAll('script')].map(s => s.src).filter(Boolean);
    const hits = [];
    for (const s of scripts) {
      const text = await (await fetch(s)).text();
      // look for - Hedge - or - RTX Terminal -
      const idx = text.indexOf(' - RTX Terminal -');
      if (idx !== -1) {
        hits.push({ src: s, snippet: text.slice(Math.max(0, idx - 150), idx + 150) });
      }
    }
    return hits;
  });
  console.log(JSON.stringify(res, null, 2));
} finally {
  await b.disconnect();
}
