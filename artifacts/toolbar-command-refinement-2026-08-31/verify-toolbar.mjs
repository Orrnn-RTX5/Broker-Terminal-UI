import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const accountId = process.env.RTX5_QA_ACCOUNT;
const password = process.env.RTX5_QA_PASSWORD;
const baseUrl = process.env.RTX5_QA_URL || 'http://127.0.0.1:5173/';
const outputDirectory = process.env.RTX5_QA_OUTPUT_DIR || 'artifacts/toolbar-command-refinement-2026-08-31';
const screenshotPrefix = process.env.RTX5_QA_PREFIX || 'implementation';

if (!accountId || !password) {
  throw new Error('RTX5_QA_ACCOUNT and RTX5_QA_PASSWORD are required.');
}

mkdirSync(outputDirectory, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--disable-gpu', '--no-sandbox'],
});

const page = await browser.newPage();
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.setViewport({ width: 1916, height: 919, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('rtx5-last-symbol', JSON.stringify({
    state: {
      lastSymbol: 'XAUUSD',
      lastTradeSide: 'BUY',
      lastTradeTime: Date.now(),
      volume: 0.01,
      useRiskSizing: false,
      riskPercent: 1,
      autoSLTP: false,
      slPips: 30,
      tpPips: 60,
    },
    version: 0,
  }));
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const loginForm = await page.$('[data-rtx-login-form]');
  if (loginForm) {
    await page.waitForFunction(() => {
      const broker = document.querySelector('#rtxBrokerServer');
      const submit = document.querySelector('[data-rtx-login-submit]');
      return broker instanceof HTMLInputElement
        && broker.value.trim().length > 0
        && submit instanceof HTMLButtonElement
        && !submit.disabled;
    }, { timeout: 30_000 });

    await page.click('#rtxAccountId', { clickCount: 3 });
    await page.type('#rtxAccountId', accountId);
    await page.type('#rtxPassword', password);
    await page.click('[data-rtx-login-submit]');
  }

  try {
    await page.waitForSelector('[aria-label="Chart commands"]', { visible: true, timeout: 90_000 });
  } catch (error) {
    const loginError = await page.$eval('.rtx-login-error, [role="alert"]', (element) => element.textContent?.trim() || '').catch(() => '');
    await page.screenshot({ path: `${outputDirectory}/login-blocked.png` });
    throw new Error(`Authenticated toolbar did not render.${loginError ? ` ${loginError}` : ''}`, { cause: error });
  }

  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  const toolbar = await page.$('.rtx-top-chrome');
  if (!toolbar) throw new Error('Top toolbar was not found after authentication.');

  const fullScreenshotPath = `${outputDirectory}/${screenshotPrefix}-authenticated-full.png`;
  const toolbarScreenshotPath = `${outputDirectory}/${screenshotPrefix}-toolbar-default.png`;
  const activeScreenshotPath = `${outputDirectory}/${screenshotPrefix}-toolbar-last-symbol-active.png`;
  const hoverScreenshotPath = `${outputDirectory}/${screenshotPrefix}-toolbar-new-order-hover.png`;

  await page.screenshot({ path: fullScreenshotPath });
  await toolbar.screenshot({ path: toolbarScreenshotPath });

  const defaultMetrics = await page.evaluate(() => {
    const cluster = document.querySelector('[aria-label="Chart commands"]');
    const actions = Array.from(cluster?.querySelectorAll('.rtx-toolbar-action, .rtx-toolbar-icon-button') || []);
    return {
      title: document.title,
      toolbar: (() => {
        const rect = document.querySelector('.rtx-top-chrome')?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height } : null;
      })(),
      actions: actions.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const svg = element.querySelector('svg');
        return {
          label: element.getAttribute('aria-label'),
          width: rect.width,
          height: rect.height,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          color: style.color,
          background: style.backgroundColor,
          borderColor: style.borderColor,
          pressed: element.getAttribute('aria-pressed'),
          checked: element.getAttribute('aria-checked'),
          iconWidth: svg?.getBoundingClientRect().width ?? null,
          iconHeight: svg?.getBoundingClientRect().height ?? null,
          iconStrokeWidths: svg
            ? [...new Set(Array.from(svg.querySelectorAll('[stroke]:not([stroke="none"])')).map((part) => getComputedStyle(part).strokeWidth))]
            : [],
        };
      }),
      timeframes: Array.from(document.querySelectorAll('.rtx-timeframe-option')).map((element) => {
        const style = getComputedStyle(element);
        return {
          label: element.textContent?.trim() || '',
          color: style.color,
          checked: element.getAttribute('aria-checked'),
        };
      }),
      symbolBadge: (() => {
        const badge = cluster?.querySelector('.rtx-toolbar-symbol-badge');
        if (!(badge instanceof HTMLElement)) return null;
        const rect = badge.getBoundingClientRect();
        const style = getComputedStyle(badge);
        return {
          text: badge.textContent?.trim() || '',
          width: rect.width,
          height: rect.height,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      })(),
    };
  });

  await page.hover('button[aria-label="New Order (F9)"]');
  await toolbar.screenshot({ path: hoverScreenshotPath });

  const newOrderEventDispatched = await page.evaluate(() => new Promise((resolve) => {
    const button = document.querySelector('button[aria-label="New Order (F9)"]');
    if (!(button instanceof HTMLButtonElement)) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => resolve(false), 2_000);
    window.addEventListener('openNewOrder', () => {
      window.clearTimeout(timer);
      resolve(true);
    }, { once: true });
    button.click();
  }));
  const orderDialog = await page.waitForSelector('.rtx-order-dialog', { visible: true, timeout: 5_000 }).catch(() => null);
  const newOrderOpened = Boolean(orderDialog);
  if (orderDialog) {
    await page.evaluate(() => {
      const dialog = document.querySelector('.rtx-order-dialog');
      const closeButton = dialog?.querySelector(':scope > div:first-child > div > button:last-child');
      if (closeButton instanceof HTMLButtonElement) closeButton.click();
    });
    const stillOpen = await page.$('.rtx-order-dialog');
    if (stillOpen) {
      await page.evaluate(() => {
        const backdrop = document.querySelector('.rtx-order-dialog')?.parentElement;
        if (backdrop instanceof HTMLElement) backdrop.click();
      });
    }
    await page.waitForSelector('.rtx-order-dialog', { hidden: true, timeout: 10_000 });
  }

  const lastSymbolButton = 'button[aria-label^="Last Symbol Trader Panel"]';
  const lastSymbolInitiallyOpen = await page.$eval(lastSymbolButton, (element) => element.getAttribute('aria-pressed') === 'true');
  if (!lastSymbolInitiallyOpen) {
    await page.$eval(lastSymbolButton, (element) => (element instanceof HTMLButtonElement) && element.click());
    await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true', { timeout: 10_000 }, lastSymbolButton);
  }
  await toolbar.screenshot({ path: activeScreenshotPath });
  const lastSymbolOpened = await page.$eval(lastSymbolButton, (element) => element.getAttribute('aria-pressed') === 'true');
  await page.$eval(lastSymbolButton, (element) => (element instanceof HTMLButtonElement) && element.click());
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-pressed') === 'false', { timeout: 10_000 }, lastSymbolButton);

  await page.$eval('button[role="radio"][aria-label="Line Chart"]', (element) => (element instanceof HTMLButtonElement) && element.click());
  await page.waitForFunction(() => document.querySelector('button[role="radio"][aria-label="Line Chart"]')?.getAttribute('aria-checked') === 'true', { timeout: 10_000 });
  const lineChartSelected = await page.$eval('button[role="radio"][aria-label="Line Chart"]', (element) => element.getAttribute('aria-checked') === 'true');
  await page.$eval('button[role="radio"][aria-label="Candlesticks"]', (element) => (element instanceof HTMLButtonElement) && element.click());
  await page.waitForFunction(() => document.querySelector('button[role="radio"][aria-label="Candlesticks"]')?.getAttribute('aria-checked') === 'true', { timeout: 10_000 });

  process.stdout.write(JSON.stringify({
    baseUrl,
    authenticatedAccount: accountId,
    screenshots: {
      full: fullScreenshotPath,
      toolbarDefault: toolbarScreenshotPath,
      toolbarHover: hoverScreenshotPath,
      toolbarActive: activeScreenshotPath,
    },
    interactions: {
      newOrderEventDispatched,
      newOrderOpened,
      lastSymbolOpened,
      lineChartSelected,
    },
    metrics: defaultMetrics,
    consoleErrors,
  }, null, 2));
} finally {
  await browser.close();
}
