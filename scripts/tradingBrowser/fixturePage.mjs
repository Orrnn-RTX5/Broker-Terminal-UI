/**
 * Fixture page that exercises the ACTUAL frontend services via Vite.
 *
 * LABEL: NOT FULL UI. This page does not boot App/AppShell. It imports the
 * real `src/api/tradeSocket.ts` (TradeWebSocketClient) and
 * `src/api/trade.ts` (tradingV2Api) through Vite's transform pipeline so
 * click-to-confirm latency and recovery semantics are those of the shipped
 * services — not a toy reimplementation. No `WebSocket` mocking, no fake
 * timers: the page uses the real browser `WebSocket`/`fetch` against the
 * synthetic gateway (transport mode) or an explicit local gateway (live mode).
 */
export const VITE_FIXTURE_PATH = '/__trading_browser_fixture.html';

export const buildServiceFixtureHtml = ({ gatewayHttpUrl, wsUrl }) => `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Trading-browser fixture — NOT FULL UI</title>
<style>
  body { font-family: monospace; background: #0b0e14; color: #d7e0f0; padding: 24px; }
  .banner { border: 1px solid #b98a1d; padding: 12px; margin-bottom: 16px; }
  button { margin: 4px; padding: 10px 16px; font-size: 14px; }
  #confirm { margin-top: 16px; padding: 12px; border: 1px solid #2c3a55; min-height: 2em; }
  #log { white-space: pre-wrap; font-size: 12px; opacity: 0.85; }
</style>
</head>
<body>
<div class="banner">TRADING-BROWSER FIXTURE — NOT FULL UI. Exercises actual frontend
services (tradeSocket TradeWebSocketClient, tradingV2Api) via Vite transform. No full App bootstrap.</div>
<div>
  <button id="btn-open" type="button">Market open (WS place_order)</button>
  <button id="btn-close" type="button">Close position (REST, same-ID recovery)</button>
  <button id="btn-modify" type="button">Modify position (REST)</button>
  <button id="btn-pending" type="button">Place pending (REST)</button>
</div>
<div id="confirm" data-status="idle">idle</div>
<pre id="log"></pre>
<script type="module">
import { TradeWebSocketClient, createTradeOrderUuid } from '/src/api/tradeSocket.ts';
import { tradingV2Api } from '/src/api/trade.ts';

const GATEWAY_HTTP_URL = ${JSON.stringify(gatewayHttpUrl)};
const WS_URL = ${JSON.stringify(wsUrl)};
const confirmEl = document.getElementById('confirm');
const logEl = document.getElementById('log');
const log = (line) => { logEl.textContent += line + '\\n'; };
const setConfirm = (status, detail, painted) => {
  confirmEl.dataset.status = status;
  if (painted === '0' || painted === '1') confirmEl.dataset.painted = painted;
  else delete confirmEl.dataset.painted;
  confirmEl.textContent = status + (detail ? ' ' + detail : '');
};
// Timing note: measurands are submitted->DOM (performance.now at handler start
// through the correlated DOM update). The final confirm text is written AFTER
// awaiting two animation frames so the reported ms includes DOM-update paint,
// not just time before setConfirm. Node waits for painted final (see
// clickAndWaitForConfirm), so provisional text is never accepted as a sample.
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const confirmThroughPaint = async (status, detailWithoutMs, t0, extra = {}) => {
  const tOp = performance.now();
  setConfirm(status, detailWithoutMs + ' ' + (tOp - t0).toFixed(1) + 'ms (unpainted)', '0');
  await nextPaint();
  const doneMs = performance.now() - t0;
  const detail = detailWithoutMs + ' ' + doneMs.toFixed(1) + 'ms';
  setConfirm(status, detail, '1');
  return { doneMs, submittedMs: tOp - t0, detail };
};

const readIdentity = () => {
  let identity = null;
  try { identity = JSON.parse(sessionStorage.getItem('tb_identity') || 'null'); } catch { identity = null; }
  if (!identity) throw new Error('missing identity: call __tradingBrowser.setIdentity first');
  return identity;
};

let socket = null;
const getSocket = (identity) => {
  if (socket && socket.isReadyForOrders()) return socket;
  const endpoint = new URL(WS_URL);
  endpoint.searchParams.set("token", identity.token);
  socket = new TradeWebSocketClient({ url: endpoint.toString(), reconnect: true, orderTimeoutMs: 8000 });
  socket.connect(identity.token);
  return socket;
};

const waitForOpen = (client, timeoutMs = 8000) => new Promise((resolve, reject) => {
  if (client.isReadyForOrders()) { resolve(); return; }
  const timer = setTimeout(() => { off(); reject(new Error('trade socket not ready')); }, timeoutMs);
  const off = client.onStateChange((state) => {
    if (client.isReadyForOrders()) { clearTimeout(timer); off(); resolve(); }
    if (state === 'error') { /* keep waiting until timeout: reconnect may recover */ }
  });
});

const v2 = (identity) => ({ baseUrl: GATEWAY_HTTP_URL + '/api/v2', skipDynamicUrl: true });

async function runOpen() {
  const t0 = performance.now();
  const identity = readIdentity();
  // Concrete default instrument for the synthetic gateway; live mode passes
  // its own symbol via __tradingBrowser.setParams.
  const symbol = sessionStorage.getItem('tb_symbol') || 'EURUSD';
  const volume = Number(sessionStorage.getItem('tb_volume') || '0.01') || 0.01;
  const clientOrderId = createTradeOrderUuid();
  const client = getSocket(identity);
  await waitForOpen(client);
  const filled = await client.placeOrder(
    { account_login: Number(identity.account_login), symbol, side: 'buy', type: 'market', volume },
    clientOrderId,
    { intentAtMs: t0, apiStartedAtMs: t0 },
  );
  const ticket = filled?.data?.position_ticket ?? filled?.data?.order_ticket ?? filled?.position_ticket ?? filled?.ticket ?? 'unknown';
  if (ticket === 'unknown' || ticket === undefined || ticket === null || String(ticket).trim() === '') {
    throw new Error('open response missing authoritative ticket');
  }
  // Correlated confirm: the DOM carries the ORIGINAL client_order_id intent
  // plus the server ticket, and __tradingBrowser.lastResult exposes the same
  // pair so the Node side matches the confirm to this exact click.
  const base = 'intent=' + clientOrderId + ' ticket=' + ticket;
  const measured = await confirmThroughPaint('filled', base, t0);
  const result = { action: 'open', clientOrderId, ticket: String(ticket), latencyMs: measured.doneMs, submittedMs: measured.submittedMs };
  window.__tradingBrowser.lastResult = result;
  return result;
}

async function runClose() {
  const t0 = performance.now();
  const identity = readIdentity();
  const ticket = sessionStorage.getItem('tb_close_ticket') || '710001';
  // Single durable intent: one client_order_id is minted for this click,
  // sent ONCE in POST /positions/{ticket}/close, and — on a lost reply —
  // recovered via GET /order-commands/{the same id}. The close is never
  // resubmitted under a new id. An optional per-close timeout
  // (tb_close_timeout_ms) lets the harness force the timeout path.
  const clientOrderId = createTradeOrderUuid();
  const accountLogin = Number(identity.account_login) || undefined;
  const timeoutRaw = sessionStorage.getItem('tb_close_timeout_ms');
  const timeoutMs = timeoutRaw === null || timeoutRaw === '' ? undefined : Number(timeoutRaw);
  const closed = await tradingV2Api.closePosition(ticket, {
    ...v2(identity),
    client_order_id: clientOrderId,
    ...(accountLogin === undefined ? {} : { account_login: accountLogin }),
    ...(timeoutMs === undefined || !Number.isFinite(timeoutMs) ? {} : { timeoutMs }),
  });
  // Authoritative correlation: closePosition resolves only for the correlated
  // intent (same-ID success or bounded same-ID poll); still require an object.
  if (!closed || typeof closed !== 'object') throw new Error('close response missing authoritative result');
  const base = 'intent=' + clientOrderId + ' ticket=' + ticket;
  const measured = await confirmThroughPaint('closed', base, t0);
  const result = { action: 'close', clientOrderId, ticket: String(ticket), latencyMs: measured.doneMs, submittedMs: measured.submittedMs };
  window.__tradingBrowser.lastResult = result;
  return result;
}
async function runModify() {
  const t0 = performance.now();
  const identity = readIdentity();
  const ticket = sessionStorage.getItem('tb_close_ticket') || '710001';
  // Live isolated-gateway levels are set explicitly via setParams
  // (tb_modify_sl/tb_modify_tp, e.g. 95/105 relative to base 100 for PERFUSD);
  // synthetic default preserves the existing transport behavior.
  const slRaw = sessionStorage.getItem('tb_modify_sl');
  const tpRaw = sessionStorage.getItem('tb_modify_tp');
  const sl = slRaw === null || slRaw === '' ? 1.08 : Number(slRaw);
  const tp = tpRaw === null || tpRaw === '' ? 1.09 : Number(tpRaw);
  const intentId = createTradeOrderUuid();
  const updated = await tradingV2Api.modifyPosition(ticket, { sl, tp }, v2(identity));
  // Validate before confirm (the previous fixture blindly accepted any 200):
  // the response must name the requested ticket.
  const echoed = updated && typeof updated === 'object'
    ? (updated.ticket ?? updated.id ?? updated.position_ticket ?? updated.positionTicket)
    : undefined;
  if (!updated || typeof updated !== 'object') throw new Error('modify response missing authoritative result');
  if (echoed === undefined || String(echoed) !== String(ticket)) {
    throw new Error('modify response ticket mismatch: expected ' + ticket);
  }
  const base = 'intent=' + intentId + ' ticket=' + ticket + ' sl=' + sl + ' tp=' + tp;
  const measured = await confirmThroughPaint('modified', base, t0);
  const result = { action: 'modify', clientOrderId: intentId, ticket: String(ticket), latencyMs: measured.doneMs, submittedMs: measured.submittedMs };
  window.__tradingBrowser.lastResult = result;
  return result;
}

async function runPending() {
  const t0 = performance.now();
  const identity = readIdentity();
  const symbol = sessionStorage.getItem('tb_symbol') || 'EURUSD';
  const volume = Number(sessionStorage.getItem('tb_volume') || '0.01') || 0.01;
  const priceRaw = sessionStorage.getItem('tb_pending_price');
  const price = priceRaw === null || priceRaw === '' ? 1.07 : Number(priceRaw);
  const side = sessionStorage.getItem('tb_pending_side') || 'buy';
  const type = sessionStorage.getItem('tb_pending_type') || 'limit';
  const intentId = createTradeOrderUuid();
  const order = await tradingV2Api.placePendingOrder(
    { account_login: Number(identity.account_login), symbol, side, type, volume, price },
    v2(identity),
  );
  // Validate before confirm: ticket must be present and non-empty; when the
  // gateway echoes symbol/type they must match the requested intent.
  const ticket = (order && (order.ticket ?? order.order_ticket ?? order.id)) || 'unknown';
  if (ticket === 'unknown' || String(ticket).trim() === '') throw new Error('pending response missing authoritative ticket');
  if (order && typeof order === 'object') {
    if (order.symbol !== undefined && String(order.symbol) !== String(symbol)) {
      throw new Error('pending response symbol mismatch');
    }
    if (order.type !== undefined && String(order.type) !== String(type)) {
      throw new Error('pending response type mismatch');
    }
  } else {
    throw new Error('pending response missing authoritative result');
  }
  const base = 'intent=' + intentId + ' ticket=' + ticket + ' ' + symbol + ' ' + type + ' ' + price;
  const measured = await confirmThroughPaint('pending-confirmed', base, t0);
  const result = { action: 'pending', clientOrderId: intentId, ticket: String(ticket), latencyMs: measured.doneMs, submittedMs: measured.submittedMs };
  window.__tradingBrowser.lastResult = result;
  return result;
}

const runners = { open: runOpen, close: runClose, modify: runModify, pending: runPending };

for (const [action, id] of [['open', 'btn-open'], ['close', 'btn-close'], ['modify', 'btn-modify'], ['pending', 'btn-pending']]) {
  document.getElementById(id).addEventListener('click', async () => {
    setConfirm('working', action);
    try {
      const result = await runners[action]();
      log(action + ' ok ' + JSON.stringify({ ticket: result.ticket, latencyMs: Math.round(result.latencyMs * 10) / 10 }));
    } catch (error) {
      setConfirm('error', action + ' ' + String(error && error.message || error));
      log(action + ' error ' + String(error && error.message || error));
    }
  });
}

window.__tradingBrowser = {
  kind: 'service-fixture-not-full-ui',
  lastResult: null,
  setIdentity: (identity) => {
    sessionStorage.setItem('tb_identity', JSON.stringify(identity));
    try { localStorage.setItem('auth_token', identity.token); } catch { /* noop */ }
  },
  setParams: (params = {}) => {
    if (params.symbol) sessionStorage.setItem('tb_symbol', params.symbol);
    if (params.closeTicket) sessionStorage.setItem('tb_close_ticket', params.closeTicket);
    if (params.closeTimeoutMs !== undefined && params.closeTimeoutMs !== null) {
      sessionStorage.setItem('tb_close_timeout_ms', String(params.closeTimeoutMs));
    }
    if (params.volume !== undefined && params.volume !== null) sessionStorage.setItem('tb_volume', String(params.volume));
    if (params.modifySl !== undefined && params.modifySl !== null) sessionStorage.setItem('tb_modify_sl', String(params.modifySl));
    if (params.modifyTp !== undefined && params.modifyTp !== null) sessionStorage.setItem('tb_modify_tp', String(params.modifyTp));
    if (params.pendingPrice !== undefined && params.pendingPrice !== null) sessionStorage.setItem('tb_pending_price', String(params.pendingPrice));
    if (params.pendingSide) sessionStorage.setItem('tb_pending_side', params.pendingSide);
    if (params.pendingType) sessionStorage.setItem('tb_pending_type', params.pendingType);
  },
  // Cleanup outside timed windows (live pending cancel): not a timed sample.
  // Returns the raw gateway result so Node can record cleanup without timing it.
  cleanupPending: async (ticket) => {
    const identity = readIdentity();
    return tradingV2Api.cancelPendingOrder(ticket, v2(identity));
  },
  run: (action) => runners[action](),
};</script>
</body>
</html>
`;
