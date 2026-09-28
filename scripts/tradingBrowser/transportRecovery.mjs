/**
 * Transport/recovery mode: real Chromium + real browser WebSocket/HTTP +
 * synthetic local gateway. Verifies:
 *   1. click-to-confirm latency for open/close/modify/pending, each sample a
 *      UNIQUE intent with a correlated confirm (browser performance.now
 *      click-to-confirmed DOM matching the original client_order_id/ticket;
 *      no Node wall-clock timing);
 *   2. dropped fill -> get_order_status with ORIGINAL ids (no 2nd place_order);
 *   3. dropped REST close reply -> GET /order-commands with the ORIGINAL
 *      client_order_id (one POST, one execution, no resubmit);
 *   4. server-initiated socket drop -> client reconnects, no duplicate intent.
 *
 * Fixture label: NOT FULL UI (actual frontend services via Vite, no App boot).
 * Scope label: frontend-only/socket. No full-UI or live financial benchmark
 * is claimed.
 */
import { randomUUID } from 'node:crypto';
import { resolveChromium, resolveVite } from './resolveDeps.mjs';
import { startSyntheticGateway } from './syntheticGateway.mjs';
import { VITE_FIXTURE_PATH, buildServiceFixtureHtml } from './fixturePage.mjs';
import { launchChromium, clickAndWaitForConfirm } from './browserLaunch.mjs';
import { summarizeMs } from './validation.mjs';

const BUTTONS = {
  open: { button: '#btn-open', expect: 'filled' },
  close: { button: '#btn-close', expect: 'closed' },
  modify: { button: '#btn-modify', expect: 'modified' },
  pending: { button: '#btn-pending', expect: 'pending-confirmed' },
};

export const runTransportRecovery = async (args) => {
  const chromium = resolveChromium();
  if (!chromium.ok) return { ok: false, reason: chromium.reason };
  const viteResolved = resolveVite();
  if (!viteResolved.ok) return { ok: false, reason: viteResolved.reason };
  const { createServer } = viteResolved.vite;

  const gateway = await startSyntheticGateway({ fillDelayMs: 20 });
  let viteServer = null;
  let browser = null;
  const latencies = { open: [], close: [], modify: [], pending: [] };
  const checks = [];
  try {
    const fixtureHtml = () => buildServiceFixtureHtml({
      gatewayHttpUrl: gateway.httpUrl,
      wsUrl: gateway.wsUrl,
    });
    viteServer = await createServer({
      // configFile:false: the worktree has no node_modules, so the tree's own
      // vite.config.ts (react plugin, broker proxy) is not loadable here. The
      // fixture needs only Vite's TS transform for the actual frontend
      // services (all relative imports).
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: args.vitePort || 0, strictPort: false },
      plugins: [{
        name: 'trading-browser-fixture',
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

    browser = await launchChromium(chromium.puppeteer, { headless: args.headless, timeoutMs: args.timeoutMs });
    const page = await browser.newPage();
    // Ephemeral synthetic identity for the isolated gateway only.
    const identity = { account_login: 900001, token: `tb-synthetic-${randomUUID()}` };
    await page.goto(fixtureUrl, { waitUntil: 'networkidle0', timeout: args.timeoutMs });
    const kind = await page.evaluate(() => window.__tradingBrowser?.kind || null);
    if (kind !== 'service-fixture-not-full-ui') {
      return { ok: false, reason: `fixture did not boot actual services (kind=${kind})` };
    }
    await page.evaluate((id) => window.__tradingBrowser.setIdentity(id), identity);
    // Baseline: real click -> correlated confirmed update per action. EVERY
    // sample is a unique intent: WS opens mint a fresh client_order_id per
    // click in the fixture; REST close/modify each get a fresh synthetic
    // ticket so no sample measures an already-closed replay. The confirm DOM
    // must carry the original intent id (checked in clickAndWaitForConfirm).
    const openIntents = [];
    const ticketActions = ['close', 'modify'];
    let ticketSeq = 710001;
    const nextTicket = () => String(ticketSeq += 1);
    for (const action of Object.keys(BUTTONS)) {
      for (let i = 0; i < args.samples; i += 1) {
        let expectTicket = null;
        if (ticketActions.includes(action)) {
          // Fresh synthetic ticket per sample: no sample replays an
          // already-closed position. Pure sequence counter, no wall clock.
          expectTicket = nextTicket();
          await page.evaluate((t) => window.__tradingBrowser.setParams({ closeTicket: t }), expectTicket);
        }
        const { latencyMs, lastResult } = await clickAndWaitForConfirm(page, {
          ...BUTTONS[action],
          expectTicket,
          timeoutMs: args.timeoutMs,
        });
        // Page-measured performance.now samples are the real timings; Node
        // wall time is not mixed in.
        if (latencyMs !== null) latencies[action].push(latencyMs);
        if (action === 'open' && lastResult?.clientOrderId) openIntents.push(lastResult.clientOrderId);
      }
    }
    const distinctOpens = new Set(openIntents).size;
    checks.push({
      name: 'unique-intent-per-sample',
      pass: distinctOpens === openIntents.length && openIntents.length >= args.samples,
      detail: `open samples=${openIntents.length}, distinct client_order_ids=${distinctOpens}; close/modify used fresh tickets per sample`,
    });

    // Recovery 1: dropped fill -> original-ID status retry, no 2nd intent.
    // Faithful to the shipped client: TradeWebSocketClient.recoverPendingOrder
    // reuses the ORIGINAL request_id/client_order_id via get_order_status.
    const intentsBefore = gateway.state.placeOrderByIntent.size;
    gateway.state.dropNextFill = true;
    const recoveryConfirm = await clickAndWaitForConfirm(page, { ...BUTTONS.open, timeoutMs: args.timeoutMs });
    const placeEntries = [...gateway.state.placeOrderByIntent.entries()];
    const recovered = placeEntries.slice(intentsBefore);
    const recoveryOk = recovered.length === 1 && recovered[0][1] === 1
      && (gateway.state.statusRecoveryByIntent.get(recovered[0][0]) || 0) >= 1
      && recoveryConfirm.lastResult?.clientOrderId === recovered[0][0]
      && recoveryConfirm.confirmText.includes(recovered[0][0]);
    checks.push({
      name: 'dropped-fill-original-id-retry',
      pass: recoveryOk,
      detail: recoveryOk
        ? `withheld order_filled recovered via get_order_status with original ids (${recovered[0][0]}); exactly 1 place_order frame; confirm DOM matched`
        : `place intents delta=${JSON.stringify(recovered)}`,
    });

    // Recovery 2: withheld REST close reply -> the fixture's single intent
    // recovers via GET /order-commands/{same client_order_id}. The gateway
    // withholds the reply past the click's own deadline (the connection
    // stays open and silent, so the transport cannot duplicate the POST);
    // the client observes its timeout and polls the SAME id. Exactly one
    // POST, at least one status poll with that id, one execution, and the
    // confirm DOM carries the original intent id. The close is never
    // resubmitted.
    gateway.state.delayCloseReplyMs = 8000;
    const closeRecoveryTicket = '720007';
    await page.evaluate(
      (t) => window.__tradingBrowser.setParams({ closeTicket: t, closeTimeoutMs: 2500 }),
      closeRecoveryTicket,
    );
    const closeConfirm = await clickAndWaitForConfirm(page, { ...BUTTONS.close, expectTicket: closeRecoveryTicket, timeoutMs: args.timeoutMs });
    const closeIntent = closeConfirm.lastResult?.clientOrderId;
    const closePosts = gateway.state.restAttempts.filter((a) => a.kind === 'rest_close' && a.ticket === closeRecoveryTicket);
    const closePolls = gateway.state.restAttempts.filter((a) => a.kind === 'rest_close_status' && a.client_order_id === closeIntent);
    const closeExecutions = closeIntent ? (gateway.state.closeCommandsByIntent.get(closeIntent)?.executions || 0) : 0;
    const sameIdOnEveryPost = closePosts.length >= 1 && closePosts.every((a) => String(a.client_order_id) === String(closeIntent));
    const closeRecoveryOk = Boolean(closeIntent)
      && closePosts.length === 1
      && sameIdOnEveryPost
      && closePolls.length >= 1
      && closeExecutions === 1
      && closeConfirm.confirmText.includes(String(closeIntent));
    checks.push({
      name: 'dropped-close-reply-same-id-status-recovery',
      pass: closeRecoveryOk,
      detail: closeRecoveryOk
        ? `ticket ${closeRecoveryTicket}: intent ${closeIntent}: 1 POST, ${closePolls.length} status poll(s), 1 execution; confirm DOM matched`
        : `ticket ${closeRecoveryTicket}: posts=${closePosts.length}, polls=${closePolls.length}, executions=${closeExecutions}, intent=${closeIntent}`,
    });

    // Recovery 3: server-initiated drop -> reconnect, no duplicate intent.
    gateway.state.dropConnectionAfterNextFrame = true;
    const intentsBeforeDrop = gateway.state.placeOrderByIntent.size;
    let firstAttemptErrored = false;
    try {
      await clickAndWaitForConfirm(page, { ...BUTTONS.open, timeoutMs: 12_000 });
    } catch {
      firstAttemptErrored = true;
    }
    await page.waitForFunction(
      () => window.__tradingBrowser !== undefined,
      { timeout: args.timeoutMs },
    );
    // Reconnect proof: a fresh intent succeeds afterwards with 1 frame.
    await clickAndWaitForConfirm(page, { ...BUTTONS.open, timeoutMs: args.timeoutMs });
    const afterEntries = [...gateway.state.placeOrderByIntent.entries()].slice(intentsBeforeDrop);
    const noDup = afterEntries.every(([, count]) => count === 1);
    checks.push({
      name: 'reconnect-no-duplicate-intent',
      pass: noDup && afterEntries.length >= 1,
      detail: `first attempt errored=${firstAttemptErrored}; intents since drop=${afterEntries.length}, all single-frame=${noDup}`,
    });

    if (args.screenshots) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(args.screenshots, { recursive: true });
      await page.screenshot({ path: `${args.screenshots}/transport-fixture.png` });
    }

    return {
      ok: checks.every((c) => c.pass),
      mode: 'transport',
      fixture: 'service-fixture-NOT-FULL-UI (actual tradeSocket/tradingV2Api via Vite)',
      scope: 'frontend-only/socket (synthetic local gateway; NOT full UI, NOT a live financial benchmark)',
      unsupported: [
        'live mode (no correlated confirm possible for arbitrary UI)',
      ],
      engine: browser.__tradingBrowserEngine || 'puppeteer-bundled-chromium',
      gateway: gateway.httpUrl,
      latencies: Object.fromEntries(
        Object.entries(latencies).map(([k, v]) => [k, summarizeMs(v)]),
      ),
      gatewaySummary: gateway.summary(),
      checks,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (viteServer) await viteServer.close().catch(() => {});
    await gateway.close().catch(() => {});
  }
};
