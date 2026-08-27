# Light Theme Dock Chrome Design QA

## Comparison target

- Source visual truth: inline user screenshot attached in the 2026-08-27 request, showing the authenticated XAUUSD M1 terminal in Light theme with Market Watch, Navigator, and Toolbox dock headers marked.
- Source pixels: 1943 x 895.
- Implementation: local authenticated terminal at `http://127.0.0.1:5173/`.
- Implementation screenshot path: unavailable because browser control repeatedly disconnected during the post-fix capture.
- Intended viewport: desktop, approximately 1920 x 860 CSS pixels at device scale 1.
- State: authenticated terminal, XAUUSD M1, Light theme, default dock layout.

## Full-view comparison evidence

The pre-fix live page reproduced the screenshot issue exactly. With Light theme active, Market Watch, Navigator, and Toolbox shared dock headers computed to `rgb(32, 33, 38)` while their panel bodies were light. The source showed the same three dark title bars.

Post-fix browser-rendered evidence could not be captured because browser control disconnected during every final DOM/style read. Source contracts, TypeScript, and rendered component regressions pass, but they do not replace the required visual comparison.

## Focused region comparison evidence

- Target region: shared 30px dock title bars for Market Watch, Navigator, and Toolbox.
- Pre-fix cause: the Light-theme selector targeted an obsolete 22px header while the live component rendered 30px hard-coded dark headers.
- Implemented fix: the shared DockPanel now exposes semantic header, title, action, close-action, and content classes. Light mode maps these classes to the neutral enterprise palette; Dark mode retains its existing utilities.
- Post-fix focused screenshot: unavailable due to the same browser-control interruption.

## Required fidelity surfaces

- Fonts and typography: dock titles use the existing responsive header-size token, weight 500, and restrained letter spacing. Automated typography contracts pass.
- Spacing and layout rhythm: the existing 30px header height, dock proportions, panel content, and close/minimize hit areas are preserved. Dock layout regression passes.
- Colors and visual tokens: canvas `#F5F7FA`, panel `#FFFFFF`, dock header `#F2F4F7`, border `#D0D5DD`, selected accent surface `#F4F3FF`, and accent `#6941C6` are now semantic Light-theme tokens.
- Image quality and asset fidelity: no raster assets were added or replaced. Existing broker and product assets are unchanged.
- Copy and content: the settings control and visible menu heading are now `Theme`; the first selector is labeled `Color Scheme`, with Dark and Light unchanged.

## Findings

- [P1] Post-fix visual comparison is unavailable.
  - Location: authenticated Light-theme terminal, shared dock headers.
  - Evidence: browser control disconnected during post-fix computed-style reads and screenshots.
  - Impact: the required visual gate cannot confirm the final pixels despite passing source and behavior checks.
  - Fix: reopen the authenticated local terminal and capture the Light-theme workspace at the same desktop viewport.

## Comparison history

1. Initial evidence reproduced the P1 mismatch: three dock headers remained `rgb(32, 33, 38)` in Light mode.
2. Fixed the obsolete selector by adding semantic classes to the shared DockPanel and applying Light-theme dock tokens.
3. Added broader Light-theme hierarchy for canvas, panel headers, selected rows, navigation hover, bottom tabs, controls, and Theme menu copy.
4. Post-fix visual evidence remained unavailable because the browser connection repeatedly stopped responding.

## Implementation checklist

- [x] Rename Advanced View Settings to Theme.
- [x] Replace the grid icon with a palette icon.
- [x] Fix all shared dock headers rather than panel-specific instances.
- [x] Preserve Dark-theme styling and dock layout behavior.
- [x] Add enterprise Light-theme surface and interaction tokens.
- [x] Pass focused style, typography, Market Watch, and dock-layout tests.
- [x] Pass TypeScript checking.
- [ ] Capture and compare the post-fix authenticated Light-theme workspace.

## Follow-up polish

- Recheck the close-button hover and selected-row accent visually once browser control is stable.

final result: blocked

---

# One-Click Trading Layout Design QA

## Comparison target

- Source visual truth: the two screenshots attached to the current request, with the second screenshot defining the horizontal `SELL | decrease | lot | increase | BUY` layout and light-theme treatment.
- Implementation: local authenticated terminal at `http://127.0.0.1:5173/`.
- Intended state: XAUUSD chart with OneClickTrading visible in both Dark and Light themes.
- Latest implementation screenshot path: unavailable because the connected browser repeatedly timed out during the post-polish capture.

## Implemented fidelity

- The control order matches the supplied light reference: SELL, left/decrease control, lot input, right/increase control, BUY.
- The row is now 34px high with larger 11px labels, 13px prices, 24x28px arrow targets, and a 48-50x24-26px lot field.
- Trade cells use a 104px minimum width in Dark mode and 110px in Advanced Light mode, while expanding for long prices instead of clipping them.
- Dark input colors override the global form reset; standard and Advanced Light modes use opaque blue/red trading surfaces with white-text contrast above 4.5:1.
- Keyboard focus, hover, click feedback, disabled state, 0.01 stepping, and the 0.01 minimum are retained.

## Validation evidence

- `OneClickTrading.marketStatus.test.tsx`: 13/13 passing, including control order, dimensions, stepping, minimum, market gating, and order dispatch.
- TypeScript: `npm.cmd run typecheck` passed.
- CSS cascade review: no late selector overrides the 34px row or 24x28px controls; long-price internal clipping is removed.
- Dark-theme live rendering was observed after the initial size increase, but the final post-polish capture could not be completed.

## Blocking finding

- [P1] Final same-viewport Light and Dark screenshot comparison is unavailable.
  - Impact: automated and source-level checks pass, but the mandatory final visual gate cannot certify the latest pixels.
  - Next check: reopen the authenticated local terminal, select Dark and Light from the Theme menu, and capture the same chart viewport in each state.

final result: blocked
