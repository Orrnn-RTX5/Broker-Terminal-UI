# Gann price-scale highlight

Compared the selected Gann box on the user's TradingView chart with the live RTX BTCUSD chart. The current source already rendered the selected endpoint price band after completion, but construction required two committed anchors. All four Gann tools finish on their second anchor, so their placement previews could never reach that condition.

The construction band now includes the visible moving second anchor for the Gann catalog group. It follows the price interval in either direction, disappears when the preview cursor is hidden, and retains the existing selected/deselected behavior. Fibonacci time-axis highlighting is unchanged.

Verified Gann Box, Gann Square Fixed, Gann Square and Gann Fan through the live web UI, both during placement and after completion. Screenshots cover each state. Also verified the Gann Fan band follows a drawing move. Temporary test drawings were removed; the pre-existing drawings were retained.

Validation: 248 tests passed across the drawing manager Gann/Fibonacci, Gann catalog, and trend-tool suites. `npx tsc -b` passed. This change is in the shared drawing manager; a new desktop installer was not packaged for this drawing-only change.
