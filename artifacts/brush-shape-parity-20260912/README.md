# Brush, Arrow and Shape axis comparison — 12 September 2026

Reference: https://in.tradingview.com/chart/P8prO2VP/?symbol=BITSTAMP%3ABTCUSD

Compared each of the 16 screenshot menu tools in the live TradingView chart and the local RTX5 chart at http://127.0.0.1:5173/. This pass addresses selection/placement axis feedback. The charts use different feeds, viewports and saved drawing styles; screenshots compare behavior rather than market prices or exact styling.

| Tool | TradingView observation | RTX5 finding and correction |
| --- | --- | --- |
| Brush | Blue price/time interval covers all sampled points, including interior extrema; no coordinate badges | Added missing intervals; verified body movement after switching to Cursor |
| Highlighter | Same interval behavior as Brush, with a translucent thick stroke | Added missing intervals; browser verified |
| Arrow marker | Interval spans its two anchors, excluding the decorative arrowhead extent | Added missing intervals |
| Arrow | Interval spans two anchors | Added missing intervals |
| Arrow mark up | One anchor, no interval | Preserved single-coordinate behavior |
| Arrow mark down | One anchor, no interval | Preserved single-coordinate behavior |
| Rectangle | Two corner anchors define intervals; eight resize controls | Added intervals; upper-right resizing verified before and after |
| Rotated rectangle | Three placed coordinates define intervals; visible corners differ from the third placed coordinate | Added intervals and corrected third-coordinate badges; browser verified |
| Path | Open multi-point path with ending arrow; selected interval covers all vertices without per-vertex badges | Added intervals and removed extra selected badges |
| Circle | Center and radius anchor define the interval, not the full circle bounds | Added anchor intervals |
| Ellipse | Three placed coordinates define interval; perpendicular width handles differ from the third placed coordinate | Added intervals and corrected third-coordinate badges; browser verified |
| Polyline | Open multi-point line; selected interval covers all vertices without per-vertex badges | Added intervals and removed extra selected badges |
| Triangle | All three vertices contribute to interval | Added missing intervals |
| Arc | Third placed coordinate contributes to interval even though its handle is projected onto the arc | Retained original third coordinate, corrected badges, added intervals |
| Curve | Bend contributes to shading; only the two endpoints have coordinate badges | Added intervals and removed bend badges; bend editing exercised |
| Double curve | Both bend points contribute to shading; only the two endpoints have coordinate badges | Added intervals and removed bend badges; second bend editing verified independently before and after |

Moving the pointer away from the completed rotated rectangle, ellipse and arc exposed the third coordinate badge that the crosshair initially obscured. Their range includes that third placed coordinate, not only the first two anchors. The final implementation and reference screenshots reflect this corrected observation.

Changes are in `src/services/drawingManager.ts`. Selection and construction use the shared blue, non-interactive price/time range renderer. Completed shapes use durable placed points for badges independently from the geometry's projected handles. Existing saved Arc drawings retain their stored coordinates; they are not migrated.

Validation:

- 367 tests passed across seven suites: drawingManager.brushShapes, brushShapeGeometry, freehandGeometry, drawingManager.chartPatterns, drawingManager.forecastingMeasurement, drawingManager.gannFibonacci, drawingManager.trendTools.
- The new brush/shape suite contains 18 cases covering all 16 tools: construction, selection, deselection, body movement, raw third-coordinate labels and individual curve bend edits.
- `npm run typecheck` passed.
- `git diff --check -- src/services/drawingManager.ts` passed.
- Browser after-checks: Rectangle preview/completion/resize, rotated rectangle, Brush body movement, Highlighter, Ellipse, Arc, Double curve second bend, and deselection. DOM verification confirmed zero interval elements after deselection.
- Comparison drawings were removed through the UI; existing drawings were preserved.

Evidence: `*-tv.png` contains reference captures, `*-rtx-before.png` contains pre-fix captures, and `*-rtx-after.png` plus the preview/resize/bend captures shows browser verification. These are sampled screenshots, not a continuous video. This pass does not establish complete parity for Shift constraints, polyline closure, every endpoint/corner interaction, or default curve proportions. No desktop installer was built or published.
