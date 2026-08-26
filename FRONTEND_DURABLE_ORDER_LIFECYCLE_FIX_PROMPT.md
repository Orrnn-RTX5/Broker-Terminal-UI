# Frontend implementation prompt: durable accepted-order reconciliation and exact Journal latency

Use this prompt in the `rtx5-broker-webterminal-ui` repository **after** the backend work in `BACKEND_STUCK_ACCEPTED_ORDER_QUEUE_JOURNAL_FIX_PROMPT.md` is implemented and its final OpenAPI/WebSocket response schemas are available.

Inspect the real current source before editing. Preserve unrelated dirty-worktree changes and existing public component/service APIs where possible. Implement and verify the changes; do not only write a report.

## Goal

Make every deliberate market-order click visible and exactly reconcilable from local submission through backend terminal fill/rejection, including page reconnect and temporary status loss, without creating duplicates or adding a frontend account-wide order cap.

The frontend must never turn a durably accepted or uncertain order into a second create request. It must keep the original `client_order_id`, show a nonterminal state, and reconcile by status until the backend supplies the stored terminal result.

## Confirmed current behavior to preserve

Relevant files include:

- `src/api/tradeSocket.ts`
- `src/services/api.ts`
- `src/services/orderLatencyTelemetry.ts`
- `src/components/OneClickTrading.tsx`
- `src/components/OneClickPanel.tsx`
- `src/components/LastSymbolPanel.tsx`
- `src/App.tsx`
- `src/components/layout/JournalTab.tsx`
- `src/hooks/useToolboxTradeData.ts`
- `src/store/useAppStore.ts`

Current strengths that must not regress:

- one UUID v4 `client_order_id` is generated per deliberate click;
- WebSocket responses are correlated using both `request_id` and `client_order_id`;
- `order_accepted` is nonterminal;
- `order_filled` and `order_rejected` are terminal business outcomes;
- `QUOTE_STALE` and other terminal business rejections are shown without a new-ID retry;
- independently correlated rapid clicks are allowed; there is no account-global one-order lock;
- the existing burst test dispatches 20 clicks while all prior requests remain pending;
- reverse-order fills settle the correct pending requests;
- position refresh/reconciliation is coalesced;
- quick/DOM order errors use nonblocking `rtx:order-feedback`, not `window.alert`;
- unavailable live/tradable quotes display an explicit "order not sent" reason;
- Journal accepts structured `latency_ms` and correlation fields when supplied;
- the Journal `Last trade latency` indicator uses current-session total attempt time and is account/broker scoped.

Keep per-form double-submit guards and keyboard auto-repeat suppression. They prevent one physical/form action from firing twice and are not an account-wide trading limit.

## Exact failure this frontend must handle

On TEST account `200002`, one BTCUSD 0.01 order was known by the backend as `order_accepted` at approximately `15:51:06.428 IST`, but it had no fill/rejection, position, order-list row, deal, or Journal terminal row more than eight minutes later. A REST request waited `20,073ms` without returning. A later status lookup still returned accepted.

The current frontend has a dangerous edge:

1. WebSocket `place_order` is sent.
2. Backend returns `order_accepted`.
3. No terminal frame arrives before the local timer.
4. Frontend sends one `get_order_status` recovery request.
5. If the order is still accepted or status recovery times out, `TradeSocketTransportError`/`ORDER_STATUS_TIMEOUT` can be treated as retryable.
6. `src/services/api.ts` may call `POST /api/v2/orders` as REST fallback with the same UUID.

Reusing the UUID protects idempotency only if the backend is correct, but once durable acceptance is known the client must not create again through another transport. It must perform read-only reconciliation.

## Backend contract to consume

Use the backend team's delivered schema as source of truth. Do not guess routes or field names. The intended contract is below; if the backend ships different names, update one normalized adapter and document the mapping.

### WebSocket place

```json
{
  "action": "place_order",
  "request_id": "<unique transport UUID>",
  "client_order_id": "<UUID v4 durable idempotency key>",
  "account_login": 200002,
  "symbol": "BTCUSD",
  "side": "sell",
  "type": "market",
  "volume": 0.01
}
```

Inactive SL/TP may be omitted. Positive protection values must be sent unchanged.

### Nonterminal accepted/current state

```json
{
  "type": "order_accepted",
  "status": "accepted",
  "success": true,
  "request_id": "<correlation UUID>",
  "client_order_id": "<original durable UUID>",
  "accepted_at": 1787739666428,
  "applied_revision": 1,
  "terminal": false,
  "data": {
    "account_login": 200002,
    "symbol": "BTCUSD",
    "side": "sell",
    "volume": 0.01,
    "state": "accepted"
  }
}
```

The normalized adapter must also accept later nonterminal current-state frames with `type="order_status"` and `status="accepted|queued|executing|reconciling"`. During the backend's documented compatibility window, `get_order_status` may still return `type="order_accepted"` for accepted status; normalize it to the same lifecycle state. All of these states are nonterminal.

### Terminal success/rejection

Keep the current `order_filled` and `order_rejected` contracts. Filled data may include `order_ticket`, `position_ticket`, `symbol`, `side`, `volume`, `price`, commission, SL, and TP. Rejection contains the exact structured backend code/message.

For genuine pre-admission capacity exhaustion, consume the backend's fenced terminal response over WebSocket or HTTP `503`:

```json
{
  "type": "order_rejected",
  "status": "not_admitted",
  "success": false,
  "terminal": true,
  "request_id": "<placement request UUID>",
  "client_order_id": "<same durable UUID>",
  "applied_revision": 1,
  "error": {
    "code": "CAPACITY_UNAVAILABLE",
    "message": "Order was not admitted; try a new deliberate order after the retry interval",
    "retryable": true,
    "retry_after_ms": 1000
  }
}
```

Normalize this to a terminal rejected-style lifecycle outcome, show the exact reason and retry interval, and never auto-resubmit it. A later deliberate user click may create a new UUID. Replaying the rejected UUID only retrieves the same tombstone.

### Status lookup

WebSocket status remains:

```json
{
  "action": "get_order_status",
  "request_id": "<new correlation request UUID>",
  "client_order_id": "<original durable UUID>",
  "account_login": 200002
}
```

Generate a new transport `request_id` for every status poll. The response must echo that poll's request ID while retaining the original durable `client_order_id`. Normalize the intended response envelope:

```json
{
  "type": "order_status",
  "status": "queued",
  "success": true,
  "request_id": "<echoed status-request UUID>",
  "client_order_id": "<original durable UUID>",
  "accepted_at": 1787739666428,
  "applied_revision": 2,
  "terminal": false,
  "data": {
    "account_login": 200002,
    "symbol": "BTCUSD",
    "side": "sell",
    "volume": 0.01,
    "state": "queued"
  }
}
```

Keep existing terminal `order_filled` and `order_rejected` envelopes with `terminal=true`. A terminal reply to a status poll echoes that poll's request ID; an unsolicited terminal push uses the original placement request ID. Both retain the durable client order ID. When both legacy `revision` and canonical `applied_revision` exist, use `applied_revision`.

Consume the backend's documented authenticated REST exact-status route for reconnect/offline recovery. Existing `GET /api/v2/orders/{account_login}` must also return accepted/queued/executing/reconciling orders for session hydration.

### REST asynchronous create

When REST is selected before any WebSocket order frame is sent, add:

```text
Prefer: respond-async
```

Support a bounded HTTP `202` response:

```json
{
  "success": true,
  "status": "accepted",
  "terminal": false,
  "client_order_id": "<same durable UUID>",
  "accepted_at": 1787739666428,
  "applied_revision": 1
}
```

Also retain the existing fast terminal REST success/error behavior. Never map HTTP `202 accepted` into a fabricated Position.

## Required frontend implementation

### 1. Add one normalized client-order lifecycle

Create a transport-owned service/store shared by every order-entry surface. Do not implement separate pending logic in `App.tsx`, `OneClickTrading.tsx`, and dialogs.

At minimum retain:

```ts
type ClientOrderPhase =
  | 'created'
  | 'sending'
  | 'accepted'
  | 'queued'
  | 'executing'
  | 'confirming'
  | 'reconciling'
  | 'filled'
  | 'rejected'
  | 'unsent';

interface ClientOrderLifecycle {
  sessionScope: string;
  accountLogin: number;
  placementRequestId: string;
  latestStatusRequestId?: string;
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  phase: ClientOrderPhase;
  appliedRevision?: number;
  createdAtEpochMs: number;
  acceptedAtEpochMs?: number;
  terminalAtEpochMs?: number;
  orderTicket?: number | string;
  positionTicket?: number | string;
  fillPrice?: number;
  latencyMs?: number;
  error?: { code?: string; message: string };
}
```

Authoritative key: authenticated broker/tenant plus account `sessionScope` and `clientOrderId`; never use numeric account login alone. Request IDs are transport correlation only. Keep a registry from every active placement/status `request_id` to the lifecycle; do not key lifecycle state by request ID. Each poll gets a new status request ID, and settling one poll must not detach a newer in-flight poll for the same client order.

Transitions must be monotonic and idempotent. Duplicate/late accepted frames cannot move a terminal order backward. Duplicate terminal frames cannot duplicate positions, sounds, refreshes, toasts, or Journal associations.

Treat backend exact-status/active-list data as authoritative. Keep only a bounded working window in browser memory. Page or spill older unresolved identity/intent records into account-and-broker-scoped IndexedDB (or the repository's existing durable client store), then rehydrate them on demand. Never silently discard an unresolved identity merely because many clicks occurred; remove it only after the backend confirms a terminal result or documents that it has been durably archived and remains queryable. If durable tracking cannot be established before send, stop that click locally as `not_sent`. If storage fails after transmission, surface degraded reconciliation but never authorize another create.

### 2. Classify whether the create frame was sent

Add an explicit typed disposition to transport failures:

```ts
type OrderTransportDisposition =
  | 'not_sent'
  | 'sent_outcome_unknown'
  | 'durably_accepted';
```

Do not infer this from human error text.

- `not_sent`: socket was unavailable or local backpressure rejected the order before `WebSocket.send()`; REST may be selected once with the same UUID.
- `sent_outcome_unknown`: `WebSocket.send()` returned/threw after transmission might have started, socket closed, or REST timed out after request transmission; never create again. Enter confirming and query status.
- `durably_accepted`: an accepted/current response was observed; never create again. Continue read-only status reconciliation.
- terminal filled/rejected, including fenced `not_admitted`: finish exactly once; never auto-create again.

`ORDER_STATUS_TIMEOUT` after a sent or accepted request must not be classified as permission for REST create.

### 3. Change fallback rules to preserve exactly-once intent

REST `POST /api/v2/orders` is allowed only as the initial create transport when the frontend can prove the WebSocket frame was **not sent**.

Once any of these are true:

- `WebSocket.send()` succeeded;
- `order_accepted` was observed;
- transport outcome is uncertain;
- REST transmission started and then timed out;

the frontend must:

- keep the original `client_order_id`;
- issue only status/list reads;
- never call another create transport;
- never generate a replacement UUID;
- never show a fake rejection merely because the client timer expired.

### 4. Reconcile accepted and uncertain orders across reconnect/reload

- Keep each accepted/confirming/reconciling order visible until a correlated terminal result.
- Query status with bounded exponential backoff and jitter. Read-only polling may slow down; it must not become a create retry.
- Reset backoff when the authenticated socket reconnects or a newer backend `applied_revision` arrives.
- If status remains accepted, keep it pending and display its age. Do not start REST create after a second timer.
- `unsent` is allowed only when the client proves locally that no create transport was invoked. Once transmission started or is uncertain, an empty list, cache miss, HTTP `404`, or ordinary `not_found` remains `confirming`/`reconciling` and never authorizes a create retry.
- Consume `not_admitted` only through the documented fenced terminal envelope. Normalize it to a terminal rejected-style lifecycle outcome with the exact backend code/message and retry interval, and do not automatically resubmit. Any ordinary missing/404/not-found response remains reconciling.
- Persist unresolved IDs and intent metadata without tokens/passwords, and rehydrate/merge them with the backend exact-status and active-order list. The backend is the source of truth.
- Never hydrate one broker/account's pending order into another session.
- On reconnect, merge local unresolved identities with backend active orders by exact `client_order_id`.

### 5. Keep deliberate clicks unconstrained without duplicating physical actions

Do not add:

- account-global `isPlacingOrder` locks;
- a client-side count/rate limit;
- a debounce/throttle that drops distinct clicks;
- button disabling because another order is accepted/pending;
- a "latest request" singleton.

Every valid deliberate click creates exactly one UUID and lifecycle record. Retain authentication, symbol eligibility, market status, volume, executable quote, and backend risk validation. Keep form-level duplicate-submit locks and keyboard auto-repeat suppression.

"Unlimited" means no artificial frontend account-wide cap; it does not mean retaining unlimited terminal UI history or bypassing backend capacity/risk controls.

### 6. Show nonblocking per-order state

Preserve `rtx:order-feedback`. Do not use `window.alert`.

Render independently keyed states such as:

- `Sending BTCUSD sell 0.01...`
- `BTCUSD sell 0.01 accepted - awaiting execution`
- `BTCUSD sell 0.01 status unavailable - confirming`
- `BTCUSD sell 0.01 reconciling with broker`
- filled with supplied ticket/price;
- rejected with the exact backend code/message;
- unsent with a clear local reason.

One order's fill must not clear another order's error/pending state. Feedback must use accessible `role="status"`/`aria-live` without blocking focus or later clicks.

### 7. Apply terminal side effects exactly once

Only `order_filled` may create/upsert an immediate position.

- Map `position_ticket`, `order_ticket`, and `price` to the existing aliases without fabrication.
- Accepted/queued/executing/confirming/reconciling/rejected/unsent states create no position.
- Coalesce trailing positions/orders/history/account reconciliation after bursts; do not launch one full refresh per fill.
- Capture session/account at submission. A late result from an old session must not mutate the newly active account.
- Terminal replays after reconnect must settle local state once without duplicate UI side effects.

### 8. Consume exact Journal correlation and latency

Backend Journal rows will add optional top-level fields:

```json
{
  "latency_ms": 347.82,
  "accepted_latency_ms": 12.31,
  "execution_latency_ms": 335.51,
  "client_order_id": "<durable UUID>",
  "request_id": "<request UUID when available>",
  "order_state": "accepted|queued|executing|reconciling|filled|rejected",
  "order_ticket": 880001,
  "position_ticket": 990001
}
```

- Preserve finite nonnegative numeric values, including numeric zero and numeric strings if the existing normalizer intentionally supports them.
- Missing/empty/negative/nonfinite latency displays the U+2014 em-dash placeholder; never manufacture zero.
- Correlate local lifecycle/telemetry to a Journal row only by exact session scope and `client_order_id`.
- Never correlate by symbol, side, volume, second-resolution timestamp, message text, array position, or "latest row."
- Do not copy one local latency onto multiple identical same-second rows.
- Include latency and available structured identifiers in copied Journal output.
- Show backend per-row latency separately from current-session local total latency. They have different clock boundaries.
- `Last trade latency` updates only for current-session terminal filled/rejected outcomes and reports total click/API-to-terminal time. Accepted/confirming is not completed latency.
- Quote age such as `2615ms` is not order latency.

### 9. Preserve latency-critical click ordering

Capture intent at the first instruction of the click/shortcut handler. Before the warm `WebSocket.send()` call, do not add:

- React notification state;
- Journal fetches;
- market-status REST preflights;
- positions/history refreshes;
- status polling;
- expensive formatting/logging.

Continue measuring local enqueue, accepted RTT, accepted-to-terminal, terminal total, status-recovery RTT, and REST RTT as separate fields. Never label `WebSocket.send()` return time as execution/fill latency.

## Required tests

Update existing tests; do not delete current concurrency, correlation, market-status, or Journal coverage.

### Transport/lifecycle

1. Direct WS fill settles once and maps one Position.
2. `order_accepted` remains nonterminal and causes zero REST create calls.
3. Accepted followed by status still accepted remains pending and causes zero REST create calls.
4. Accepted followed by `ORDER_STATUS_TIMEOUT` enters confirming and causes zero REST create calls.
5. Sent frame followed by socket loss enters confirming and causes zero REST create calls.
6. Socket unavailable before send selects REST exactly once with the original UUID.
7. Local pre-send backpressure selects REST exactly once with the original UUID.
8. A synchronous send failure is classified explicitly; test both definitely-not-sent and uncertain cases supported by the runtime.
9. REST `202 accepted` creates no Position and starts status reconciliation.
10. REST timeout after transmission uncertainty performs status reads and no second POST.
11. Terminal `QUOTE_STALE` and other business rejections preserve the backend message and never retry create.
12. Wrong request ID, client ID, account, or session responses are ignored.
13. Duplicate/late accepted and terminal frames cannot regress state or duplicate side effects.
14. Every status poll has a new request ID while retaining the original client order ID; out-of-order poll replies correlate correctly and canonical `applied_revision` prevents state regression.
15. Empty active list, HTTP `404`, cache miss, and ordinary `not_found` after possible transmission remain confirming/reconciling and cause zero create calls.
16. Only the documented fenced terminal `not_admitted` envelope is consumed as proven non-admission; an ordinary missing/404/not-found response is not, and neither path causes an automatic resubmit.
17. A documented `CAPACITY_UNAVAILABLE` tombstone displays the exact terminal reason/retry interval, creates no Position, and replaying its UUID performs status/idempotency lookup without another create.

### Concurrent clicks and session safety

18. Twenty pending Buy/Sell clicks dispatch twenty unique UUIDs without disabling buttons.
19. One hundred local mock clicks are not lost/overwritten; do not use production trading for this test.
20. Reverse-order terminal results settle the correct lifecycle entries.
21. An older success cannot clear another order's rejection/confirming state.
22. Burst fills produce a bounded/coalesced reconciliation count.
23. Account/broker switching isolates unresolved lifecycle state and ignores late old-session updates, including equal numeric account logins at different brokers/tenants.
24. Same-account reload restores active identities from backend status/list and performs no create call.
25. A large unresolved set stays bounded in memory, pages to durable scoped storage, rehydrates without lost IDs, and performs no create calls.
26. A pre-send durable-storage failure prevents transmission; a post-send storage failure never permits resubmission.

### Position, Journal, latency, and feedback

27. Accepted/queued/executing/confirming/reconciling/rejected/unsent create no position.
28. Filled maps ticket/price and upserts once, including terminal replay.
29. Exact `client_order_id` plus authenticated broker/account session scope links only the matching Journal/lifecycle row.
30. Distinct identical same-second rows retain their own backend latencies.
31. Missing/negative/nonfinite/empty latency displays the U+2014 em-dash placeholder; zero displays `0 ms`.
32. Clipboard includes the correct row latency and identifiers.
33. `Last trade latency` ignores accepted, nonterminal, and other-session samples.
34. Total fallback/confirmation duration is displayed instead of only the final transport leg.
35. Quick trade, order dialog, and one-click errors remain nonblocking; no order-error path calls `window.alert`.
36. One pending order cannot disable or overwrite another order's state.

## Verification commands

Run at minimum:

```powershell
npm run test:run -- src/api/tradeSocket.orders.test.ts src/services/api.market-order-ws.test.ts src/services/api.test.ts src/services/orderLatencyTelemetry.test.ts src/components/OneClickTrading.marketStatus.test.tsx src/components/layout/JournalTab.test.tsx src/App.orderFeedback.contract.test.ts
npm run typecheck
npm run build
git diff --check
```

Then run the full test suite when focused tests pass:

```powershell
npm run test:run
```

Report exact pass counts and separate new regressions from unrelated pre-existing dirty-worktree failures.

## Live TEST acceptance

Use only a designated TEST account with explicit authorization. Never print or commit credentials/tokens. Never test on production.

1. Place one 0.01 test order and observe sending -> accepted/current -> filled or rejected.
2. In approved TEST-only fault injection, or by suppressing the terminal frame on the client without delaying real broker execution, prove accepted status causes no REST create.
3. Disconnect/reconnect; prove status returns the original stored result and no duplicate broker execution occurs.
4. Confirm active accepted orders appear after a same-account page reload.
5. Confirm Journal accepted/terminal rows contain exact correlation and structured latency fields.
6. Run a controlled 20-click TEST burst only with operator authorization; verify 20 UUIDs, no frontend cap, no missing lifecycle entries, and one terminal result per accepted order.
7. Switch accounts during reconciliation and prove no old-account mutation leaks into the new account.

Do not claim the problem is fixed from component tests alone. Provide source evidence, automated results, and safely redacted live correlation/ticket evidence.

## Prohibited shortcuts

- Do not generate a new UUID during recovery.
- Do not REST-create after durable acceptance or uncertain transmission.
- Do not treat a local timeout as terminal rejection.
- Do not fabricate a Position/ticket for accepted status.
- Do not reintroduce account-global button locks or click limits.
- Do not remove genuine quote, risk, market, symbol, or volume validation.
- Do not correlate Journal rows heuristically.
- Do not place live production trades.
