# Text and notes axis feedback — 12 September 2026

Compared each of the ten Text and notes tools on the [TradingView reference chart](https://in.tradingview.com/chart/P8prO2VP/?symbol=BITSTAMP%3ABTCUSD), then created the corresponding annotation in the local RTX5 app. Before the fix, RTX5 omitted their price/time coordinate feedback and used generic red square selection handles.

| Tool | Selected TradingView axis feedback | Reference | RTX5 before |
| --- | --- | --- | --- |
| Text | One price and time badge; no range | [Screenshot](text-tv.png) | [Screenshot](text-rtx-before.png) |
| Note | Two anchor badges on each axis, with range bands | [Screenshot](note-tv.png) | [Screenshot](note-rtx-before.png) |
| Price note | Two anchor badges on each axis, with range bands | [Screenshot](price-note-tv.png) | [Screenshot](price-note-rtx-before.png) |
| Pin | One price and time badge; no range | [Screenshot](pin-tv.png) | [Screenshot](pin-rtx-before.png) |
| Table | One price and time badge; no range from cell dimensions | [Screenshot](table-tv.png) | [Screenshot](table-rtx-before.png) |
| Callout | Two anchor badges on each axis, with range bands | [Screenshot](callout-tv.png) | [Screenshot](callout-rtx-before.png) |
| Comment | One price and time badge; no range | [Screenshot](comment-tv.png) | [Screenshot](comment-rtx-before.png) |
| Price label | One price and time badge; no range | [Screenshot](price-label-tv.png) | [Screenshot](price-label-rtx-before.png) |
| Signpost | One price and time badge; no range | [Screenshot](signpost-tv.png) | [Screenshot](signpost-rtx-before.png) |
| Flag mark | One price and time badge; no range | [Screenshot](flag-tv.png) | [Screenshot](flag-rtx-before.png) |

## Changes

- Added anchor price/time badges during construction and selection for all ten tools.
- Added blue axis bands between the two anchors of Note, Price note and Callout. Text box and table dimensions do not create additional chart anchors.
- Kept committed anchor badges when the preview cursor leaves the chart. Selection feedback clears on deselection, deletion and cancellation.
- Added blue selection handles, retaining independent anchor dragging. Text and Signpost use square handles; other annotation anchors use circular handles.
- Kept Price note content tied to its target price, independently of the label position's coordinate badge.

The shared drawing renderer serves the desktop and web app. The separate Content tools are outside this change.

## Verification

- 69 tests passed across drawingManager annotations (34), AnnotationEditor (11), TableCellEditor (5), drawingApi annotations (1), and drawingManager brushShapes (18).
- The new parameterized cases cover all ten tools, preview feedback, anchor movement, selection cleanup, and text/table size independence.
- `npm run typecheck` passed.
- `git diff --check -- src/services/drawingManager.ts src/services/drawingManager.annotations.test.ts` passed.
- Browser verification after the change confirmed [Price note construction feedback](price-note-preview-rtx-after.png) and [completed selection bands, badges and handles](price-note-rtx-after.png).

The browser connection timed out after dragging the Price note label. Its final drag state and further single-anchor browser checks could not be captured; movement is covered by the automated tests. A test Price note may remain in the task's local chart tab because the connection became unavailable before cleanup. Earlier test annotations were removed through the UI. Browser tab finalization was also blocked by the lost connection.

No desktop installer was built or published in this pass. An installed desktop copy needs a build containing these changes.
