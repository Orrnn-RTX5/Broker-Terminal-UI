# Chart pattern price-scale highlight verification

Verified on 2026-09-12 against the user's TradingView chart and the local terminal at http://127.0.0.1:5173/.

- TradingView ABCD selection shades the interval between the lowest and highest anchor prices, including interior anchors (`tradingview-abcd-selected.png`).
- Before the fix, local ABCD displayed four anchor price labels but zero price-range bands (`local-abcd-before.png`).
- After the fix, local ABCD displays the range (`local-abcd-selected.png`). Dragging the body upward by 40 pixels moves its band from y=302.64669 to y=262.64669 while retaining height=133.07559 (`local-abcd-moved.png`).
- XABCD displays the moving price interval while placing anchors (`local-xabcd-preview.png`). Completed selection spans 180 pixels, including the interior extreme (`local-xabcd-selected.png`). Clicking away removes the band; selecting the drawing restores it.
- Elliott impulse preview and selection both span 250 pixels (`local-elliott-preview.png`, `local-elliott-selected.png`).
- Temporary ABCD, XABCD, and Elliott drawings created for these checks were removed afterward. No orders were submitted.

Automated validation: 310 tests passed across drawingManager.chartPatterns, chartPatternRenderer, drawingManager.gannFibonacci, and drawingManager.trendTools. TypeScript project build (`npx tsc -b`) passed.

Regression coverage checks all six chart patterns and all five Elliott wave tools for preview bounds in both directions, full anchor extrema, selection visibility, body dragging, and interior anchor dragging. Cycle tools retain their existing behavior.

This verifies the source and running development app. No new desktop installer was packaged for this drawing change.
