# Ruler / Measure

The separate ruler button is below Icons and above Zoom In, matching the supplied screenshot. Select Measure, then drag between two points, or click the start and end. Shift-click also starts a measurement from cursor mode. The result remains until the next chart click, Escape, a tool change, or a symbol/timeframe/account change. It is temporary and never enters saved drawings or undo history.

## Reference review

TradingView reference: https://www.tradingview.com/chart/P8prO2VP/

Short clips were captured separately and their extracted frames reviewed before implementation. They are **sampled browser-frame videos, not continuous screen recordings**. This verifies interaction states and geometry; it does not establish frame-perfect animation parity.

- [Upward placement](03-up-click-reference.mp4): blue rectangle, centered directional arrows, blue summary above the range.
- [Finish and dismiss](04-finish-dismiss-reference.mp4): result remains after completion, then disappears on the next chart click.
- [Reverse measurement](05-reverse-reference.mp4): red decline, negative bars and duration, summary below the range.
- [Shift-click](12-reference-shift-click.mp4): shortcut starts the same temporary tool.

The first drag experiments (01 and 02) also included chart panning; the later click-placement clips provided the unambiguous reference. Existing reference drawings were left intact.

## Verified terminal captures

- [Downward measurement](13-terminal-down.mp4)
- [Upward drag](14-terminal-up-drag.mp4)
- [Reverse measurement](15-terminal-reverse.mp4)
- [Clear on next chart click](16-terminal-clear.mp4)
- [Shift-click measurement](17-terminal-shift.mp4)

Each video has a matching `-review.jpg` contact sheet. `build_videos.py` reproduces them from the captured source frames and samples the complete duration for review.

Capture correction: files numbered 06 through 11 mistakenly captured the reference tab while terminal actions were performed. They are invalid as terminal evidence, are excluded from the video builder, and were replaced by 13 through 17. Direct terminal screenshots and DOM checks were also used throughout.

## Implementation and checks

- Price change, percentage, ticks, signed bar count, elapsed calendar time, and inclusive candle volume.
- Blue for upward changes; red for downward changes; both axis ranges highlighted in blue.
- Missing volume displays a dash. The terminal uses its broker's candle data, so values need not equal TradingView's OANDA feed.
- Candles snap horizontally; prices use symbol precision. Empty chart space projects the current timeframe.
- Historical loading exposed an index-shift bug during verification: a short measurement could report thousands of bars. Anchors now retain timestamps and resolve their current chart indexes on redraw. A regression test covers a 4,000-index shift.
- Atomic SVG replacement keeps the rectangle and readout in the same update.
- Pointer capture, drag suppression, cancellation, chart ownership, and cleanup are separate from persistent drawing tools.
- Wider regression run: **172 tests passed across seven files** (`regression-final.log`). Final ruler-specific check: **13 tests passed** (`ruler-final.log`).
- Production build: **passed** (`build-final.log`). Final screenshot: [final-ruler.png](final-ruler.png).
- Live browser checks also confirmed Escape clearing and M1-to-M5 switching removes the ruler. No order was submitted or closed.
