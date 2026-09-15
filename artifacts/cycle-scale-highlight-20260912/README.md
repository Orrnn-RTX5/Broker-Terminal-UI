# Cycle axis highlight verification

Checked TradingView's reference chart and the authenticated local development chart on 2026-09-12.

Observed reference behavior:
- Cyclic lines: price and time intervals between the two anchors are highlighted during placement and selection.
- Sine line: both price and time intervals are highlighted.
- Time cycles: the time interval is highlighted. Both anchors share one price baseline, so there is no price-range band.

Before the fix, a locally selected Cyclic lines drawing had no axis-range bands. The fix adds both intervals for Cyclic lines and Sine line, and the time interval for Time cycles, using existing shared axis rendering helpers.

Live verification:
- Cyclic lines selection shows a time band 261.375 pixels wide and a price band 116.11435 pixels tall after reload.
- Time cycles preview and selection show only the time band. Dragging the second anchor across the first updates the band width from 261.375 to 43.5625 pixels while preserving the baseline.
- Sine line preview and selection show a 261.375-pixel time interval and 120-pixel price interval. Deselection removes both; reselecting restores them.
- Screenshots in this folder capture the reference previews/selections and local before/after states. Temporary drawings created for verification were removed; no orders were submitted.

Validation: all 310 tests passed across drawingManager.chartPatterns, chartPatternRenderer, drawingManager.gannFibonacci, and drawingManager.trendTools. Cycle regressions cover both preview directions, hidden preview cursors, selection, anchor crossing, body dragging, and Time cycles' shared price baseline. `npx tsc -b` and scoped `git diff --check` passed.

The source and running development app were verified. No desktop installer was rebuilt.
