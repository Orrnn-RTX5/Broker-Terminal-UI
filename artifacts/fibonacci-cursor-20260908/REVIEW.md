# Fibonacci cursor fix — 8 September 2026

Fib Retracement lost its first anchor when the mouse moved while pressed. The next click therefore began the drawing instead of completing it. This was reproduced and recorded in the user's Achiever chart and compared with the supplied TradingView chart before editing.

## Main comparison

- [TradingView Fib Retracement](videos/01-tv-fib-retracement.mp4)
- [RTX5 before the fix](videos/02-rtx-fib-retracement-before.mp4)
- [RTX5 fixed placement](videos/03-rtx-retracement-fixed.mp4)
- [Endpoint editing, deselection, and reselection](videos/04-rtx-retracement-edit.mp4)
- [Cancellation, chart exit/reentry, and placement over an existing drawing](videos/19-cancel-and-existing-drawing.mp4)

The first press now commits the anchor, movement immediately updates the preview, and the next press completes a two-point drawing. Three-point tools retain both committed anchors until their third press. Initial cursor coordinates, committed anchor markers, and selected endpoint price/time labels are visible.

## Cause and code

The mouse-down, direct mouse-move, hidden-crosshair reset guard, and drawing input-priority paths in `TradingChart.tsx` were restricted to trend tools. Fibonacci and Gann tools still depended on the chart library's click event, which can be discarded after held movement.

`usesDirectDrawingPointerInput` now supplies one shared predicate for those four paths, covering trend tools plus `fibonacci` and `fib_extension`. The existing duplicate-click suppression, primary-button checks, chart ownership, axis boundaries, and touch behavior remain in use.

`drawingManager.ts` now renders Fibonacci/Gann construction coordinates and selected endpoint handles/labels. The existing Fibonacci/Gann geometry renderer remains unchanged.

## Remaining menu tools: recorded placement and completion checks

| Tool | Recording |
| --- | --- |
| Trend-based fib extension | [Video](videos/05-trend-based-fib-extension.mp4) |
| Fib channel | [Video](videos/06-fib-channel.mp4) |
| Fib time zone | [Video](videos/07-fib-time-zone.mp4) |
| Fib speed resistance fan | [Video](videos/08-fib-speed-resistance-fan.mp4) |
| Trend-based fib time | [Video](videos/09-trend-based-fib-time.mp4) |
| Fib circles | [Video](videos/10-fib-circles.mp4) |
| Fib spiral | [Video](videos/11-fib-spiral.mp4) |
| Fib speed resistance arcs | [Video](videos/12-fib-speed-resistance-arcs.mp4) |
| Fib wedge | [Video](videos/13-fib-wedge.mp4) |
| Pitchfan | [Video](videos/14-pitchfan.mp4) |
| Gann box | [Video](videos/15-gann-box.mp4) |
| Gann square fixed | [Video](videos/16-gann-square-fixed.mp4) |
| Gann square | [Video](videos/17-gann-square.mp4) |
| Gann fan | [Video](videos/18-gann-fan.mp4) |

All 15 tools passed native mouse placement, preview, required-anchor completion, selection, and deletion checks. Fib Retracement also passed endpoint editing and reselection. Retracement and extension passed cancellation and cursor boundary checks. `dom-stages.json` corroborates the observed anchor counts and coordinate values.

426 tests passed across eight files, including all 15 tools in the actual chart listener and command lifecycle tests, geometry/degeneracy checks, construction labels, existing trend tools, toolbar dispatch, and chart isolation. See [focused tests](focused-tests.log) and [regression tests](regression-tests.log).

`npm run build:web` passed with the existing bundle-size warning. See [build log](build-web.log). Relevant source files passed `git diff --check`.

Recordings use timestamped browser screenshot samples during native browser actions. They are not 60 fps desktop captures, and the OS cursor is not captured. Video timestamps/dimensions were checked with FFprobe. The retracement comparison and final editing/extension contact sheets were reviewed alongside full-resolution chart screenshots. This verifies the reported interaction fix, not complete visual/settings parity for every TradingView tool.

RTX5 remained connected to Achiever Financials, with historical XAUUSD candles and a stale-quote notice. No trades were submitted. Test drawings were deleted or cancelled; preexisting drawings were preserved. The user's RTX5 tab was reloaded to use the updated drawing engine.
