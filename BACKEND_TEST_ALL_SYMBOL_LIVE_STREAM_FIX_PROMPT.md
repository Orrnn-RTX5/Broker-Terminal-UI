# Backend implementation prompt: repair TEST all-symbol live streaming

Copy this prompt into the backend repository/agent. Implement and deploy the real backend fix; do not only write a report. Inspect the actual discovery registry, broker registry, `/ws/feed` gateway, `/ws/v2` channel router, cServer/provider subscription lifecycle, quote cache, and deployment secrets before editing. Never print, commit, or return a feed token.

## Direct verdict

TEST is **not** limited to BTCUSD and XAUUSD upstream. The backend currently streams many FX, index, crypto, and metal symbols through `/ws/v2`. The confirmed backend/deployment defects are:

1. TEST account login succeeds, but login returns no browser-usable feed credential or feed routing fields;
2. the frontend's provisioned TEST `/ws/feed` credential is rejected with `401 broker_token_mismatch`;
3. the provider/cServer feed intermittently stalls globally;
4. catalog, streamability, and freshness are conflated;
5. invalid and silent `/ws/v2` channels are acknowledged as subscribed;
6. TEST registry and status broker isolation are inconsistent.

Do not hide these problems with cached quotes, fabricated ticks, or a BTCUSD/XAUUSD allowlist.

## Endpoints under test

- Broker backend: `https://fxtrustbrokerbackend.orrnn.com`
- Broker discovery: `https://fxtrustsuperbackned.orrnn.com`
- Quote feed: `wss://fxtrustbrokerbackend.orrnn.com/ws/feed`
- Multiplexed socket: `wss://fxtrustbrokerbackend.orrnn.com/ws/v2`
- Feed status: `https://fxtrustbrokerbackend.orrnn.com/ws/feed/status?broker_id=TEST`

## Confirmed live evidence from 2026-08-31

### `/ws/v2` is broadly live

Using the exact frontend-compatible request below, direct 20-second probes produced:

| Asset class | Symbol | Tick count | Result |
|---|---:|---:|---|
| Crypto | BTCUSD | 77 | live |
| Metal | XAUUSD | 68 | live |
| FX | EURUSD | 56 | live |
| FX | GBPUSD | 64 | live |
| FX | USDJPY | 64 | live |
| Index | US30 | 68 | live |
| Index | NAS100 | 69 | live |
| Index | US500 | 58 | live |
| Crypto | ETHUSD | 71 | live |
| Metal | XAGUSD | 75 | live |
| Catalog/stale | 1U1D.DE | 0 | stale/silent during probe |
| Catalog/silent | ABT.US-24 | 0 | stale/silent during probe |
| Invalid | NOTAREAL | 0 | unsupported but incorrectly acknowledged |

Request:

```json
{
  "action": "subscribe",
  "channel": "ticks.EURUSD",
  "channels": ["ticks.EURUSD"]
}
```

Observed acknowledgement:

```json
{"channel":"ticks.EURUSD","type":"subscribed"}
```

`channel` alone also worked. `channels` alone did not. Tick frames contained a top-level `channel`, sequence, and `data`; the data object carried exact symbol identity, broker ID, bid/ask, source timestamps, source sequence, age, stale/tradable flags, and source.

The local Vite proxy also carried EURUSD, GBPUSD, US30, ETHUSD, and XAGUSD, proving proxy routing is not the backend bottleneck.

### Primary `/ws/feed` authentication is broken

- Current provisioned TEST credential: HTTP 401 with reason `broker_token_mismatch`.
- Missing credential: HTTP 401 with reason `missing_broker_token`.
- TEST, lowercase test, and omitted broker ID did not make the provisioned credential valid.
- The failure occurs during the handshake, before any symbol subscription can be processed.

### Successful account login does not provide the required feed handoff

The real frontend login contract was used against:

```text
POST https://fxtrustbrokerbackend.orrnn.com/api/v2/auth/login
Content-Type: application/json
```

Request shape:

```json
{
  "username": "<operator-provided TEST login>",
  "password": "<operator-provided TEST password>",
  "broker_id": "TEST"
}
```

Account `200001` returned HTTP 200. Sensitive values are intentionally redacted:

```json
{
  "access_token": "<redacted-present>",
  "account_login": 200001,
  "broker_id": "TEST",
  "expires_at": 1788267704,
  "expires_in": 86400,
  "login_type": "master",
  "refresh_token": "<redacted-present>",
  "role": "trader",
  "token_type": "<present>",
  "user_id": 3,
  "username": "TEST@TEST.COM"
}
```

The response did **not** contain any of these fields:

- `feed_token`, `feed_broker_token`, `broker_feed_token`, or `ws_feed_token`;
- `feed_url`, `feed_ws_url`, or `feed_status_url`;
- `server_url`, `market_api_url`, or `ws_url`.

Therefore normal account authentication succeeds while the dedicated `/ws/feed` authentication handoff remains impossible. The frontend can use the account access token with `/ws/v2`, but it cannot derive the broker-service credential expected by `/ws/feed`. Do not solve this by embedding a permanent shared broker secret in browser JavaScript or Vite output.

### Feed inventory and continuity are inconsistent

At `12:29:33Z`, status reported approximately:

- 559 registered/advertised symbols;
- 418 streaming;
- 187 fresh/tradable;
- 372 stale;
- 141 silent.

At that moment EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, EURJPY, US30, US500, AUS200, ETHUSD, XAGUSD, BTCUSD, and XAUUSD were fresh with roughly 0-2 second tick ages.

From approximately `12:32:25Z` through `12:33:07Z`, status briefly fell to `fresh=0` and all approximately 561 symbols became stale while provider last-tick age reached 7-11 seconds. By `12:33:57Z`, it recovered to approximately 465 streaming and 198 fresh. Diagnose the global cServer/provider stall and subscription restoration path.

Publish fanout counters showed no quote gaps, overflow, dropped, or failed messages during the probe. Tick-cache counters already contained 148 write errors and 158 timeouts; determine their cause and ensure they do not continue increasing.

### Registry and broker isolation defects

- Central discovery exposed one TEST broker record, ID 18.
- `/api/v2/broker/servers` exposed three simultaneously enabled TEST records: IDs 3, 4, and 5 mapped to `broker-server-3`, `broker-server-4`, and `broker-server-5`.
- `/ws/feed/status?broker_id=NOT_A_REAL_BROKER` returned HTTP 200 with TEST status instead of rejecting the unknown broker.
- `/ws/v2` returned `subscribed` for `ticks.NOTAREAL`, `ticks.1U1D.DE`, and `ticks.ABT.US-24`, although they emitted no ticks during the probe.

## Required backend changes

### 1. Canonical broker identity and registry

- Keep exactly one active normalized `TEST` broker record across discovery, trading backend, feed auth, status, and cServer registration.
- Add a normalized broker-ID uniqueness constraint.
- Replace duplicate startup inserts with idempotent upsert/lease registration.
- Expire or disable stale cServer registrations.
- Reject unknown broker IDs with deterministic 400/404 responses; never return TEST data for another broker ID.

### 2. Secure and reliable feed authentication

- Rotate/reissue the authoritative TEST gateway credential so the current `broker_token_mismatch` deployment is repaired.
- Define one browser-safe authentication contract for `/ws/feed`. The preferred contract is a short-lived `feed_token` issued from successful `/api/v2/auth/login` and `/api/v2/auth/refresh`; alternatively, explicitly document and implement account access-token authentication on `/ws/feed`. Do not require a permanent shared service secret in the browser.
- If using `feed_token`, return the canonical fields `feed_token`, `feed_token_expires_at` (or `feed_token_expires_in`), `feed_broker_id`, `feed_url`, and `feed_status_url` from login and refresh. Avoid multiple undocumented aliases.
- Bind the credential to the authenticated session/user, normalized `broker_id=TEST`, allowed quote scope, and expiry. Rotate it on refresh, revoke it on logout/session revocation, support controlled rotation grace, and redact it everywhere.
- Keep account authorization separate from quote-feed authorization: a valid trader session must not gain admin or broker-service privileges from the feed credential.
- A valid credential must upgrade to HTTP 101. Missing, invalid, wrong-broker, and expired credentials must return distinct deterministic reasons.
- Login and refresh responses must remain backward compatible for existing `access_token`, `refresh_token`, `account_login`, and role fields.
- Make discovery or login the documented canonical authority for `server_url`, `ws_url`, `feed_url`, and `feed_status_url`. If login omits routing fields, discovery must always return valid canonical values for the same normalized broker record.
- Add a backend contract test that fails whenever `feed_auth_required=true` but successful login or refresh omits every supported browser-safe feed-credential field.

### 3. Correct subscription contract

- `/ws/feed` batch subscription must accept the complete exact requested set:

  ```json
  {"type":"subscribe","symbols":["BTCUSD","XAUUSD","EURUSD","GBPUSD","USDJPY","US30","ETHUSD"]}
  ```

- Return explicit accepted and rejected symbols with per-symbol reasons.
- `/ws/v2` must validate `ticks.<symbol>` against the broker's canonical catalog and stream capability before returning `subscribed`.
- Reject invalid, disabled, unmapped, or unauthorized symbols using reasons such as `symbol_not_found`, `symbol_disabled`, `no_mapping`, or `not_entitled`.
- Treat subscription acknowledgement as registration only; publish an immediate authoritative snapshot where available, followed by incremental ticks.

### 4. Separate catalog, market state, and live capability

- Do not describe every registered symbol as available/live.
- Expose separate `catalog_symbols`, `streamable_symbols`, and currently `fresh_symbols`, or equivalent explicit fields.
- Keep per-symbol state authoritative: `subscribed`, `fresh`, `stale`, `market_closed`, `silent`, `unsupported`, and `tradable` must be distinguishable.
- Closed or legitimately illiquid instruments must not be called a provider outage, but open/liquid symbols missing their SLA must be alerted.
- Align exact symbols and suffixes across `/api/v2/instruments`, `/api/v2/quotes`, `/ws/feed/status`, `/ws/feed`, and `/ws/v2`.

### 5. Repair provider/cServer continuity and observability

- Find and fix why the complete feed can enter `fresh=0`.
- Persist and restore the full intended provider subscription set after reconnect/restart.
- Expose requested, accepted, rejected, unsubscribed, and actively streaming counts by broker and symbol.
- Track per-symbol last provider tick, last published tick, sequence, reconnect generation, and rejection reason.
- Alert on global ingress stalls, open-symbol freshness breaches, growing cache errors/timeouts, gaps, overflow, dropped frames, and failed publishes.

## Acceptance criteria

1. Discovery and trading backend each expose exactly one enabled TEST record.
2. Unknown broker IDs are rejected by status and websocket authentication.
3. Re-run account `200001` login with operator-supplied credentials. It still returns HTTP 200 and the existing account fields, plus the documented browser-safe feed authentication/routing fields. Never include the password or token values in evidence.
4. `/api/v2/auth/refresh` rotates or renews the same documented feed authorization contract without requiring a page rebuild or shared Vite secret.
5. Using only the credential returned from login/refresh—no Vite variable, manually copied token, or shared deployment secret—opens `/ws/feed?broker_id=TEST&token=<redacted>` with HTTP 101. A credential for another broker/session is rejected deterministically.
6. The upgraded socket confirms this full batch:

   ```json
   {"type":"subscribe","symbols":["BTCUSD","XAUUSD","EURUSD","GBPUSD","USDJPY","US30","ETHUSD"]}
   ```

7. Every supported open/liquid requested symbol produces an initial snapshot and continuing ticks within the agreed SLA; there is no BTCUSD/XAUUSD-only route.
8. Invalid or non-streamable symbols are explicitly rejected instead of falsely acknowledged.
9. Disconnect/reconnect restores the exact confirmed set without missing or duplicate subscriptions.
10. Refresh returns a new usable feed credential; the old credential follows the documented grace/revocation rule. Logout/session revocation invalidates the feed session. Expiry, wrong-broker use, and gateway credential rotation are integration-tested.
11. A minimum 15-minute soak has no unexplained global `fresh=0` interval, no quote gaps/overflow/drops/failures, and no increasing cache errors/timeouts.
12. Return redacted proof: registry rows, login and refresh response **field names only**, HTTP 101 handshake, accepted/rejected acknowledgement, per-symbol tick counts, pre/post status counters, token lifecycle tests, and reconnect/soak results.
