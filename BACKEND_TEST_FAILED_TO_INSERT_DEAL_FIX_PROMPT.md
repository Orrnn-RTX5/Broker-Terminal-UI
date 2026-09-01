# Backend Fix Prompt: TEST orders fail with `Failed to insert deal`

## Direct diagnosis

This is a backend Gateway/deal-persistence defect, not a frontend balance, margin, quote, symbol, or market-hours defect.

Use the TEST environment and account login `200001`. Obtain the password through the team's secure channel; do not copy it into source code, logs, tickets, commits, or this prompt.

Live verification on 2026-08-31 showed:

- Authentication succeeds and `/api/v2/auth/me` identifies account `200001`, broker `TEST`, role `trader`, and `login_type: master`.
- `/api/v2/account/200001` reports `status: active`, group `demo/STD`, currency `USD`, leverage `100`, balance `10000`, equity `10000`, free margin `10000`, used margin `0`, and no open positions.
- `/api/v2/market/status/XAUUSD` reports the market, quote, and trading as open.
- `/api/v2/quotes/XAUUSD` reports a fresh, non-stale, tradable cServer quote with no source mismatch.
- Orders, pending orders, positions, and deals are empty after the failures.
- The account Journal contains these independent Gateway failures:
  - Journal `3540`: buy `XAUUSD` `0.01` rejected: `Failed to insert deal` in about `244 ms`.
  - Journal `3542`: sell `XAUUSD` `0.01` rejected: `Failed to insert deal` in about `233 ms`.
  - Journal `3537`: sell `BTCUSD` `0.01` rejected: `Failed to insert deal` in about `478 ms`.

Because both sides and multiple symbols fail while the account and quotes are healthy, do not fix this by changing balance checks, symbol subscriptions, spreads, market-hours logic, or the UI error text. Find and repair the backend deal-insert failure.

## Existing frontend contract

The frontend sends market orders to `POST /api/v2/orders` or through the authenticated v2 trading WebSocket. It creates one UUIDv4 `client_order_id` per user action and preserves the same ID if a transport-safe REST fallback is needed.

The normalized REST intent is:

```json
{
  "login": "200001",
  "client_order_id": "<UUID v4>",
  "symbol": "XAUUSD",
  "side": "buy",
  "type": "market",
  "volume": 0.01,
  "price_sl": null,
  "price_tp": null,
  "comment": "<optional>",
  "trailing_stop": null,
  "trailing_step": null,
  "magic": "<optional>"
}
```

The exact `Failed to insert deal` text does not exist in the frontend repository. A WebSocket `order_rejected` business response is terminal and is shown to the user; it is not retried as a fresh REST order. The frontend has also been hardened so REST creation is allowed only when the WebSocket create frame was definitely not sent. After a successful WebSocket `send()`, a generic error, disconnect, or status timeout remains tied to the original `client_order_id` and is reported as execution status unknown; it never causes another create request. Do not claim a frontend payload defect unless a redacted wire capture proves the received payload violates the documented backend contract.

## Required investigation

Trace one failed order end to end using broker/tenant, account, request/correlation ID, and `client_order_id`. Log the phase names and safe identifiers, but never log credentials, bearer tokens, or the full database statement with sensitive values.

For the same correlation identity, capture:

1. Authentication and account-resolution result.
2. Normalized order intent and idempotency reservation.
3. Risk, permissions, market, quote freshness, volume, and margin decisions.
4. Worker/job claim count.
5. cServer/MT5 submission time and result, including broker order/deal ticket if one was allocated.
6. Parent order/position write, deal insert, account update, and transaction order.
7. Exact database driver error, SQLSTATE/error number, table, constraint or column, and migration/schema version.
8. Commit, rollback, timeout, or unknown transaction outcome.
9. Final durable lifecycle state and emitted WebSocket/Journal result.

Inspect these concrete failure classes and report which one is proven:

- missing or unapplied migration, schema drift, missing column, or incompatible enum/check constraint;
- NOT NULL, type, precision, timestamp, or numeric ticket-width violation;
- missing foreign-key parent for broker `TEST`, account `200001`, instrument, order, or position;
- primary-key/sequence collision or duplicate broker deal-ticket uniqueness conflict;
- duplicate callback, concurrent worker, or replay executing the same `client_order_id` twice;
- database user missing `INSERT`/sequence permission;
- pool exhaustion, connection loss, timeout, deadlock, serialization failure, or uncertain commit;
- deal inserted before its required order/position/account parent is committed;
- cServer/MT5 execution succeeded but the local database transaction failed afterward.

Do not stop at the generic exception. The required diagnosis is the underlying database error plus whether external execution occurred before it.

## Mandatory remediation

1. Reserve idempotency before any irreversible broker execution. Scope the key by broker/tenant + account + `client_order_id`, and store a normalized intent fingerprint.
2. Allow at most one cServer/MT5 submission for a scoped `client_order_id`, including concurrent WebSocket/REST arrival and worker redelivery.
3. Persist a canonical broker deal idempotently using broker/tenant + account + broker deal ticket as a unique identity. Duplicate execution notifications must coalesce into the same row.
4. Correct migrations, column mappings, foreign keys, constraints, ticket widths, sequence ownership, permissions, and parent-row transaction ordering based on the proven SQL error.
5. Keep order, deal, position, account-ledger, and event/outbox writes atomic where they are locally reversible.
6. If broker execution may already have succeeded, never blindly execute again and never return a false terminal rejection. Persist `reconciling` or `execution_outcome_unknown`, query broker history by ticket/client correlation, and repair the local deal/position state without another broker submission.
7. Make replay deterministic:
   - same ID + same intent returns the stored/in-progress/final result;
   - same ID + different intent returns an idempotency conflict;
   - no replay can create a second broker trade or deal row.
8. Replace the unstructured message with a stable safe error contract, for example:

```json
{
  "code": "DEAL_PERSISTENCE_FAILED",
  "message": "The order could not be finalized.",
  "correlation_id": "<safe id>",
  "retryable": false,
  "execution_state": "not_executed"
}
```

For an uncertain or post-execution failure, use an appropriate state such as `reconciling` or `execution_outcome_unknown`; do not tell the client to create another order.

9. Add readiness/write-path monitoring that detects an unapplied migration, invalid DB permissions, or inability to complete the smallest safe transaction before accepting live orders.
10. Preserve the original exception internally with structured context, while redacting SQL values, credentials, and tokens from client responses and ordinary logs.

## Evidence-based classification

- Broker/MT5 deal ticket exists but no local deal row: post-execution persistence/reconciliation defect.
- SQL unique violation and an identical deal already exists: duplicate callback/worker or broken idempotency handling.
- One `client_order_id` reached broker execution twice: backend failed to coalesce concurrent transports/workers.
- SQL FK/NOT NULL/type/check failure before any broker call: schema, mapping, migration, or transaction-order defect.
- Database timeout/deadlock with unknown commit: reconcile the transaction and broker outcome before allowing any retry.
- Validation 4xx before idempotency, SQL, and broker submission: only then investigate an actual request-contract mismatch.

## Required tests and acceptance criteria

Run only in TEST/demo and clean up created test positions safely.

1. A fresh ID for `XAUUSD` buy `0.01` completes and appears consistently in orders/deals/positions/account metrics/Journal, or returns a precise legitimate business rejection—not `Failed to insert deal`.
2. Repeat for `XAUUSD` sell `0.01` and `BTCUSD` sell `0.01`.
3. One fresh `client_order_id` results in at most one broker submission and one canonical deal row.
4. Replaying the exact same ID and intent returns the same durable result without another broker call or insert.
5. Reusing the ID with different symbol, side, or volume returns deterministic idempotency conflict.
6. Simultaneous WebSocket and REST delivery with the same ID still creates only one execution.
7. Duplicate broker callbacks are harmless idempotent replays.
8. An injected pre-execution DB failure creates no broker trade.
9. An injected post-execution persistence failure enters durable reconciliation and restores the local deal/position from broker history without executing again.
10. Balance, equity, free/used margin, positions, orders, deals, and Journal agree after success, rejection, rollback, restart, and reconnect.
11. Restart workers during the lifecycle and prove the order resumes from durable state without duplicate execution.
12. Run concurrent/burst orders for at least 15 minutes with no duplicate deals, orphan broker trades, stuck accepted orders, or generic insert failures.

## Backend team's completion report

Return all of the following, redacted:

- proven root cause and exact failing lifecycle phase;
- SQLSTATE/database error class and constraint/column involved;
- whether any broker ticket existed for Journal entries `3537`, `3540`, and `3542`;
- migrations and code paths changed;
- idempotency and reconciliation behavior before versus after;
- automated test results plus the three TEST/demo acceptance results;
- before/after API, database, broker-history, and Journal evidence;
- confirmation that no credential, token, or raw sensitive SQL value was logged.
