# Pitchfork price-scale comparison — 8 September 2026

Reference: https://www.tradingview.com/chart/P8prO2VP/
RTX5: http://127.0.0.1:5173/

## Observed difference

All four tools were placed with native browser mouse actions: Pitchfork, Schiff pitchfork, Modified Schiff pitchfork, and Inside pitchfork.

| Stage | TradingView | RTX5 before the fix |
| --- | --- | --- |
| Cursor before first anchor | Moving price and time values | No drawing coordinate values |
| First anchor committed; cursor moves | Committed anchor value and next cursor value | No drawing coordinate values |
| Second anchor committed; cursor moves | Two committed values and next cursor value | Pitchfork geometry, but no drawing coordinate values |
| Third anchor committed; drawing selected | Three anchor prices and times | Three anchor prices and times already worked |
| Completed drawing deselected | Anchor labels hidden | Anchor labels hidden |

The right-scale values are anchor coordinates, not the projected prices where the fork rays intersect the chart edge.

## Recordings reviewed

Final recordings on Achiever Financials, with the complete fix:

- [Pitchfork after](videos/17-rtx-pitchfork-final.mp4)
- [Schiff pitchfork after](videos/14-rtx-schiff-pitchfork-final.mp4)
- [Modified Schiff pitchfork after](videos/15-rtx-modified-schiff-pitchfork-final.mp4)
- [Inside pitchfork after](videos/16-rtx-inside-pitchfork-final.mp4)
- [Pointer exit, reentry, and cancellation](videos/18-rtx-cancel-boundaries-final.mp4)
- [Reselection, anchor dragging, and deletion](videos/09-rtx-pitchfork-edit-selection-after.mp4)

Reference and before recordings:

- [TradingView Pitchfork placement](videos/01-tv-pitchfork.mp4)
- [TradingView remaining three variants](videos/02-tv-other-pitchforks.mp4)
- [RTX5 Pitchfork before](videos/03-rtx-pitchfork-before.mp4)
- [RTX5 remaining three variants before](videos/04-rtx-other-pitchforks-before.mp4)
- [TradingView construction stages](videos/05-tv-pitchfork-construction.mp4)
- [RTX5 construction stages before](videos/06-rtx-pitchfork-construction-before.mp4)

These videos use continuously sampled browser screenshots during native UI actions. The encoder preserves original frame timestamps and verifies the resulting MP4 with ffprobe. They are not native 60 fps desktop recordings; the OS cursor is not captured. Construction stages, chart geometry, values, and selection state were reviewed through the recorded frames and full-resolution stage screenshots.

## Code change

`src/services/drawingManager.ts` previously rendered pitchfork coordinate labels only for completed, selected drawings. Its construction overlay handled certain line tools and regression, excluding all four pitchfork variants.

The construction overlay now shows committed pitchfork handles and their price/time labels. A separate dark label follows the pending point, including before the first click. Existing chart price precision and time formatting are reused. Construction overlays do not intercept anchor clicks.

`src/components/TradingChart.tsx` hides the moving labels when the pointer leaves the plot while retaining unfinished geometry and fixed anchor values. Completion uses the existing three selected-anchor labels. Cancellation removes the construction overlay.

`src/drawing-tools/WebDrawingToolsRail.tsx` also retried `SELECT_TOOL` unconditionally on the first chart pointer event. Browser diagnostics showed it running after the chart had rendered the first preview, restarting the drawing and clearing that preview. The retry now checks whether the target chart already has the requested type and subtype armed. It still retries after a chart switch or failed initial selection. Tests cover both an empty construction and an already-placed first anchor.

Mouse previews also ignore resets of the chart's hidden native crosshair. Actual DOM pointer exit remains authoritative; touch continues using native crosshair events.

## Verification

- Final focused suite: 258 drawing, pointer lifecycle, and toolbar tests passed. The earlier coordinate and chart-context checks also passed.
- 26 broker configuration tests passed after switching the local web deployment to Achiever Financials.
- Web production build passed with the final implementation and Achiever configuration (existing bundle-size warning only).
- All four variants passed browser assertions for the initial cursor value, the first anchor while pressing and moving, the second anchor with a moving third-point value, and three selected anchor values after completion.
- Pointer exit hides only the moving value, reentry restores it, and Escape clears construction. Reselection restores three values; moving one anchor changes its price while preserving the other two. Test drawings were deleted after verification.
- Final MP4 frame timestamps and dimensions were verified with ffprobe. Their captured frames were reviewed visually. The earlier combined capture numbered 07 timed out and is explicitly marked incomplete; it is superseded by the separate final recordings above.

The pitchfork coordinate-label fix is implemented and browser-verified. This is a targeted verification of placement, coordinate values, and selection behavior, not a claim of complete TradingView styling/settings parity. Achiever supplied historical candles and displayed a stale-quote notice during testing; no orders were submitted.
