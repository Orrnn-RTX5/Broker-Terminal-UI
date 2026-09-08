# Drawing tools evidence recheck

This pass reviewed the existing TradingView capture contact sheets for all 16 requested tools, in tool order. It did **not** obtain a fresh live recording: Chrome control timed out before the chart could be inspected. Chrome was running, the extension was installed and enabled, and the native-host checks passed. Opening a fresh Chrome window did not restore communication. Reconnection was requested from the user.

RTX5 login remains unavailable and was not attempted, following the user's instruction. No application code was changed during this recheck.

## What the existing captures show

These are observations of previously saved frames, not a new live test. Each linked MP4 contains sampled screenshots; the gaps between frames prevent a conclusion about continuous cursor motion or input latency.

| Tool | Visible evidence in the saved sequence | Reference |
| --- | --- | --- |
| Brush | A curved stroke appears; later stages show its position changing. | [Capture](videos/01-tv-brush-reference.mp4) |
| Highlighter | A broad translucent curved stroke appears and remains visible. | [Capture](videos/02-tv-highlighter.mp4) |
| Arrow marker | A filled arrow appears with two endpoint handles; later stages show a changed endpoint and length. | [Capture](videos/03-tv-arrow-marker.mp4) |
| Arrow | A thin arrow appears with two endpoint handles; its slope and length change. | [Capture](videos/04-tv-arrow.mp4) |
| Arrow mark up | A green marker appears and subsequently moves. | [Capture](videos/05-tv-arrow-mark-up.mp4) |
| Arrow mark down | A red marker appears and subsequently moves. | [Capture](videos/06-tv-arrow-mark-down.mp4) |
| Rectangle | A filled rectangle appears with eight handles; a later stage shows a changed vertical extent. | [Capture](videos/07-tv-rectangle.mp4) |
| Rotated rectangle | An axis segment becomes a filled rotated rectangle; later stages show a changed thickness. | [Capture](videos/08-tv-rotated-rectangle.mp4) |
| Path | A sequence of connected segments appears with an arrow at its end; a vertex changes position. | [Capture](videos/09-tv-path.mp4) |
| Circle | A filled circle appears with center and radius handles; a later stage shows movement. | [Capture](videos/10-tv-circle.mp4) |
| Ellipse | An axis segment becomes a filled tilted ellipse; a width edit makes it broader. | [Capture](videos/11-tv-ellipse.mp4) |
| Polyline | An open sequence of segments appears; an individual vertex changes position. | [Capture](videos/12-tv-polyline.mp4) |
| Triangle | A filled three-vertex shape appears; one vertex subsequently changes position. | [Capture](videos/13-tv-triangle.mp4) |
| Arc | An arch appears with endpoint and middle handles; its height changes. | [Capture](videos/14-tv-arc.mp4) |
| Curve | A curve appears with three handles; the separate successful edit sequence shows its bend moving while endpoints stay fixed. | [Placement](videos/15-tv-curve.mp4), [bend edit](videos/15-tv-curve-bend.mp4) |
| Double curve | An S-shaped curve appears; price-scale zoom reveals its full extent. A later stage shows one bend changing. | [Capture](videos/16-tv-double-curve.mp4) |

All 16 tools have a visible completed drawing in these saved references. This supports basic placement in the earlier session. It does not establish that every interaction or setting works, or that RTX5 matches TradingView exactly.

## Checks still requiring a live reference session

- Successful editing of the second Double curve bend; the saved attempted edit does not establish that result.
- Rotated rectangle corner dragging along its axis as well as across its width. The current RTX5 handler changes width for corner handles; the existing capture does not establish TradingView's behavior for an along-axis corner drag.
- Curve and Double curve endpoint edits, including how the existing bends respond.
- Drag-to-create versus separate-click creation for anchored shapes, and any Shift constraints.
- Polyline closure behavior. The existing sequence verifies an open polyline only.
- Continuous pointer response and drawing smoothness. Sampled still frames cannot verify these.

The current geometry and drawing-manager paths were read during this recheck. No new reference-confirmed mismatch was established, so no speculative geometry change was made. Earlier automated validation remains recorded in [final-tests.txt](final-tests.txt): 226 tests passed across eight files. Those tests were not rerun during this evidence-only pass.
