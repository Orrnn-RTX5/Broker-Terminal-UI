# Channel price-scale fix — 8 September 2026

Reproduced all four channel tools in the supplied [TradingView chart](https://www.tradingview.com/chart/P8prO2VP/) and the local RTX5 terminal connected to Achiever Financials. Recorded the reference and broken behavior before changing channel code, then recorded and reviewed the corrected behavior.

## Video comparisons

| Tool | TradingView | RTX5 before | RTX5 fixed | Selected price values |
| --- | --- | --- | --- | --- |
| Parallel channel | [Reference](videos/01-tv-parallel-channel.mp4) | [Before](videos/05-rtx-parallel-before.mp4) | [Fixed](videos/10-rtx-parallel-final.mp4) | Four projected corner prices |
| Regression trend | [Reference](videos/02-tv-regression-trend.mp4) | [Before](videos/06-rtx-regression-before.mp4) | [Fixed](videos/12-rtx-regression-final.mp4) | Two fitted centerline endpoint prices |
| Flat top/bottom | [Reference](videos/03-tv-flat-top-bottom.mp4) | [Before](videos/07-rtx-flat-before.mp4) | [Fixed](videos/14-rtx-flat-final.mp4) | Two baseline prices and one shared flat-boundary price |
| Disjoint channel | [Reference](videos/04-tv-disjoint-channel.mp4) | [Before](videos/08-rtx-disjoint-before.mp4) | [Fixed](videos/16-rtx-disjoint-final.mp4) | Four projected corner prices |

Counts above describe the tested, non-degenerate shapes. Equal prices are displayed once. During placement, a separate cursor price appears when its value differs from the channel's endpoint values.

## Cause and implementation

`src/services/drawingManager.ts` had construction coordinate labels gated to pitchforks. The four channel-specific selection branches rendered handles but never appended their price/time labels.

- Added channel construction labels from the first cursor move through completion. Cursor exit hides the moving values and retains committed anchors; reentry restores the preview values.
- Shared channel geometry across boundary rendering, handles, and coordinate labels. Parallel channels respect their persisted width offset. Flat channels deduplicate the shared boundary price.
- Regression construction shows the clicked range with cursor prices. Completion shows the actual fitted centerline prices and sampled range times, rather than the arbitrary clicked prices. Existing no-fit editing remains available.
- Moved the disjoint boundary control from its unused third-click x position onto the rendered boundary corner. Dragging changes the boundary prices while retaining the baseline.
- Separated nearby price labels so distinct channel values remain readable. Labels retain instrument precision and the chart's time formatter.

This task changed `drawingManager.ts` and `drawingManager.trendTools.test.ts`. Earlier pitchfork, toolbar pointer-input, and Achiever configuration changes remain in the existing working tree.

## Verification

Native browser mouse actions verified first movement, press-and-move placement, every required anchor, completion, deselection, reselection, editing, and deletion for each channel.

Additional recordings:

- [Parallel width editing and selection](videos/11-rtx-parallel-edit-final.mp4)
- [Regression range editing and selection](videos/13-rtx-regression-edit-final.mp4)
- [Flat boundary editing and selection](videos/15-rtx-flat-edit-final.mp4)
- [Disjoint boundary editing and selection](videos/17-rtx-disjoint-edit-final.mp4)
- [Escape cancellation for all four channels](videos/18-rtx-channels-cancel-final.mp4)

The parallel placement recording includes leaving the chart and reentering during construction. Browser DOM checks corroborate the visible values in `before-dom-stages.json` and `final-dom-stages.json`; full-resolution screenshots are in `stages/`, and timestamped video contact sheets are in `contact-sheets/`.

338 tests passed across nine files: trend tools, regression recovery, native chart drawing lifecycle, interaction priority, toolbar activation, channel geometry, logical coordinates, chart rebinding, and drawing context isolation. See [channel tests](channel-tests.log) and [integration tests](drawing-integration-tests.log).

`npm run build:web` passed. The existing large-bundle warning remains; see [build log](build-web.log). Relevant files passed `git diff --check`.

## Recording details

These MP4s use timestamped browser screenshots with native browser mouse actions. They preserve sampled timing; they are not desktop recordings or 60 fps performance measurements, and the OS cursor is not captured. FFprobe verified video dimensions and timestamps. The captures and full-resolution stage images were reviewed.

TradingView and RTX5 use different broker data and dates, so the comparison concerns placement and coordinate behavior, not matching numeric market prices. RTX5 displayed historical XAUUSD candles with a stale-quote notice during this test. No orders were submitted. Test drawings were removed, and preexisting TradingView drawings were preserved.

Capture `09-rtx-parallel-final` was stopped when its assertion found the browser still running the previous drawing-manager instance. The chart was reloaded; complete recordings 10–18 verify the updated code. Capture 09 is not final validation.
