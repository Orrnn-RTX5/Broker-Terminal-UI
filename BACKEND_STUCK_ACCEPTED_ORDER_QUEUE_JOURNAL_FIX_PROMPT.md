# Backend implementation prompt: fix stuck accepted orders, leaked in-flight capacity, and missing Journal latency

Copy this prompt into the backend repository/agent. Implement the fix in the real backend; do not only write a report. First inspect the actual framework, database, queue/worker topology, MT5 or broker bridge, `/ws/v2`, `POST /api/v2/orders`, order-status code, Journal writer, and deployment topology. Do not guess the stack.

The frontend repository is `rtx5-broker-webterminal-ui`. Preserve backward compatibility with its existing request and terminal response fields. Test credentials must remain operator-provided secrets; never commit or print them.

## Exact live TEST evidence from 2026-08-26

Account: `200002`, broker: `TEST`, route: `https://fxtrustbrokerbackend.orrnn.com`.

1. At `15:26:26 IST`, one `SELL XAUUSD 0.01` reached the backend and was terminally rejected:

   ```text
   Order rejected sell XAUUSD 0.01: Quote is stale for XAUUSD in 2615ms
   ```

   Journal ID was `14943`; no ticket was created. The `2615ms` value is quote age, not order-placement latency.

2. Before the next test, `/ws/feed/status`, `/api/v2/quotes/XAUUSD`, `/api/v2/quotes/BTCUSD`, and per-symbol market status all reported fresh, tradable, open quotes. BTCUSD quote age was measured at `0ms` immediately before submission.

3. Exactly one `SELL BTCUSD 0.01` was submitted with one fresh UUID `client_order_id`. No retry or fallback with a new ID was made. The HTTP request produced no response and timed out locally after `20,073ms`.

4. WebSocket `get_order_status` using the same `client_order_id` returned in about `2.012s`:

   ```json
   {
     "type": "order_accepted",
     "action": "get_order_status",
     "status": "accepted",
     "success": true,
     "accepted_at": 1787739666428,
     "applied_revision": 0
   }
   ```

   `accepted_at` corresponds to approximately `15:51:06.428 IST`.

5. At `15:59:12 IST`, more than eight minutes later, the same order still had no terminal fill or rejection. Journal, open positions, orders, pending orders, deals, and closed-position history all returned no matching record. Open positions remained unchanged at four.

6. A previous Journal row at `14:17:42 IST` contained:

   ```text
   Order rejected buy BTCUSD 0.01: Too many orders are already in flight for this account
   ```

This proves a backend lifecycle defect: an order can be reported as accepted but remain invisible and nonterminal, plausibly leaking per-account in-flight capacity. The status response alone does not prove that the acceptance was durably committed; verify that in backend storage. This is not a frontend click-rate limit, not a duplicate retry, and not the stale-quote case.

The exact live `client_order_id` is intentionally omitted from this prompt. Obtain it securely from the test operator/session evidence, or locate the record by account plus the exact accepted timestamp. Do not paste the complete identifier into public logs or reports.

## Required outcome

- Every distinct valid `client_order_id` submitted within documented durable admission capacity is independently and durably admitted inside its authenticated broker/tenant plus account scope.
- A normal user burst is queued instead of rejected by a small per-account in-flight counter.
- Every accepted order is queryable immediately and progresses to `filled`, `rejected`, or an explicit nonterminal `reconciling` state with a bounded, monitored recovery policy.
- No accepted order disappears from all list, status, and Journal surfaces.
- No code path leaks an execution permit, account semaphore, worker lease, or queue reservation.
- Journal returns structured correlation and latency fields so the frontend can display exact per-row latency without guessing from message text.

"Unlimited user orders" means no arbitrary small frontend/backend per-account click cap and no lost requests. It does **not** mean unbounded RAM, goroutines/tasks, sockets, broker calls, or database rows. Keep bounded infrastructure protection, but use durable admission and queueing so execution concurrency can remain safe without rejecting ordinary deliberate bursts.

## Existing contract to preserve

WebSocket place request:

```json
{
  "action": "place_order",
  "request_id": "<unique transport UUID>",
  "client_order_id": "<durable UUID v4 idempotency key>",
  "account_login": 200002,
  "symbol": "BTCUSD",
  "side": "sell",
  "type": "market",
  "volume": 0.01
}
```

WebSocket recovery request:

```json
{
  "action": "get_order_status",
  "request_id": "<correlation request UUID>",
  "client_order_id": "<same durable UUID>",
  "account_login": 200002
}
```

REST placement remains `POST /api/v2/orders` and must accept the same `client_order_id`. WebSocket and REST must call one shared idempotent order-command implementation.

Keep existing `order_accepted`, `order_filled`, and `order_rejected` core fields. Additive fields are allowed. Correlate every response by `client_order_id` and, where applicable, the request's `request_id`.

## Required backend implementation

### 1. Replace fragile in-flight counting with durable admission and a bounded execution queue

- Atomically reserve `(authenticated_broker_or_tenant_scope, account_login, client_order_id)` **and** its durable queue/outbox capacity in one transaction before `order_accepted`. Derive broker/tenant scope from the authenticated connection/session, not an untrusted request-body field. Enforce the full scoped identity with a database uniqueness constraint. Never commit an accepted reservation that has no recoverable execution command.
- Store a canonical intent fingerprint: account, symbol, side, type, volume, SL, TP, and other execution-affecting fields.
- A replay with the same UUID and same fingerprint returns the stored current/terminal state. It must never submit again.
- The same UUID with a different fingerprint returns a deterministic idempotency conflict.
- Separate **admitted orders** from **actively executing broker calls**. Accepted/queued/reconciling rows must not permanently consume a small per-account execution semaphore.
- Execute through a bounded, fair queue/worker pool. Preserve account ordering only if the actual broker requires it; do not invent global serialization.
- Release active execution permits in `finally`/defer-equivalent cleanup for success, business rejection, validation failure, timeout, cancellation, disconnect, worker crash, and exception paths.
- If durable queue capacity is genuinely exhausted, fail before `order_accepted`, but atomically persist a fenced terminal `not_admitted` tombstone for the scoped `client_order_id` and intent fingerprint. That tombstone must never enter the execution queue or broker bridge, and replaying the same ID must return the same outcome. Return the exact structured capacity envelope defined below with `retry_after_ms`. Never emit `order_accepted` and later drop the order because the queue is full.
- Remove the normal-path `Too many orders are already in flight for this account` behavior for tested ordinary bursts. Do not remove margin, market, entitlement, quote-freshness, or broker risk checks.

### 2. Implement an explicit durable order state machine

Use repository-appropriate names, but the semantics must cover:

```text
received -> not_admitted (terminal; fenced from queue/broker execution)
received -> accepted -> queued -> executing -> filled
                                      |       -> rejected
                                      -> reconciling -> filled/rejected
```

Persist at least:

- authenticated broker/tenant scope, `account_login`, `client_order_id`, intent fingerprint, and the original placement `request_id`;
- optional append-only transport-correlation/audit records for later status request IDs; never overwrite placement identity with a status lookup ID;
- current state and monotonically increasing `applied_revision`;
- accepted/queued/execution-started/terminal timestamps;
- worker owner, lease expiry, attempt metadata, and last heartbeat where workers can crash;
- broker request/correlation reference and terminal tickets/result;
- final error code/message;
- phase durations described below.

`order_accepted` means the reservation is committed and recoverable on another process. It must never mean only an in-memory map entry.

### 3. Recover expired accepted/executing work without duplicates

- Add a watchdog/reconciler for accepted, queued, executing, and reconciling rows that exceed their phase SLA.
- An accepted/queued order that was never submitted may be safely leased to another worker under the same durable UUID.
- If broker submission may have occurred but its result is unknown, move to `reconciling`; query the broker/MT5 source of truth before any resubmission.
- Never convert an unknown broker outcome into a new order. Never submit with a new `client_order_id`.
- Reclaim expired worker leases atomically. Multiple workers/instances must not execute the same order.
- A permanent business failure becomes one persisted terminal `order_rejected`.
- A terminal result must be immutable except for additive audit metadata.
- Alert operationally when any order remains nonterminal beyond the configured maximum reconciliation SLA.

### 4. Make accepted status visible everywhere

- `get_order_status` must return the durable current state from any healthy instance, not only process-local pending memory.
- Uniqueness, status lookup, active-order lists, queue ownership, idempotency replay, and Journal correlation must all use the same authenticated broker/tenant plus account scope. The same numeric `account_login` at another broker/tenant must never see or collide with this order.
- Each status request uses a new transport `request_id`; its response echoes that status request ID. The durable `client_order_id` remains unchanged. Do not require the client to reuse the original placement `request_id`.
- Use `applied_revision` as the canonical monotonic state revision because that field is already present in the observed deployment. If an older implementation also returns `revision`, document it only as a compatibility alias; when both exist, `applied_revision` wins.
- Use this exact event envelope:

  - initial durable acceptance: `type="order_accepted"`, `status="accepted"`, `terminal=false`;
  - later nonterminal status/reconciliation response: `type="order_status"`, `status="accepted|queued|executing|reconciling"`, `terminal=false`;
  - terminal success/failure: the existing `type="order_filled"` or `type="order_rejected"`, `terminal=true`.

- During a compatibility window, `get_order_status` may still return `type="order_accepted"` for an accepted nonterminal state; document the window and remove it only after the frontend supports `order_status`.
- Every nonterminal response must include current state, `applied_revision`, accepted timestamp, and enough order data for the client to render it. Additive initial-acceptance example:

  ```json
  {
    "type": "order_accepted",
    "status": "accepted",
    "success": true,
    "request_id": "<correlation id>",
    "client_order_id": "<durable id>",
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

- Existing `GET /api/v2/orders/{account_login}` must include active accepted/queued/executing/reconciling market orders, not return an empty list for a known accepted order.
- Add a documented authenticated REST status lookup by `(authenticated_broker_or_tenant_scope, account_login, client_order_id)` if the existing API has no exact lookup. The route may infer broker/tenant scope from authentication rather than expose it as a path field. Publish its OpenAPI/schema; do not make the frontend guess a route.
- WebSocket reconnect or another backend instance must replay the same stored state and terminal result.
- A `404`, missing list row, expired cache entry, or ordinary `not_found` response is **not** proof that a possibly transmitted order was never admitted. It must not authorize another create request. Retain idempotency records/tombstones for a documented period longer than every client retry, queue, broker, and reconciliation window. Only the documented fenced terminal `not_admitted` envelope below may represent proven non-admission, and the original command for that UUID must be structurally unable to enter the queue or execute later.
- For genuine pre-admission capacity exhaustion, use this terminal fenced response over WebSocket and the same JSON body with HTTP `503` over REST:

  ```json
  {
    "type": "order_rejected",
    "status": "not_admitted",
    "success": false,
    "terminal": true,
    "request_id": "<placement request id>",
    "client_order_id": "<durable id>",
    "applied_revision": 1,
    "error": {
      "code": "CAPACITY_UNAVAILABLE",
      "message": "Order was not admitted; try a new deliberate order after the retry interval",
      "retryable": true,
      "retry_after_ms": 1000
    }
  }
  ```

  `retryable=true` means a later deliberate user action may create a new UUID after the interval; it does not authorize an automatic replay/create. The same UUID always replays this tombstone and can never execute.
- A terminal result returned directly for the original placement echoes the placement `request_id`. A terminal result returned as the answer to `get_order_status` echoes that status poll's `request_id`. An unsolicited terminal push uses the original placement request ID (and may add `placement_request_id` explicitly); it must never reuse an unrelated or stale status-poll ID. Every form retains the same durable `client_order_id`.

### 5. Bound the REST response and support durable asynchronous acceptance

The observed `POST /api/v2/orders` hung beyond 20 seconds even though the order was accepted.

- Never hold an HTTP request indefinitely waiting for broker completion.
- Preserve the existing fast terminal `200` response for backward compatibility when a fill completes inside the normal short window.
- Add an explicit asynchronous mode, preferably `Prefer: respond-async`, for the updated frontend. After durable acceptance, return HTTP `202` promptly with `client_order_id`, `accepted_at`, state/`applied_revision`, and status lookup metadata.
- Return `Preference-Applied: respond-async` when honored.
- Replaying the same UUID must return its stored state: `202` while nonterminal, the existing success result when filled, or the same deterministic terminal rejection when rejected.
- Never return a generic timeout/5xx after durable acceptance without also returning the durable correlation ID and current state.

### 6. Fix Journal completeness and structured latency

The live `/api/v1/journal?mode=2&type=0` rows currently expose only:

```text
id, code, code_text, type, type_text, datetime, source, message
```

Add these optional top-level fields without removing existing fields:

```json
{
  "client_order_id": "<durable UUID>",
  "request_id": "<original placement request UUID when available>",
  "order_state": "accepted|queued|executing|reconciling|filled|rejected",
  "latency_ms": 123.45,
  "accepted_latency_ms": 2.31,
  "execution_latency_ms": 121.14,
  "order_ticket": 880001,
  "position_ticket": 990001
}
```

- Values must be real JSON numbers, finite, and nonnegative. Do not embed the only latency value inside `message`.
- For an accepted-phase row, `latency_ms` is ingress-to-durable-acceptance.
- For a terminal row, `latency_ms` is backend ingress-to-terminal-result persistence for that same order.
- `execution_latency_ms` is durable acceptance to terminal persistence.
- Quote age such as `2615ms` is a separate `quote_age_ms` diagnostic and must never be labeled order latency.
- Persist a Trade/Journal accepted entry as soon as durable acceptance commits, then a correlated terminal entry when the order fills/rejects. If the repository uses a mutable audit row instead, preserve equivalent accepted visibility and full state history.
- Journal/outbox work must not block the hot order path, but it must be durable and eventually consistent with the order state machine. Define and test a bounded visibility SLA for accepted rows, terminal rows, and outbox replay under healthy dependencies; alert when it is exceeded.
- Use a process-local monotonic clock only for a separate duration wholly measured inside one process/phase. `latency_ms`, `execution_latency_ms`, and any duration spanning queue wait, workers, crashes, or instance handoff must come from persisted phase timestamps generated by one shared database/server clock. Accumulated process-local monotonic durations may be exposed only as separate phase metrics; they must never substitute for end-to-end latency because they omit queue/crash downtime. Never subtract monotonic values from different processes and never mix browser/client clocks with server clocks.

### 7. Keep quote freshness and capacity failures separate

- Continue using the authoritative fresh quote snapshot for execution validation.
- `QUOTE_STALE` is a terminal business rejection only when the actual execution quote is stale.
- A queue/capacity problem must never be reported as quote stale.
- A stuck worker/lease must never cause every later account order to be rejected as already in flight.
- Log quote age, queue wait, and execution latency as separate dimensions.

### 8. Add phase-level observability

Use the clock rules from section 6: process-local monotonic clocks only inside one process/phase, and persisted shared database/server-clock timestamps for every cross-worker or end-to-end duration. Emit structured logs/metrics without JWTs or passwords for:

- request/frame ingress;
- idempotency reservation start/commit;
- acceptance response write;
- queue depth and queue wait;
- worker lease acquisition/heartbeat/expiry/reclaim;
- broker request start/ack/result;
- unknown-outcome reconciliation attempts;
- terminal persistence and Journal/outbox publication;
- permit acquisition/release and current counts by account;
- count and maximum age of accepted/queued/executing/reconciling orders.

Expose p50/p95/p99 and maximum for acceptance, queue wait, execution, reconciliation, terminal latency, and status lookup. Add an alert for nonterminal age above the configured SLA and for permit-count divergence from durable active state.

## Required regression and load tests

1. Reproduce the exact bug: broker worker accepts an order but stalls. Assert REST returns a bounded `202`, status/list/Journal show the accepted order, and no permit leaks.
2. Advance time past the worker lease. Assert the watchdog safely reclaims never-submitted work or moves an uncertain submission into reconciliation.
3. Resolve the broker result after the client disconnected. Assert the terminal result persists and is returned by status/reconnect without another broker call.
4. In an isolated harness with a fake/stub broker, send 20 and then 100 unique alternating Buy/Sell requests for one account, all within the configured durable admission capacity. Assert every UUID is durably admitted/correlated, no normal request receives `Too many orders are already in flight`, and execution concurrency stays within configured worker bounds. This is not authorization for 100 real TEST trades.
5. Deliver terminal broker results in reverse order. Assert exact correlation and no overwrite/latest-request race.
6. Replay accepted, filled, rejected, and reconciling UUIDs over WS and REST. Assert broker submission count does not increase.
7. Send the same UUID with a different intent. Assert deterministic idempotency conflict.
8. Kill a worker before enqueue, after enqueue, after broker send, and after broker result but before terminal persistence. Prove safe recovery for each crash window.
9. Run two backend instances concurrently against the same UUID. Assert only one durable reservation and at most one broker submission.
10. Verify active orders appear in `GET /api/v2/orders/{account_login}` and exact status lookup from another instance.
11. Verify accepted and terminal Journal rows contain valid numeric latency and correlation fields.
12. Verify genuine stale quotes still produce exactly one `QUOTE_STALE` terminal rejection and never execute later.
13. Verify capacity exhaustion, if deliberately forced, occurs before acceptance, atomically persists the fenced terminal `not_admitted` tombstone, returns the documented WS/HTTP envelope, never queues or executes that ID, replays deterministically, and does not leak permits.
14. Verify an ordinary missing list row, `404`, cache miss, or `not_found` status never changes a possibly transmitted order to `not_admitted` and never authorizes a second create. Prove only the persisted capacity tombstone can produce `not_admitted`, and its fence prevents that UUID from ever executing.
15. Use two authenticated broker/tenant scopes with the same numeric account login and client UUID. Verify uniqueness, status, lists, queue work, terminal delivery, and Journal rows remain isolated.
16. Hand an order across workers with queue/crash downtime. Verify end-to-end Journal latency includes that elapsed time from shared-clock persisted timestamps while process-local monotonic values remain separate phase metrics.

## Do not implement these unsafe shortcuts

- Do not make queues, maps, tasks, or broker concurrency literally unbounded.
- Do not merely raise a counter and leave the accepted-order leak unfixed.
- Do not delete idempotency records to free capacity.
- Do not mark an unknown broker outcome rejected and then resubmit it.
- Do not create a new UUID during WS recovery, REST fallback, reconnect, or status lookup.
- Do not treat `order_accepted` as terminal success or fabricate a position/ticket.
- Do not return `200 filled` before broker confirmation and terminal persistence.
- Do not solve capacity by weakening quote, entitlement, margin, or risk validation.
- Do not log credentials, complete JWTs, or sensitive account data.

## Deliverables

1. Backend code, migrations, queue/worker/reconciler changes, and documented API schema.
2. Before/after state-machine and sequence diagrams for WS, REST async acceptance, reconnect, and crash recovery.
3. Automated regression/load tests and their results.
4. A TEST-account verification report showing accepted, terminal, positions/orders, and Journal consistency without exposing credentials.
5. p50/p95/p99 phase latency and nonterminal-age metrics.
6. Deployment/rollback plan, feature flags if needed, and any required frontend contract version/date.

Do not ask the frontend to retry an accepted order as a new order. Backend correctness and terminalization must be complete before the frontend follow-up prompt is implemented.
