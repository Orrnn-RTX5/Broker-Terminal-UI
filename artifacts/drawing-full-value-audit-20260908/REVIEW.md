# Drawing values and chart-scale audit — 8 September 2026

The audit found real calculation and redraw errors. The frontend fixes are implemented. The broad regression run passed **600 tests in 25 files**; the final toolbar correction passed **170 focused tests**, including one additional regression (**601 distinct tests across the runs**). Reference and before recordings cover **44 drawing tools**. After recordings verify positions, saved inputs, price-axis alignment, Fib Retracement and Trendline zoom, Fib Channel, both Fib time tools, both fan label corrections, Fib Wedge, Sector, Forecast, VWAP, both volume profiles and reversed range arrows. The final Trend-based Fib Time capture completed and was reviewed from saved frames after the browser transport timed out. Only the latest toolbar visibility correction's final visual repeat remains unverified.

Open [the video index](index.html) for TradingView/RTX5 pairs and detailed after recordings.

## What was observed before drawing

- TradingView: OANDA XAUUSD, one-minute candles, tick volume, live price and OHLC updates. The latest bar changed during capture. Price-scale drag and candle zoom were recorded before placing tools.
- RTX5: Achiever Financials account 200032, XAUUSD M1. The available candles were dated 3 September; the latest displayed OHLC was O 4472.64, H 4473.62, L 4472.19, C 4472.90, V 124. The UI reported no fresh quote. This is not the same feed/date as the TradingView reference, so numerical market prices must not be compared directly across the two sites.
- After a sign-in interruption and browser restart, the same RTX5 tab returned with TEST account 200001. The remaining completed after clips use that current session on M1, with changing candles/quotes. This audit did not select or submit that login. Clip metadata identifies TEST; these are not presented as Achiever live-feed verification.
- No order was submitted. Backend/feed code was not changed in this audit. The preexisting dirty worktree, including runtime configuration, was preserved.

## Confirmed fixes

| Area | Before | Implemented behavior |
|---|---|---|
| Position sizing | Fixed account 1000, fixed risk 250; quantity rounded down to an integer with a minimum of one | Saved editable account size, risk, risk unit, instrument point value, lot size, leverage cap and quantity display precision. Missing required inputs show an unavailable value. The current account balance initializes the form. |
| Position amounts | Fixed stop amount 750 and a fixed-account target amount | Amounts derive from the saved inputs and actual target/stop offsets. Display rounding does not affect calculations. |
| Position PnL | Latest close multiplied by quantity, including historical drawings | Signed price difference, using the historical right-edge candle or the latest available close for a future endpoint. Target/stop crossings produce closed PnL. A candle touching both levels is explicitly ambiguous. |
| Position price labels | No separate entry, target and stop scale labels | Labels use each actual price and the chart's price formatter. |
| Price-axis zoom | Candles changed scale while SVG drawings could retain old coordinates | The existing coalesced axis/pan/wheel repaint now also schedules drawings after the chart transform. |
| Selection toolbar | The toolbar could cover measurement labels above the anchors | Toolbar avoidance bounds now include drawing callout backgrounds as well as the existing Info line panel. The focused regression passes; final visual repeat was interrupted by the browser disconnect. |
| Offscreen position levels | Target/stop prices were clamped onto the viewport edge | The SVG viewport clips the drawing while the actual price coordinates stay intact. |
| Live drawing source | Accepted live candle updates could leave the drawing data provider stale | The accepted candle path refreshes drawing OHLCV and coalesces drawing repaint requests. Tested with candle updates; a working live broker feed was unavailable for this check. |
| Fib Channel | Projected third anchor onto the perpendicular; omitted the zero label and derived price values | Level one starts at the third anchor. Parallel levels use the A-to-C offset. All level labels include the corresponding calculated price. |
| Fan labels | Gann ratios and speed-resistance level labels were reversed relative to the reference | Labels follow the observed reference direction. |
| Fib time / wedge | Coincident time anchors introduced a fixed 24-pixel interval; wedge ratio labels were absent | Time spacing follows the actual anchors; wedge ratios are labeled. |
| Sector | Second anchor was forced horizontal | The selected second anchor sets the first radius; the third sets the arc direction at the same screen radius. |
| Forecast / ranges | Negative forecast changes displayed as positive; failure could be declared before the endpoint; combined range arrows ignored direction | Signed offsets, pending status until the endpoint unless the target is reached, and arrows following anchor direction. |
| VWAP / volume profile | Missing volume could become invented unit volume; profiles put a whole candle into one typical-price bin | Valid HLC3 and volume drive VWAP and deviation bands. Profiles conserve volume across each candle's range, show POC, and explicitly say **OHLCV estimate**. Missing data is labeled unavailable. |

## Values independently checked

The position convention was checked in the live reference and against [TradingView's position-tool documentation](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/). PnL is the signed price difference; quantity is a separate value. Right-edge time matters for a historical open position.

With multiplier = point value × lot size:

```
risk budget = account size × risk percent / 100  (or explicit amount)
risk quantity = risk budget / (abs(entry - stop) × multiplier)
notional cap = account size × leverage / (abs(entry) × multiplier)
quantity = min(risk quantity, notional cap), when leverage is supplied
target amount = account size + abs(target - entry) × quantity × multiplier
stop amount = account size - abs(entry - stop) × quantity × multiplier
reward/risk = abs(target - entry) / abs(entry - stop)
Fib Channel level price = A.price + ratio × (C.price - A.price)
```

The notional cap uses the explicit instrument multiplier; the live TradingView comparison used point value and lot size equal to one. Other instrument multipliers and the cap are covered by arithmetic tests, not a claim of broker-specific contract conversion.

| Recorded check | Inputs / evidence | Result |
|---|---|---|
| TradingView input edit | Entry 4394.642, target 4398.933, stop 4390.351; account 2500, risk 2%, lot 1 | Risk budget 50, raw quantity 50 / 4.291, displayed integer quantity 11, target/stop amounts 2550 / 2450. |
| RTX5 configured Long | Entry 4470, target 4485, stop 4460; account 2500, risk 2%, point value 1, lot 1 | Quantity 5, target/stop amounts 2575 / 2450, reward/risk 1.50. |
| Future endpoint | Latest available close 4472.90, entry 4470 | Open PnL 2.90. |
| Historical endpoint | Right-edge hovered candle O 4475.03, H 4475.52, L 4470.75, C 4471.22 | Open PnL changes to 1.22. Quantity and account amounts stay unchanged. |
| Position zoom and reload | Same saved inputs; price axis dragged after full page navigation | Values survive reload and zoom. Target coordinate changes from -40.1403 to 18.2701 as it enters view; price stays 4485.00. Stop coordinate changes from 458.8227 to 426.7865; price stays 4460.00. |
| Long target/stop drag | Stop moved to displayed 4463.11; target to displayed 4479.02 | Quantity 7.25, reward/risk 1.31, target amount 2565.43, stop amount 2450; target crossing gives Closed PnL 9.02. Calculations retain full anchor precision before formatting. |
| Configured Short | Entry 4470, target 4455, stop 4480; same sizing | Quantity 5, amounts 2575 / 2450, reward/risk 1.50. Historical stop crossing gives Closed PnL -10.00. |
| Fib Channel placement | Displayed A 4472.29, C 4473.51 | Level 0 is 4472.29, level 1 is 4473.51, level 0.5 is 4472.90; ten ratio/price labels are present. |
| BTCUSD Fib Retracement zoom | Displayed anchors 78612.29 and 78512.29 | All eleven calculated ratio/price labels and both anchor prices/times are unchanged after price-axis zoom. Level 0.5 is 78562.29. |
| BTCUSD Trendline zoom | Endpoint prices 78618.82 and 78507.19, at 09:23 and 09:39 | Both prices and both anchor times remain identical after price-axis zoom; geometry follows the new scale. |

## Test and source evidence

- [Final regression output](tests-verified.txt): 600 passing tests, including actual chart callback execution for live drawing data and price-axis repaint scheduling, Long/Short arithmetic, missing/ambiguous data, position settings, renderer geometry, drawing input ownership, trend tools, Fibonacci tools, persistence payloads and remount behavior.
- [Final toolbar regression output](tests-toolbar-final.txt): 170 passing tests after extending callout avoidance.
- [Final web build output](build-final.txt).
- [Position zoom values](post-long-scale-values.json), [historical PnL and visible OHLC](post-long-historical-values.json), [target/stop drag values](post-long-drag-values.json), [Short values](post-short-values.json).
- Production changes: `src/components/TradingChart.tsx`, `src/drawing-tools/drawingCandleUpdates.ts`, `positionDrawingValues.ts`, `PositionDrawingSettings.tsx`, `WebDrawingSelectionToolbar.tsx/.css`, `forecastingMeasurementRenderer.ts`, `gannFibonacciRenderer.ts`, `src/services/drawingManager.ts`, and `drawingApi.ts`.

## Coverage and limits

The 44-tool placement scope is the three affected menus: 17 Trend tools (including channels and pitchforks), 15 Gann/Fibonacci tools and 12 Forecasting/measurement tools. It does not include geometric shapes, text, icons or pattern menus.

The initial before/reference pass placed every tool, inspected completed geometry and available labels, and saved timestamped sequences. Detailed sequence review focused on the market baseline, Trendline/Info line, positions, Fib Channel, fans and Sector; full-size placement images support the wider catalog review. This is not a claim that every possible setting or every video frame was audited.

The first after pass stopped after Fib Channel when RTX5 returned to sign-in. After reconnecting to the restarted Chrome session, the fan labels, Fib Wedge, Sector, Forecast, VWAP, profiles and reversed range arrows were recorded and visually inspected on TEST XAUUSD M1. A later reconnection found BTCUSD M1 selected; Fib Retracement/Trendline zoom and both Fib time tools were recorded there. The Trend-based Fib Time recording completed before a transport timeout: its reviewed final frame shows A at 09:23, B at 09:26 and C at 09:39, with the unit interval projected three bars/minutes from C. The latest toolbar correction's visual repeat remains pending; its automated regression passes. The final temporary Trend-based Fib Time drawing may remain because the browser stopped accepting page operations before cleanup. The current account is TEST 200001; this audit did not restore Achiever after the session switch.

Volume profile remains an estimate from the available timeframe's candle range and volume. TradingView calculates profiles from lower-timeframe data ([official methodology](https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/)). RTX5 does not yet reproduce every TradingView profile setting, up/down row display or value area. Basic OHLC cannot establish target-versus-stop order within a candle. Position inputs do not automatically discover a broker contract's currency conversion.

Advanced Gann-square price/time scaling settings, Fib Spiral extent, Ghost Feed simulation settings and all TradingView style/settings options are not certified as equivalent by this audit. Existing simplified implementations remain; the report does not claim complete TradingView feature parity.

## Recording method

MP4s encode continuously sampled browser screenshots at their original variable timestamps. Sampling gaps are preserved. The OS pointer is not captured, although chart crosshairs, previews, anchors and UI changes are visible. These are **not native 60 fps screen recordings**. The encoder validates source paths, increasing timestamps, video duration, dimensions and output timestamps with ffprobe. Contact sheets provide frame sequences for review.

The incomplete extended-line/fan/input-edit attempts are retained for traceability but excluded from the primary links in favor of completed retries. `rtx-post-long-position-settings` was captured against a stale in-memory drawing runtime and is not after-fix evidence. The later `configured` and `scale-verified` clips were captured after full navigation to the updated runtime.
