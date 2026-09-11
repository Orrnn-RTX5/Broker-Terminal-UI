# Text and notes / Content drawing tools

Implemented in the T menu, in the order shown in the supplied reference image.

## Evidence method

Reference: https://www.tradingview.com/chart/P8prO2VP/

Each tool was inspected separately. The `videos` folder contains one short reference video per tool (about 3–12 seconds each). These videos combine browser screenshots sampled during the interaction, usually 2–4 frames per second; they are **not continuous screen recordings**. Gaps between separate interaction phases have been removed. Extracted video contact sheets and individual browser views were inspected during implementation. These captures establish geometry and UI states, not animation smoothness or complete TradingView parity.

`videos/manifest.json` records the exact source segments, frame counts, and durations. `build_review_videos.py` reproduces the videos from the retained source frames.

## Tool-by-tool results

| Tool | Reference observation | Implemented behavior / verification |
| --- | --- | --- |
| [Text](videos/01-text-reference.mp4) | One anchor, multiline text, text styling and background/border settings; inline creation | Inline creation, multiline editing, font/color/bold/italic, wrap width, optional background/border. Created, edited, and restored in the terminal. Final live check confirmed two lines at size 18. |
| [Note](videos/02-note-reference.mp4) | Target point plus separate text position and leader | Two anchors, leader/dot, editable multiline note; placed and checked in the terminal. |
| [Price note](videos/03-price-note-reference.mp4) | Two anchors; price comes from the target, with separately positioned blue label | Target-price formatting, optional note text, independent label position. Verified displayed price and tested target/label separation. |
| [Pin](videos/04-pin-reference.mp4) | One pin marker; text appears on hover/selection | Marker and hover text; placed and checked. Hover visibility tested. |
| [Table](videos/05-table-reference.mp4) | Default 3×3 table; individual cell entry, Tab navigation, formatting and resizing | Editable cells, row/column count, alignment, font styling, corner resizing. Double-click a cell to edit directly on the chart; Tab advances, Shift+Tab goes back, Enter commits, Escape cancels. Direct cell edit and Tab checked in the final browser pass. |
| [Callout](videos/06-callout-reference.mp4) | Target anchor and a movable filled bubble with a pointed tail | Two anchors, filled tail and bubble, multiline editing. Placed and checked with custom text. |
| [Comment](videos/07-comment-reference.mp4) | One anchor; rounded bubble with a fixed square corner | Single-anchor comment bubble; placed and checked with custom text. |
| [Price label](videos/08-price-label-reference.mp4) | Single anchor; price label with a short pointer | Price formatted from its own anchor, short pointer; placed and checked. |
| [Signpost](videos/09-signpost-reference.mp4) | One anchor, text label and vertical line below | Centered label and vertical guide; placed and checked. |
| [Flag mark](videos/10-flag-reference.mp4) | One small flag marker; color control | Single-anchor flag; placed and checked. |
| [Image](videos/11-image-reference.mp4) | File selection accepts JPG/PNG/WEBP up to 2 MB; transparency setting | File validation, image URL option, transparency, dimensions and corner resize. URL rendering checked. Actual upload is **unverified**: Chrome's chooser returned `Not allowed` because the extension requires `Allow access to file URLs`. |
| [Post](videos/12-post-reference.mp4) | Enter an X post URL; chart jumps to publication time | Validated URL, caption, movable link card and original-post link. Link card checked in the terminal. **Rich post embedding and automatic publication-time placement are not implemented.** The reference post hit the TradingView account's 5,000-bar history limit. |
| [Idea](videos/13-idea-reference.mp4) | Enter a published idea URL; card displays author/title/direction/date at publication time | Validated published-idea URL, caption, movable link card and original-idea link. Link card checked in the terminal. **Automatic author/title/direction/date metadata and publication-time placement are not implemented.** |

The public Post and Idea URLs were used only as drawing references; no post, comment, idea, or trade was published/submitted.

## Shared implementation

- Stable annotation subtypes under the existing `text` drawing type.
- Per-chart/symbol/timeframe/account drawing ownership and existing undo/redo persistence.
- Saved properties include typography, cell data, image dimensions/transparency, and attachment URLs.
- Price labels use the series' price formatter.
- Double-click editing survives SVG selection rebuilds.
- Preview text backgrounds do not intercept the second anchor click.
- Cancelling a new annotation removes its placeholder; cancelling an existing edit leaves the saved drawing intact.
- One editor mounted at application level, including when the drawing rail is collapsed.
- Direct table-cell editor preserves neighboring cells and existing styles.
- Local restore is tested. The existing application intentionally bypasses cloud drawing loads; this task does not enable cloud restore.

## Checks

- Production build: passed (`build.log`).
- Final broad drawing regression run: **470 tests passed across 16 files** (`final-drawing-tests.log`).
- Final annotation-specific run: 33 tests passed across four files (`final-annotation-tests.log`). Earlier API-test assumption about DELETE bodies was corrected before the final runs.
- Final menu screenshot: `final-menu.png`.
- Final direct cell editing screenshot: `final-table-inline.png`.
- Inline Text screenshot: `final-text-inline.png`.

Remaining work for exact parity: rich external content/metadata integration, automatic publication-time placement, continuous-motion comparison, and the blocked file-upload browser check. Notes and bubble tools use the shared text-settings popover on creation. The current implementation should not be described as full TradingView parity.
