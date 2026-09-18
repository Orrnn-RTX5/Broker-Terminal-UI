/** Shared Chromium launch for the trading-browser harness (real browser only). */
import { findSystemChrome } from './resolveDeps.mjs';

export const launchChromium = async (puppeteer, { headless = true, timeoutMs = 30_000 } = {}) => {
  const launchOptions = {
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    protocolTimeout: timeoutMs,
  };
  try {
    return await puppeteer.launch(launchOptions);
  } catch (firstError) {
    const systemChrome = findSystemChrome();
    if (!systemChrome) throw firstError;
    // Puppeteer's bundled Chromium may be missing; an installed desktop
    // Chrome/Edge is still a real Chromium engine — label it in results.
    const browser = await puppeteer.launch({ ...launchOptions, executablePath: systemChrome });
    browser.__tradingBrowserEngine = `system-chrome:${systemChrome}`;
    return browser;
  }
};

/**
 * Real click -> visibly confirmed update, explicitly correlated.
 * - Captures the pre-click confirm text and waits for a CHANGED confirm node
 *   with the expected status, so a stale/unrelated message is never accepted.
 * - Matches the confirm DOM against the operation's own intent exposed via
 *   `window.__tradingBrowser.lastResult` (original client_order_id for WS
 *   opens, ticket for REST actions). Mismatch throws.
 * - Timing is page-measured `performance.now()` parsed from the confirm DOM;
 *   no Node wall-clock timing is mixed in. Resolves with the correlated
 *   result; rejects on stale confirm, intent mismatch, or timeout.
 */
export const clickAndWaitForConfirm = async (page, { button, expect, expectTicket = null, timeoutMs }) => {
  await page.waitForSelector(button, { timeout: timeoutMs });
  const before = await page.$eval('#confirm', (el) => el.textContent || '').catch(() => '');
  await page.evaluate(() => {
    window.__tbConfirmSeen = null;
    if (window.__tradingBrowser) window.__tradingBrowser.lastResult = null;
  });
  await page.click(button);
  try {
    await page.waitForFunction(
      (expected, priorText) => {
        const el = document.getElementById('confirm');
        if (!el || el.dataset.status !== expected) return false;
        if ((el.textContent || '') === priorText) return false;
        // Through-paint protocol: provisional confirms carry
        // data-painted="0" and are never accepted; final confirms carry
        // data-painted="1" (or no marker from older fixtures).
        if (el.dataset.painted === '0') return false;
        return true;
      },
      // Interval polling: headless Chromium may throttle requestAnimationFrame
      // (the default waitForFunction polling), which would never observe the
      // confirm update. 100ms interval keeps timing honest — the measured
      // latency still comes from the page's performance.now confirm DOM.
      { timeout: timeoutMs, polling: 100 },
      expect,
      before,
    );
  } catch (error) {
    const state = await page.$eval(
      '#confirm',
      (el) => `${el.dataset.status} :: ${(el.textContent || '').slice(0, 300)}`,
    ).catch(() => 'no-confirm-node');
    const logTail = await page.$eval('#log', (el) => (el.textContent || '').slice(-500)).catch(() => '');
    throw new Error(`no correlated confirm for ${button} (expected "${expect}"): confirm=${state} log=${logTail}`);
  }
  const confirmText = (await page.$eval('#confirm', (el) => el.textContent || '')).trim();
  const lastResult = await page.evaluate(() => window.__tradingBrowser?.lastResult || null).catch(() => null);
  if (!lastResult) {
    throw new Error(`confirmed "${expect}" but no correlated operation result was exposed for ${button}`);
  }
  const intentId = lastResult.clientOrderId || lastResult.ticket;
  if (!intentId || !confirmText.includes(String(intentId))) {
    throw new Error(`confirm/intent mismatch for ${button}: DOM does not carry the original intent id`);
  }
  if (expectTicket !== null && expectTicket !== undefined && String(expectTicket) !== String(lastResult.ticket || '')) {
    throw new Error(`confirm/intent mismatch for ${button}: expected ticket ${expectTicket}, got ${lastResult.ticket}`);
  }
  const ms = /([\d.]+)ms/.exec(confirmText)?.[1];
  return { confirmText, latencyMs: ms ? Number(ms) : null, lastResult };
};
