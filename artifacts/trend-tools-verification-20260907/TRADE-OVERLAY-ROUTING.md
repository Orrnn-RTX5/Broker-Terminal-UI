Drawing placement through an existing trade overlay passed the recorded BTCUSD M1 check. The completed Trendline has two visible handles and an editing toolbar; the trade rows remain present. The root live session reports that the existing trades were not modified.

Evidence: [recording](videos/fixed-trade-overlay-drawing-placement.mp4), [result](fixed-trade-overlay-drawing-placement-result.png), [contact sheet](contact-sheets/fixed-trade-overlay-drawing-placement.jpg), and [live DOM audit](TRADE-OVERLAY-ROUTING.json).

| Stage | Evidence |
| --- | --- |
| Armed | The root interaction targeted the existing trade hit area at screen `(1000,95)`. The DOM audit reports `armed: "true"`, trade-overlay pointer events `none`, and hit-test target `CANVAS`. This records routing of the drawing click to the chart. |
| Completed | Two visible endpoint circles and the Trendline editing toolbar appear. The DOM audit reports local anchors approximately `(572.364,21)` and `(875.273,176)`, `armed: null`, pointer events restored to `auto`, and toolbar `Edit trendline`. |

The result screenshot independently confirms the rendered drawing. The exact hit-test target, CSS pointer state and action coordinates come from the root live DOM/action audit. Restoring `auto` establishes the control state; this check does not exercise a trade operation after drawing completion.

The finalized capture has seven source screenshots, no reported capture errors, duration 4.374s and dimensions 1920x864. The MP4 preserves source timestamps, verified by FFprobe. It contains sampled browser screenshots without the OS pointer; see [recording method](RECORDING_METHOD.md).
