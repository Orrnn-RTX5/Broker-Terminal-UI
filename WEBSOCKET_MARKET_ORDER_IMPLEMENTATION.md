# WebSocket Market Order Implementation and Latency Report

Date: 2026-08-25

## Result

Market orders now use the already-warm, authenticated `/ws/v2` connection first. REST `POST /api/v2/orders` remains the idempotent fallback whenever the socket is closed, unauthenticated, backpressured, throws during `send()`, times out after status reconciliation, or the order contains fields outside the fixed WebSocket contract.

The frontend's local JavaScript work is already far below the requested 1–2 ms target in the included synthetic benchmark. That is not an end-to-end trade time. Public network latency, durable backend reservation, and broker execution dominate the real `order_accepted` and `order_filled` times.

This workspace is a local/test implementation only; no deployment was published. One explicitly confirmed local test order was placed successfully through the test terminal. The later latency/network probes were read-only and placed no additional order.

## Local no-protection compatibility fix

The local BTCUSD one-click test exposed a deployed `/ws/v2` validation mismatch. One-click Buy/Sell intentionally supplies no SL or TP, the frontend represented that as `sl: 0, tp: 0`, and the backend returned `order_rejected.error.message` with `sl must be a positive finite number`. The text did not originate in the UI; the UI correctly displayed the terminal backend rejection.

For immediate local compatibility, the first WebSocket frame now omits only inactive/zero `sl` and `tp` fields. Positive finite protection levels are still sent unchanged. Negative, `NaN`, and infinite protection values are rejected locally before any frame is written. This avoids an extra REST attempt, keeps Buy and Sell on the fast path, and does not weaken the rule that a terminal `order_rejected` is never retried.

The backend must still be corrected to accept its documented zero sentinel. The local backend prompt in this repository now requires both the published zero form and the omission-compatible form to mean “protection disabled.”

## Before and after

Previous market-order path:

```text
click
  -> forced HTTP market-status request on several entry points
  -> api.orders.placeMarketOrder()
  -> POST /api/v2/orders
  -> map REST response
  -> refresh positions/journal
```

Current standard market-order path:

```text
click / keyboard intent timestamp
  -> synchronous status gate from already-rendered/cached state
  -> api.orders.placeMarketOrder()
  -> generate or preserve one UUID v4 client_order_id
  -> authenticated warm /ws/v2 ready and queue healthy?
       yes -> place_order frame (inactive SL/TP omitted; positive values preserved)
              -> order_accepted: remain pending
              -> order_filled: map data to existing Position shape
              -> order_rejected: surface backend error.message
              -> uncertain error/10 s timeout: get_order_status once
       no  -> POST /api/v2/orders with the same client_order_id
  -> dispatch rtx:new-trade-placed
  -> existing position/journal refresh behavior
```

No component has to understand the transport decision. All callers still use `api.orders.placeMarketOrder(...)`.

## What changed

| File | Current behavior |
| --- | --- |
| `src/api/tradeSocket.ts` | Owns request correlation, strict request/client ID matching, accepted/fill/reject routing, one-shot status recovery, absolute initial timeout, queue-pressure guard, socket lifecycle warming, transport-specific errors, and deployed-validator compatibility for inactive SL/TP. |
| `src/services/api.ts` | Selects WebSocket first, validates market protection values, maps `order_filled.data` to the existing `Position` shape, preserves one UUID across recovery/REST fallback, keeps REST-only fields on REST, dispatches the existing trade event, and allocates the REST payload/trace only if fallback is actually used. |
| `src/api/endpoints.ts` | Carries `client_order_id` on the unchanged REST fallback request. |
| `src/services/orderLatencyTelemetry.ts` | Records monotonic enqueue, accepted, terminal, recovery, and REST timings after the latency-critical send. Keeps a bounded in-memory sample ring, exposes a console diagnostics API, and dispatches observer events in a later task so diagnostics cannot run ahead of terminal Promise/UI settlement. |
| `src/App.tsx` | Removes the forced status HTTP request from the order click path, starts placement before chart bookkeeping, and passes Depth-of-Market volume directly so React state cannot submit a stale lot size. |
| `src/components/OneClickTrading.tsx` | Uses the already-rendered market status and starts the synchronous WS enqueue before cosmetic loading/flash state and chart bookkeeping. |
| `src/components/LastSymbolPanel.tsx` | Removes the forced status HTTP request and cosmetic REST-only comment, then starts enqueue before loading feedback. |
| `src/components/OneClickPanel.tsx` | Reads default protection settings during render and starts enqueue before cosmetic loading/error state. |
| `AdvancedOrderPanel`, `ProfessionalTradingDashboard`, `ModifyPositionDialog`, `useAdvancedOrdersStore` | Capture intent timing and continue through the same centralized transport policy. |
| `scripts/benchmarkTradeSocketOrder.mjs` | Runs a reproducible synthetic benchmark through the real `TradeWebSocketClient` code. It does not contact the backend or place a trade. |

## Correctness and duplicate-order protection

`client_order_id` is the durable idempotency key. It is created once per API invocation, before choosing a transport. A valid caller-supplied UUID v4 is preserved for an upstream retry. The same value is used for:

- the initial `place_order` frame;
- every `get_order_status` reconciliation;
- REST fallback after an uncertain WebSocket result.

`request_id` is a separate per-request correlation ID. Incoming order messages are ignored unless both the pending `request_id` and its expected `client_order_id` match. Arrival order is never assumed, so a fast direct fill and multiple concurrent orders are safe.

An `order_rejected` business decision is never retried through REST. Its backend `error.message` is thrown unchanged. A retryable execution/transport result such as `SERVICE_UNAVAILABLE` is treated as uncertain: the client sends `get_order_status` once and waits for a terminal fill/rejection. If the WebSocket transport itself is unavailable after that, REST receives the same durable key and must reconcile rather than execute twice.

The initial terminal deadline is 10 seconds. `order_accepted` records durable acceptance but does not move that deadline; duplicate accepted frames cannot hold the Promise open forever. At the deadline, one status query receives one additional 10-second response window.

## WebSocket queue safety

The order connection is dedicated and normally has zero queued application bytes. Before `place_order`, the client checks `bufferedAmount`; above 16 KiB it immediately takes the idempotent REST path instead of placing the order behind an unhealthy queue. It never waits for `bufferedAmount` to reach zero.

The browser WebSocket specification defines `send()` as enqueueing data and explains that `bufferedAmount` does not include framing or bytes buffered by the operating system/network hardware. Therefore neither value proves server delivery. See the [WHATWG WebSockets Standard](https://websockets.spec.whatwg.org/#dom-websocket-send).

The socket is initialized at service startup, not at click time. Token/session changes reconcile it, and `online` or returning to a visible tab re-warms it if the browser closed it while suspended.

The current verified backend contract has no explicit authentication-ready acknowledgement or browser-usable protocol heartbeat. Therefore frontend readiness proves that the socket is open, a token is present, and the auth frame was queued; it cannot independently prove that a long-idle peer is still healthy. The backend prompt requests a backward-compatible auth-ready signal and heartbeat/liveness handling to reduce stale-open tail latency. Orders are never put in an offline replay queue.

## Timing model

All duration subtraction uses `performance.now()`, the browser's monotonic high-resolution clock described by [W3C High Resolution Time](https://www.w3.org/TR/hr-time-3/).

| Metric | Meaning |
| --- | --- |
| `intentToEnqueueMs` | First JavaScript instruction of the UI handler through return from `WebSocket.send()`; it excludes browser input-queue delay before handler dispatch. |
| `apiToEnqueueMs` | Central API entry through return from `WebSocket.send()`. |
| `serializationMs` | `JSON.stringify(place_order)` only. |
| `sendCallMs` | Time spent in the browser's local `WebSocket.send()` call; enqueue only. |
| `acceptedRttMs` | Local enqueue through durable `order_accepted`. This is the first meaningful server round-trip metric. |
| `terminalRttMs` | Local enqueue through `order_filled` or `order_rejected`. |
| `acceptedToTerminalMs` | Backend durable acceptance through terminal outcome as observed by the client. |
| `statusRttMs` | Status-recovery send through its terminal response. |
| `restRttMs` | REST fallback request duration. |
| `bufferedAmountBefore/After` | Browser application bytes queued around the send call; diagnostic only. |

Routine telemetry includes only a short UUID suffix, never the JWT, account login, full UUID, or order body.

Browser console examples:

```js
window.__RTX_TRADE_ORDER_LATENCY__.getSamples()

window.__RTX_TRADE_ORDER_LATENCY__.summarize(
  'intentToEnqueueMs',
  { phase: 'ws_enqueued' },
)

window.__RTX_TRADE_ORDER_LATENCY__.summarize(
  'acceptedRttMs',
  { phase: 'order_accepted' },
)

window.addEventListener('rtx:trade-order-latency', (event) => {
  console.table(event.detail)
})
```

Use those commands in the page's main-world DevTools console. The sample ring is in memory and is cleared by a full reload; browser-extension isolated worlds may not see custom page globals.

The event is scheduled in a later task only after send/settlement processing. On a terminal response, the resolved/rejected order Promise and its UI continuation run before diagnostics listeners.

## Synthetic local measurement

Command:

```powershell
npm run bench:orders -- 50000
```

Measured on this workstation after a 2,000-iteration warm-up:

| Synthetic metric | p50 | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Real `placeOrder()` call through fake local `send()` return | 0.0129 ms | 0.0398 ms | 0.1689 ms | 84.0601 ms |
| Same call through a correlated synthetic fill | 0.0255 ms | 0.0712 ms | 0.3405 ms | 247.2478 ms |
| Instrumented fake `send()` call, retained samples | 0.0006 ms | 0.0007 ms | 0.0010 ms | 0.0010 ms |
| API entry through fake enqueue, retained samples | 0.0053 ms | 0.0064 ms | 0.0121 ms | 0.0161 ms |

The measured timer granularity was approximately 0.0001 ms. The serialized no-protection JSON was 217 UTF-8 application bytes; an uncompressed masked client WebSocket frame is approximately 225 bytes before TLS/TCP/IP overhead. These figures use a fake in-process socket and demonstrate JavaScript overhead only. Rare maxima are scheduler/garbage-collection pauses, which is why percentiles—not a single maximum—are the useful comparison. The safe allocation trims are within run-to-run noise and do not change the conclusion: frontend p95 remains far below 1 ms. Use the browser telemetry above for the real device/browser and `acceptedRttMs` for the first server-confirmed result.

## Live read-only route measurement

The following fresh probe performed only DNS/TCP/TLS/HTTP setup and WebSocket protocol Ping/Pong. It sent no application WebSocket message, JWT, account data, or order.

From this India workstation on 2026-08-25:

- Cloudflare served the reachable route from `SIN` (Singapore).
- Direct TCP to `104.21.57.102`: 82.75 ms in the fresh probe (74.97–105.49 ms in the earlier same-day samples).
- Fresh hostname TLS completion: 468.05, 528.44, and 925.34 ms.
- Unauthenticated `GET /api/v2/orders` returned HTTP 405 with TTFB 546.33, 1,242.08, and 4,127.49 ms. Cloudflare `Server-Timing` reported origin portions of 244, 612, and 270 ms respectively, showing substantial additional client/edge/path variability.
- Unauthenticated `/ws/v2` upgrade: 1,072.07 ms.
- Five warm WebSocket protocol Ping/Pong RTTs after upgrade: 253.06–257.53 ms.
- The other advertised A record, `172.67.162.241`, timed out in the fresh 10-second direct probe and in all earlier direct probes from this route.

This is one workstation/network route, not proof of a global outage. It does show why a public end-to-end 1–2 ms promise is impossible here and why preserving the warm socket removes a large avoidable handshake. The warm RTT is roughly 20,000 times the local p50 enqueue call. It also gives the backend/network team a concrete anycast reachability and origin/path-variance issue to investigate. WebSocket Ping/Pong control frames are standardized by [RFC 6455 section 5.5.2](https://www.rfc-editor.org/rfc/rfc6455#section-5.5.2).

## Exact local runtime used

Use `http://127.0.0.1:5174/` for this file tree. The live response is titled `RTX 5 Web Terminal`. This workstation currently also has another terminal on IPv4 port 5173 and a different `RTX-5 Manager` app bound to IPv6 port 5174; `http://localhost:5174/` can therefore open the wrong project. No deployed URL was changed or tested as a deployment target.

## REST-only fields

The verified WebSocket shape does not contain `comment`, `trailing_stop`, `trailing_step`, or `magic`. Orders containing any of those fields deliberately remain on REST so the UI never drops user intent. Extending them requires an explicit backward-compatible backend contract change. Positive SL and TP are supported by the current WebSocket shape; inactive zero values are omitted locally until the backend zero-sentinel validator is corrected.

## Verification coverage

Automated coverage includes:

- direct fill and accepted-then-fill;
- strict request/client ID correlation;
- terminal rejection with exact backend message;
- retryable `SERVICE_UNAVAILABLE` status recovery;
- one-shot timeout recovery and absolute accepted deadline;
- socket backpressure and synchronous `send()` failure;
- same UUID across WebSocket and REST;
- valid supplied UUID preservation and malformed UUID rejection;
- REST-only enriched orders;
- no forced HTTP preflight in one-click trading;
- actual Buy and Sell click dispatch through the same centralized order API;
- actual serialized Buy and Sell WebSocket frames;
- two simultaneous Buy/Sell orders filled in reverse order;
- omitted, zero, and positive SL/TP behavior plus negative/non-finite rejection;
- Last Symbol orders no longer include the cosmetic REST-only comment.

Run:

```powershell
npm run typecheck
npx vitest run src/api/tradeSocket.orders.test.ts src/services/api.market-order-ws.test.ts
npx vitest run src/components/OneClickTrading.marketStatus.test.tsx src/components/LastSymbolPanel.orderTransport.test.tsx
npm run bench:orders -- 50000
```

Validation completed for this implementation:

- `npm run typecheck`: passed.
- Focused Buy/Sell, socket-frame, fallback, telemetry, and protection validation suite: 5 files and 48 tests passed.
- Full silent `vitest run`: 89 files and 1,059 tests passed.
- Core order/socket/telemetry files and their new tests: ESLint passed.
- `npm run build`: passed, including `tsc -b` and the production web bundle (1,961 modules).

The remaining meaningful latency work is in network routing, backend durable reservation, and broker execution. Reducing another few microseconds of frontend JavaScript would not materially change the measured public round trip and would risk weakening validation or idempotency.
