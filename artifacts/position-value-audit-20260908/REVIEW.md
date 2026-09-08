# Long/Short Position value audit

**Verdict: cursor placement works, but the value implementation is not fully correct.** This verification pass did not change production source or backend configuration.

## Confirmed correct

- Target/stop price distances and percentage formulas use the drawing's entry and boundaries.
- Risk/reward is reward distance divided by stop distance. Browser checks matched the visible geometry through initial placement, width adjustment, target adjustment, and stop adjustment: `1`, `1`, `1.34`, `1.08`.
- Long and Short use opposite signs for price movement.
- Tick offsets divide price distance by the chart series' minimum move. This confirms the frontend formula, not the broker's instrument metadata.

## Confirmed gaps

| Value | Finding | Required correction |
| --- | --- | --- |
| PnL units | The center label multiplies the price difference by floored Qty. This differs from TradingView's drawing label, which uses the price offset. | Distinguish the price-offset label from monetary profit calculations. |
| Historical PnL | `drawingManager` always supplies the last candle's price. The position renderer never uses the drawing's candle interval for PnL. | Resolve the close at the drawing's right edge; use the current price for a future drawing. |
| Closed result | The renderer never checks candle highs/lows for entry and target/stop touches and always labels the result Open. | Evaluate the drawing interval and distinguish open/closed outcomes, handling ambiguous same-bar hits explicitly. |
| Missing prices | Missing current/latest price becomes `0.000` PnL. | Display unavailable until a usable reference price exists. |
| Quantity | Risk is fixed at 250, integer flooring occurs inside the calculation, and Qty is forced to at least 1. A 500-unit stop distance therefore shows Qty 1 although the risk budget permits only 0.5 raw units. | Preserve raw sizing separately from display precision; avoid forcing a quantity that exceeds the risk budget. |
| Amount and sizing assumptions | Account 1,000 and risk 250 are hardcoded. No drawing controls supply account size, risk, leverage, point value, lot size, or quantity precision. Amount is rounded to whole numbers. | Make planning assumptions explicit/configurable and calculate all monetary labels from the same sizing model. These labels are not the connected broker balance. |

**Rounding clarification:** Amount and the displayed integer Qty can differ even in TradingView because the displayed quantity may be rounded while calculations retain raw precision. That difference alone is not a bug. The confirmed RTX5 issues are the forced minimum quantity, using floored quantity inside the center PnL, missing planning inputs, and the PnL time/status semantics above.

The [official TradingView drawing calculation reference](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/) distinguishes monetary target/stop balance estimates from the center price-offset PnL and describes the historical right-edge and closed-result behavior. The existing TradingView chart also visibly showed historical Open PnL `-9.533` while Qty was `13`; see the reference screenshot below.

## Numerical evidence

The audit imports and executes the actual production SVG renderer with deterministic candles. It does not duplicate the renderer.

- Entry 100, target 110, stop 90, drawing right-edge close 103, later/latest close 105: RTX5 shows `Open PnL: 125.000`; the historical price-offset result is `3.000`.
- The mirrored Short example also shows `125.000` instead of `3.000`.
- A future Long example with entry 100 and current price 105 shows `125.000` instead of `5.000`.
- An unambiguous target touch inside the drawing shows `Open PnL: 175.000` instead of the closed target offset `10.000`.
- With no candle data and no reference price, the renderer asserts `Open PnL: 0.000`.

Nine audit checks produced three matches and six mismatches. This is a separate semantic audit, not a rerun of the earlier 500 passing interaction/regression tests. Those tests did not establish complete correctness of the values; an existing renderer test explicitly expects quantity-scaled center PnL.

Run: `node artifacts/position-value-audit-20260908/probe.mjs`

## Data-update implementation concern

Source inspection also found that `getDrawingSeriesData` returns `lastRenderedCandlesRef.current`, which is assigned by full chart rendering. The incremental `push` path updates the chart series and legend without explicitly updating that drawing snapshot or scheduling a drawing render. Therefore live drawing freshness needs a dedicated frontend test and synchronization correction; restoring the backend feed alone is not proof that this path is correct. This concern was not tested with live broker ticks because the feed is unavailable, as reported by the user.

## Evidence and source locations

- [Deterministic production-renderer probe](probe.mjs)
- [Numerical results](results.json)
- [Browser geometry/value checks](browser-value-checks.json)
- [Current RTX5 labels](rtx-current-values.png)
- [Short Position adjustment check](short-value-check.png)
- [TradingView reference labels](tradingview-reference-values.png)
- `src/drawing-tools/forecastingMeasurementRenderer.ts:272`: distances, quantity, PnL, and amounts.
- `src/services/drawingManager.ts:2373`: latest candle passed to the renderer regardless of drawing interval.
- `src/components/TradingChart.tsx:862`: drawing candle provider.
- `src/components/TradingChart.tsx:4971`: incremental live candle update path.

The temporary Short Position used for the browser audit was deleted. The user's existing Long Position was preserved. No live order was submitted.
