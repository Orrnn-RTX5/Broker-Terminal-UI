/**
 * Bounded LIVE ISOLATED GATEWAY Chromium mode (service fixture, NOT FULL UI).
 *
 * LABEL: NOT FULL UI. This mode does NOT boot App/AppShell and does NOT claim
 * full production UI rendering. It reuses the same service fixture as
 * transport mode (`fixturePage.mjs`): the REAL frontend `tradeSocket`
 * (TradeWebSocketClient) + `tradingV2Api` imported via Vite, driven by REAL
 * clicks on explicit fixture buttons (#btn-open/#btn-close/#btn-modify/
 * #btn-pending). No arbitrary UI heuristics: no heuristically discovered
 * controls, no `[data-testid="trade-confirm"], #confirm, [role="status"]`
 * existence checks. Every timed sample requires an authoritative correlated
 * confirmation (DOM carries the original intent client_order_id/ticket and
 * `__tradingBrowser.lastResult` matches it; modify/pending responses are
 * validated for ticket/type before confirm).
 *
 * Timing: browser `performance.now()` submitted->DOM THROUGH paint. The fixture
 * writes the final confirm only after two animation frames, so the reported ms
 * includes DOM-update paint (see `confirmThroughPaint`); provisional text is
 * never accepted (browserLaunch waits for painted final).
 *
 * Bounded live contract (all required, else fail closed with unsupported:true):
 *   --gateway-url <loopback http URL> (http only, loopback/RFC1918/link-local)
 *   --identity <PATH to private JSON file> (object or [login,token]/[{...}];
 *     read silently, NEVER logged)
 *   --symbol PERFUSD (exact; live instrument only)
 * Live constants (explicit): base price 100, modify SL 95 / TP 105 (buy
 * protections relative to 100), pending buy_limit 90, full close of the actual
 * setup ticket, pending cleanup cancel outside the timed window.
 *
 * Setup vs timed separation: market opens that prepare positions are recorded
 * as setupSamples (outside measured windows) and never mixed into timed
 * samples. Timed modify/close/pending samples are returned raw with per-intent
 * transport IDs; timings are uncertified (certified:false).
 *
 * Never logs tokens. Never runs live credentials/services by itself: without
 * explicit --gateway-url/--identity/--symbol it fails closed.
 */

import { readFile } from 'node:fs/promises';
import { resolveChromium, resolveVite } from './resolveDeps.mjs';
import { VITE_FIXTURE_PATH, buildServiceFixtureHtml } from './fixturePage.mjs';
import { launchChromium, clickAndWaitForConfirm } from './browserLaunch.mjs';
import {
  deriveLiveWsUrl,
  isLiveSymbol,
  isLocalGatewayUrl,
  isLoopbackHostname,
  LIVE_BASE_PRICE,
  LIVE_MODIFY_SL,
  LIVE_MODIFY_TP,
  LIVE_PENDING_PRICE,
  LIVE_PENDING_SIDE,
  LIVE_PENDING_TYPE,
  LIVE_SYMBOL,
  normalizeLiveIdentity,
  redactIdentity,
  summarizeMs,
} from './validation.mjs';

const unsupported = (reason) => ({
  ok: false,
  mode: 'live-isolated-gateway',
  unsupported: true,
  reason,
  requestedGateway: '[withheld]',
});

export const runLiveIsolatedGateway = async (args = {}) => {
  const gatewayUrl = String(args?.gatewayUrl ?? '').trim();
  const identityPath = String(args?.identity ?? '').trim();
  const symbol = String(args?.symbol ?? '').trim();
  const samples = Math.max(1, Math.min(50, Number.parseInt(args?.samples, 10) || 1));
  const timeoutMs = Number(args?.timeoutMs) || 30_000;
  const headless = args?.headless !== false;
  const volume = Number.isFinite(Number(args?.volume)) && Number(args.volume) > 0
    ? Number(args.volume)
    : 0.01;

  if (!gatewayUrl || !isLocalGatewayUrl(gatewayUrl)) {
    return unsupported(
      'live mode is unsupported without an explicit loopback --gateway-url '
      + '(http, local only). Supply --gateway-url http://127.0.0.1:<port> explicitly.',
    );
  }
  try {
    const endpoint = new URL(gatewayUrl);
    if (endpoint.protocol !== 'http:' || !isLoopbackHostname(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      return unsupported(
        'live mode is unsupported: --gateway-url must be a loopback http URL (http only, no ws/https).',
      );
    }
  } catch {
    return unsupported('live mode is unsupported: --gateway-url must be a loopback http URL.');
  }
  if (!identityPath) {
    return unsupported(
      'live mode is unsupported without an explicit --identity PATH to a private JSON file '
      + '(object or [login, token] / [{...}] array; read silently, never logged).',
    );
  }
  if (!isLiveSymbol(symbol)) {
    return unsupported(
      `live mode is unsupported without --symbol ${LIVE_SYMBOL} (exact). Live isolated-gateway measures ${LIVE_SYMBOL} only.`,
    );
  }

  let identity;
  try {
    const raw = await readFile(identityPath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('live identity file is not valid JSON');
    }
    identity = normalizeLiveIdentity(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      mode: 'live-isolated-gateway',
      reason: `live --identity PATH unreadable/invalid: ${detail}`,
      identity: { account_login: null, token: '[redacted]' },
      requestedGateway: '[withheld]',
    };
  }

  let wsUrl;
  try {
    wsUrl = deriveLiveWsUrl(gatewayUrl);
  } catch (error) {
    return unsupported(`live mode is unsupported: ${error instanceof Error ? error.message : String(error)}`);
  }
  const gatewayHttpUrl = gatewayUrl.replace(/\/+$/, '');

  const chromium = resolveChromium();
  if (!chromium.ok) return { ok: false, mode: 'live-isolated-gateway', reason: chromium.reason };
  const viteResolved = resolveVite();
  if (!viteResolved.ok) return { ok: false, mode: 'live-isolated-gateway', reason: viteResolved.reason };
  const { createServer } = viteResolved.vite;

  let viteServer = null;
  let browser = null;
  const setupSamples = [];
  const timed = { modify: [], close: [], pending: [] };
  const cleanupCancelled = [];
  const checks = [];
  try {
    const fixtureHtml = () => buildServiceFixtureHtml({ gatewayHttpUrl, wsUrl });
    viteServer = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: args?.vitePort || 0, strictPort: false },
      plugins: [{
        name: 'trading-browser-live-fixture',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if ((req.url || '').split('?')[0] !== VITE_FIXTURE_PATH) { next(); return; }
            res.setHeader('content-type', 'text/html');
            res.end(fixtureHtml());
          });
        },
      }],
    });
    await viteServer.listen();
    const viteUrls = viteServer.resolvedUrls?.local || [];
    const viteOrigin = viteUrls[0] || `http://127.0.0.1:${viteServer.config.server.port}`;
    const fixtureUrl = new URL(VITE_FIXTURE_PATH, viteOrigin).toString();

    browser = await launchChromium(chromium.puppeteer, { headless, timeoutMs });
    const page = await browser.newPage();
    await page.goto(fixtureUrl, { waitUntil: 'networkidle0', timeout: timeoutMs });
    const kind = await page.evaluate(() => window.__tradingBrowser?.kind || null);
    if (kind !== 'service-fixture-not-full-ui') {
      return { ok: false, mode: 'live-isolated-gateway', reason: `fixture did not boot actual services (kind=${kind})` };
    }
    await page.evaluate((id) => window.__tradingBrowser.setIdentity(id), {
      account_login: identity.account_login,
      token: identity.token,
    });
    await page.evaluate((params) => window.__tradingBrowser.setParams(params), {
      symbol: LIVE_SYMBOL,
      volume,
      modifySl: LIVE_MODIFY_SL,
      modifyTp: LIVE_MODIFY_TP,
      pendingPrice: LIVE_PENDING_PRICE,
      pendingSide: LIVE_PENDING_SIDE,
      pendingType: LIVE_PENDING_TYPE,
    });

    // Setup phase (OUTSIDE measured windows): market opens prepare one live
    // position per timed modify/close sample. Recorded separately, never mixed
    // into timed samples.
    for (let i = 0; i < samples; i += 1) {
      const { latencyMs, lastResult } = await clickAndWaitForConfirm(page, {
        button: '#btn-open',
        expect: 'filled',
        timeoutMs,
      });
      setupSamples.push({
        action: 'open-setup',
        ticket: String(lastResult?.ticket || ''),
        transportId: String(lastResult?.clientOrderId || ''),
        latencyMs,
      });
    }
    const setupTickets = setupSamples.map((s) => s.ticket).filter(Boolean);
    const setupOk = setupTickets.length === samples && new Set(setupTickets).size === samples && new Set(setupSamples.map((s) => s.transportId)).size === samples;
    checks.push({
      name: 'live-setup-opens-isolated',
      pass: setupOk,
      detail: `setup market opens=${setupSamples.length}, distinct intents=${new Set(setupSamples.map((s) => s.transportId)).size}`,
    });

    if (!setupOk) throw new Error("Live fixture requires distinct hedging positions; setup did not produce unique tickets");

    // Timed modify: correct protections relative to explicit base 100.
    for (const ticket of setupTickets) {
      await page.evaluate((t) => window.__tradingBrowser.setParams({ closeTicket: t }), ticket);
      const { latencyMs, lastResult } = await clickAndWaitForConfirm(page, {
        button: '#btn-modify',
        expect: 'modified',
        expectTicket: ticket,
        timeoutMs,
      });
      timed.modify.push({
        action: 'modify',
        ticket: String(lastResult?.ticket || ticket),
        transportId: String(lastResult?.clientOrderId || ''),
        latencyMs,
        submittedMs: typeof lastResult?.submittedMs === 'number' ? lastResult.submittedMs : null,
      });
    }

    // Timed full close of the ACTUAL setup ticket (volume omitted = full).
    for (const ticket of setupTickets) {
      await page.evaluate((t) => window.__tradingBrowser.setParams({ closeTicket: t }), ticket);
      const { latencyMs, lastResult } = await clickAndWaitForConfirm(page, {
        button: '#btn-close',
        expect: 'closed',
        expectTicket: ticket,
        timeoutMs,
      });
      timed.close.push({
        action: 'close',
        ticket: String(lastResult?.ticket || ticket),
        transportId: String(lastResult?.clientOrderId || ''),
        latencyMs,
        submittedMs: typeof lastResult?.submittedMs === 'number' ? lastResult.submittedMs : null,
      });
    }

    // Timed pending buy_limit 90, then cleanup cancel OUTSIDE the timed window.
    for (let i = 0; i < samples; i += 1) {
      const { latencyMs, lastResult } = await clickAndWaitForConfirm(page, {
        button: '#btn-pending',
        expect: 'pending-confirmed',
        timeoutMs,
      });
      const pendingTicket = String(lastResult?.ticket || '');
      timed.pending.push({
        action: 'pending',
        ticket: pendingTicket,
        transportId: String(lastResult?.clientOrderId || ''),
        latencyMs,
        submittedMs: typeof lastResult?.submittedMs === 'number' ? lastResult.submittedMs : null,
      });
      // Cleanup outside the timed window (not a sample).
      await page.evaluate((t) => window.__tradingBrowser.cleanupPending(t), pendingTicket);
      cleanupCancelled.push(pendingTicket);
    }

    const allTransportIds = [...timed.modify, ...timed.close, ...timed.pending].map((s) => s.transportId);
    const uniqueTimed = new Set(allTransportIds).size === allTransportIds.length && allTransportIds.every(Boolean);
    checks.push({
      name: 'live-unique-intent-per-timed-sample',
      pass: uniqueTimed,
      detail: `timed samples=${allTransportIds.length}, distinct transport IDs=${new Set(allTransportIds).size}`,
    });
    const ticketsPresent = [...timed.modify, ...timed.close, ...timed.pending].every((s) => s.ticket && s.ticket !== 'unknown');
    checks.push({
      name: 'live-authoritative-ticket-per-sample',
      pass: ticketsPresent,
      detail: ticketsPresent ? 'every timed sample carries an authoritative ticket' : 'missing ticket on a timed sample',
    });

    if (args?.screenshots) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(args.screenshots, { recursive: true });
      await page.screenshot({ path: `${args.screenshots}/live-fixture.png` });
    }

    const ok = checks.every((c) => c.pass);
    return {
      ok,
      mode: 'live-isolated-gateway',
      fixture: 'service-fixture-NOT-FULL-UI (actual tradeSocket/tradingV2Api via Vite; NOT full App UI)',
      scope: 'frontend-only/socket live isolated gateway (loopback only; NOT full production UI rendering; timings uncertified)',
      engine: browser.__tradingBrowserEngine || 'puppeteer-bundled-chromium',
      gateway: gatewayHttpUrl,
      identity: redactIdentity(identity),
      symbol: LIVE_SYMBOL,
      basePrice: LIVE_BASE_PRICE,
      modifyLevels: { sl: LIVE_MODIFY_SL, tp: LIVE_MODIFY_TP },
      pending: { side: LIVE_PENDING_SIDE, type: LIVE_PENDING_TYPE, price: LIVE_PENDING_PRICE },
      volume,
      certified: false,
      setupSamples,
      samples: timed,
      cleanupCancelled,
      latencies: {
        modify: summarizeMs(timed.modify.map((s) => s.latencyMs)),
        close: summarizeMs(timed.close.map((s) => s.latencyMs)),
        pending: summarizeMs(timed.pending.map((s) => s.latencyMs)),
      },
      checks,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'live-isolated-gateway',
      reason: error instanceof Error ? error.message : String(error),
      identity: { account_login: null, token: '[redacted]' },
      requestedGateway: '[withheld]',
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (viteServer) await viteServer.close().catch(() => {});
  }
};
