import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9225' });
try {
  const page = (await b.pages()).find(x => x.url().startsWith('file:'));
  const res = await page.evaluate(async () => {
    // We can fetch App chunk by guessing or checking performance
    const files = [
      'App-D8fPR1gv.js',
      'App-*.js',
    ];
    // Let's list files in the current folder using electron if available
    return {
      title: document.title,
      electron: Boolean(window.electron)
    };
  });
  console.log(JSON.stringify(res, null, 2));
} finally {
  await b.disconnect();
}
