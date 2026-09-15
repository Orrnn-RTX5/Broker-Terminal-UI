# Forecasting, volume, and measurement scale highlights

Verified 2026-09-12 in the running local terminal and the user's TradingView reference chart.

Implemented tool-specific selected and construction intervals:
- Long/Short position: stop-to-target prices, including the entry, using the same defaults and edited values as the drawing.
- Position forecast, Bars pattern, Ghost feed, and Sector: anchor ranges; Ghost feed uses its two visible end handles, and Sector uses its constrained anchor coordinates.
- Fixed and anchored volume profiles: actual volume-profile low/high values from the selected chart's data, ignoring unrelated candles and arbitrary clicked prices. Missing volume data produces no invented interval.
- Price range: price interval. Date range: time interval. Date and price range: both.
- Anchored VWAP remains a single-anchor study without an artificial selection interval, as observed on TradingView.

TradingView comparison screenshots include fixed-range profile bounds, the position stop-to-target range, anchored VWAP, and anchored volume profile. The anchored volume profile reference itself uses a single anchor; the local app highlights its computed profile bounds to fulfill the requested volume-tool highlighting.

Live local checks:
- Date and price range had zero bands before the fix. Afterward it displayed both. Dragging the body 40 pixels right and 30 pixels down moved the highlighted price range down 30 pixels while retaining height 116.80310 pixels.
- Long position displayed its 204.06-pixel stop-to-target range during preview and selection.
- Fixed range volume profile preview/selection labeled 77249.93 and 77329.01, matching its profile data despite anchors being placed below that range.
- Anchored volume profile displayed its computed range, extending through the latest candle. Clicking away cleared the range highlights.
- Only test drawings created in this pass were removed. No trades were submitted.

Validation: 371 tests passed across drawingManager.forecastingMeasurement, forecastingMeasurementRenderer, drawingManager.chartPatterns, drawingManager.gannFibonacci, and drawingManager.trendTools. `npx tsc -b` and scoped `git diff --check` passed.

No desktop installer was rebuilt in this pass.
