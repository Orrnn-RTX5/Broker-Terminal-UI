# Fib Time Zone comparison and fix

Verified on 2026-09-12 using the user's [TradingView BTCUSD M1 chart](https://in.tradingview.com/chart/P8prO2VP/?symbol=BITSTAMP%3ABTCUSD) and the authenticated local RTX5 BTCUSD M1 terminal.

## Recordings

- [TradingView reference](tradingview-placement.mp4)
- [RTX5 before](rtx-before.mp4)
- [RTX5 after](rtx-after.mp4)

These are **sampled interaction videos assembled from browser screenshots**, with each captured state held for 1.5 seconds. They are not continuous screen recordings and do not measure animation smoothness or latency. Each folder retains the original PNGs and capture timestamps. The matching `*-review.jpg` sheets were extracted from the encoded videos and reviewed.

## Findings and changes

| Behavior | Observed problem | Result |
| --- | --- | --- |
| Axis highlight | The initially open RTX5 tab highlighted the price axis. An existing source change already moved completed time drawings to the time axis, but omitted the moving endpoint during construction. | Preserved that change and included the second-anchor preview in Fib Time Zone's time-axis band. The band follows either direction and uses the actual time-scale height. |
| Level 1 color | RTX5 reused retracement colors, making both levels 0 and 1 gray. TradingView used gray for 0 and blue for positive projections. | Level 0 stays gray; positive time projections and labels use the drawing color. |
| Line width and style | The renderer hard-coded widths and solid strokes, ignoring the editing controls. | All time-zone levels now use the chosen width and dash style. Verified 4px Dashed and then restored 2px Solid in the browser. |
| Placement and dragging | Two-click placement, moving the whole drawing by a projected line, and reversing the second anchor worked in the baseline. | Rechecked successfully after the change. Fibonacci spacing remains unchanged. |

The before capture predates a reload of the unfinished local changes. The additional `rtx-current-source` and `rtx-source-before` folders contain diagnostic captures during that check; they are not the primary comparison videos.

## Validation

- Three regression failures reproduced before the implementation change.
- 396 tests passed across Gann/Fibonacci rendering and catalog, chart drawing lifecycle, and interaction priority. See `tests.txt`.
- `npm run build` passed, including `tsc -b`. See `build.txt`. Vite reported its bundle-size warning.
- Live final checks: moving preview band, completed time band without price band, blue level 1, 4px dashed projections, whole-drawing drag, reversed endpoint, and deselection clearing the band and handles.
- `style-verification.json` confirms the rendered width, dash pattern, colors, and axis-band ownership. `reverse-verification.json` confirms the reversed anchor and a positive-width band on the 28px time scale.
- Final browser error inspection returned zero matching drawing errors.

Changes are in `src/services/drawingManager.ts`, `src/drawing-tools/gannFibonacciRenderer.ts`, and the existing Gann/Fibonacci regression test file. Other pre-existing checkout changes were preserved.

Live comparison covered BTCUSD M1. Exact parity across every symbol/timeframe and continuous pointer latency were not measured. No installer or release was published.
