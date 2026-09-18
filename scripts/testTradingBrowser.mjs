#!/usr/bin/env node
/**
 * test:trading-browser — real Chromium/TCP trading latency harness.
 *
 * Modes:
 *   --mode transport   real browser sockets + synthetic local gateway:
 *                      click-to-confirm latency (open/close/modify/pending,
 *                      each a unique intent, browser performance.now
 *                      click-to-confirmed DOM matching the original
 *                      client_order_id/ticket), dropped-fill original-ID
 *                      retry, dropped-close same-ID status recovery (one
 *                      POST with a client_order_id idempotency key, then
 *                      GET /order-commands/{same id}; never resubmitted),
 *                      reconnect, and no-duplicate-intent checks.
 *                      Fixture is explicitly NOT FULL UI: actual frontend
 *                      services via Vite. Scope is frontend-only/socket:
 *                      never a full-UI or live financial benchmark.
 *   --mode live        UNSUPPORTED: returns a failure without launching. An
 *                      arbitrary local UI cannot provide an explicitly
 *                      correlated confirmed result for the clicked intent.
 *
 * Fails closed (exit 2 + TRADING_BROWSER_UNAVAILABLE / refusal reason) when
 * dependencies are missing or the configuration is not local-only. Never
 * prints fake timings, never mocks WebSocket, never logs tokens.
 */
import { parseTradingBrowserArgs } from './tradingBrowser/validation.mjs';
import { runTransportRecovery } from './tradingBrowser/transportRecovery.mjs';
import { runLiveIsolatedGateway } from './tradingBrowser/liveIsolatedGateway.mjs';

const args = parseTradingBrowserArgs(process.argv.slice(2));

const result = args.mode === 'live'
  ? await runLiveIsolatedGateway(args)
  : args.mode === 'transport'
    ? await runTransportRecovery(args)
    : { ok: false, reason: `unknown --mode ${JSON.stringify(args.mode)} (expected "transport" or "live")` };

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : result.reason?.startsWith('TRADING_BROWSER_UNAVAILABLE') ? 2 : 1);
