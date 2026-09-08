# Fibonacci and Gann comparison - work in progress

User acceptance: work on one tool at a time, test the existing RTX5 tool first,
record the same tool on TradingView second, compare both recordings, fix the
differences, and physically retest before proceeding. Cursor selection and clean
tool icons are required. Automated tests alone do not satisfy acceptance.

## Current tool: Fib retracement

Observed on the live TradingView reference:
- Two anchors; the second anchor is level 0 and the first anchor is level 1.
- This direction follows the anchors, including a downward drawing.
- Default enabled levels: 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618,
  3.618, 4.236. Prices are displayed alongside ratios.
- Left-aligned placement of labels outside the level span; the Style panel
  displays 12px text, Prices enabled, Background enabled, and no extension of
  the horizontal lines by default.

Implemented changes this session:
- Corrected anchor direction, extended ratios through 4.236, chart price
  formatting, label typography/alignment, and level line width/style handling.
- Applied the same observed extended ratios and price labels to trend-based
  extension, which was inspected before the one-at-a-time clarification.
- Fixed existing SVG hit areas intercepting clicks while placing a new drawing:
  existing groups and descendants become noninteractive in the owning chart
  during placement; interactivity returns on completion or cancellation.

Live RTX5 observations before the final interaction fix:
- Account 200001 was authenticated at http://127.0.0.1:5173/.
- Corrected retracement levels and symbol-formatted labels were visible.
- Selected line width 4 and dashed styling through the edit toolbar and verified
  their actual SVG attributes. Lock/unlock controls changed state.
- Existing drawings could intercept anchor clicks for a newly selected tool.
  This is the source of the final interaction fix, still needing browser retest.
- Do not interpret click attempts or screenshots of an in-progress preview as a
  completed drawing or verified deletion/persistence.

## Validation

250 tests passed across drawingManager.gannFibonacci, drawingManager.setChart,
drawingContextIsolation, drawingManager.trendTools,
drawingManager.forecastingMeasurement, and WebDrawingToolsRail.

The final `npm run build:web` passed, including the interaction fix. Vite emitted
its existing chunk-size and mixed-import warnings.

## Evidence and remaining work

The PNG subfolders are preliminary browser step captures. They are not a
continuous video recording. The attempted desktop recording captured the editor
and was discarded. Existing artifacts/drawing-parity/videos contains earlier
reference recordings; those do not establish current-session acceptance.

Chrome repeatedly timed out on chart input, screenshot, and DOM commands.
Browser extension checks passed (enabled, native host valid). A request to open
a fresh Chrome window using the documented Browser recovery flow is pending.

After browser recovery, restart the requested sequence with Fib retracement:
1. Record RTX5 placement, upward/downward anchors, selecting an existing drawing,
   endpoint dragging, whole-object dragging, cursor restoration, cancel, and
   placing a drawing over an existing drawing.
2. Record the same interactions on TradingView and compare the recordings.
3. Inspect and refine the retracement icon from the actual reference.
4. Fix any remaining discrepancies, retest RTX5, and record evidence.
5. Only then proceed to trend-based extension, channel, time zone, speed
   resistance fan, trend-based time, circles, spiral, resistance arcs, wedge,
   pitchfan, Gann box, fixed Gann square, Gann square, and Gann fan, one by one.

None of the 15 tools is signed off for complete TradingView parity yet. Advanced
style settings and the icon cleanup have not been implemented in this session.
