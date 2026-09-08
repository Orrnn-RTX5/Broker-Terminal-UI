# Trend tools: sequential comparison

Reference: https://in.tradingview.com/chart/P8prO2VP/?symbol=OANDA%3AXAUUSD

RTX5: local web terminal, account 200001, primarily XAUUSD M1; the trade-overlay routing check uses BTCUSD M1 with existing trades. No orders were submitted or changed.

Initial workflow: each tool is checked in RTX5 first, then in TradingView, then fixed and checked again before advancing. The latest user instruction prioritizes an RTX5 application audit of every tool before further fixes: select, preview, place all anchors, verify completion and editing, and record applies/fails. Videos are timestamp-preserving, continuously sampled browser screenshots; see [recording method and limitations](RECORDING_METHOD.md). They do not capture the OS pointer or establish native frame-rate performance.

The user has additionally required coverage of all nine timeframes: M1, M5, M15, M30, H1, H4, D1, W1 and MN. That expanded live verification is in progress; the existing mostly-M1 checks do not establish all-timeframe parity.

| Tool | Status |
| --- | --- |
| Trendline | Compared, fixed, and live retested: creation, handles, drag, Shift, styling, lock, cancellation, time labels |
| Ray | Normal placement, Shift/reverse/style/lock exercised; future placement and future-endpoint drag now pass after fractional-coordinate and timeframe-context fixes. Earlier failed projection attempts are preserved |
| Info line | New RTX5 M1 count (`11 bars / 11m`), committed first anchor and panel drag recorded. Toolbar overlap is visible; clean layout retest and remaining reference behaviors are pending. TradingView references are gathered |
| Extended line | RTX5 application retested; individual TradingView parity comparison pending |
| Trend angle | RTX5 application retested; individual TradingView parity comparison pending |
| Horizontal line | RTX5 application retested; individual TradingView parity comparison pending |
| Horizontal ray | RTX5 application retested in a complete reloaded check; individual TradingView parity comparison pending |
| Vertical line | RTX5 application retested; individual TradingView parity comparison pending |
| Crossline | RTX5 application retested; individual TradingView parity comparison pending |
| Parallel channel | RTX5 application retested in a complete reloaded check; individual TradingView parity comparison pending |
| Regression trend | RTX5 candle-range application passed. Empty future range and recovery compared with TradingView; clean-session RTX5 retest now retains handles and recovers a fitted channel. Other individual parity checks remain open |
| Flat top/bottom | RTX5 application retested; individual TradingView parity comparison pending |
| Disjoint channel | RTX5 application retested; individual TradingView parity comparison pending |
| Pitchfork | RTX5 application retested; individual TradingView parity comparison pending |
| Schiff pitchfork | RTX5 application retested; individual TradingView parity comparison pending |
| Modified Schiff pitchfork | RTX5 application retested; individual TradingView parity comparison pending |
| Inside pitchfork | RTX5 application retested in a completed retry; individual TradingView parity comparison pending |

## Trendline findings

- Finite line placement and endpoint/body dragging were demonstrated in both charts.
- RTX5 hid the first anchor until pointer movement. Fixed: committed construction anchor stays visible. Confirmed after reloading the updated drawing service.
- RTX5 cleared selection immediately after completion. Fixed duplicate save-triggered cursor commands; local toolbar state resets without deselecting the drawing. Live retest confirms endpoint handles and editing toolbar remain visible.
- Replaced the zigzag arrow menu/rail icon with a straight segment and hollow endpoint circles. Visible in live retest.
- Width, dashed styling, locked movement, and unlocked endpoint editing were exercised in RTX5; corresponding reference actions recorded in TradingView.
- RTX5 selected time labels used the computer timezone instead of the owning chart's broker-time formatter. Fixed; final live labels align with chart ticks (11:39/11:54).
- TradingView constrains placement and endpoint editing to 45-degree increments with Shift. Implemented and live verified: horizontal placement, then rendered endpoint deltas of 291.7778px horizontally and vertically after a Shift drag.
- Corrected width-dependent dash patterns from measured reference pixels. RTX5 3px dashed now uses 15/18 spacing with flat caps; dotted uses 3/9. Both verified in rendered SVG and recorded.
- Starting another Trendline now clears the old selection. Escape cancels the unfinished drawing: rendered drawing count remained 5 before/after, and the Cursor button returned to pressed.
- TradingView's currently selected cursor mode is Arrow. Default canvas cursor was observed in both charts; no unsupported crosshair-default change was made.

Some initial post-edit captures retained stale drawing-service listeners after hot reload. Those captures are explicitly inconclusive in RECORDING_METHOD.md. The `reloaded-*` captures use the updated service after an explicit browser reload.

## Validation so far

- 133 focused drawing-manager and rail tests passed after the construction-anchor/icon change.
- 21 hook/toolbar tests passed for completed-selection lifecycle.
- 83 drawing/time-format tests passed with `TZ=Asia/Kolkata`, including broker-time offsets.
- An unrelated existing chart-type contract expects `onChartTypeChange('line')`, whereas HEAD already uses `dispatchTargetedChartType('line')`; not changed by this work.
- Earlier Ray/projection run: 128 tests passed (85 drawing-manager, 39 chart-interaction, 4 future-time projection regressions). TypeScript and `npm run build:web` passed. Vite reported existing bundle-size/mixed-import warnings. This preceded the subsequently reproduced future-coordinate failure; those test results alone did not establish a live fix.
- Subsequent live recordings verify future Ray placement/dragging, all 17 tools applying after timeframe-context changes, clean-session Regression recovery, arming/cancellation and unfinished-tool replacement. See the [post-fix application evidence](RTX5-APPLICATION-AUDIT.md).
- [Trade-overlay routing](TRADE-OVERLAY-ROUTING.md) passed on BTCUSD using existing trades: the armed drawing reaches the chart canvas through the trade hit area, completes with two handles, and restores overlay pointer events afterward. Exact state is recorded in [TRADE-OVERLAY-ROUTING.json](TRADE-OVERLAY-ROUTING.json).

## Application audit and next action

The old chart tabs repeatedly timed out even after an approved fresh Chrome window. A fresh terminal tab created through the same supported browser connection restored page interactions. Reinstallation is not currently needed. The first application audit has now exercised all 17 tools in RTX5; see [application audit](RTX5-APPLICATION-AUDIT.md) and its JSON/recordings. A fresh TradingView tab also responds.

The preserved baseline demonstrates application in normal candle space for all 17 tools and records three failures: M5-to-M1 drawing-layer disappearance, Ray future-endpoint x=0, and invisible Regression completion for a future-only range. The first Ray projection correction remained insufficient in a fresh-tab retest. Subsequent shared fractional-coordinate and timeframe-context fixes passed recorded future placement/dragging and the full 17-tool application retest. Clean-session Regression now retains empty-range handles and recovers a fitted channel when dragged over candles. These supersede the earlier failure status while preserving its evidence.

The active individual comparison is [Info line](03-INFO-LINE-EVIDENCE.md). Its new M1 placement reads `11 bars (11m)`, and panel dragging moves both endpoints while retaining the interval and price difference. The editing toolbar covers the panel's top row; the root reports a correction, but its clean live retest is still pending. Complete that check and the remaining reference behaviors, then continue the other tools one by one. Per-tool icon refinement, remaining cursor/drag/settings comparisons and the expanded nine-timeframe verification remain open. Application success does not establish complete TradingView parity or native pointer/frame-rate performance.
