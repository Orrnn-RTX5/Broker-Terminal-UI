# Long Position cursor verification — 8 September 2026

Fixed Long Position and the shared Short Position input path in the local RTX5 web terminal. Verified on the Achiever account's XAUUSD M1 chart.

## Reproduction and cause

Compared the same press-and-move gesture on the [TradingView chart](https://www.tradingview.com/chart/P8prO2VP/) and RTX5 before editing:

- TradingView completed Long Position on the initial mouse press.
- RTX5 relied on the chart library's click event. Moving while pressed suppressed that event, leaving an uncommitted preview following the cursor.
- Long/Short Position were missing from the shared direct-pointer input predicate already used by trend and Fibonacci tools. This also omitted their scoped overlay input priority.
- The preview used the renderer's 1%-of-price and 160-pixel fallbacks. Completion used viewport-based risk and a forty-bar duration, so the geometry jumped after placement. In the recorded chart the preview risk was about 44.5 price units; the completed default was 7.01.
- Position rendering excluded candle data, leaving the PnL calculation without a current price.

## Changes

- `src/drawing-tools/drawingInteractionPriority.ts`: include Long/Short Position in the existing native mouse-press, movement, click-deduplication, and chart-scoped priority path.
- `src/services/drawingManager.ts`: share target/stop/duration defaults between preview and completion without mutating the moving preview; supply candle data for position PnL.
- Extend the production-listener and command-lifecycle tests to both position tools. Add preview/completion geometry and signed-PnL checks. Refresh three stale forecasting source-contract assertions to the existing runtime-context and time-projection implementation.

## Recordings reviewed

These MP4s contain continuously sampled browser screenshots, encoded using their capture timestamps. Sampling intervals vary and include capture gaps; these are not native 60 fps desktop recordings. The OS cursor is not captured. Full-resolution stages, timestamp manifests, contact sheets, and ffprobe output are retained alongside them.

| Recording | Result |
| --- | --- |
| [TradingView reference](videos/01-tv-long-position.mp4) | First press commits the drawing despite held movement. Our temporary reference drawing was undone. |
| [RTX5 before](videos/02-rtx-long-position-before.mp4) | Press lost; oversized uncommitted preview follows later cursor movement. |
| [RTX5 after](videos/03-rtx-long-position-after.mp4) | Preview matches completion; first press commits one selected drawing at its original location. |
| [Long controls](videos/04-rtx-long-position-controls.mp4) | Target, stop, width, and entry adjust independently. Risk/reward changes from 1 to 1.39, 1.08, and 1.25. |
| [Movement and lock](videos/05-rtx-long-position-lock-move.mp4) | Body movement preserves dimensions and ratio; dragging while locked leaves geometry unchanged. |
| [Short Position](videos/06-rtx-short-position.mp4) | Preview and first-press completion match; mirrored target/stop controls and width work. |
| [Cancel and normal click](videos/07-rtx-cancel-and-normal-click.mp4) | Escape removes the preview; ordinary click creates one position, and width remains adjustable. |

[Final restored drawing](stages/long-restored.png) and [before/after reload geometry](persistence.json) confirm that the adjusted drawing survives reload with identical geometry and readout. Final DOM inspection found one position, no preview, and no lingering armed input-priority flag. A short browser wait timed out during reload; the subsequent successful screenshot and DOM inspection confirmed restoration. One Long Position example remains on the chart.

## Validation

- [Focused tests](focused-tests.log): **178 passed**, 7 files.
- [Trend/Fibonacci and interaction regressions](regression-tests.log): **322 passed**, 5 files.
- **500 tests passed in total.**
- [Production web build](build-web.log): passed, including TypeScript compilation. Vite reports its existing chunk-size warning.

Browser verification covers the recorded mouse workflows. No live orders were submitted. The chart showed a stale-quote notice; this verifies drawing behavior and PnL calculation from available chart data, not broker quote freshness or every TradingView feature.
