# Fibonacci retracement and Trendline value audit

**Result: the checked values are correct.** Verified the current RTX5 Fibonacci retracement and standard Trendline using known-price cases, actual production rendering, and mouse interaction on the Achiever XAUUSD M1 chart. This was an audit; production source and backend configuration were not changed.

## Fibonacci retracement

The second anchor is level 0 and the first anchor is level 1. Each level price is `secondPrice + (firstPrice - secondPrice) * level`. The same calculated price is used for both the line's chart coordinate and its text label.

All eleven levels passed independent known-price checks in both drawing directions, including extension levels above 1. Flat anchors and five-decimal formatting also passed. For an upward 100-to-200 drawing, independently specified expectations included 176.40 at 0.236, 150.00 at 0.5, and 138.20 at 0.618.

The browser drawing had anchor labels 4459.83 and 4468.10. Its 0.618 label was **4462.99**, matching `4468.10 + (4459.83 - 4468.10) * 0.618` after rounding. Dragging the second anchor updated the levels correctly. All 11 values and line positions passed at initial placement, after dragging, and after zoom: **33 browser level checks**.

Browser checks account for the fact that endpoint labels have already been rounded to two decimals while calculations retain the original anchor precision. The exact known-price tests separately compare the renderer against unrounded numerical inputs. Zoom changes the screen projection, not saved prices.

This agrees with the anchor-and-ratio basis described in [TradingView's Fibonacci retracement documentation](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/). The audit covers RTX5's current arithmetic price calculation, not TradingView's optional logarithmic-level mode or every other Gann/Fibonacci tool.

## Standard Trendline

The two right-side price labels show the selected endpoints' prices. The bottom labels use those endpoints' timestamps through the chart's time formatter. The labels are anchor coordinates, not a current quote or a projected price at the chart's right edge. This is consistent with the [documented Trendline endpoint labels](https://www.tradingview.com/support/solutions/43000518095-trendline-drawing-tool/).

Browser proof:

| Stage | First endpoint | Second endpoint |
| --- | --- | --- |
| Placed | 4457.76 at 3 Sep 2026 13:51 | 4468.10 at 3 Sep 2026 14:24 |
| After dragging second endpoint | 4457.76 at 3 Sep 2026 13:51 | 4471.20 at 3 Sep 2026 14:21 |
| After zoom | Unchanged | Unchanged |

The numerical audit also verified that each price-scale badge aligns vertically with its anchor and that both tools use the chart's time formatter. No Long/Short Position PnL or sizing calculation is involved in these labels.

## Tests and evidence

- [Numerical audit tests](values.test.ts): **10 passed**. Run `npx vitest run --config artifacts/fib-trend-value-audit-20260908/vitest.config.ts`.
- [Numerical audit log](value-tests.log).
- [Existing drawing and time/coordinate regression tests](regression-tests.log): **273 passed** across five files.
- **283 tests passed in total.**
- [Fibonacci browser arithmetic/geometry audit](fib-browser-audit.json) and [raw DOM observations](fib-browser-dom.json).
- [Trendline browser checks](trendline-browser-audit.json) and [raw DOM observations](trendline-browser-dom.json).
- [Fibonacci placement and dragging recording](videos/01-fib-values.mp4).
- [Fibonacci zoom recording](videos/02-fib-zoom.mp4).
- [Trendline dragging and zoom recording](videos/03-trendline-values.mp4).
- [Fibonacci screenshot](fib-placed.png) and [Trendline screenshot](trendline-dragged.png).

Recordings contain timestamped browser screenshot samples with variable sampling intervals, not native 60 fps video. Full-resolution stages and contact sheets were reviewed. Temporary audit drawings were deleted; the user's existing Long Position was preserved.

These calculations remain verifiable using loaded chart data while incoming live quotes are unavailable. This result does not certify backend quote freshness, every drawing tool, or resolve the separate Long/Short Position value gaps found in the previous audit.
