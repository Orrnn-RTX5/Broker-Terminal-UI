import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9225', defaultViewport: null });
try {
  const p = (await b.pages()).find(p => p.url().startsWith('file:'));
  if (!p) {
    console.log('No file: page found. URLs:', (await b.pages()).map(x => x.url()));
  } else {
    const data = await p.evaluate(() => {
      const storage = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        storage[k] = localStorage.getItem(k);
      }
      return {
        title: document.title,
        desktopTitle: document.querySelector('.rtx-desktop-titlebar__title')?.textContent,
        statusText: document.querySelector('.rtx-status-bar__metric span')?.textContent,
        labels: [...document.querySelectorAll('.navigator-tree-item__label')].map(x => x.textContent),
        storage
      };
    });
    console.log(JSON.stringify(data, null, 2));
  }
} finally {
  await b.disconnect();
}
