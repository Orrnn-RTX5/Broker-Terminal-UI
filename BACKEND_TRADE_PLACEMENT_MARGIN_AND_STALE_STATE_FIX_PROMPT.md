# **COMBINED BACKEND AND FRONTEND IMPLEMENTATION PROMPT: BURST TRADING, PENDING TICKETS, MISSING TRADES, MARGIN, AND STALE STATE**

Copy this entire prompt into the backend repository issue or coding-agent task.

This is an implementation and verification assignment, not a request for a speculative report. Inspect the real backend source, database, migrations, broker or MT5 bridge, queue/worker topology, Redis or other shared state, caches, WebSocket gateway, outbox/pub-sub system, deployment configuration, and production-shaped logs. Then implement the root fixes, add migrations and automated tests, update the published API/WebSocket contract, deploy safely, and provide redacted before/after evidence.

> **ONE-FILE CONSOLIDATION NOTICE**
>
> This is the single authoritative prompt. It combines the complete scope of the former burst-trading/rate-limit/pending-ticket prompt with the trade-placement/margin/stale-state prompt. Shared requirements are intentionally deduplicated; unique evidence and contracts from both are preserved here. Do not request, create, or depend on a second prompt file.

## **BOLD SECTION MAP**

- **SECTION A — BURST TRADING, RATE LIMITS, OWNERSHIP, AND PENDING TICKETS:** the dated burst evidence, distributed rate policy, pre-admission response contracts, durable queue/lease rules, exact status recovery, Journal latency, and burst-specific tests.
- **SECTION B — TRADE PLACEMENT, MARGIN 0, MARGIN LEVEL INFINITY, AND STALE VALUES:** deal/position/account causality, margin semantics, canonical portfolio snapshots, revision ordering, freshness, reconnect, and resynchronization.
- **SECTION C — UNIFIED BACKEND IMPLEMENTATION AND VERIFICATION:** the shared durable lifecycle, database/outbox/fan-out architecture, trace requirements, tests, acceptance, migration, and delivery package.
- **SECTION D — FRONTEND IMPLEMENTATION HANDOFF:** the frontend work to perform after the backend contract is implemented and proven. This remains a section of this same file.
- **SECTION E — ALL-SYMBOL OHLC HISTORY AND LIVE-STREAM INTEGRITY:** the confirmed mixed-price-band and missing-minute evidence, exact symbol/time/finality/sequence contracts, reconnect and staleness behavior, backend acceptance tests, and the mandatory frontend implementation return report.

Important ownership instruction:

- These problems are currently experienced and reported through the frontend: Buy/Sell appears not to place a trade, Ticket can remain pending or disappear, Margin shows 0, Margin Level shows infinity, and account/position values remain stale.
- Treat this as an end-to-end incident. Implement and verify every backend-owned fix in the real backend; do not merely tell the frontend team to refresh, poll more often, recalculate margin locally, or retry the order.
- Do not make frontend changes from this backend task unless separately authorized. First finish the backend implementation, deploy or stage the finalized contract, and prove it with correlated evidence.
- Keep the backend implementation instructions and frontend handoff in this one Markdown file. Do not create or request a second frontend prompt file.
- After the backend contract is finalized, the backend team must complete the Frontend Implementation Handoff section inside this same document. That section must tell the frontend team exactly how to consume the implemented backend contract and fix every remaining frontend-owned issue. A vague list of recommendations is not acceptable.

## **1. MISSION**

Resolve these user-visible symptoms as one causally connected trading-state problem:

1. A user presses Buy or Sell, but no authoritative open position appears.
2. A provisional Trade row may stay at Ticket = pending, disappear after a timeout, or never receive an authoritative ticket.
3. Margin remains 0.00 and Margin Level displays as infinity.
4. Positions, account balance/equity/margin/free margin/margin level, orders, deals, and Journal can show old or mutually inconsistent values.
5. Refresh, reconnect, another browser session, or another backend instance can show a different answer.

The required outcome is:

- every submitted order is either provably not admitted or durably admitted;
- every durably admitted order is queryable immediately by its original client_order_id;
- every admitted order reaches one authoritative terminal result, or a visible and monitored reconciling state while the broker outcome is genuinely unknown;
- a filled order atomically or causally produces the matching order, deal, position, account/margin, Journal, and WebSocket state;
- REST and WebSocket never regress a client from a newer portfolio revision to an older one;
- no execution is duplicated by retries, reconnects, timeouts, REST fallback, worker crashes, or multi-instance races;
- all displayed account metrics come from one documented backend-authoritative calculation and freshness model;
- the backend delivery completes the frontend implementation section in this same file using the actual implemented and tested contract, not a proposed or hypothetical schema.

## **2. DIAGNOSIS BOUNDARY: DO NOT START WITH THE WRONG CONCLUSION**

The frontend code proves how requests are produced and how backend results are consumed. It does not, by itself, prove the current live failure for a particular click. Historical TEST evidence identifies several real backend failure modes, but those observations were collected on 2026-08-31 and 2026-09-01 and must be revalidated against the current deployment.

For one newly captured failed attempt, first determine which of these boundaries failed:

1. No request left the browser because a pre-send eligibility gate rejected it.
2. The request reached the WebSocket or REST gateway but was not durably admitted.
3. It was accepted but stuck in queue, reservation, ownership, or worker state.
4. It reached the broker, but the broker rejected it.
5. The broker executed it, but local order/deal/position/account persistence failed.
6. Backend persistence succeeded, but terminal response correlation was malformed.
7. Terminal response succeeded, but positions/account fan-out was missing or stale.
8. The backend state was correct, but an older REST response or WebSocket packet overwrote it in the client because the contract contains no comparable revision.

Do not collapse these into “frontend issue,” “network issue,” “stale quote,” “insufficient margin,” “rate limit,” or “database issue” without a correlated trace.

For every investigation, preserve and correlate:

- authenticated broker or tenant identity;
- account login;
- client_order_id;
- request_id;
- order ticket;
- deal ticket;
- position ticket;
- lifecycle revision;
- portfolio revision;
- event_id;
- backend trace_id;
- broker request and response correlation;
- server timestamps for every phase.

If there is no outbound request, report the exact frontend or backend-health gate and stop blaming order execution. If a request exists, trace it end to end before proposing a fix.

## **3. CURRENT RUNTIME AND SECURITY SCOPE**

Frontend repository:

    rtx5-broker-webterminal-ui

Current TEST routing visible in the frontend configuration:

    Broker/tenant: TEST
    Account used in prior diagnostics: 200001
    REST origin: https://fxtrustbrokerbackend.orrnn.com
    REST prefix: /api/v2
    Trading/account WebSocket: wss://fxtrustbrokerbackend.orrnn.com/ws/v2

The application is broker-routed. The effective identity is not account login alone. Scope all authorization, idempotency, queues, locks, caches, exact-status records, events, and Journal correlation by authenticated tenant/broker plus account login.

Never include passwords, bearer tokens, refresh tokens, cookies, or query-token values in source, tickets, screenshots, traces, fixtures, logs, dashboards, or the final report. Redact full UUIDs from routine metrics while retaining them in access-controlled forensic storage.

Do not run a 20-order or 100-order burst against a real trading account. Use a deterministic fake broker or isolated staging environment. A minimal TEST/demo smoke trade is allowed only after explicit operator approval, with the symbol, volume, maximum risk, and cleanup plan documented.

## **4. CONFIRMED CURRENT FRONTEND ARCHITECTURE**

### 4.1 Active surface

The active desktop Trade tab is:

    src/components/dock/DockWorkspace.tsx
      -> src/components/BottomDock.tsx
      -> src/hooks/useToolboxTradeData.ts

BottomDock constructs useToolboxTradeData itself and passes that hook's account, positions, pending positions, WebSocket state, and REST timestamps into the Trade tab.

The older files src/components/Toolbox.tsx and src/components/PositionsPanel.tsx contain another trading implementation, including their own metrics WebSocket behavior, but they are not mounted by the current DockWorkspace terminal path. Do not use that legacy implementation as the source of truth for reproducing the active screen.

### 4.2 Broker routing and session scope

Runtime REST and WebSocket endpoints are derived from the committed broker session and selected broker server_url:

- src/config/api.ts:155-179
- src/services/brokerSession.ts:987-1015
- src/services/brokerSession.ts:1040-1049

Frontend session ownership includes authentication state, account ID, broker ID, and server URL:

- src/services/brokerSession.ts:55-117

The backend must not key idempotency, account permits, cache state, or broadcast ownership by a naked numeric login.

### 4.3 Active market-order entry points

The active order entry points include:

- chart one-click Buy/Sell: src/components/OneClickTrading.tsx:165-257;
- application quick Buy/Sell and market requests: src/App.tsx:2725-2776;
- F9/New Order dialog callback: src/App.tsx:2838-2882;
- Last Symbol panel: src/components/LastSymbolPanel.tsx:187-255;
- reverse/double actions: src/App.tsx:1956-2025;
- Trade-tab modify/reverse path: src/components/ModifyPositionDialog.tsx:476-508.

They converge on:

    src/services/api.ts:530-744
    api.orders.placeMarketOrder(...)

### 4.4 Pre-send gates

The browser deliberately refuses to send an order when required state is not authoritative:

- no authenticated account/login;
- invalid or nonpositive volume;
- no positive bid/ask;
- symbol absent from the authenticated catalog or eligible live-feed set;
- market closed, unknown, pre-market, or after-hours;
- feed-status endpoint says the current feed is unavailable or non-authoritative.

Relevant source:

- src/components/OneClickTrading.tsx:165-214
- src/hooks/useLiveMarketData.ts:639-677 and 778-873
- src/hooks/useSymbolMarketStatus.ts:50-174
- src/utils/marketStatus.ts:133-208
- src/App.tsx:1514-1534

This matters because cached prices may remain visible while the authoritative feed-health gate prevents submission. The backend team must verify that symbol catalog, market status, quote APIs, /ws/feed/status, and the execution quote source agree. A click with no outbound place_order or POST /orders is not an order-worker failure.

### 4.5 Known frontend-only F9 behavior

The F9 order callback catches a placement failure and returns normally:

- src/App.tsx:2838-2881

The dialog treats the resolved callback as success and closes:

- src/components/OrderPanelDialog.tsx:542-560

This can make an F9 order look successful even when the backend returned an error. The backend cannot fix the dialog behavior. It still must return typed, correlated errors, and the frontend-owned correction is specified in the Frontend Implementation Handoff section of this same prompt.

Do not use this frontend issue to dismiss failures also reproduced from one-click, WebSocket traces, REST calls, Journal, or backend records.

## **5. EXACT ORDER TRANSPORT CONTRACT TO PRESERVE**

### 5.1 Identity

For every deliberate user action, the frontend creates exactly one UUID-v4 client_order_id. A WebSocket placement also receives a separate UUID-v4 request_id used for that transport request.

Source:

- src/services/api.ts:544-565
- src/api/tradeSocket.ts:407-480

The client_order_id is the durable business idempotency key. The request_id is a transport correlation ID. Never conflate them.

### 5.2 WebSocket placement

When the trading socket is authenticated and open, the frontend sends:

    {
      "action": "place_order",
      "request_id": "<transport UUID-v4>",
      "client_order_id": "<durable UUID-v4>",
      "account_login": 200001,
      "symbol": "XAUUSD",
      "side": "buy",
      "type": "market",
      "volume": 0.01
    }

Positive sl and tp may be included. A disabled SL or TP is omitted because the deployed validator reportedly rejects an explicitly present zero:

- src/api/tradeSocket.ts:466-485

Preserve this compatibility unless a versioned and coordinated contract replaces it.

### 5.3 REST placement

If the trading socket was definitely unavailable before send, or the request contains REST-only fields, the frontend uses:

    POST /api/v2/orders
    Authorization: Bearer <redacted>
    Content-Type: application/json

The actual normalized market payload is:

    {
      "login": 200001,
      "client_order_id": "<same durable UUID-v4>",
      "symbol": "XAUUSD",
      "side": "buy",
      "volume": 0.01,
      "price_sl": 0,
      "price_tp": 0
    }

Optional fields may be absent. The current REST normalizer removes type, account_login, quantity, sl, and tp and maps protection fields to price_sl and price_tp:

- src/api/endpoints.ts:91-112
- src/api/endpoints.ts:515-516

The current OpenAPI also describes POST /api/v2/orders as market placement requiring login, symbol, side, and volume:

- swagger.yaml:1493-1548

Continue accepting an omitted type for this legacy client, or introduce a versioned coordinated change.

### 5.4 Safe fallback and replay

The frontend uses REST fallback only when it knows a WebSocket placement frame was not enqueued. After WebSocket.send succeeds, a timeout or disconnect is an unknown outcome and the client does not create a second order. It reconciles the original client_order_id.

Source:

- src/api/tradeSocket.ts:112-130
- src/api/tradeSocket.ts:691-733
- src/services/api.ts:613-710

A 401 refresh can replay a REST request. Reconnect and status recovery can also repeat queries. Backend idempotency is therefore mandatory, not optional.

### 5.5 Current synchronous REST compatibility

Direct REST placement has a 30-second client deadline:

- src/api/client.ts:662-728

The current client treats every successful 2xx REST response as a filled Position. Do not silently change the legacy endpoint to return HTTP 202 with an acceptance-only body. Add asynchronous REST behavior only behind explicit opt-in such as Prefer: respond-async, a new route/version, and a coordinated frontend release.

### 5.6 WebSocket terminal-response compatibility

For an outstanding order, the current client recognizes only these top-level types:

    order_accepted
    order_filled
    order_rejected
    error

It requires both request_id and client_order_id at the top level. The values must exactly match the outstanding request. order_filled is terminal only if data is an object.

Source:

- src/api/tradeSocket.ts:736-785

A response can be ignored and leave the UI pending if:

- either ID is missing;
- IDs exist only inside data;
- an ID is changed;
- the type is renamed to order_status;
- the type is undocumented or differently cased;
- order_filled has no object-valued data;
- the fill has no usable positive position/order ticket.

Until a coordinated frontend version supports another envelope, emit compatible terminal responses:

    {
      "type": "order_accepted",
      "action": "place_order",
      "status": "accepted",
      "success": true,
      "terminal": false,
      "request_id": "<same request UUID>",
      "client_order_id": "<same durable UUID>",
      "lifecycle_revision": 2,
      "accepted_at": "<RFC3339 UTC>",
      "data": {
        "state": "accepted"
      }
    }

    {
      "type": "order_filled",
      "action": "place_order",
      "status": "filled",
      "success": true,
      "terminal": true,
      "request_id": "<same request UUID>",
      "client_order_id": "<same durable UUID>",
      "lifecycle_revision": 6,
      "data": {
        "state": "filled",
        "order_ticket": 123456,
        "position_ticket": 123456,
        "ticket": 123456,
        "account_login": 200001,
        "symbol": "XAUUSD",
        "side": "buy",
        "volume": 0.01,
        "price": 2500.25,
        "price_open": 2500.25,
        "portfolio_revision": 9104,
        "filled_at": "<RFC3339 UTC>"
      }
    }

    {
      "type": "order_rejected",
      "action": "place_order",
      "status": "rejected",
      "success": false,
      "terminal": true,
      "request_id": "<same request UUID>",
      "client_order_id": "<same durable UUID>",
      "lifecycle_revision": 3,
      "error": {
        "code": "INSUFFICIENT_MARGIN",
        "message": "Order rejected because available margin is insufficient.",
        "retryable": false
      },
      "data": {
        "state": "rejected",
        "rejected_at": "<RFC3339 UTC>"
      }
    }

Do not require a client acknowledgement before releasing an order permit, lease, reservation, or worker slot. Terminal delivery may be retried, but backend capacity cleanup must depend on durable backend state, not a browser ACK.

### 5.7 Current timeout and provisional-row behavior

The first WebSocket terminal timer is 10 seconds. At that point the client sends get_order_status for the original client_order_id. It waits one additional 10-second interval. If no recognized terminal response arrives, the client reports that final status could not be confirmed and instructs the user not to resubmit:

- src/api/tradeSocket.ts:691-733

Immediately after transport enqueue, the UI creates a local provisional position with a negative local ticket and placement_state = pending:

- src/services/api.ts:565-610

The Ticket cell literally renders pending:

- src/components/BottomDock.tsx:1667-1700

On a placement rejection or status timeout, the provisional row is removed. An order that remains accepted or executing in the backend can therefore disappear from the active table at roughly 20 seconds. A separate 120-second orphan guard is evaluated during Trade refresh, not by an independent timer:

- src/hooks/useToolboxTradeData.ts:74-77
- src/hooks/useToolboxTradeData.ts:722-800
- src/hooks/useToolboxTradeData.ts:920-991

Therefore:

- pending is not a real broker ticket;
- a disappearing provisional row is not proof that the broker did not execute;
- an accepted order must remain durably queryable and replayable after the socket promise times out;
- the normal backend terminal SLO must fit inside the current client window, or the backend must publish a coordinated durable reconciling contract before relying on longer processing.

## **6. EVIDENCE RELEVANT TO “WHY IS THE TRADE NOT PLACED?”**

### 6.1 What is confirmed in the current frontend worktree

On 2026-09-04, these focused suites passed in the current dirty worktree:

- src/api/tradeSocket.orders.test.ts
- src/services/api.market-order-ws.test.ts
- src/hooks/useToolboxTradeData.test.ts
- src/hooks/useToolboxTradeData.lifecycle.test.tsx
- src/components/BottomDock.trade.test.ts

Result:

    5 test files passed
    76 tests passed

These tests verify current frontend correlation, timeout recovery, fallback safety, provisional lifecycle, account normalization, and backend-authoritative metric rendering. They do not certify the deployed backend, database, broker bridge, or live WebSocket fan-out.

### 6.2 Historical TEST evidence from 2026-08-31

A prior read-only TEST audit recorded:

- login/account authorization succeeded;
- account 200001 was active;
- balance, equity, and free margin were 10000;
- used margin was 0 because there were no positions;
- XAUUSD and BTCUSD quotes were available and fresh;
- XAUUSD Buy, XAUUSD Sell, and BTCUSD Sell were rejected with Failed to insert deal;
- no order, deal, or position materialized.

This combined file preserves the relevant evidence from the earlier investigation; no separate prompt is required.

Treat this as a historical regression signal, not proof of the current incident. Search the current backend for the exact error and inspect:

- schema/migration drift;
- required columns and defaults;
- foreign keys;
- unique constraints;
- sequence ownership or exhaustion;
- numeric precision/scale;
- timezone/timestamp conversion;
- database role permissions;
- transaction isolation and lock/deadlock behavior;
- insert ordering among order, deal, position, ledger, and account state;
- whether the broker execution happened before local deal persistence;
- whether a rollback left an executed broker trade without local representation.

### **6.3 Historical TEST evidence from 2026-09-01**

This combined prompt preserves a read-only live audit of TEST account 200001. No new trades were placed during that audit. Treat every item below as dated regression evidence, not automatic proof of the current deployment.

Account/API baseline during that audit:

- login succeeded against /api/v2/auth/login with broker TEST;
- the account was active and was a demo/standard USD account;
- GET /api/v2/positions/200001 returned four open positions;
- GET /api/v2/orders/200001 returned 66 terminal rows: 61 closed and 5 filled;
- GET /api/v2/orders/pending/200001 returned no pending limit/stop orders;
- current positions and order rows did not expose client_order_id;
- 1,000 Journal rows exposed mainly id, code, type, datetime, source, and human message, without usable request/client IDs, lifecycle state, tickets, or structured latency.

Single read-only client-side samples were:

| Read | HTTP | Observed duration |
|---|---:|---:|
| Account | 200 | 518 ms |
| Metrics | 200 | 447 ms |
| Positions | 200 | 1,361 ms |
| Orders | 200 | 623 ms |
| Pending orders | 200 | 1,064 ms |
| Journal | 200 | 4,612 ms |

These are workstation samples, not backend SLO measurements. The backend must expose authoritative phase timings.

Observed within the then-current 1,000 Journal rows:

| Category | Count |
|---|---:|
| Filled market orders | 39 |
| Too many orders are already in flight for this account | 13 |
| Unable to resolve authoritative command ownership | 13 |
| Unable to reserve the order command | 12 |
| Quote is stale | 11 |
| POST orders failed with HTTP 409 | 8 |

REST attempts around 13:21 IST produced HTTP 429 while a separate WebSocket-oriented burst around 13:23 IST produced the custom in-flight refusal. Trace the HTTP product-rate limiter separately from the execution/admission-capacity gate.

The exact 2026-09-01 13:23:36–13:24:03 +05:30 burst window contained 30 order-related rows:

- 12 fills;
- 4 Too many orders are already in flight refusals;
- 8 Unable to resolve authoritative command ownership failures;
- 5 Unable to reserve the order command failures;
- 1 stale-quote rejection.

The 12 fill durations recorded in human Journal messages were:

    2335, 3955, 6164, 7254, 8314, 8850, 8877, 10080, 10147, 10990, 11686, 14152 ms

For those 12 fills:

- minimum 2.335 seconds;
- average approximately 8.567 seconds;
- maximum 14.152 seconds.

Across all 39 visible fill messages:

- minimum 1.138 seconds;
- p50 8.139 seconds;
- p95 11.937 seconds;
- maximum 14.152 seconds;
- mean approximately 7.688 seconds.

A later BTCUSD burst around 14:58:39–14:58:49 IST produced:

- one fill in 5.604 seconds;
- two ownership-resolution failures;
- one fill in 9.908 seconds;
- one fill in 13.066 seconds.

Backend preparation logs around affected bursts were generally microseconds or milliseconds while the broad execution phase took approximately 4.6–14.2 seconds. One XAUUSD order waited 10.962 seconds and then ended as QUOTE_STALE. This means a fresh ingress quote can age during queue/execution delay. Record and report ingress quote age, queue wait, execution-time quote age, and broker latency separately.

The audit also found:

- REST HTTP 429 around a burst;
- WebSocket close 1006, unexpected EOF, and I/O timeout;
- successful fill durations from about 1.1 to 14.2 seconds;
- p50 around 8.1 seconds and p95 around 11.9 seconds across the visible fill messages;
- one initially viable XAUUSD request waited about 11 seconds before QUOTE_STALE;
- positions, orders, and Journal rows lacked useful client_order_id and structured lifecycle correlation.

At the end of the audit, XAUUSD and BTCUSD quotes were open, fresh, tradable, and source-consistent. That does not disprove a stale quote for one command, but it rules out “the market was generally closed or stale” as the explanation for the whole incident.

Investigate whether WebSocket 1006/disconnect cleanup leaked command ownership, reservations, permits, leases, pending-map records, or terminal delivery.

These observations point to multiple backend failure classes, not one universal cause:

- rate middleware;
- per-account in-flight admission;
- ownership/reservation;
- slow queue or broker execution;
- quote-cache/TTL disagreement;
- socket stability;
- missing durable correlation.

Reproduce safely in staging and verify whether each path still exists.

### 6.4 Historical accepted-but-invisible evidence

An earlier investigation recorded an accepted order that remained invisible and nonterminal for roughly eight minutes. This combined file preserves that finding; no separate prompt is required.

Again, treat this as historical evidence to regression-test. It demonstrates why order_accepted must mean durable admission and immediate exact-status visibility, not a transient in-memory reservation.

### 6.5 Required conclusion format

Do not state only “trade was not placed.” For every captured attempt, return exactly one of:

- NOT_SENT: no backend request; include the gating reason and source.
- NOT_ADMITTED: validated fenced refusal before any broker call.
- ACCEPTED_QUEUED: durably admitted and queryable.
- EXECUTING: broker submission in progress under a valid lease.
- RECONCILING: broker outcome uncertain; duplicate submission prohibited.
- FILLED: authoritative tickets and portfolio revision committed.
- REJECTED: terminal broker/business rejection with a typed code.
- BACKEND_DEFECT: persistence, ownership, fan-out, or invariant failure.

Provide evidence for the selected state.

## **SECTION A — BURST TRADING, RATE LIMITS, OWNERSHIP, AND PENDING TICKETS**

This section contains the burst-specific requirements formerly held in a separate prompt. They are cumulative with the unified architecture, tests, and acceptance criteria later in this file. When two examples differ, use the current verified frontend request shape in section 5 and the compatibility rules below.

### **A1. Separate rate, capacity, admitted, and business outcomes**

Do not collapse unrelated conditions into generic Too many, In flight, Try again later, HTTP 409, or HTTP 503 messages.

The backend must represent these outcome classes separately:

1. RATE_LIMITED: the documented product-policy quota was exceeded.
2. CAPACITY_UNAVAILABLE: the system could not durably admit another command.
3. ACCEPTED, QUEUED, EXECUTING, or RECONCILING: the command is durably admitted and nonterminal.
4. FILLED or a specific REJECTED result: the terminal broker/business outcome.
5. ADMISSION_UNKNOWN: durable storage could not prove either admission or a fenced refusal; no broker call is permitted.

Rate and capacity refusal must happen before order_accepted and before any broker call. Persist a scoped, immutable NOT_ADMITTED tombstone with the UUID and intent fingerprint before reporting deterministic refusal.

If the NOT_ADMITTED tombstone cannot be committed:

- make no broker call;
- return ADMISSION_UNKNOWN or an equivalent typed service-unavailable result;
- do not falsely claim deterministic non-admission;
- require read-only status reconciliation or a formally documented safe-retry decision.

### **A2. Complete distributed rate policy**

The current OpenAPI baseline says 60 trading requests per minute per account. The backend/product team must verify whether that is still the intended policy and publish:

- policy name and version;
- rollout/effective date;
- sustained refill rate;
- window definition;
- instantaneous burst capacity B;
- limiter algorithm;
- authenticated broker/tenant plus account scope;
- global, broker, group, account, and user limits if more than one applies;
- whether open and close commands share a budget;
- whether validation or business rejections consume tokens;
- whether NOT_ADMITTED replays consume tokens;
- a separate budget for exact-status reads;
- multi-instance/distributed storage and atomicity;
- exact REST response headers;
- exact WebSocket response fields;
- retry semantics.

If the product approves the tested 20-click workflow, configure and prove B greater than or equal to 20 for unique commands inside the approved allowance. Broker execution concurrency may be lower; the bounded durable queue absorbs the difference.

These actions must not consume a new create token:

- replay of the same client_order_id and same intent;
- mixed REST/WebSocket replay of the same durable command;
- get_order_status;
- exact REST status read;
- reconnect/resume;
- delivery retry.

REST and WebSocket must share the same distributed policy. A process-local limiter on one transport is not sufficient.

### **A3. Exact typed pre-admission response contracts**

Select one canonical lifecycle-revision name. This combined prompt uses lifecycle_revision. If the deployed backend already uses applied_revision, document:

    applied_revision -> lifecycle_revision

as a temporary compatibility alias with identical value and a removal date. Never emit two revision fields with different meanings.

Rate-limited WebSocket response:

    {
      "type": "order_rejected",
      "action": "place_order",
      "status": "not_admitted",
      "success": false,
      "terminal": true,
      "request_id": "<WebSocket placement UUID>",
      "client_order_id": "<durable UUID>",
      "lifecycle_revision": 1,
      "error": {
        "code": "RATE_LIMITED",
        "message": "Order was not admitted because the account order rate was exceeded.",
        "retryable": true,
        "retry_after_ms": 1000
      },
      "rate_limit": {
        "policy": "trading-account-v2",
        "limit": 60,
        "window_ms": 60000,
        "burst": 20,
        "remaining": 0,
        "reset_after_ms": 1000
      }
    }

The numbers above are illustrative except for the currently documented 60/minute baseline. Backend/product must choose, publish, configure, and test the actual values.

Capacity-unavailable WebSocket response:

    {
      "type": "order_rejected",
      "action": "place_order",
      "status": "not_admitted",
      "success": false,
      "terminal": true,
      "request_id": "<WebSocket placement UUID>",
      "client_order_id": "<durable UUID>",
      "lifecycle_revision": 1,
      "error": {
        "code": "CAPACITY_UNAVAILABLE",
        "message": "Order was not durably admitted; make a new deliberate attempt only after the retry interval.",
        "retryable": true,
        "retry_after_ms": 1000
      }
    }

HTTP equivalents:

- RATE_LIMITED uses HTTP 429;
- CAPACITY_UNAVAILABLE uses HTTP 503;
- include the same durable admission semantics and structured body;
- HTTP 429 includes a standards-compliant Retry-After header;
- publish consistent RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, or a documented standards-based equivalent;
- do not claim to echo a REST request_id unless the client actually sent one; use a clearly named server trace/correlation ID instead.

retryable = true means a later deliberate user action may use a new UUID after the interval. It never authorizes automatic resubmission. Replaying the original UUID returns the same fenced NOT_ADMITTED result and never executes.

### **A4. Stronger durable idempotency and broker propagation**

The normalized intent fingerprint must include every execution-affecting value:

    authenticated broker/tenant
    account
    symbol
    side
    order type
    volume
    SL
    TP
    comment
    magic
    trailing stop
    trailing step
    contract/schema version

Additional requirements:

- propagate client_order_id or a stable derived idempotency key to the downstream broker when supported;
- if the broker has no idempotency capability, an ambiguous send must enter reconciliation before any possible resend;
- atomically commit the idempotency reservation, initial lifecycle row, NOT_ADMITTED/ACCEPTED decision, and durable queue/outbox command as applicable;
- order_accepted is forbidden until that transaction commits;
- exact replay and status reads consume no create-rate token;
- retain tombstones and terminal records beyond all client, queue, broker, reconciliation, failover, and disaster-recovery windows.

### **A5. Exact status request and response correlation**

Preserve this WebSocket recovery request:

    {
      "action": "get_order_status",
      "request_id": "<status correlation UUID>",
      "client_order_id": "<same durable order UUID>",
      "account_login": 200001
    }

Correlation rules:

- the current automatic frontend recovery may reuse the original placement request_id;
- echo exactly the request_id supplied by the status request;
- future clients may use a new transport request_id;
- append every status-request correlation without overwriting the original placement request_id;
- every response retains the same client_order_id;
- a direct placement response echoes the placement request_id;
- a direct status response echoes the status request_id;
- an unsolicited terminal push uses the original placement request_id and may also include placement_request_id;
- correlation IDs remain top-level even if duplicated inside data.

While the current client compatibility window remains, nonterminal status recovery may return the recognized top-level type order_accepted with the exact current state in status and data.state. Do not silently replace it with an unsupported order_status type.

Add and publish an authenticated REST exact-status route scoped by broker/account/client_order_id. It must not conflict with the existing numeric /orders/{login} route. One possible shape is:

    GET /api/v2/accounts/{login}/orders/by-client-id/{client_order_id}

The actual route must be documented; the frontend must not guess it.

### **A6. Rich compatible WebSocket lifecycle envelopes**

For the compatibility window, lifecycle messages must include:

- type;
- action;
- status;
- success;
- terminal;
- top-level request_id;
- top-level client_order_id;
- lifecycle_revision;
- object-valued data for order_filled;
- top-level error object for order_rejected;
- authoritative tickets only.

Compatible acceptance:

    {
      "type": "order_accepted",
      "action": "place_order",
      "status": "accepted",
      "success": true,
      "terminal": false,
      "request_id": "<placement request UUID>",
      "client_order_id": "<durable UUID>",
      "lifecycle_revision": 1,
      "accepted_at": "<RFC3339 UTC>",
      "data": {
        "account_login": 200001,
        "symbol": "XAUUSD",
        "side": "buy",
        "volume": 0.01,
        "state": "accepted"
      }
    }

Compatible fill:

    {
      "type": "order_filled",
      "action": "place_order",
      "status": "filled",
      "success": true,
      "terminal": true,
      "request_id": "<matching correlation UUID>",
      "client_order_id": "<same durable UUID>",
      "lifecycle_revision": 5,
      "data": {
        "account_login": 200001,
        "order_ticket": 880001,
        "position_ticket": 990001,
        "ticket": 990001,
        "symbol": "XAUUSD",
        "side": "buy",
        "volume": 0.01,
        "price": 3500.25,
        "price_open": 3500.25,
        "portfolio_revision": 9104
      }
    }

Compatible rejection:

    {
      "type": "order_rejected",
      "action": "place_order",
      "status": "rejected",
      "success": false,
      "terminal": true,
      "request_id": "<matching correlation UUID>",
      "client_order_id": "<same durable UUID>",
      "lifecycle_revision": 3,
      "error": {
        "code": "INSUFFICIENT_MARGIN",
        "message": "Not enough free margin.",
        "retryable": false
      },
      "data": {
        "state": "rejected",
        "account_login": 200001
      }
    }

Do not fabricate order_ticket or position_ticket to make pending disappear.

### **A7. Full asynchronous REST compatibility**

Never hold an HTTP request indefinitely while waiting for a broker:

- preserve fast terminal HTTP 200 when completion occurs within the legacy synchronous compatibility window;
- honor Prefer: respond-async only for clients that explicitly send it;
- return Preference-Applied: respond-async when honored;
- return HTTP 202 promptly after durable acceptance with client_order_id, current state, accepted_at, lifecycle_revision, and exact-status metadata;
- same-ID replay returns 202 while nonterminal, terminal 200 when filled, or the same deterministic rejection/not-admitted result;
- never return a generic timeout or 5xx after durable acceptance without the durable identity and current state;
- document a synchronous wait budget shorter than browser, proxy, and load-balancer deadlines;
- never send a bare 202 acceptance to the current legacy frontend, because it treats successful REST bodies as filled positions.

### **A8. Queue, permit, lease, and disconnect invariants**

- A queued command must not permanently occupy a broker-execution semaphore.
- Preserve per-account ordering only if the downstream broker contract requires it.
- Never globally serialize all accounts.
- Use fair scheduling so one account cannot starve others.
- Client disconnect, terminal socket-write failure, or status timeout only detaches delivery; it does not prove execution stopped.
- Do not release ambiguous execution ownership because the browser disconnected.
- Release or reclaim a permit/lease only after worker completion or an atomic fenced transition proves the old owner cannot continue.
- If durable evidence proves the broker request was never sent, a fenced worker may execute the durable command.
- If the broker request may have been sent, enter RECONCILING and query broker truth.
- Recover durable nonterminal rows on service startup and rolling deployment.
- Monitor live permit counts against durable executing leases.
- Alert on divergence and self-heal only through a safe fenced reconciliation process.

Persist:

- original placement request_id;
- append-only status request IDs;
- intent fingerprint and contract version;
- reservation_started_at;
- lease_acquired_at, lease expiry, heartbeat, and fencing token;
- worker/pod/attempt metadata;
- rate/capacity decision metadata;
- Journal/outbox publication state and published timestamp.

Terminal states are immutable except for additive audit metadata. Duplicate or late broker callbacks are ignored or audited and never create a second terminal transition.

### **A9. Ticket and active-status visibility**

- Expose an authoritative order_ticket as soon as the broker supplies it, even if the position is not yet filled.
- Expose position_ticket only after an authoritative position exists.
- Include client_order_id on orders, positions, deals/history, exact status, and Journal.
- Make ACCEPTED, QUEUED, EXECUTING, and RECONCILING market commands visible in an authoritative lifecycle/status surface.
- Keep lifecycle commands distinct from user-created pending limit/stop orders.
- Replay terminal ticket/state after reconnect and from every healthy backend instance.
- Never invent a ticket merely to remove the frontend's pending label.

### **A10. Exact phase timing and Journal contract**

Persist and report these boundaries separately:

    client ingress -> idempotency reservation start
    reservation start -> durable admission commit
    durable commit -> acceptance response written
    acceptance -> queue lease acquired
    queue wait
    worker start -> broker request written
    broker request -> broker acknowledgement/order ticket
    broker acknowledgement -> terminal result
    terminal result -> durable terminal commit
    terminal commit -> WebSocket/HTTP fan-out
    terminal commit -> Journal/outbox visibility

Add structured Journal fields:

    {
      "client_order_id": "<durable UUID>",
      "request_id": "<original placement request UUID>",
      "order_state": "accepted|queued|executing|reconciling|filled|rejected|not_admitted",
      "lifecycle_revision": 5,
      "portfolio_revision": 9104,
      "latency_ms": 123.45,
      "acceptance_latency_ms": 2.31,
      "queue_wait_ms": 20.0,
      "broker_execution_ms": 100.0,
      "reconciliation_ms": 0.0,
      "journal_visibility_ms": 1.14,
      "quote_age_ms": 45.0,
      "order_ticket": 880001,
      "position_ticket": 990001,
      "terminal_code": "FILLED"
    }

Rules:

- durations are finite, nonnegative JSON numbers;
- quote age is not order latency;
- write durable accepted and terminal audit events;
- prefer an append-only lifecycle audit;
- publish Journal through a nonblocking durable outbox;
- define and monitor a bounded Journal visibility SLA;
- retain the human message for compatibility, generated from structured data;
- for cross-process durations, use persisted timestamps from a shared server/database clock;
- never subtract monotonic values from different processes or mix browser and server clocks.

### **A11. Mandatory burst tests and acceptance**

In addition to the unified test matrix, run:

1. 20 simultaneous alternating Buy/Sell WebSocket orders inside the approved allowance.
2. 20 simultaneous REST orders under the equivalent policy.
3. 20 simultaneous mixed REST/WebSocket unique orders.
4. 100 unique synthetic orders with isolated limiter/queue configuration.
5. The same UUID and same intent replayed 100 times across both transports.
6. Reverse-order completion of 20 unique commands.
7. Slow broker responses at 2, 10, and 30 seconds.
8. A status-poll flood proving reads cannot starve placement/execution.
9. Exact sustained-rate and instantaneous-burst boundaries.
10. Pre-admission storage failure proving ADMISSION_UNKNOWN makes zero broker calls.

For every run, report the rate-policy decision plus exact permit/lease counts before and after.

Burst-specific acceptance:

- rate and capacity refusal is typed, pre-admission, durably fenced, replayable, and makes zero broker calls;
- reverse-order completions settle the correct UUID;
- zero cross-account and cross-broker correlation;
- no normal order stays silently pending beyond its phase SLA;
- accepted and terminal Journal visibility p99 is at most 1 second;
- no status-read traffic consumes create capacity or starves placement;
- publish a realistic external-broker terminal SLO;
- do not hide the historical roughly 8.1-second p50 and 11.9-second p95 in one broad execution bucket;
- explicitly state that no 20/100-order burst was run against a real account.

OpenAPI/WebSocket documentation must include:

- UUID-v4 client_order_id validation;
- client_order_id on Position, Order, deal/history, status, and Journal;
- exact REST status route;
- Prefer: respond-async and HTTP 202 behavior;
- structured 409, 429, and 503 bodies plus Retry-After;
- all lifecycle states and phase timestamps;
- ticket semantics;
- complete rate/burst policy;
- ACK semantics or explicit removal of an ACK requirement;
- authentication/reconnect behavior;
- compatibility/deprecation plan for any future order_status message.

## **SECTION B — TRADE PLACEMENT, MARGIN 0, MARGIN LEVEL INFINITY, AND STALE VALUES**

## **7. Exact meaning of Margin = 0 and Margin Level = infinity**

### 7.1 Confirmed active UI behavior

The active Trade footer treats account metrics as backend-authoritative and does not recompute equity, free margin, or margin level:

- src/components/BottomDock.trade.ts:102-158
- src/components/BottomDock.tsx:984-1007

It formats margin level as infinity only when:

    backend-derived numeric margin level <= 0
    AND
    active Trade positions array is empty

Source:

- src/components/BottomDock.tsx:1009-1013

If equity, free margin, or margin level is genuinely absent, the current resolver returns unavailable and the footer renders a dash:

- src/components/BottomDock.trade.ts:123-155
- src/components/BottomDock.tsx:1121-1136

The direct interpretation is:

- no open positions plus used margin 0 is normally correct;
- with no used margin, a percentage margin level is mathematically not applicable, and the current UI chooses the infinity symbol for a numeric zero;
- if a trade failed and no position was created, Margin 0 and Level infinity are downstream consequences, not an independent proof of a second calculation failure;
- if a real authoritative position exists while used margin is 0, that is an invalid or stale backend portfolio snapshot;
- if the backend omitted margin or sent an unrecognized/blank field, the active normalizer can coerce it to a real-looking zero.

Do not “fix” the symptom by fabricating a positive margin or arbitrary percentage.

### 7.2 Active normalization behavior

The active Trade hook accepts these aliases:

    balance:
      balance_amount | balance | Balance

    equity:
      equity_amount | equity | Equity

    used margin:
      used_margin | margin_used | margin | marginUsed

    free margin:
      free_margin_amount | free_margin | margin_free | freeMargin | margin_available

    margin level:
      margin_level | marginLevel

Source:

- src/hooks/useToolboxTradeData.ts:116-163

Missing fields preserve prior values. Margin has no hasBackendMargin availability flag and falls back to prior margin or zero. Empty strings become numeric zero through the current conversion helper:

- src/hooks/useToolboxTradeData.ts:79-103
- src/hooks/useToolboxTradeData.ts:153

A funded-account packet that suddenly says balance = 0 is treated as untrustworthy, and previous values are retained:

- src/hooks/useToolboxTradeData.ts:124-160

This protects against known partial/uninitialized backend packets, but it also proves that backend partial packets can create retained or mixed state. A legitimate funded-to-zero transition will later need a frontend contract-aware change. Backend work alone cannot make an unversioned client perfectly order old and new packets.

### 7.3 Required backend margin semantics

Choose and document one canonical live-account schema. At minimum:

- balance: finite decimal;
- credit: finite decimal;
- equity: finite decimal;
- margin: finite decimal representing current used margin;
- margin_free: finite decimal representing current free margin;
- margin_level: finite decimal when margin is greater than zero;
- floating: finite decimal;
- currency;
- leverage;
- open_positions_count;
- pending_orders_count;
- margin_level_state.

Required invariants under the broker's documented rounding, commission, swap, credit, cross-currency conversion, hedge/netting, and leverage rules:

1. All numeric values are valid finite JSON numbers. Never emit NaN or Infinity.
2. margin is greater than or equal to zero.
3. When margin is greater than zero, margin_level is finite and consistent with the authoritative broker formula, normally equity / margin * 100.
4. margin_free is consistent with equity and used margin under the broker's rules, normally equity - margin.
5. When margin equals zero, do not serialize Infinity. Return a documented representation such as:

       "margin_level": null,
       "margin_level_state": "not_applicable_no_used_margin"

   If backward compatibility requires numeric zero for the current UI, also include the explicit semantic state and publish a deprecation plan:

       "margin_level": 0,
       "margin_level_state": "not_applicable_no_used_margin"

6. An open leveraged position with margin = 0 is an invariant violation unless the instrument/account is explicitly configured as zero-margin. Emit a configuration reason for that exception.
7. A normal leveraged fill must not be reported terminal until its resulting position and nonzero used margin are durably computable and readable.
8. A transient calculator/cache initialization failure must return typed unavailable/service failure, not HTTP 200 or a WebSocket snapshot containing fabricated zeros.

The endpoint /api/v2/calculate/margin returns order-preview required_margin. It is not the source of current account used margin and must not be substituted into account state:

- swagger.yaml:945-976
- src/types/api.ts:230-246

## **8. WHY STALE VALUES CAN REMAIN**

### 8.1 Multiple asynchronous writers with no comparable revision

The active Trade tab loads:

- GET /api/v2/positions/{login};
- GET /api/v2/account/{login};
- best-effort GET /api/v2/account/{login}/metrics.

Positions are committed first, account second, and metrics are merged afterward:

- src/hooks/useToolboxTradeData.ts:722-841
- src/services/tradeStartupSnapshot.ts:61-111

It also opens its own /ws/v2 connection and subscribes:

    positions.{login}
    metrics.{login}
    account.{login}

Source:

- src/hooks/useToolboxTradeData.ts:1057-1200

The App and account socket manager have additional REST/WS writers:

- src/App.tsx:2210-2340
- src/App.tsx:2401-2517
- src/services/accountSocketManager.ts:205-351

No consumed account envelope supplies a monotonic portfolio_revision, source event sequence, as-of timestamp, or snapshot/delta mode. A REST response captured before a fill can arrive after a newer WebSocket frame and overwrite it. An older WebSocket packet can arrive after a newer one. The browser has no contract field with which to reject the regression.

### 8.2 Partial packets deliberately preserve old fields

normalizeToolboxAccount merges absent fields from the prior account object:

- src/hooks/useToolboxTradeData.ts:116-163

That means a packet containing only balance, or an envelope shape the normalizer only partly recognizes, can leave old margin/equity/free margin/margin level visible. The result can be a mixed snapshot that never existed atomically in the backend.

### 8.3 Missing margin can look like a real zero

Margin has no backend-presence marker in the current Trade resolver. A missing, blank, unknown-alias, or uninitialized value can become 0.00:

- src/hooks/useToolboxTradeData.ts:79-103 and 153
- src/components/BottomDock.trade.ts:118-121

Backend responses must therefore never use blanks, omit required snapshot fields, or silently change aliases.

### 8.4 Position WebSocket data is patch-oriented

The active positions handler patches existing rows and removes rows only when it receives explicit close tickets/events:

- src/hooks/useToolboxTradeData.ts:316-348
- src/hooks/useToolboxTradeData.ts:493-512
- src/hooks/useToolboxTradeData.ts:1113-1129

A positions array that merely omits a closed ticket, including an empty array, is not enough to clear stale rows in the patch path. New rows are ignored unless they include symbol, positive volume, and positive price_open:

- src/hooks/useToolboxTradeData.ts:247-251
- src/hooks/useToolboxTradeData.ts:328-338

Therefore the backend must:

- explicitly mark snapshot versus delta;
- provide a complete full position object for an open event;
- provide an explicit ticket and recognized close event for removal;
- send an authoritative reconnect snapshot that the coordinated client can replace, not merely patch.

### 8.5 No active Trade polling freshness guarantee

The active hook refreshes on mount/session change and force/manual events:

- src/hooks/useToolboxTradeData.ts:866-918

It does not run a regular account/position polling interval. WebSocket disconnect updates wsState but retains the last account/position values:

- src/hooks/useToolboxTradeData.ts:1173-1185

lastWsAt and lastRestAt are recorded, but the active Trade presentation does not enforce an expiry TTL or stale banner. Backend silence can therefore leave old numbers visible.

This is a shared backend/frontend contract gap. The backend must provide heartbeat, freshness, reconnect snapshot, revisions, and gap recovery. A later frontend task must consume those fields, reject regressions, and visibly expire stale state.

### 8.6 Shared liveness can hide a broken channel

The broader App path can treat any account/positions/orders/deals activity as trade-stream liveness. A noisy account stream can suppress the REST position fallback while positions fan-out is broken:

- src/App.tsx:1006-1009
- src/App.tsx:2328-2334
- src/App.tsx:2436-2517

Backend channel health and sequence monitoring must be per account and per channel, not one generic “socket connected” flag.

### 8.7 Contract aliases differ across consumers

The active Trade normalizer is relatively alias-tolerant, but other consumers accept different subsets:

- src/App.tsx:658-711;
- src/api/tradeGateway.ts:278-287;
- src/services/accountSocketManager.ts:71-81;
- src/services/websocket-enhanced.ts:654-674.

One payload can render differently across Trade, Exposure, toolbar, and other surfaces. Compatibility aliases may be mirrored during migration, but the backend must publish one canonical schema and deprecation schedule.

## **9. CURRENT API/WEBSOCKET DOCUMENTATION CONTRADICTIONS**

Fix the deployed implementation and the published contract together.

### 9.1 Live account versus analytics metrics

OpenAPI says GET /api/v2/account/{login} returns Account:

- swagger.yaml:1069-1095

Account contains:

    balance
    credit
    equity
    margin
    margin_free
    margin_level
    floating

Source:

- swagger.yaml:4587-4640

OpenAPI says GET /api/v2/account/{login}/metrics returns AccountMetrics:

- swagger.yaml:1097-1115

But AccountMetrics contains historical performance statistics such as total_deals, win_rate, profit_factor, total_profit, total_loss, drawdown, total volume, commission, and swap. It does not define live equity/margin state:

- swagger.yaml:4642-4686

The active Trade client nevertheless calls that route as an optional live-account overlay and subscribes to undocumented metrics.{login}.

Choose one of these approaches and document it:

1. Preferred: /account/{login} plus account.{login} are the canonical live portfolio state, while /account/{login}/metrics remains analytics.
2. Alternative: introduce a separately named and versioned live portfolio metrics resource/channel with a distinct schema.

Do not overload the analytics AccountMetrics schema with a conflicting live-margin shape.

### 9.2 WebSocket channels

OpenAPI documents account.{login} as carrying equity, margin, free margin, and margin level:

- swagger.yaml:230-262

It does not document metrics.{login}, WebSocket place_order, get_order_status, terminal order envelopes, lifecycle states, revisions, snapshot/delta semantics, or resume behavior.

Add all of them or formally deprecate redundant channels. During compatibility, mirror canonical live-account snapshots to both account.{login} and metrics.{login}, with identical portfolio_revision and values.

### 9.3 Authentication contradiction

OpenAPI documents query-token authentication and later also instructs clients to send an auth action:

- swagger.yaml:225-228
- swagger.yaml:264-268

The 2026-09-01 live audit observed that query-token authentication worked while the documented auth action returned unknown action. Decide the supported method, implement it consistently, update documentation, and test it. Authentication or disconnect cleanup must never leak an order ownership record or execution permit.

### 9.4 Order schema omissions

OpenAPI POST /orders omits the durable client_order_id and describes only a synchronous 200 response:

- swagger.yaml:1493-1554

The Order schema omits client_order_id, lifecycle revision, portfolio revision, phase timestamps, and reconciling state:

- swagger.yaml:4937-4969

Update OpenAPI and WebSocket documentation with the actual durable lifecycle.

## **SECTION C — UNIFIED BACKEND IMPLEMENTATION, VERIFICATION, AND DELIVERY**

## **10. REQUIRED CURRENT-INCIDENT TRACE**

Capture at least:

- one click that does not emit a request, if that symptom exists;
- one rejected placement;
- one successful placement;
- one accepted-but-delayed or uncertain placement, if reproducible safely;
- one close;
- one reconnect after a state change.

For each emitted placement, produce a redacted timeline:

| Phase | Required evidence |
|---|---|
| Browser intent | broker, account, symbol, side, volume, client_order_id suffix |
| Gateway receive | instance, request_id, client_order_id, received_at |
| Auth/ownership | authenticated tenant/account decision |
| Validation | symbol, market, volume, SL/TP result |
| Quote | source, symbol mapping, bid/ask, sequence, produced_at, received_at, TTL, age |
| Risk/margin | balance, equity, used/free margin before, required margin, conversion prices, leverage/group rules |
| Admission | limiter key, queue depth, capacity, durable state, accepted_at |
| Ownership | lease owner, fencing token, acquired/renewed/released timestamps |
| Broker send | attempt number, broker correlation, sent_at |
| Broker outcome | fill/reject/unknown, broker timestamp and raw code |
| DB commit | order/deal/position/ledger/account rows and transaction boundary |
| Outbox | event IDs, revisions, commit and publish timestamps |
| WS fan-out | channel, gateway instances, payload revision, client delivery |
| REST visibility | exact status, positions, orders, deals, account revision |
| Journal | structured lifecycle event and phase latencies |

Search every backend path that can emit or cause:

    Failed to insert deal
    Too many orders are already in flight for this account
    Unable to resolve authoritative command ownership
    Unable to reserve the order command
    Too many requests
    Try again later
    QUOTE_STALE
    HTTP 409
    HTTP 429
    HTTP 503
    WebSocket close 1006
    order_accepted without terminal state
    fill without position/account fan-out
    open position with zero used margin

For each path, document:

- exact source file/function/service;
- configured limit and timeout;
- storage and key scope;
- whether state is process-local or shared;
- every acquire/release path;
- crash/restart behavior;
- retry behavior;
- whether it can occur after broker submission;
- exact client-visible and Journal result.

## **11. REQUIRED BACKEND ARCHITECTURE AND IMPLEMENTATION**

### 11.1 One durable command path for REST and WebSocket

REST POST /orders and WebSocket place_order must invoke one shared application command. They must not have separate:

- validators;
- idempotency stores;
- account limiters;
- queue reservations;
- ownership records;
- broker clients;
- lifecycle rows;
- result caches;
- Journal writers.

Transport adapters may differ. Business admission and execution semantics must not.

### 11.2 Durable scoped idempotency

Use a unique key equivalent to:

    tenant_or_broker_id
    + account_login
    + client_order_id

Persist a normalized intent hash covering at least:

- symbol;
- side;
- market/pending type;
- volume;
- SL;
- TP;
- comment/magic where supported;
- account and broker scope.

Rules:

1. Same key plus same intent returns the current or terminal lifecycle record without another broker call.
2. Same key plus different intent returns typed 409 IDEMPOTENCY_CONFLICT.
3. Idempotency survives gateway/worker restart and works across instances and transports.
4. Retention exceeds all broker reconciliation, dispute, and retry windows.
5. A status lookup, reconnect, or client ACK is never counted as a new order.
6. Do not delete an idempotency record merely to clear stuck state.

### 11.3 Explicit durable lifecycle

Implement persisted states such as:

    RECEIVED
      +-> NOT_ADMITTED
      +-> ACCEPTED -> QUEUED -> EXECUTING
            +-> FILLED
            +-> REJECTED
            +-> RECONCILING -> FILLED or REJECTED

NOT_ADMITTED is terminal only when a fenced transaction proves no broker call occurred and no worker can later execute the command.

RECONCILING means the broker outcome is unknown after a send/timeout/crash. It is nonterminal, prevents resubmission, remains queryable, and has an owner, retry policy, maximum-age alert, and manual escalation path.

Persist:

- lifecycle_revision;
- received_at;
- validated_at;
- admitted_at;
- queued_at;
- execution_started_at;
- broker_sent_at;
- broker_ack_at;
- terminal_at;
- reconciled_at;
- rejection code;
- attempt count;
- worker/lease identity;
- broker correlation;
- order/deal/position tickets.

order_accepted may be emitted only after durable admission commits and exact-status lookup can retrieve the row from any instance.

### 11.4 Bounded admission, queueing, and worker ownership

Do not solve in-flight failures by merely increasing an in-memory counter.

Implement:

- documented sustained rate and burst allowance;
- bounded durable admission;
- bounded per-account and global queue capacity;
- fair scheduling;
- separately bounded broker-execution concurrency;
- durable leases with fencing tokens;
- lease renewal and crash recovery;
- no permit leak on validation failure, quote failure, broker rejection, timeout, socket disconnect, panic, or restart;
- queue-wait and execution timing as separate metrics.

A request inside the documented rate and available admission capacity should be queued, not rejected by a fragile process-local “already in flight” counter.

Rate limiting, durable-capacity refusal, business rejection, quote rejection, and broker failure must have different typed codes.

### 11.5 Deal/order/position/account transaction and reconciliation

Determine whether the broker is the external source of truth and where local transaction boundaries occur.

If the broker has not executed:

- local persistence failure may safely roll back and terminally reject.

If the broker might have executed:

- never automatically submit again;
- enter RECONCILING;
- query the broker by durable correlation;
- persist the discovered order/deal/position exactly once;
- update account state;
- publish terminal and portfolio events;
- retain a complete audit trail.

Where one database owns the state, atomically persist:

- terminal order/lifecycle transition;
- deal;
- position open/modify/close;
- account ledger or calculator input;
- new account snapshot/revision;
- Journal event;
- transactional outbox rows.

If atomicity across external systems is impossible, use a saga/reconciler with durable compensation and idempotent steps. Never report filled before the authoritative local position/account state is committed and readable.

### 11.6 One canonical portfolio revision

For each tenant/broker plus account, allocate a strictly monotonic portfolio_revision for every externally visible trading-state mutation:

- fill;
- close;
- partial close;
- modify;
- SL/TP execution;
- stop-out;
- swap/commission posting;
- balance/credit operation;
- authoritative recalculation.

Order lifecycle_revision and account portfolio_revision are different concepts. Include both where a lifecycle event causes a portfolio mutation.

Every position, account, order, deal, and Journal event caused by one commit must contain:

- same causal event_id or causation_id;
- same client_order_id where applicable;
- same portfolio_revision;
- authoritative generated_at/as_of server time;
- broker/account scope.

Do not use wall-clock timestamp alone for ordering.

### 11.7 Canonical live account snapshot

Publish a complete snapshot, not a partial merge packet:

    {
      "schema_version": 1,
      "snapshot_kind": "full",
      "broker_id": "TEST",
      "account_login": 200001,
      "event_id": "<UUID>",
      "portfolio_revision": 9104,
      "causation_id": "<order lifecycle event UUID>",
      "client_order_id": "<durable order UUID when applicable>",
      "generated_at": "<RFC3339 UTC>",
      "as_of_server_ms": 1788512345678,
      "balance": 10000.00,
      "credit": 0.00,
      "equity": 9998.75,
      "margin": 25.10,
      "margin_free": 9973.65,
      "margin_level": 39835.66,
      "margin_level_state": "finite",
      "floating": -1.25,
      "currency": "USD",
      "leverage": 100,
      "open_positions_count": 1,
      "pending_orders_count": 0
    }

Canonical names should match the documented Account schema: margin, margin_free, margin_level, and floating. During a compatibility window, aliases such as used_margin, free_margin, and floating_pnl may be mirrored, but they must carry identical values and a deprecation date.

Do not send an HTTP 200 or snapshot with omitted required fields. For a true dependency failure, return a typed unavailable response containing no fabricated financial values and keep the last committed revision queryable.

### 11.8 Canonical position events

Open/fill event data must be complete enough for the current client:

    {
      "schema_version": 1,
      "snapshot_kind": "delta",
      "event": "position_opened",
      "broker_id": "TEST",
      "account_login": 200001,
      "event_id": "<UUID>",
      "portfolio_revision": 9104,
      "client_order_id": "<UUID>",
      "order_ticket": 123456,
      "position_ticket": 123456,
      "ticket": 123456,
      "symbol": "XAUUSD",
      "side": "buy",
      "volume": 0.01,
      "price_open": 2500.25,
      "price_current": 2500.10,
      "price_sl": 0,
      "price_tp": 0,
      "profit": -0.15,
      "swap": 0,
      "commission": 0,
      "time_create": "<document one timestamp representation>",
      "time_update": "<document one timestamp representation>"
    }

Close/removal events must explicitly include the position ticket and a recognized event name:

    position_closed
    close
    closed
    sl_hit
    tp_hit
    stop_out
    delete

Do not rely on omission from an array to remove a row in the current patch-oriented client.

For versioned full snapshots:

    {
      "schema_version": 1,
      "snapshot_kind": "full",
      "broker_id": "TEST",
      "account_login": 200001,
      "event_id": "<UUID>",
      "portfolio_revision": 9104,
      "generated_at": "<RFC3339 UTC>",
      "positions": []
    }

Coordinate frontend replacement semantics before relying on snapshot_kind. Until then, continue explicit close events.

### 11.9 Transactional outbox and multi-instance fan-out

Persist outbox events in the same transaction as committed trading state. A publisher must:

- deliver or replay idempotently;
- deduplicate by event_id;
- preserve per-account portfolio revision order;
- broadcast across all WebSocket gateway instances;
- expose outbox lag and failures;
- resume after restart;
- never publish a terminal fill before the related state commit;
- never silently drop an event because the originating client disconnected.

After a fill, all connected authorized sessions for that broker/account must receive:

- terminal order result where correlated;
- positions.{login};
- orders.{login};
- deals.{login};
- account.{login};
- metrics.{login} compatibility mirror if still supported;
- structured Journal event.

Publishing account updates without the matching position event is a defect.

### 11.10 Subscribe, reconnect, replay, and gap recovery

On authenticated subscription or reconnect:

1. Authorize the full broker/account scope.
2. Return the latest committed full account and positions snapshot with portfolio_revision.
3. Replay later events or begin streaming strictly after that revision.
4. Let clients supply a resume revision/cursor.
5. Detect unavailable history and instruct the client to fetch a versioned resync snapshot.
6. Never retain old subscription ownership after account/broker switching.

Provide a route such as:

    GET /api/v2/account/{login}/portfolio-snapshot

Response:

    {
      "schema_version": 1,
      "broker_id": "TEST",
      "account_login": 200001,
      "portfolio_revision": 9104,
      "generated_at": "<RFC3339 UTC>",
      "account": { "...": "full canonical account fields" },
      "positions": [],
      "pending_orders": []
    }

The exact route name may differ, but account and positions must be read from one consistent revision or transaction snapshot.

### 11.11 REST consistency and caching

GET account, positions, orders, deals, exact order status, and the portfolio snapshot must use the same durable source of truth as WebSocket publication.

Requirements:

- read-your-write after terminal fill;
- include portfolio_revision and generated_at;
- no shared cache key based only on numeric login;
- invalidate or version caches in the state transaction/outbox flow;
- use Cache-Control: no-store for user-specific mutable trading state unless a correct private revision-keyed policy is formally designed;
- never serve an older revision as current after a newer terminal result;
- if a replica is used, enforce session consistency or route post-write reads to a sufficiently current source;
- expose source/replica lag internally.

Because network responses can arrive out of order, backend revisions are still required even with strong reads. A coordinated frontend release must reject lower revisions.

### 11.12 Quote freshness consistency

The frontend sends no execution price for a market order. The backend selects the authoritative execution quote. A QUOTE_STALE rejection is therefore not caused by a stale price embedded in the order body.

Use one documented quote identity across:

- /ws/feed/status;
- market/symbol status;
- tick WebSocket;
- quote REST;
- pre-trade validation;
- risk/margin conversion;
- broker execution.

Record:

- quote source/provider;
- normalized symbol;
- quote sequence;
- exchange/provider timestamp;
- gateway received timestamp;
- validation timestamp;
- execution timestamp;
- configured TTL;
- age at receipt;
- queue wait;
- age at execution;
- bid/ask selected.

If a fresh quote ages during queueing, revalidate immediately before broker send. Distinguish QUOTE_STALE_AT_RECEIPT from QUOTE_EXPIRED_IN_QUEUE. Do not use quote rejection to hide ownership or capacity delays.

### 11.13 Typed errors

Return stable machine-readable codes, safe user messages, retryability, admission state, and correlation:

    {
      "code": "CAPACITY_UNAVAILABLE",
      "message": "Order was not admitted because execution capacity is temporarily unavailable.",
      "retryable": true,
      "admission_state": "not_admitted",
      "client_order_id": "<UUID>",
      "request_id": "<UUID>",
      "trace_id": "<redacted-safe trace>"
    }

At minimum distinguish:

- AUTHORIZATION_FAILED;
- ACCOUNT_NOT_TRADABLE;
- SYMBOL_NOT_TRADABLE;
- MARKET_CLOSED;
- INVALID_VOLUME;
- INVALID_PROTECTION;
- INSUFFICIENT_MARGIN;
- RATE_LIMITED;
- CAPACITY_UNAVAILABLE;
- QUOTE_STALE_AT_RECEIPT;
- QUOTE_EXPIRED_IN_QUEUE;
- BROKER_REJECTED;
- IDEMPOTENCY_CONFLICT;
- DEAL_PERSISTENCE_FAILED;
- EXECUTION_OUTCOME_UNKNOWN;
- INTERNAL_STATE_INVARIANT_VIOLATION.

Generic “Try again later,” “in flight,” HTTP 409, or HTTP 503 without admission semantics is insufficient.

### 11.14 Exact order status and terminal replay

Implement an authenticated exact lookup by broker/account/client_order_id. WebSocket get_order_status and REST status must read the same lifecycle row.

Status must return:

- durable state;
- admitted versus not admitted;
- lifecycle revision;
- portfolio revision if applied;
- timestamps;
- normalized intent hash or safe summary;
- retryability;
- broker correlation;
- tickets;
- typed failure;
- whether the result is terminal.

Any healthy instance must answer it after reconnect or restart. Empty active-order lists, a cache miss, 404 from a non-authoritative replica, or absence from positions do not prove non-admission.

Only a durable fenced NOT_ADMITTED tombstone proves that the original command can never execute.

### 11.15 Journal and observability

Journal rows must be structured and queryable, not only human strings. Include:

- broker/tenant and account;
- client_order_id;
- request_id;
- lifecycle revision;
- portfolio revision;
- state;
- order/deal/position tickets;
- trace/event/causation IDs;
- quote sequence/age;
- queue wait;
- broker latency;
- persistence latency;
- outbox delay;
- terminal delivery delay;
- total latency;
- typed failure code;
- backend instance and worker.

Emit metrics by transport, broker, account group, symbol, and phase:

- received/admitted/not-admitted/filled/rejected/reconciling;
- queue depth and oldest age;
- active leases and leaked/orphan candidates;
- duplicate/replay count;
- broker submissions per client_order_id;
- ownership/reservation failures;
- deal persistence failures;
- accepted-but-unqueryable count;
- outbox backlog and publish failures;
- per-channel last revision and publish lag;
- REST/WS revision divergence;
- account-position invariant violations;
- stale quote at receipt versus after queue;
- WebSocket close codes including 1006;
- p50/p95/p99/max phase latency.

Alert on:

- any duplicate broker submission;
- any accepted-but-unqueryable order;
- nonterminal age beyond SLA;
- reconciling beyond maximum age;
- lease/permit divergence;
- outbox lag;
- account update without matching position revision;
- open positions with zero margin absent explicit zero-margin configuration;
- a lower portfolio revision published after a higher one;
- repeated WS 1006;
- REST/WS snapshots disagreeing at the same revision.

## **12. EXISTING-STATE AUDIT AND SAFE REPAIR**

Before deployment:

1. Inventory all received/accepted/queued/executing/reconciling rows.
2. Inventory all rate keys, in-flight counters, reservations, leases, ownership rows, and queue entries.
3. Compare lifecycle state with broker/MT5 order, deal, and position truth.
4. Compare DB orders, deals, positions, account ledger, account snapshot, outbox, Journal, and caches.
5. Identify accepted-but-unqueryable commands, executed-but-unpersisted trades, missing deals, missing positions, missing account revisions, and orphaned permits.
6. Reconcile ambiguous outcomes against the broker before releasing ownership or allowing another submission.
7. Backfill client_order_id and revisions only where identity can be proven.
8. Recompute account state from the authoritative ledger/broker position set using documented rules.
9. Purge or version stale caches only after durable truth is repaired.
10. Produce a redacted repair report for TEST account 200001.

Do not:

- delete idempotency/lifecycle rows to hide stuck commands;
- fabricate tickets;
- mark an order rejected merely because local persistence is missing;
- replay a broker submission while outcome is unknown;
- release a lease without fencing the old worker;
- rewrite financial history without an auditable migration and rollback plan.

## **13. REQUIRED AUTOMATED TEST AND FAULT MATRIX**

Use a deterministic fake/stub broker for concurrency, crash, and latency tests.

### 13.1 Basic execution

1. One WebSocket Buy: accepted, filled, exact IDs, authoritative tickets, deal, position, account revision, all events.
2. One WebSocket Sell with the same guarantees.
3. One REST Buy with synchronous 200 Position compatibility.
4. One REST Sell.
5. XAUUSD, BTCUSD, a forex symbol, and an instrument requiring cross-currency margin conversion.
6. Disabled SL/TP omitted on WS and compatible zero/omission behavior on REST.
7. Positive SL/TP validation and persistence.

### 13.2 Idempotency and ordering

8. Same UUID and same intent replayed 100 times over WS.
9. Same UUID and same intent replayed across REST and WS concurrently.
10. Same UUID with changed symbol, side, volume, SL, or TP.
11. Twenty unique orders completed in reverse response order.
12. Two backend instances race the same UUID.
13. Same numeric login under two different broker/tenant scopes.
14. Authentication refresh replays a REST request.
15. Status polls use new transport correlation where supported while preserving the original client_order_id.

Expected:

- one broker submission for one durable ID;
- no cross-correlation;
- deterministic 409 only for intent conflict;
- terminal replay returns the same result.

### 13.3 Admission, queue, and crash safety

16. Exact rate boundary: limit minus one, limit, limit plus one.
17. Exact burst boundary: capacity minus one, capacity, capacity plus one.
18. Queue exhaustion before admission.
19. Crash before admission commit.
20. Crash after admission commit and before queue publication.
21. Crash after dequeue and before broker send.
22. Crash after broker send and before broker acknowledgement.
23. Crash after broker result and before DB commit.
24. Crash after terminal commit and before outbox publication.
25. Worker lease expiry and fenced reclaim.
26. WebSocket disconnect before and after acceptance.
27. Reconnect/status lookup through a different instance.
28. Missing client ACK.
29. Thirty-to-sixty-minute soak proving no growth in leaked permits, leases, pending rows, or memory.

### 13.4 Persistence and reconciliation

30. Inject deal insert failure before any broker call.
31. Inject deal insert failure after broker execution.
32. Inject unique constraint, foreign key, permission, sequence, precision, timeout, deadlock, and serialization failures.
33. Duplicate broker callbacks.
34. Broker timeout followed by later confirmed fill.
35. Broker rejection after durable admission.
36. Reconciler restart and multiple reconciler race.

Expected:

- no duplicate broker call;
- rollback when safely pre-execution;
- RECONCILING when outcome is uncertain;
- eventual one terminal local representation;
- no order/deal/position/account split brain.

### 13.5 Quote and margin

37. Fresh quote accepted.
38. Stale quote at receipt rejected with the exact typed code.
39. Fresh quote aged by 2, 10, and 30 seconds of controlled queue delay and revalidated at execution.
40. /ws/feed/status, tick feed, REST quote, and executor use the same quote identity/TTL.
41. Insufficient margin uses one atomic pre-trade account revision.
42. One 0.01 leveraged fill changes used margin from zero to a correct nonzero value and changes free margin/level consistently.
43. Empty account returns zero used margin and documented not-applicable margin-level state.
44. Zero-margin instrument/account exception includes a configuration reason.
45. Open normal leveraged position plus zero used margin triggers an invariant failure, never a fabricated successful snapshot.
46. Currency conversion, hedged positions, netting positions, partial close, swap, commission, leverage change, and credit affect all account fields consistently.

### 13.6 State propagation and freshness

47. After a fill, positions, orders, deals, account, metrics compatibility channel, exact status, REST, and Journal share causal IDs and revisions.
48. Two connected clients on different gateway instances receive both position and account changes once.
49. Drop an account event; reconnect snapshot recovers it.
50. Drop a positions event while account messages continue; gap monitoring detects it and reconnect/resync recovers the position.
51. Explicit close, SL, TP, stop-out, and partial-close events remove/update the exact ticket.
52. Full positions snapshot with zero rows clears state in the versioned replacement consumer.
53. Older REST response arrives after newer WS event; lower revision is rejected by the coordinated client.
54. Older WS event arrives after newer event; revision never regresses.
55. Duplicate event_id is harmless.
56. Outbox publisher restarts with backlog.
57. Database replica/cache lag is injected.
58. Subscribe/reconnect snapshot and replay have no gap or duplicate state.
59. Account switch and broker switch cannot receive the previous scope's events.
60. Partial/uninitialized calculator/cache returns typed unavailable, never zero-filled HTTP 200.

### 13.7 Contract compatibility

61. Current WebSocket place_order request is accepted.
62. Current get_order_status request is accepted.
63. Current top-level accepted/filled/rejected envelopes parse exactly.
64. Current filled data includes a usable positive ticket and full Position fields.
65. Current REST payload without type remains accepted.
66. Current legacy REST receives synchronous 200; async 202 is opt-in only.
67. Query-token and any documented auth-frame method behave exactly as published.
68. account.{login} and temporary metrics.{login} compatibility mirror have identical revisions/values.
69. Analytics AccountMetrics remains schema-distinct from live portfolio state.

For every load/fault run, report:

    attempted
    received
    durably admitted
    not admitted by typed code
    queued
    executing
    filled
    business rejected
    reconciling
    missing/unqueryable
    broker submissions
    duplicate broker submissions
    order/deal/position/account invariant failures
    queue depth and oldest age
    permit/lease count before and after
    outbox lag
    p50/p95/p99/max for every phase

## **14. ACCEPTANCE CRITERIA**

Correctness:

- Every deliberate request has one durable client_order_id and at most one broker submission.
- Every accepted order is immediately queryable from any healthy instance.
- Every accepted order progresses to one terminal result or an explicitly owned/alerted reconciling state.
- Zero accepted-but-invisible orders.
- Zero duplicate broker executions.
- Zero missing deal/position/account records after a confirmed fill.
- Zero leaked permits or leases after terminal processing and fenced recovery.
- Terminal WS responses contain exact top-level correlation IDs and object-valued fill data.
- A normal filled leveraged position yields a nonzero correct used margin.
- REST, account WS, positions WS, orders, deals, status, and Journal agree at the same revision.
- Reconnect produces an authoritative full snapshot and catches up without regression.
- No backend payload contains fabricated zero metrics, Infinity, NaN, or blank numeric fields.
- No state/cache/idempotency key is scoped only by naked numeric login.

Compatibility:

- Existing WebSocket and synchronous REST clients keep working.
- Zero SL/TP omission remains supported.
- REST payload without type remains supported.
- account.{login} remains canonical or a documented versioned migration is delivered.
- metrics.{login} compatibility is explicit while the current client still subscribes.
- New async lifecycle shapes are introduced only with an opt-in/versioned client contract.

Performance under healthy staging dependencies:

- durable acceptance p95 at or below 250 ms and p99 at or below 500 ms;
- exact status p95 at or below 250 ms and p99 at or below 500 ms;
- account/position/outbox visibility p99 at or below 1 second;
- with a deterministic fast fake broker, terminal result p95 at or below 1 second and p99 at or below 2 seconds;
- zero generic in-flight/ownership/reservation failures for an approved 20-order isolated burst;
- backend queue, quote wait, broker, persistence, outbox, and delivery timing reported separately.

If the external broker cannot meet a terminal latency target, prove that with separate broker timings. Do not lower correctness, idempotency, visibility, or reconciliation guarantees.

## **15. REQUIRED MIGRATION AND ROLLOUT**

Deliver:

1. database migrations and rollback plan for idempotency, lifecycle, revisions, leases, and outbox;
2. existing-state reconciliation/backfill plan;
3. compatibility flags for canonical account events and optional async order flow;
4. rolling-deploy behavior across mixed backend versions;
5. cache invalidation/versioning plan;
6. dashboards and alerts before traffic migration;
7. isolated staging load/fault results;
8. minimal explicitly authorized TEST smoke;
9. rollback criteria based on duplicate risk, unqueryable orders, invariant errors, event lag, and latency;
10. post-deploy audit showing no stuck accepted state and no portfolio divergence.

Do not deploy a schema writer before all readers tolerate it. Do not remove legacy aliases/channels until client adoption is measured and the deprecation window ends.

## **16. REQUIRED BACKEND DELIVERY PACKAGE**

The task is not complete with a diagnosis alone. Return:

- exact current root cause or roots, with source file/function and correlated evidence;
- clear separation of no-send, not-admitted, accepted, executing, broker outcome, persistence, and fan-out failures;
- implementation changes;
- migration and rollback files;
- updated OpenAPI and WebSocket documentation;
- canonical account/position/order/status/Journal schemas;
- final distributed rate-policy configuration, burst allowance, capacity limits, and rationale;
- test code and full results;
- before/after phase latency and reliability metrics;
- multi-instance and fault-injection evidence;
- safely redacted current TEST verification;
- existing-state repair results;
- deployment/rollback steps;
- explicit confirmation that no 20-order or 100-order burst test was run against a real account;
- every remaining frontend change required to consume revisions, freshness, snapshot replacement, or new lifecycle states;
- one completed, copy-paste-ready Frontend Implementation Handoff section inside this same document, meeting SECTION D below.

## **SECTION D — FRONTEND IMPLEMENTATION HANDOFF (SAME FILE)**

After implementing and verifying the backend work, complete this SECTION D and return this one combined Markdown document only. Do not create a second frontend file.

The completed SECTION D must be ready to copy directly into a frontend coding-agent task while remaining part of this combined file. Do not return a separate artifact, contract link alone, change log, short checklist, or prose summary.

Begin the completed SECTION D with this explicit context:

    The user-facing problem occurs in the frontend: a submitted trade can appear
    missing or pending, Margin can show 0, Margin Level can show infinity, and
    account/position values can remain stale. The backend portion has now been
    implemented and verified. Update the frontend to consume the finalized
    backend contract below, remove the remaining client-side races and stale
    fallbacks, and prove the complete behavior with automated and runtime tests.

The same-file Frontend Implementation Handoff section must contain all of the following.

### **D1. PROVEN BACKEND RELEASE INFORMATION**

- backend repository and service names;
- backend commit SHA or release identifier;
- API schema/OpenAPI version;
- WebSocket schema version;
- environment where it is deployed and verified;
- rollout or feature-flag requirements;
- compatibility and deprecation dates;
- endpoints and channels that are ready now;
- anything proposed but not yet deployed, clearly marked BLOCKED and excluded from frontend implementation.

Do not ask the frontend team to code against an undeployed design.

### **D2. EXACT FINALIZED WIRE CONTRACT**

Include copy-paste JSON examples from the implemented backend for:

- WebSocket place_order;
- order_accepted;
- order_filled;
- order_rejected;
- get_order_status request and every possible response state;
- synchronous REST market-order success and typed error;
- optional asynchronous REST behavior, only if actually implemented;
- full account snapshot;
- full positions snapshot;
- position opened/updated/closed deltas;
- orders and deals events;
- reconnect/resume success;
- sequence-gap/resync instruction;
- stale or temporarily unavailable portfolio state.

For every example, document:

- required and optional fields;
- scalar types and nullability;
- top-level versus nested correlation fields;
- timestamp unit and timezone;
- numeric precision;
- schema_version;
- snapshot_kind;
- event_id;
- lifecycle_revision;
- portfolio_revision;
- broker/account scope;
- client_order_id, request_id, order ticket, deal ticket, and position ticket semantics.

Redact secrets and real private identifiers, but do not replace structural fields with vague prose.

### **D3. OLD-TO-NEW COMPATIBILITY MAP**

Provide a table mapping every currently consumed field/channel to the final canonical value:

    current frontend input
    final canonical input
    temporary compatibility alias
    removal date
    required frontend action

Cover at least:

- margin | used_margin | margin_used | marginUsed;
- margin_free | free_margin | free_margin_amount | margin_available;
- floating | floating_pnl | profit | unrealized_pl;
- account.{login};
- metrics.{login};
- positions.{login};
- orders.{login};
- deals.{login};
- current REST /account/{login};
- current REST /account/{login}/metrics;
- canonical portfolio snapshot/resync route.

State clearly whether metrics.{login} is a temporary live-account mirror or a separate analytics channel. Do not leave the frontend to guess from payload shape.

### **D4. REQUIRED FRONTEND ORDER-LIFECYCLE WORK**

The same-file frontend section must instruct the frontend team to:

1. Keep one UUID-v4 client_order_id for the full user action.
2. Keep request_id as transport correlation, separate from durable identity.
3. Never create a second order after WebSocket send, acceptance, disconnect, timeout, or unknown status.
4. Reconcile the original client_order_id through the finalized exact-status contract.
5. Parse only the finalized versioned terminal envelopes and validate both IDs.
6. Preserve synchronous REST compatibility and opt into async REST only when explicitly supported.
7. Keep a provisional row visibly tied to its durable client_order_id.
8. Represent accepted, queued, executing, reconciling, filled, rejected, not-admitted, and unknown states according to the implemented backend contract.
9. Replace a provisional row only with an authoritative positive ticket.
10. Never infer non-admission from 404, an empty positions list, a cache miss, or a local timeout.
11. Surface typed backend rejection codes accurately.
12. Fix the F9/New Order path so a rejected placement rejects the submit callback and the dialog does not close as if successful.
13. Propagate every supported order field, or explicitly disable unsupported controls rather than silently dropping intent.

### **D5. REQUIRED FRONTEND PORTFOLIO-REVISION AND FRESHNESS WORK**

The same-file frontend section must specify the exact client algorithm using the backend's implemented fields:

1. Scope state by authenticated broker/tenant plus account login.
2. Store the highest applied portfolio_revision for that scope.
3. Reject an account, positions, order, or deal packet with a lower revision.
4. Deduplicate repeated event_id values.
5. Define how multiple events sharing one revision are applied atomically.
6. Detect revision gaps and call the finalized snapshot/resync route.
7. Treat snapshot_kind = full as authoritative replacement.
8. Treat snapshot_kind = delta only as the documented patch.
9. Clear a closed position by its explicit ticket.
10. Do not let a delayed REST response overwrite newer WebSocket state.
11. On reconnect, obtain a full snapshot and resume after its revision.
12. Track freshness separately for account, positions, orders, deals, and quotes; one noisy channel must not make every channel appear healthy.
13. Define heartbeat and stale TTL values exactly from the backend contract.
14. Show disconnected/stale/unavailable state instead of indefinitely presenting old values as live.
15. Cancel and ignore responses from an old broker/account session.

Include pseudocode for revision comparison, gap recovery, and atomic snapshot application based on the actually implemented backend semantics.

### **D6. REQUIRED FRONTEND ACCOUNT AND MARGIN WORK**

The same-file frontend section must instruct the frontend team to:

- keep account balance, equity, used margin, free margin, margin level, floating P/L, credit, currency, leverage, and position count backend-authoritative;
- never calculate or invent authoritative account margin from browser ticks;
- consume the final canonical field names;
- keep aliases only for the documented migration window;
- add an explicit hasBackendMargin or equivalent availability state;
- stop coercing missing, blank, invalid, NaN-like, or uninitialized financial values to a real-looking zero;
- distinguish zero from unavailable;
- consume margin_level_state;
- render a documented not-applicable value for zero used margin without expecting JSON Infinity;
- treat a normal open leveraged position plus zero used margin as inconsistent state and trigger resync/error presentation;
- remove the unconditional assumption that every funded-account balance transition to zero is a bogus packet; use revision, snapshot authority, and backend availability semantics instead;
- never mix fields from different portfolio revisions into one displayed account snapshot.

The prompt must explain exactly when the product should display:

    0.00
    infinity
    a dash/unavailable state
    a stale/disconnected warning
    an invariant-error/resync state

These rules must match the implemented backend contract.

### **D7. ACTIVE FRONTEND FILES AND CONSOLIDATION SCOPE**

Tell the frontend team to begin with the currently active path:

    src/components/dock/DockWorkspace.tsx
    src/components/BottomDock.tsx
    src/components/BottomDock.trade.ts
    src/hooks/useToolboxTradeData.ts
    src/services/api.ts
    src/api/tradeSocket.ts
    src/api/endpoints.ts
    src/App.tsx
    src/services/accountSocketManager.ts
    src/services/tradeStartupSnapshot.ts

Require them to verify which secondary account/position writers are still mounted. Consolidate or coordinate duplicate writers so App, Trade, Exposure, toolbar, and charts cannot apply different aliases or revisions.

Identify src/components/Toolbox.tsx and src/components/PositionsPanel.tsx as legacy/dormant unless runtime evidence proves another entry bundle mounts them. Do not accidentally “fix” only the inactive surface.

### **D8. FRONTEND AUTOMATED TESTS REQUIRED**

The same-file frontend section must include concrete tests for:

- successful WS and REST placement;
- typed rejection that keeps the F9 dialog open;
- accepted/queued/executing/reconciling/terminal presentation;
- status timeout without duplicate resubmission;
- strict top-level ID correlation;
- reverse-order completion of multiple orders;
- same durable ID across reconnect;
- authoritative ticket replacement;
- delayed old REST response after newer WS state;
- out-of-order and duplicate revisions;
- revision gap and resync;
- full empty positions snapshot clearing stale rows;
- explicit close/SL/TP/stop-out removal;
- account event arriving without a position event;
- per-channel freshness and broken positions channel;
- disconnect/reconnect snapshot;
- broker/account switching;
- missing, blank, null, zero, and Money-object financial values;
- no-position zero-margin not-applicable presentation;
- normal open position with zero margin invariant handling;
- legitimate authoritative balance transition to zero;
- account and position fields never mixed across revisions;
- legacy alias compatibility during the documented window;
- removal behavior after compatibility flags are disabled.

Require focused tests, integration tests, and a real-browser runtime reproduction against the deployed backend contract.

### **D9. FRONTEND ACCEPTANCE CRITERIA**

The same-file frontend section must require proof that:

- one click produces one durable command and never a duplicate;
- every provisional row reaches an accurate visible state;
- a backend fill produces an authoritative ticket and visible position without manual refresh;
- Margin changes from zero after a normal leveraged fill;
- Free Margin and Margin Level match the backend snapshot;
- no older REST or WebSocket packet can regress displayed state;
- an empty full snapshot clears old positions;
- reconnect recovers missed updates;
- stale channels are visibly stale, not silently treated as live;
- Trade, Exposure, toolbar, and other active consumers show the same portfolio revision;
- the F9 dialog remains open and displays the backend reason on rejection;
- all relevant frontend tests and final browser verification pass.

### **D10. FRONTEND DELIVERY FORMAT**

Require the frontend team to return:

    1. Implemented files and rationale
    2. Final order lifecycle behavior
    3. Revision/snapshot/freshness algorithm
    4. Margin and unavailable-state presentation rules
    5. Duplicate data-writer consolidation
    6. Tests added and full results
    7. Browser reproduction before and after
    8. Network evidence with redacted IDs/revisions
    9. Compatibility flags and cleanup date
    10. Remaining blockers

The backend team must complete this section from the contract it actually implemented. Do not copy proposed examples from the backend portion if the implemented names, states, routes, nullability, or revision rules differ. Replace every placeholder with the real tested contract. Return the backend implementation report and the completed frontend handoff as sections of this one file.

Use this final response structure:

    1. Executive root cause
    2. Evidence timeline for each captured client_order_id
    3. Exact old backend code/configuration paths
    4. Database, queue, lease, broker, cache, and outbox findings
    5. Implemented durable order lifecycle
    6. Implemented canonical portfolio state and margin semantics
    7. REST and WebSocket contract changes
    8. Existing-state audit and repair
    9. Unit/integration/load/fault test results
    10. Before/after latency and consistency measurements
    11. Dashboards and alerts
    12. Migration, deployment, rollback, and compatibility plan
    13. Completed same-file Frontend Implementation Handoff section
    14. Frontend contract handoff summary
    15. Remaining risks

## **SECTION E — ALL-SYMBOL OHLC HISTORY AND LIVE-STREAM INTEGRITY (BACKEND FIX + FRONTEND RETURN HANDOFF)**

This section is mandatory and applies to every broker symbol and every supported timeframe, not only XAUUSD M1. Treat the historical REST response, live tick stream, live candle stream, symbol catalog, and reconnect snapshot as one versioned market-data contract. The objective is MetaTrader/TradingView-style behavior: exact broker-symbol identity, one coherent price scale, UTC-aligned timeframe buckets, immutable finalized bars except for explicit authoritative corrections, one forming bar updated from real source ticks or server candle updates, preserved real gaps, explicit staleness, and deterministic recovery after disconnect.

### **E1. CONFIRMED CURRENT EVIDENCE — DO NOT ATTRIBUTE THIS TO CHART DRAWING**

Authenticated evidence for XAUUSD M1 with `limit=5000` returned 1,887 rows containing two incompatible price bands:

- 593 rows are in the approximately `43.xx–44.xx` band;
- 1,294 rows are in the approximately `4302–4507` band;
- at the boundary, the candle at `2026-09-03 14:32:00 UTC` is approximately `44.77085`, while the next one-minute candle is approximately `4477.32`.

That is a roughly 100x discontinuity between consecutive M1 rows for one exact symbol series. It is authoritative evidence of mixed-scale, mixed-source, contaminated-cache, storage, migration, or normalization behavior upstream of rendering. The backend team must trace and prove the exact cause through ingestion, normalization, persistence, cache, aggregation, pagination, and response serialization. Do not ask the frontend to multiply or divide old rows to hide it.

The latest 500 XAUUSD M1 rows also contain 13 separate gap intervals with 129 absent one-minute buckets; the largest gap has 27 missing interior minutes. Determine for each gap whether it is a legitimate no-trade/session/source gap or backend loss. A legitimate gap must remain a gap. A lost interval must be recovered only from an authoritative source. Neither backend nor frontend may invent flat candles or interpolate OHLC.

Direct live-stream evidence is symbol-dependent:

- fresh XAUUSD, EURUSD, BTCUSD, and NAS100-F subscriptions emit live data;
- at least one exact dotted symbol, `MAERSKB.DK`, receives a subscription acknowledgement but emits no ticks or candles during the observed window.

A subscription acknowledgement proves only that the request was accepted; it does not prove that the upstream feed is live or that the symbol has usable data. Backend health, freshness, and observability must therefore be measured per exact broker symbol and per channel.

### **E2. REQUIRED ROOT-CAUSE TRACE AND DATA REPAIR**

Inspect the real path for every history and stream producer:

1. broker/upstream tick and bar adapters;
2. symbol catalog, alias mapping, contract metadata, digits, point size, price multiplier, and corporate-action metadata;
3. raw tick/bar normalization;
4. M1 storage keys, uniqueness constraints, partitions, migrations, and backfills;
5. higher-timeframe aggregation;
6. Redis or other cache keys and cache-version invalidation;
7. REST history query, ordering, filtering, pagination, and serialization;
8. WebSocket subscription routing, acknowledgement, snapshot, delta, heartbeat, reconnect, and unsubscribe behavior;
9. multi-instance pub/sub fan-out and sequence ownership;
10. broker/account/tenant routing so data from one source cannot enter another source's series.

For the exact XAUUSD boundary above, return a timestamp-correlated trace showing the stored raw value, the normalized value, symbol metadata/version, ingestion source, cache key/version, database record, and final REST payload on both sides of the discontinuity. Identify when and by which deployment, migration, feed adapter, or backfill the wrong-band rows were written.

Quarantine or repair the 593 wrong-band rows only when an authoritative source proves their correct identity and values. Never apply a blanket `x100` rewrite based solely on visual similarity. If a trustworthy reconstruction is unavailable, exclude the contaminated generation from the active series, mark the affected range unavailable, retain it in forensic storage, and publish the affected interval and reason. Version and invalidate every cache that could continue serving the contaminated rows after repair.

Audit every supported symbol for the same class of contamination, not just XAUUSD. The audit must detect mixed source IDs, scale/digits changes, duplicate buckets, out-of-order rows, future timestamps, invalid OHLC ranges, cross-symbol leakage, and discontinuities inconsistent with authoritative quote/contract metadata. A percentage-jump detector may raise an investigation alert, but it must not automatically rescale or delete legitimate market moves.

At every materially changed backend production-code decision point, add a concise language-appropriate `FIX` comment that explains the history, identity, finality, ordering, reconnect, or staleness invariant being protected. Do not comment unchanged code or merely restate syntax, and do not use comments as a substitute for versioned contract documentation and tests.

### **E3. NON-NEGOTIABLE ALL-SYMBOL HISTORY INVARIANTS**

Implement and document these invariants:

- **Exact identity:** key and route data by authenticated tenant/broker/feed plus the exact case-normalized broker symbol and timeframe. Preserve meaningful punctuation and suffixes such as dots and hyphens. Do not use prefix, suffix stripping, substring matching, or a base-symbol fallback (`MAERSKB.DK` must never resolve as `MAERSKB`, and `NAS100-F` must never resolve as `NAS100`).
- **One series generation:** each response must identify `symbol`, `timeframe`, `price_basis`, `digits`, `point_size`, `source_id`, and a stable `series_id` or `series_revision`. A response must never mix incompatible source/scale generations.
- **One documented price basis:** use the broker's documented chart basis consistently (normally Bid for MetaTrader-style charts). Do not construct one candle from mixed Bid/Ask/Last values or add spread to historical bars.
- **Canonical timestamps:** use UTC and one documented wire unit. `open_time` is the exact floor to the timeframe boundary; define `close_time` semantics explicitly. Reject ambiguous local-time timestamps. Store and serialize enough precision for source-event ordering.
- **Valid OHLC:** every accepted candle contains finite numeric values with `low <= min(open, close) <= max(open, close) <= high`, positive prices where the instrument requires them, and values consistent with the declared digits/scale metadata. Invalid rows are rejected and observable, not silently repaired into plausible values.
- **Deterministic uniqueness and order:** the authoritative uniqueness key includes tenant/broker/feed, exact symbol, timeframe, and `open_time`. Responses are strictly ascending by `open_time`, contain no duplicate buckets, and implement deterministic cursor pagination without boundary duplication or omission.
- **Final versus forming:** finalized historical bars are explicitly `closed=true`/`is_final=true`; the current bar is explicitly `closed=false`/`is_final=false`. At most one forming candle exists per exact series. Do not infer finality from client wall-clock time alone.
- **Final-bar corrections:** a finalized candle is immutable unless the authoritative upstream sends a documented correction with a higher `candle_revision`. Corrections replace that exact bucket; they never create a second copy.
- **Real gaps remain visible:** missing source buckets remain absent and may be described by optional gap metadata. Do not interpolate, forward-fill, backfill from a later close, synthesize zero-volume bars, or snap a timestamp into another bucket merely to make the chart continuous.
- **Deterministic aggregation:** when higher timeframes are produced from M1 or ticks, use UTC calendar-aligned buckets and only authoritative source rows. `open` is the first source open, `high` the maximum high, `low` the minimum low, `close` the last source close, and volume the documented sum. Propagate completeness/finality and gap metadata; do not mark an incomplete aggregate as complete.

The history response must include enough metadata for the frontend to validate rather than guess. Publish a finalized, versioned example such as:

```json
{
  "schema_version": 2,
  "snapshot_kind": "full",
  "broker_id": "TEST",
  "symbol": "XAUUSD",
  "timeframe": "M1",
  "price_basis": "bid",
  "digits": 2,
  "point_size": 0.01,
  "source_id": "<authoritative-feed-id>",
  "series_id": "<stable-series-generation>",
  "series_revision": 42,
  "server_time": "<RFC3339 UTC>",
  "candles": [
    {
      "open_time": "<RFC3339 UTC timeframe boundary>",
      "open": 4474.75,
      "high": 4474.82,
      "low": 4473.88,
      "close": 4474.29,
      "volume": 143,
      "is_final": true,
      "candle_revision": 1
    }
  ],
  "gaps": [
    {
      "from_open_time": "<RFC3339 UTC>",
      "to_open_time": "<RFC3339 UTC>",
      "reason": "no_source_data"
    }
  ]
}
```

Use the actual implemented names in the delivered contract. Do not expose this illustrative payload as final documentation until the code and tests use the same fields.

### **E4. LIVE TICK/CANDLE, FINALITY, STALENESS, AND RECONNECT CONTRACT**

The backend must publish a single documented lifecycle for every exact symbol/timeframe:

1. validate and authorize the exact requested symbol;
2. return a typed subscription acknowledgement containing exact symbol, timeframe, channel, stream/session epoch, latest sequence, and current data state;
3. deliver an authoritative full snapshot or a resumable starting point before applying deltas;
4. emit ticks/candle updates with canonical source timestamp, server receive timestamp, exact identity, monotonic sequence within the stream epoch, and unique event ID;
5. update the forming candle from actual source data so high can only increase, low can only decrease, and close reflects the latest accepted source event in source-time/sequence order;
6. explicitly finalize the completed bucket and begin the next forming bucket only when authoritative time/source semantics permit it;
7. on an explicit upstream correction, replace the exact bucket using a higher candle revision;
8. publish heartbeats and per-channel freshness independent of subscription acknowledgement;
9. on disconnect, reconnect with bounded backoff and resume from the last acknowledged epoch/sequence when retained; otherwise require a new authoritative snapshot;
10. detect sequence gaps, duplicates, out-of-order events, and epoch changes. Dedupe replays and force resnapshot when loss cannot be recovered exactly.

Define and document these fields or exact equivalents: `schema_version`, `broker_id`/tenant, exact `symbol`, `timeframe`, `channel`, `stream_epoch`, `sequence`, `event_id`, `source_time`, `server_time`, `snapshot_kind`, `series_id`, `series_revision`, `candle_revision`, `is_final`, `data_state`, `last_source_event_at`, `stale_after_ms`, and `stale_reason`.

Timestamp-less market-data deltas are invalid. An older source event or lower candle revision must never overwrite newer state. A reconnect snapshot defines an atomic baseline, and buffered deltas apply only when their epoch/sequence is provably after that baseline.

For an acknowledged-but-silent symbol such as `MAERSKB.DK`, distinguish at least:

- `live`: a source event is inside the documented freshness window;
- `idle_market` or `market_closed`: no event is expected because of an authoritative session state;
- `stale`: data was expected but the last source event exceeded the TTL;
- `unavailable`: the upstream has no usable subscription/data for this exact symbol;
- `recovering`: reconnect/backfill/resnapshot is in progress.

Do not report `connected` or `healthy` merely because the WebSocket transport is open, a heartbeat is moving, or the server returned an ACK. Expose metrics and alerts by broker/feed, exact symbol, channel, and timeframe for ACK-to-first-data latency, source age, missing sequences, reconnects, snapshot failures, invalid OHLC, rejected timestamps, and silent subscriptions.

### **E5. REQUIRED FRONTEND IMPLEMENTATION AFTER THE BACKEND CONTRACT IS DEPLOYED**

The backend team must return a copy-paste-ready frontend task based on the contract actually implemented and deployed. That frontend task must require the frontend team to:

- preserve exact symbol identity, including dots, hyphens, suffixes, broker, feed, and timeframe; never perform fuzzy symbol matching or broadcast one base-symbol update to related symbols;
- validate response metadata before accepting history or stream events and reset chart state atomically when broker, account, exact symbol, timeframe, `series_id`, or stream epoch changes;
- render backend OHLC values exactly as supplied for the matching series. Never multiply/divide prices, guess decimal scale, add spread, change timezone, repair malformed ranges, snap bars into another bucket, interpolate gaps, or synthesize candles/ticks;
- reject/quarantine invalid or mismatched-series rows and show a visible partial-history/unavailable state instead of drawing misleading candles;
- preserve legitimate blank time intervals on the time axis according to the chart product's documented session/gap mode;
- load the authoritative ordered history snapshot first, then apply only buffered events whose epoch/sequence/source time is after that snapshot baseline;
- upsert by exact symbol + timeframe + open time; update one forming candle, replace an exact finalized/corrected candle, and never append a duplicate bucket;
- use explicit backend `is_final`/revision semantics. Do not finalize bars from browser wall-clock rollover or fabricate a new bar because the clock advanced without a source event;
- deduplicate event IDs/sequences, reject regressions, detect sequence gaps, and resnapshot rather than guessing missing state;
- display per-series `live`, `idle/closed`, `stale`, `unavailable`, and `recovering` states from the backend contract; do not let a transport ACK or unrelated fresh symbol hide a stale exact symbol;
- keep the last valid chart visible only with a clear stale/disconnected marker and source age; never present cached data as currently live;
- add concise `// FIX:` comments at every materially changed production-code decision point explaining the invariant being protected, without commenting unchanged code or merely restating syntax.

The frontend must not use the XAUUSD discontinuity as a hardcoded threshold or symbol-specific exception. The implementation and tests must cover arbitrary price magnitudes, fractional instruments, exact dotted/hyphenated symbols, every supported timeframe, valid discontinuous markets, and symbols with no emitted data.

### **E6. MANDATORY BACKEND AND FRONTEND ACCEPTANCE TESTS**

Backend acceptance is blocked until all of these pass with saved requests, responses, stream captures, database/cache evidence, and test output:

1. An authenticated XAUUSD M1 `limit=5000` query returns one coherent, declared series generation and price scale; it does not contain the observed `44.77085 -> 4477.32` adjacent-minute contamination.
2. The 593 wrong-band records are traced and either authoritatively repaired or explicitly quarantined with cache invalidation and an auditable report.
3. The latest-500 gap audit accounts for all 13 observed intervals and 129 absent minutes, including the 27-minute largest missing interior; recovered source loss is restored authoritatively and legitimate gaps remain absent.
4. A cross-symbol matrix covers forex, metals, crypto, an index symbol containing a hyphen, an exchange symbol containing a dot, differing digits/point sizes, and every supported timeframe. No fuzzy-key collision or cross-symbol data leakage is allowed.
5. REST history pagination is strictly ordered, duplicate-free, stable at page boundaries, and consistent under the requested limit.
6. Invalid OHLC, timestamp unit mistakes, local-time/DST mistakes, out-of-order source events, duplicate buckets, mixed scale/source generations, future bars, and stale cache generations are rejected or quarantined with typed observability.
7. Tick-to-M1 and M1-to-higher-timeframe fixtures prove exact UTC bucketing and OHLC/volume aggregation, including sparse periods and a legitimate gap.
8. Live XAUUSD, EURUSD, BTCUSD, and NAS100-F prove ACK, snapshot, ordered forming updates, explicit finalization, heartbeat/freshness, and deterministic reconnect.
9. `MAERSKB.DK` and another silent/closed-market fixture prove that ACK-without-data transitions to the correct `idle_market`, `stale`, or `unavailable` state within the documented TTL and never reports false live health.
10. Disconnect during a forming candle, duplicate replay, missing sequence, epoch change, snapshot/delta race, late old tick, and authoritative final-candle correction all recover without duplicate, regressed, fabricated, or lost candles.
11. Multi-instance fan-out gives all clients the same ordered series and revisions after reconnect.
12. Frontend unit/integration tests prove exact symbols, metadata rejection, history-before-live merge, partial/final replacement, correction revision, gap preservation, stale display, broker/symbol/timeframe switching, reconnect/resnapshot, and zero candle synthesis.
13. A real-browser authenticated verification shows the same candle values/times as the captured REST/stream data, a real forming-candle update and rollover/finalization, a legitimate gap left visible, and a silent symbol shown as non-live. Redact credentials and tokens.

Do not call the work complete from a single screenshot, a WebSocket ACK, one active symbol, unit tests alone, or frontend visual improvement while the backend still serves contaminated history.

### **E7. EXACT FRONTEND RETURN-REPORT TEMPLATE — COMPLETE EVERY FIELD**

After the frontend implements the finalized backend contract, it must return the following report with every placeholder replaced by actual evidence. This report remains part of this one combined document; do not create another prompt file.

```markdown
## **FRONTEND OHLC/HISTORY/STREAM IMPLEMENTATION RETURN REPORT**

### **1. BACKEND CONTRACT CONSUMED**
- Backend release/commit:
- Environment and broker/feed:
- REST schema version and history endpoint:
- WebSocket schema version and tick/candle channels:
- Exact identity fields:
- Timestamp unit/timezone and bucket rule:
- Series/stream epoch, sequence, revision, finality, and stale-TTL fields:

### **2. FRONTEND ROOT CAUSE CONFIRMED**
- Old history handling defect(s), with file/function/line:
- Old live-stream handling defect(s), with file/function/line:
- Why the mixed XAUUSD bands were drawn:
- Why gaps, forming/final candles, or stale symbols were previously misleading:

### **3. IMPLEMENTED FILES AND INVARIANTS**
| File/function | Change | Protected invariant | `// FIX:` comment added |
|---|---|---|---|
| `<path>` | `<actual change>` | `<identity/history/finality/order/staleness rule>` | `<line or yes>` |

### **4. EXACT HISTORY ALGORITHM**
- Metadata validation:
- Atomic snapshot replacement:
- Series mismatch/invalid OHLC behavior:
- Ordering/deduplication key:
- Real-gap rendering behavior:
- Confirmation that no scaling, timezone guessing, interpolation, range repair, or candle synthesis remains:

### **5. EXACT LIVE AND RECONNECT ALGORITHM**
- Subscribe/ACK/snapshot sequence:
- Buffered-delta rule:
- Forming-candle update rule:
- Final/correction replacement rule:
- Epoch/sequence/event dedupe and gap recovery:
- Disconnect/reconnect/resnapshot rule:
- Per-symbol stale/idle/unavailable presentation:

### **6. ALL-SYMBOL VERIFICATION MATRIX**
| Exact symbol | Timeframe | REST rows/order/scale | Tick events | Candle events | Forming/final observed | Reconnect result | Final data state |
|---|---:|---|---:|---:|---|---|---|
| XAUUSD | M1 | `<evidence>` | `<count>` | `<count>` | `<evidence>` | `<evidence>` | `<live/stale/etc.>` |
| EURUSD | M1 | `<evidence>` | `<count>` | `<count>` | `<evidence>` | `<evidence>` | `<state>` |
| BTCUSD | M1 | `<evidence>` | `<count>` | `<count>` | `<evidence>` | `<evidence>` | `<state>` |
| NAS100-F | M1 | `<evidence>` | `<count>` | `<count>` | `<evidence>` | `<evidence>` | `<state>` |
| MAERSKB.DK | M1 | `<evidence>` | `<count>` | `<count>` | `<evidence>` | `<evidence>` | `<idle/stale/unavailable>` |
| `<additional digits/timeframe fixtures>` | `<tf>` | `<evidence>` | `<count>` | `<count>` | `<evidence>` | `<evidence>` | `<state>` |

### **7. XAUUSD CONTAMINATION AND GAP PROOF**
- Before: 1,887 rows; 593 in `43.xx–44.xx`, 1,294 in `4302–4507`; exact boundary evidence:
- After: price-band/series-generation counts and exact boundary evidence:
- Latest-500 gap audit before/after:
- Why every remaining gap is legitimate, or backend blocker for every unexplained gap:
- Confirmation that the frontend did not rescale or fabricate any row:

### **8. AUTOMATED VERIFICATION**
- Focused test commands and exact pass/fail totals:
- Full typecheck command/result:
- Production build command/result:
- Full-suite command/result, with unrelated pre-existing failures separated:
- Fixtures for exact symbols, gaps, partial/final, corrections, ordering, reconnect, and staleness:

### **9. PHYSICAL BROWSER AND NETWORK PROOF**
- Authenticated account/broker used (no credentials):
- Browser route, exact symbol, and timeframe:
- REST request ID/time and redacted payload evidence:
- WebSocket subscription/snapshot/sequence evidence:
- Forming update and explicit finalization observed:
- Gap rendering observed:
- Silent-symbol stale/idle/unavailable behavior observed:
- Before/after screenshots or recording references:

### **10. REGRESSION AND SAFETY CONFIRMATIONS**
- Exact punctuation/suffix identities preserved:
- No fuzzy symbol fallback:
- No price rescaling or spread-added chart OHLC:
- No timezone guessing or bucket snapping:
- No interpolated/flat/synthetic candles:
- No older event overwrites a newer event:
- No ACK-only false-live status:
- Broker/account/symbol/timeframe switches clear incompatible state:

### **11. REMAINING BLOCKERS**
- `NONE`, or each blocker with owner, exact endpoint/channel, captured evidence, impact, and required backend/frontend action:

### **12. FINAL VERDICT**
- History integrity: `PASS/BLOCKED`
- Live forming/final integrity: `PASS/BLOCKED`
- Reconnect/sequence integrity: `PASS/BLOCKED`
- All-symbol exact-identity integrity: `PASS/BLOCKED`
- Staleness truthfulness: `PASS/BLOCKED`
- Ready for production: `YES/NO`
```

The frontend return report must contain measured evidence, not statements such as “works now.” Any backend-owned unresolved contamination, unexplained data loss, silent stream, missing finality, or absent sequence/resume contract must be reported as **BLOCKED** and must not be hidden by frontend logic.

## **17. PROHIBITED SHORTCUTS**

Do not:

- merely increase the in-flight counter;
- add an unbounded queue;
- globally serialize all accounts;
- retry an accepted or uncertain order as a new order;
- generate a new client_order_id during recovery;
- treat 404, an empty position list, or cache miss as proof of non-admission;
- rely on process memory for authoritative lifecycle state;
- keep separate REST and WebSocket idempotency paths;
- require browser ACK to release capacity;
- fabricate tickets or account metrics;
- send JSON Infinity or NaN;
- convert missing/uninitialized account fields to zero;
- publish partial financial snapshots without explicit versioned delta semantics;
- publish account state without the causal position/order/deal state;
- rely on array omission to communicate a close;
- use timestamp alone as an ordering guarantee;
- key by login alone;
- hide queue delay inside quote-stale;
- substitute preview required_margin for current used margin;
- return generic errors without admission semantics;
- change legacy REST to implicit 202;
- declare completion from unit tests only;
- run burst tests against a real account;
- call the work fixed while an accepted order can remain unqueryable or a filled leveraged position can show zero used margin.

## **18. FRONTEND SOURCE MAP FOR CONTRACT VERIFICATION**

| Concern | Current source |
|---|---|
| Active dock Trade surface | src/components/dock/DockWorkspace.tsx:213-229 |
| Active Trade data ownership | src/components/BottomDock.tsx:320-325 and 529-550 |
| One-click gates and dispatch | src/components/OneClickTrading.tsx:165-257 |
| Shared market-order service | src/services/api.ts:530-744 |
| REST payload normalization | src/api/endpoints.ts:91-112 and 515-516 |
| REST request deadline | src/api/client.ts:662-728 |
| WebSocket placement/correlation | src/api/tradeSocket.ts:407-604 |
| Status recovery and timeout | src/api/tradeSocket.ts:691-733 |
| Strict terminal routing | src/api/tradeSocket.ts:736-785 |
| Active account aliases/merge | src/hooks/useToolboxTradeData.ts:79-163 |
| Active REST account/positions load | src/hooks/useToolboxTradeData.ts:722-841 |
| Active refresh triggers | src/hooks/useToolboxTradeData.ts:866-918 |
| Active WS subscriptions/updates | src/hooks/useToolboxTradeData.ts:1057-1200 |
| Position patch/full-row rules | src/hooks/useToolboxTradeData.ts:247-348 and 493-512 |
| Backend-authoritative footer | src/components/BottomDock.trade.ts:102-158 |
| Infinity display rule | src/components/BottomDock.tsx:1009-1013 |
| Pending Ticket rendering | src/components/BottomDock.tsx:1667-1700 |
| App secondary account/position flow | src/App.tsx:2210-2340 and 2401-2517 |
| Account socket secondary normalizer | src/services/accountSocketManager.ts:71-81 and 205-351 |
| Broker session/routing | src/services/brokerSession.ts:55-117 and 987-1049 |
| OpenAPI WebSocket channels/auth | swagger.yaml:216-272 |
| OpenAPI account endpoints | swagger.yaml:1069-1115 |
| OpenAPI order placement | swagger.yaml:1493-1554 |
| OpenAPI Account schema | swagger.yaml:4587-4640 |
| Conflicting AccountMetrics schema | swagger.yaml:4642-4686 |
| OpenAPI Order schema | swagger.yaml:4937-4969 |
| Merged historical burst/live evidence | Section 6.3 and SECTION A of this file |

## **19. FINAL DIRECT INTERPRETATION FOR THE BACKEND TEAM**

The current frontend does send a properly correlated market-order command when all eligibility gates pass. The repository contains historical evidence of deal-insert failure, admission/ownership/reservation rejection, rate limiting, quote expiry during long execution, socket failure, and accepted-but-invisible lifecycle behavior. Do not guess which one is current; trace a fresh client_order_id through the complete system.

Margin 0 and Level infinity are expected when there is truly no open position and no used margin. In the reported sequence, they are commonly the downstream visual result of the trade never becoming a position. They become proof of a backend consistency defect when a broker-authoritative position exists but account used margin remains zero.

Stale values are possible because current REST and WebSocket payloads have no shared monotonic portfolio revision, partial packets retain previous fields, position events are patch-oriented, and the live account schema/channel contract is contradictory. The backend must provide atomic causality, canonical full snapshots, revisions, exact status, reliable outbox fan-out, reconnect replay, and freshness metadata. The frontend must subsequently consume those versioned guarantees. Therefore backend completion is not accepted unless this same file includes the final deployed contract and the completed copy-paste-ready Frontend Implementation Handoff required by SECTION D.
