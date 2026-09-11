import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9225' });
try {
  const page = (await b.pages()).find(x => x.url().startsWith('file:'));
  const res = await page.evaluate(async () => {
    // Check all scripts and modules in window
    const scripts = [...document.querySelectorAll('script')].map(s => s.src).filter(Boolean);
    const matches = [];
    for (const src of scripts) {
      const txt = await (await fetch(src)).text();
      let idx = 0;
      while ((idx = txt.indexOf('Broker', idx + 1)) >= 0) {
        matches.push({ src: src.split('/').pop(), snippet: txt.slice(Math.max(0, idx - 60), idx + 80) });
      }
    }
    // Also check document HTML
    const html = document.documentElement.outerHTML;
    return { matches: matches.slice(0, 20), htmlSnippets: html.includes('Broker') };
  });
  console.log(JSON.stringify(res, null, 2));
} finally {
  await b.disconnect();
}
