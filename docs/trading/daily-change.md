# Daily Change integration

## Calculation and ownership

`src/utils/dailyChange.ts` calculates signed `P - R` and `(P - R) / R * 100` at full precision. Formatting adds explicit signs, uses broker instrument precision (existing symbol formatting when precision is omitted), rounds percentages to two decimals, and normalizes rounded negative zero.

`src/utils/dailyChangeSession.ts` owns reference selection and session transitions. The existing display metadata store holds one snapshot per exact broker symbol in the committed broker/account/server scope. Reference identity includes provider, applicable session, Bid/Last basis, and adjustment convention. This state is separate from executable Bid/Ask and account P&L.

Rules:

- An authoritative upstream amount/percentage wins for that measure. Missing upstream measures can be calculated from compatible price/reference data.
- Explicit chart mode or the broker instrument catalogue chooses Bid or genuine exchange Last. Unknown mode does not infer a basis. Ask, midpoint, chart candles, and account spread markup are excluded from the new calculation.
- Applicable nonzero settlement/clearing takes precedence over previous close, including sparse previous-close corrections. Explicit settlement zero/null removes that settlement.
- References are reused only under an explicit applicable session ID or supplied start/end bounds. A new session clears the old quote/reference atomically, preserving opening gaps once the new snapshot arrives.
- Broker timestamps order quotes; older events and older reference revisions are rejected. Provider, basis, adjustment, and applicable-session mismatches are unavailable.
- Zero references allow an amount but no calculated percentage. Negative references require an explicit `signed` or `absolute` denominator convention; absent convention leaves percentage unavailable.
- Closed state retains values and their original as-of information. Sparse unscoped updates retain last-known measures as stale without recalculating against an unidentified session.
- No device-midnight reset, nominal 24-hour rollover, or chart-timezone/timeframe dependency exists in the new session calculation.

## Existing transports and UI

Quote socket, authenticated REST snapshots, catalogue seeds, guest refreshes, and existing FIX/legacy quote paths carry metadata through their existing normalizers into `liveTickDispatcher`. Rendering is batched into the existing per-symbol display store. Last/reference-only metadata does not enter executable quote stores.

Authenticated REST snapshots refresh when the existing quote subscription reconnects. In-flight snapshots are aborted on replacement/unmount and remain bound to the captured session. Socket disconnects retain values as disconnected; reconnects retain them as stale until a fresh quote/snapshot arrives. Explicit delayed/closed metadata is preserved.

Market Watch has independently selectable **Change** and **Change %** columns. The legacy `dailyChange` preference key still identifies percentage; `dailyChangePrice` identifies amount. Existing settings and saved symbol sets persist both choices. Both headers sort numerically in either direction, keep ties in existing order, and place unavailable values last. Details, popup prices, exports, chart headers, and Last Symbol headers use the shared values.

The existing closed-market D1 fallback remains display-only. It requires explicit candle finality or a later broker candle proving rollover. Candle age/weekdays cannot prove closure. It saves amount and percentage together, preserves raw broker `sourceTime`, and does not use two completed closes as a live session reference. Without a following candle, the actual completion boundary is unknown; the cache does not invent one to overwrite a newer quote. A historical pair cannot fill half of a newer quote's measures.

## Broker data contract and gaps

The adapters accept these optional fields on quote payloads or their nearest transport envelopes. These are supported frontend mappings, not a claim that deployed backends supply them.

| Meaning | Fields |
| --- | --- |
| Current basis | `chart_mode` / `chartMode`: Bid/Last or MT5 0/1 |
| Last trade | `last`, `last_price`, `lastPrice` |
| Previous completed-session close | `previous_close`, `previousClose` |
| Applicable settlement | `settlement_price`, `session_price_settlement`, `clearing_price` and existing aliases |
| Authoritative percentage | `daily_change_pct`, `dailyChangePct`, `daily_change`, `dailyChange` |
| Authoritative amount | `daily_change_price`, `dailyChangePrice`, `daily_change_amount` |
| Feed identity | `provider`, `quote_provider`; optional `reference_provider` |
| Applicable trading session | `session_id` / `trading_day`, `session_start`, `session_end` |
| Reference compatibility/revision | `reference_session_id`, `reference_price_mode`, `reference_as_of` |
| Adjustment convention | `price_adjustment`, `reference_price_adjustment` |
| Negative-price convention | `negative_reference_convention`: `signed` or `absolute` |
| Quote status | `quote_status` / `market_status`: live, delayed, stale, disconnected, closed |

`reference_session_id` identifies the session to which the reference applies and must match `session_id`. Session bounds/revisions accept epoch seconds/milliseconds or ISO timestamps with an explicit timezone offset. Provider calendars must define overnight, holiday, DST, and crypto boundaries and send rollover metadata. The frontend cannot derive those boundaries from Bid/Ask alone. Instrument changes must retain full contract identity, including broker suffixes.

On 2026-09-30, a direct public request to Nexa `/api/v1/market/symbols` returned HTTP 200 and 722 symbols. None contained previous close, settlement, daily percentage, chart mode, or session ID/bounds. EURUSD contained only symbol, Bid, Ask, spread, time, and `has_quote`. Nexa therefore needs those fields from its backend/catalogue or an authoritative existing authenticated snapshot before reliable live daily movement can be calculated. No new endpoint or synthetic production data was introduced. Authenticated Nexa feed fields and every other deployed broker still require runtime validation.

The app uses Lightweight Charts, with no TradingView Charting Library quote API integration. Explicit adapter helpers preserve TradingView `lp` as genuine Last, map regular-session `ch`, `chp`, and `prev_close_price`, and keep `rch`/`rchp` separate. These helpers are available for a future documented provider adapter; no unsupported quote API was added.

Platform numbers are comparable only for the same instrument, broker/provider, session, basis, adjustment, and timestamp. References: [MT5 symbol properties](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants), [TradingView quote values](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Datafeed.DatafeedQuoteValues/).

## Verification

Focused tests cover arithmetic, precision, Bid/Last selection, settlement, rollover/gaps, weekends/DST/holiday session inputs, closure, missing/zero/negative references, provider/adjustment mismatches, stale/out-of-order data, reconnect refresh/cancellation, batched transport integration, sorting, saved preferences, and synchronized UI values.

Actual local results on 2026-09-30:

- Broker/feature test run: **385 passed, 0 failed**, across 22 files.
- Final Market Watch/state/dispatcher regression run after the performance and sorting fixes: **125 passed, 0 failed**, across 4 files. This overlaps the earlier run and must not be added to that total.
- Application typecheck, test typecheck, and final web build: passed.
- Markdown link check and `git diff --check`: passed.
- Architecture guard: failed only on the three existing unrelated files listed below.

Primary changed areas: `src/utils/dailyChange.ts`, `src/utils/dailyChangeSession.ts`, `src/store/useMarketWatchDisplayMetadataStore.ts`, `src/services/liveTickDispatcher.ts`, broker quote normalizers, `src/features/market-data/useLiveQuotes.ts`, `src/services/dailyChangePriceModeRegistry.ts`, the closed display cache/hook, and `src/components/market-watch/` views/preferences/sorting/exports. Shared summaries also appear in Last Symbol and TradingChartView headers.

The separate bulk-close UI request removes the title icon and warning banner from `src/components/ui/BulkCloseConfirmDialog.tsx` and its CSS for ALL, WINNERS, and LOSERS; existing confirmation/cancellation tests passed.

Local tests/builds establish source behavior; authenticated browser/native broker parity and deployment are not established by these checks. Browser inspection was unavailable because local browser access was denied. The architecture guard also reports existing unrelated line-limit violations in TradingChart, WebDrawingToolsRail, and index.css; those edits were preserved.
