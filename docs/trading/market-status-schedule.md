# Missing broker session schedules

Observed on 2026-09-30 against the runtime broker `https://service.orrnn.com`.
Live browser prices changed for EURJPY, GBPJPY, and XAGUSD while the chart
one-click panel showed `Market Closed`.

Read-only `GET /api/v2/market/status/{symbol}` requests returned HTTP 200:

| Symbol | message | quote_open | trade_open |
| --- | --- | --- | --- |
| EURJPY | schedule unavailable | false | false |
| GBPJPY | schedule unavailable | false | false |
| XAGUSD | schedule unavailable | false | false |
| EURUSD | open | true | true |
| XAUUSD | open | true | true |

The affected responses omit `status` and session boundaries. The frontend
previously inferred `closed` from the placeholder false flags. The one-click
panel also hardcoded `Market Closed` for every blocked status, including a
failed request, pre-market, and after-hours.

The frontend now normalizes `schedule unavailable` to `unknown`, unless a
known explicit status is supplied, and displays the actual status label.
This shared normalization applies to chart, order dialog, and Last Symbol.
Unknown status blocks submission unless a fresh, exact-symbol hub quote explicitly
reports `tradable: true`. Price updates alone never establish permission.

## Live feed investigation and frontend repair

A read-only anonymous subscription to `/ws/feed?broker_id=Orrnn` on 2026-09-30
at 13:12 UTC confirmed EURJPY quotes with `authority: rtx5_hub`, `stale: false`,
`source_mismatch: false`, and `tradable: true`. The schedule endpoint and hub
permission therefore disagree. The previous quote normalizers discarded this
explicit permission, leaving the frontend unable to use it.

Quote normalization now retains that metadata with its broker/account ownership
and receipt time. The shared symbol status hook uses it only for unknown REST
status, only for the current exact symbol/broker/account, and only while source
and receipt timestamps are fresh (less than ten seconds). Known REST session
states remain authoritative. Silence, a new account, or missing explicit hub
metadata invalidates the fallback. Status caches and pending requests are also
invalidated on committed account/broker changes; cached rows expire after fifteen
seconds when a symbol is activated again.

The same capture showed midpoint candle updates competing with raw Bid ticks:

| Symbol | Quote Bid | Quote Ask | Server forming Close |
| --- | --- | --- | --- |
| EURJPY | 178.221 | 178.242 | 178.2315 |
| XAUUSD | 4201.67 | 4203.44 | 4202.555 |
| BTCUSD | 85498.65 | 85553.64 | 85526.145 |

These matching values establish midpoint aggregation in the captured backend
updates. Local chart aggregation uses raw Bid. Each incoming forming M1 update
or snapshot now takes Close from the exact symbol's raw Bid for the same bucket,
so an incoming midpoint candle cannot pull the live Close away from Bid. Server
Open, volume and observed range remain retained; the latest Bid extends the
range if necessary. Explicit final candles retain exact broker OHLC. Higher
periods receive the same reconciled M1 input. Account spread markup remains on
executable prices rather than raw chart candle prices.

This frontend repair does not reconstruct missing historical Bid OHLC from
midpoint data. The backend must provide one consistent declared candle price
basis across history, partial updates and final candles.

## Required broker backend repair

Restore the quote and trade session schedule source for every affected exact
broker symbol. Resolve quote and trade sessions independently using broker
server time, trading days, breaks, holidays, and configured trade permissions.
Audit the complete authorized catalog rather than special-casing these three
symbols. Keep opaque broker suffixes intact during schedule lookup.

Return `open` only when the authoritative trade session permits trading.
Return `closed`, `pre_market`, or `after_hours` only when actually established.
If the schedule cannot be resolved, omit unknown boolean flags and return a
clear unavailable reason instead of manufacturing false values. The frontend
also accepts the current legacy unavailable payload for compatibility.

Validate open sessions, session breaks, weekends, holidays, missing schedules,
and simultaneous quotes with trading disabled. Compare known-open affected
symbols with the broker's native terminal, then verify the web panel becomes
available after its status refresh. No orders were submitted during this
investigation, and backend code is not part of this frontend workspace. Also
align the status endpoint with authoritative hub permission, and generate
history/partial/final candle OHLC from the same raw Bid source expected by the
terminal. Do not infer historical Bid highs/lows by subtracting the latest spread.
