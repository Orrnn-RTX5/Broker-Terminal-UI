const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`CONSOLE[${msg.type()}]: ${text.slice(0, 400)}`);
  });
  page.on('pageerror', (err) => console.log(`PAGE EXCEPTION: ${err.message.slice(0, 800)}`));
  page.on('requestfailed', (req) => console.log(`REQUEST FAILED: ${req.url().slice(0, 120)} ${req.failure()?.errorText}`));
  await page.evaluateOnNewDocument(() => {
    window.localStorage.setItem('auth_token', 'fake-token');
    window.localStorage.setItem('refresh_token', 'fake-refresh');
    window.localStorage.setItem('token_expires_at', String(Date.now() + 86400000));
  });
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 6000));
  const info = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      rootChildren: root ? root.children.length : -1,
      bodyText: (document.body.innerText || '').slice(0, 300),
      htmlLength: document.body.innerHTML.length,
    };
  });
  console.log('PAGE INFO:', JSON.stringify(info));
  await browser.close();
})().catch((err) => {
  console.error('DIAG FAILED:', err.message);
  process.exit(1);
});
