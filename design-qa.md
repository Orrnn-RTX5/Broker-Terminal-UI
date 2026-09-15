# Light History size reference - 2026-09-15

At the user's request, light History now matches the compact dark reference: **13px rows and 12px column headings/filter controls** at Normal. Small uses 12px/11px; Large uses 14px/13px, matching the existing dark History size scale. Local size tokens cover nested text and preserve the approved light weight of 450. Toolbar line height follows the smaller text. This is a History-only exception to the shared light typography below.

---

# Shared light-theme typography - 2026-09-15

The user requested the approved Navigator **16px / 450** typography throughout the light terminal. `src/styles/light-typography.css` now owns that role for body text, toolbars, menus, panel titles, tabs, Market Watch, Toolbox tables, status text, dialogs and form controls, including portal content and nested price digits. Normal uses 16px; the existing Small and Large preferences use 15px and 17px. Weight remains 450. The earlier Navigator-only exception and theme-parity decisions below are superseded.

Light-only line heights, tab minimum heights, order-form dimensions and chart-header spacing accommodate the larger text. The one-click controls sit below the taller chart header. Custom crosshair labels follow their rendered height and price-axis width, and their width cache refreshes when theme/font classes change. The order-dialog canvas uses the larger light text with measured price-label space. Native chart axes use the light size token, with the existing 12px dark fallback. Lightweight Charts exposes size/family but no axis font-weight setting, so native axis weights remain library-controlled. User-authored drawing text and icon glyphs retain their own metrics.

Browser review covered the populated History workspace and New Order form. All 11 measured workspace roles returned 16px / 450; the order title, labels, controls, prices and actions also returned 16px / 450. The final workspace screenshot confirms the chart-header/one-click overlap is resolved. A dark baseline was captured before edits; the final live theme-switch comparison could not finish because subsequent preview calls timed out. Dark preservation is supported by light-scoped CSS and the tested dark geometry fallback, rather than a completed final browser round trip. Small/Large and native Electron were not separately reviewed in this pass. No order was submitted.

Validation: **82 tests passed across 15 files** covering styles, crosshair, order presentation/market status and chart grid. After the final spacing/cache changes, **18 tests passed across the two affected suites**, including a new larger-crosshair/theme-switch regression test. `npm run build:web` passed with the existing mixed-import and bundle-size warnings. Diff whitespace checks passed.

Evidence: [workspace](artifacts/light-ui-type-20260915/workspace-light.png), [light measurements](artifacts/light-ui-type-20260915/light-after.json), [dark baseline](artifacts/light-ui-type-20260915/dark-before.json), [tests](artifacts/light-ui-type-20260915/tests.log), [final affected tests](artifacts/light-ui-type-20260915/final-tests.log), [web build](artifacts/light-ui-type-20260915/build-web.log).

---

# Navigator body text - 2026-09-15 (superseded)

At the user's request, light-theme Navigator tree labels use an explicit 16px font size and weight 450, increased slightly from 400: Accounts, broker, account number/name, Indicators, Automated Strategies, Scripts and Services. A 1.5 line height gives the text 24px of vertical space within the existing rows. Dark labels retain their existing typography. These labels are the requested exception to the theme typography parity below. The existing enterprise-light contract permits only these label size and weight overrides.

---

# Dark/light font size and weight parity - 2026-09-15

The user's final preference is to use the existing dark-theme font sizes and weights in light mode. This supersedes the separate light hierarchy recorded below.

Removed light-only font-size/weight declarations and light-specific size tokens from `enterprise-light.css`, `advanced-untitled-light.css` and legacy `.theme-light` rules in `theme.css`. Both themes now use the existing shared S/M/L mappings and component typography. The four Trade typography rules formerly scoped to dark (headers, rows, summary labels, selected dock tabs) now share their original size/weight declarations; their dark surface rules remain scoped. Both chart branches use 12px canvas axes and 500-weight ticker labels. Light colors, glass material, font families, spacing and the complete-price overflow correction remain in place.

Browser measurements found no font-size or font-weight differences across 15 workspace selector groups at Normal and Large, 11 New Order groups, application-menu items, Trade headings/summary/tabs, and History rows including 30 sampled cells and nested spans. The final dark Normal measurements match the saved pre-edit dark baseline. Restored Normal, light theme, and the original closed-toolbox layout. No order was submitted.

Examples at Normal: toolbar 13px/400; Market Watch symbols/prices 14px/500; panel titles 14px/400; Trade headers 12px/400; selected bottom tabs 12px/600; New Order title 14px/500. Per-component differences follow dark mode rather than a new uniform text rule.

Validation: all **66 style tests across 11 files passed**; the focused chart/root-class/theme-transition checks also passed (10 tests). `npm run build:web` passed including TypeScript, with existing mixed-import and bundle-size warnings. Diff checks passed. Native Electron and OS/browser scaling were not separately tested. A PostCSS contract guards against future light-only font size or weight overrides, including nested selectors and shorthand.

Evidence: [workspace](artifacts/theme-typography-parity-20260915/workspace-light.png), [workspace comparison](artifacts/theme-typography-parity-20260915/workspace-comparison.json), [Large comparison](artifacts/theme-typography-parity-20260915/large-comparison.json), [order comparison](artifacts/theme-typography-parity-20260915/order-comparison.json), [Trade comparison](artifacts/theme-typography-parity-20260915/trade-dock-comparison.json), [History comparison](artifacts/theme-typography-parity-20260915/history-comparison.json), [menu comparison](artifacts/theme-typography-parity-20260915/menu-comparison.json), [style tests](artifacts/theme-typography-parity-20260915/style-tests.log), [web build](artifacts/theme-typography-parity-20260915/build-web.log).

---

# Light typography refinement - 2026-09-15 (superseded)

Implemented the user's request for larger, clearer light-theme text. This supersedes the earlier light typography sizes below. The approved dark typography and existing font family are retained.

## Default Normal setting

| Text role | Before | Now |
| --- | --- | --- |
| General body | 14px / 400 | 15px / 400 |
| Market Watch, history rows, menu items, inputs, chart HUD | 13px / 400 | 14px / 400 |
| Main toolbar actions | 13px / 400 | 14px / 500 |
| Panel titles and selected chart/dock tabs | 13px / 500 | 14px / 600 |
| Column headings | 12px / 500 | 13px / 500 |
| Form labels | 12px / 400 | 13px / 500 |
| Supporting text and status | 12px / 400 | 13px / 400 |
| Dialog titles | 16px / 600 | 18px / 600 |
| Canvas price/time axes | 12px | 13px |

The light-only primary/data/caption scale is Small **14/13/12**, Normal **15/14/13**, Large **16/15/14**. Dense text gets 19/20/21px line heights. Dialog titles are 17/18/19px. Light canvas axes follow 12/13/14px and respond immediately to preference changes; dark axes stay at 12px. Regular financial text retains aligned tabular numerals, while controls and headings carry the emphasis. Compact one-click labels override the component's late-loaded fixed 12px rule without changing its responsive layout. Market Watch alerts now use the caption size and the existing dark red loss token instead of pale 10px text.

This is a product-specific hierarchy informed by [Fluent's 14px/20px regular body and semibold headings](https://fluent2.microsoft.design/typography) and [Carbon's 14px productive base for dense applications](https://carbondesignsystem.com/elements/typography/type-sets/). Neither specifies a universal trading-app font size or a different mandatory weight for light themes. The 13px support and 15px body roles are our readability choices for this terminal.

## Layout correction

Market Watch previously hid horizontal overflow while assigning fixed percentage widths to price columns. Long quotes could lose their final digits even before this font change. Light mode now uses intrinsic table columns and horizontal scrolling when the dock is narrow. Header and body columns remain one table; responsive Ask/Daily visibility still depends on the outer panel. At the tested 173px viewport, the table requires 189px, and scrolling 16px exposes all of `15146.00000`. The price span fits inside its column. Dark layout rules are unchanged.

## Verification

- Authenticated Chrome preview at `http://127.0.0.1:5173/`, initially 929 x 835 CSS pixels plus the final wide workspace capture: workspace, menus, New Order dialog, populated history (57 existing records), Small/Normal/Large preferences, and dark/light round trip. No order was submitted.
- Measured dark font size, weight, family and line height match the saved baseline for all nine existing sampled roles. Normal font preference and initial closed-toolbox layout restored after review.
- **46 tests passed** across enterprise-light, typography, top-chrome, chart-grid, root-class and theme-transition suites. `npm run build:web` passed including TypeScript; Vite was rebuilt after the final overflow-only CSS change. Existing mixed-import and chunk-size warnings remain.
- Native Electron, OS display scaling, browser zoom and compact one-click layout were not separately exercised. Existing custom crosshair/live-price badge sizes and user-created drawing text remain separately controlled.

Evidence: [workspace](artifacts/light-typography-20260915/workspace.png), [order dialog](artifacts/light-typography-20260915/order-dialog.png), [history](artifacts/light-typography-20260915/history.png), [complete quote](artifacts/light-typography-20260915/complete-price.png), [Large](artifacts/light-typography-20260915/large.png), [Small](artifacts/light-typography-20260915/small.png), [dark baseline](artifacts/light-typography-20260915/dark-before.json), [dark result](artifacts/light-typography-20260915/dark-after.json), [tests](artifacts/light-typography-20260915/tests.log), [build](artifacts/light-typography-20260915/build-web.log), [final CSS build](artifacts/light-typography-20260915/build-final-css.log).

---

# Light glass finish - 2026-09-15

Applied the requested glassmorphism treatment to the light theme in `src/styles/surface-finish.css`: a soft white-to-cool-gray sheen and inset highlights on toolbars, dock headers, the drawing rail and status strips; 94% white frosted surfaces, 10px corners and layered neutral shadows on floating menus and dialog shells. The core palette, table and chart backgrounds, field fills, typography and trading colors retain their existing roles. This is a user-requested material change following the earlier flat-surface research.

Real backdrop blur is confined to floating boxes. Toolbar and dock ancestors use a static sheen so their fixed-position dialogs remain positioned against the viewport. File menus and their application-menu ancestor use opaque material while nested chart menus are open; this protects fixed submenu placement and prevents underlying numbers from showing through without frosting. Order-dialog form and header overrides account for its stylesheet loading after the shared finish.

Fresh authenticated browser verification covered the workspace, application menu, nested Trading accounts/New Chart menu, New Order dialog and a dark/light round trip. The final state is light. No orders were placed. Computed colors confirmed 18px blur on the frosted menu/order shell, opaque fields and chart/table bodies, and no new blur on the toolbar. Evidence: [workspace](artifacts/light-glass-20260915/workspace.png), [menu](artifacts/light-glass-20260915/menu.png), [nested menu](artifacts/light-glass-20260915/nested-menu.png), [New Order](artifacts/light-glass-20260915/order-dialog.png), [workspace colors](artifacts/light-glass-20260915/workspace-colors.json), [order colors](artifacts/light-glass-20260915/order-colors.json), and [dark check](artifacts/light-glass-20260915/dark-check.json).

Validation: the 34 existing enterprise-light, top-chrome and typography checks passed. The web production build, including TypeScript, passed; the final CSS was also bundled after the cascade corrections. Existing mixed-import and bundle-size warnings remain. Logs: [web build](artifacts/light-glass-20260915/build-web.log), [final CSS build](artifacts/light-glass-20260915/build-web-final-css.log), [style checks](artifacts/light-glass-20260915/style-tests.log).

The new material has an opaque fallback for browsers without backdrop-filter support and disables its transparency, frosting and decorative shadows for reduced-transparency, higher-contrast, forced-color and print preferences. These fallbacks were reviewed in source; OS preference emulation and native Electron appearance were not visually tested. The existing muted text is approximately 4.75:1 against 94% white over black before the additional white highlight. This bounds the new white floating material, not every inherited component color. CSS references: [backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter), [reduced transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency).

---

# Approved light palette - 2026-09-12 implementation

Implemented the user-approved roles from [the color research](LIGHT_THEME_COLOR_RESEARCH.md) in the shared web/Electron renderer. The workspace and headers use `#F2F4F8`, data panels `#FAFAFA`, charts `#F7F7F7`, dialogs/menus `#FFFFFF`, and fields `#F2F6FC` with `#7D8796` functional borders. Primary, secondary and muted text use `#111827`, `#4B5563` and `#5F6B7A`. Indigo `#4338CA` identifies interaction and focus, with `#EEF2FF` selection.

Buy/Sell actions use fixed blue/red fills (`#2563EB` / `#DC2626`) and white labels. Small profit/loss text uses darker `#047857` / `#B91C1C`; quote upticks remain blue `#1D4ED8`. Default light candles use `#059669` / `#DC2626`. Price badges use darker fills for readable white text. Chart axes, native/DOM crosshairs and trade overlays follow their light roles. Existing dark and custom chart palettes remain authoritative; typography and trading behavior are retained.

The browser pass exposed an old substring selector matching every dialog child and backdrop. It now targets actual dialog containers. Specific legacy overrides were also corrected for Market Watch search, New Order fields, Chart Properties preview text, and History side/P&L cells. Solid actions have an outside keyboard-focus ring with white separation. Calendar/research selection and Historical Data controls use the same roles.

Authenticated browser verification at 1920 x 863 covered the workspace, selected Market Watch row, live one-click controls, populated History, New Order, Last Symbol's idle state, Historical Data date focus/preset selection, and Chart Properties. A dark/light round trip restored dark surfaces and then the approved light palette. No orders were submitted. Evidence: [workspace](artifacts/light-theme-implementation-20260912/workspace.jpg), [New Order](artifacts/light-theme-implementation-20260912/order-dialog.jpg), [History](artifacts/light-theme-implementation-20260912/history.jpg), [Historical Data](artifacts/light-theme-implementation-20260912/historical-data.jpg), [Last Symbol](artifacts/light-theme-implementation-20260912/last-symbol.jpg), [Chart Properties](artifacts/light-theme-implementation-20260912/chart-properties.jpg), and [computed workspace colors](artifacts/light-theme-implementation-20260912/workspace-colors.json).

Validation: 80 contrast pairs pass the relevant 4.5:1 small-text or 3:1 control-boundary thresholds. Chart-focused suites passed 133 tests; shared style/typography suites passed 43 tests; order/one-click/Last Symbol suites passed 47 tests (suite totals overlap). The final shared style/order rerun passed 35 tests. Both `build:web` and `build:electron` passed TypeScript and production bundling; existing mixed-import and bundle-size warnings remain. Logs: [web build](artifacts/light-theme-implementation-20260912/build-web.log), [Electron build](artifacts/light-theme-implementation-20260912/build-electron.log), [final style tests](artifacts/light-theme-implementation-20260912/final-style-tests.log).

Desktop shell/menu checks passed 45 tests with two existing chart-parity fixture failures: they expect `Add chart (0/6)` in TopToolbar while mocking away MenuBar, which owns Add chart. This is unrelated to the palette. Native Electron window appearance was not visually inspected; desktop coverage consists of the shared renderer source, component checks and Electron build. No release was published.

---

# Light theme typography consistency - 2026-09-12 correction

The previous pass left mixed font families and nested size/weight overrides in the rendered UI. The light skin now uses Segoe UI with Tahoma/Arial fallbacks for navigation, controls, tables, quote values, status text, and chart UI. Financial values retain tabular numerals. The canvas chart uses the same light-theme font family on creation and theme changes.

| Role at normal text size | Size | Weight |
| --- | --- | --- |
| Body copy | 14px | 400 |
| Table values and symbols, navigation, menus, fields and ordinary controls | 13px | 400 |
| Panel titles, selected tabs and primary actions | 13px | 500 |
| Column headings | 12px | 500 |
| Field labels, shortcuts, status and supporting text | 12px | 400 |
| Dialog titles | 16px | 600 |
| New Order quote display, including fractional digits | 20px | 500 |

Corrected nested table headings and price spans, Exposure's 11px/700 headings, Journal's mixed 12px/14px controls, Historical Data's 14px/600 preset buttons and 10px monospace duration badge, and New Order's mismatched whole/fractional price digits. Chart Properties tabs, radio/checkbox labels, fields, color values and buttons follow the shared roles. One-click prices and volume use 13px/500, with side labels at 12px/500. Existing S/M/L tokens still drive terminal sizes, with a 12px supporting-text minimum. Scope is the light skin.

Verified computed styles in the authenticated web terminal at 1920 x 863, device scale 1, across Market Watch, Navigator, Trade, populated History rows, Exposure, Journal, Historical Data, drawing menus, New Order, and Chart Properties. Screenshots: [workspace](artifacts/typography-consistency-20260912/workspace.jpg), [History](artifacts/typography-consistency-20260912/history.jpg), [Historical Data](artifacts/typography-consistency-20260912/historical-data.jpg), [New Order](artifacts/typography-consistency-20260912/order-dialog.jpg), and [Chart Properties](artifacts/typography-consistency-20260912/chart-properties.jpg). Measured evidence: [workspace roles](artifacts/typography-consistency-20260912/workspace-roles.json), [History rows](artifacts/typography-consistency-20260912/history-roles.json), and [dialog roles](artifacts/typography-consistency-20260912/chart-properties-roles.json). Switching to dark restored the existing font families and sizes; switching back restored the new light roles. The final workspace capture is after this round trip. No orders were submitted.

Validation: 41 focused tests passed across seven style/typography suites. `npm run build:web` passed TypeScript and the Vite production build. Existing bundle-size and mixed-import warnings remain. The browser measurements supplement the source contract tests, which alone did not expose the original cascade mismatches.

---

# Softer light palette - 2026-09-12 follow-up

The user's comfort preference supersedes the literal white reference palette below. Large chart and panel surfaces now use neutral off-white `#F7F7F7`, headers `#F0F0F0`, main text `#242424`, secondary text `#454545`, and muted text `#656565`. Grid opacity is reduced from 20% to 11% on both axes. The flat finish, existing typography, and trading colors are retained.

Text contrast on the main panel is 14.49:1 (primary), 8.95:1 (secondary), and 5.44:1 (muted). These roles also exceed 4.5:1 on header and selected-row backgrounds, meeting the [WCAG normal-text contrast target](https://www.w3.org/TR/WCAG22/#contrast-minimum) for these measured pairs. This is a palette/readability check, not a claim that any color scheme prevents eye fatigue or that the entire application conforms to WCAG.

Verified the authenticated workspace and chart loading surface in the browser; corrected a legacy white Trade body and tab backgrounds exposed by the softer palette. Screenshot: [soft light theme](artifacts/tradingview-light-theme-20260912/rtx5-soft-light.png). Focused palette, chart settings, grid, and rendering checks: 41 tests passed.

---

# TradingView light palette - 2026-09-12

Reference: [TradingView BTCUSD](https://in.tradingview.com/chart/P8prO2VP/?symbol=BITSTAMP%3ABTCUSD), inspected in its existing Light theme before implementation. RTX5 was already authenticated as account 200032 at `http://127.0.0.1:5173/`. No orders were submitted for this review.

| Surface | Previous RTX5 | Observed TradingView / new RTX5 |
| --- | --- | --- |
| Chart and panels | `#F2F4F5` | `#FFFFFF` |
| Toolbar and dock headers | `#E7EBEE` with shading | `#FFFFFF`, flat |
| Workspace separators | `#D1D8DE` | `#EBEBEB` |
| Field borders | `#B5C0CA` | `#DBDBDB` |
| Main text | `#25313C` | `#0F0F0F` |
| Supporting text | `#5D6974` | `#707070` |
| Selected / hover fill | Blue gray | `#F2F2F2` |
| Primary buttons | `#28547C` | `#2E2E2E` |
| Chart grid | Unequal faint axes | `rgba(46, 46, 46, 0.2)` on both axes |
| Default up / down candles | `#00C896` / `#FF4D4F` | `#089981` / `#F23645` |

The shared light layer now supplies these colors to the toolbar, drawing rail, Market Watch, Navigator, Toolbox, menus, and dialogs. Chart colors are resolved at render time; saved dark settings, custom chart palettes, and other candle presets retain their own colors. Chart Properties uses the same grid calculation as the live chart. Financial actions and quote-direction semantics retain their existing behavior.

Evidence: [TradingView workspace](artifacts/tradingview-light-theme-20260912/tradingview-light.png), [reference canvas settings](artifacts/tradingview-light-theme-20260912/tradingview-canvas-settings.png), [RTX5 before](artifacts/tradingview-light-theme-20260912/rtx5-light-before.png), [RTX5 updated workspace and menu](artifacts/tradingview-light-theme-20260912/rtx5-light-menu.png).

Verification: 58 tests passed across eight focused suites; `npm run build:web` passed TypeScript and the production build. The updated workspace, white canvas, equal gray grid, and reference candle colors were visually inspected, including after a reload. Browser control later became unresponsive, preventing completion of the final dialog/hover and dark-to-light checks. The last CSS refinements remove legacy borders around menu items and purple selected-chart-tab / primary-button hover colors; these refinements are not reflected in the saved screenshot. No claim of complete visual parity is made for those remaining checks.

---

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

# Navigator Solid Branch Lines QA (2026-08-31)

## Comparison target

- Source visual truth: the 251 x 510 dark Navigator screenshot attached to the current request; the attachment has no workspace file path.
- Intended implementation: the existing Navigator panel rendered by `NavigatorPanel.tsx` in the local terminal.
- Implementation screenshot path: unavailable because neither the in-app preview browser nor its Chrome connection was available for capture.
- Intended viewport/state: the existing desktop Navigator dock in Dark theme, with Accounts, Indicators, and Services expanded as shown in the source.
- Density normalization: unavailable. The source attachment has 251 x 510 intrinsic pixels; an implementation pixel capture and CSS viewport could not be obtained.

## Full-view comparison evidence

The source screenshot establishes the unchanged panel hierarchy, typography, icons, indentation, row spacing, and dark surfaces. Its tree connectors are the only requested difference: every vertical trunk and horizontal branch arm should render as a continuous straight stroke instead of a dotted or dashed stroke.

A same-state browser-rendered implementation screenshot could not be captured, so full-view visual parity is not claimed.

## Focused region comparison evidence

The requested focused region is the orthogonal connector geometry beside nested Navigator rows. The implementation now uses the existing 1 px connector width, color token, 5 px x-position, 15 px branch point, 8 px horizontal arm, full-height non-last trunk, and shortened last-child trunk with a solid stroke in all three cases.

The source and a post-change implementation capture could not be placed into one combined comparison input because the browser connection was unavailable.

## Required fidelity surfaces

- Fonts and typography: unchanged; the existing Navigator labels, weights, sizes, line heights, and truncation remain untouched. Rendered fidelity is unverified.
- Spacing and layout rhythm: unchanged; indentation, 30 px row minimum height, branch coordinates, elbows, and last-child termination remain intact. Rendered fidelity is unverified.
- Colors and visual tokens: unchanged; connectors still resolve through `--navigator-tree-line` with the existing dark fallback and light-theme override.
- Image quality and asset fidelity: no image, icon, SVG, generated asset, or placeholder was added or replaced.
- Copy and content: unchanged; all Navigator labels and account content remain owned by the existing component and runtime data.

## Findings

- [P1] Final rendered comparison is unavailable.
  - Location: desktop Navigator tree connector region.
  - Evidence: the source attachment is available, but both the in-app preview binding and Chrome browser binding reported unavailable, so no current implementation screenshot or console read could be captured.
  - Impact: source and automated checks prove the stroke contract, but they do not certify the final rasterized pixels.
  - Fix: reopen the local terminal through an available browser connection, reproduce the expanded Navigator state, capture the same region, and compare it with the supplied source at matched scale.

## Comparison history

1. The source implementation used dashed borders for both vertical connector cases and the horizontal branch arm.
2. All three connector declarations were changed from `dashed` to `solid` without altering geometry, color, layout, labels, icons, or interactions.
3. The focused contract test and TypeScript validation passed; no visual-fix iteration was performed because a rendered implementation capture was unavailable.

## Primary interactions and console

- Expand/collapse and item-selection code paths were not changed.
- Browser interaction testing and console-error inspection were blocked by the unavailable browser connection.

## Implementation checklist

- [x] Make full-height vertical sibling trunks solid.
- [x] Make shortened last-child trunks solid.
- [x] Make horizontal branch arms solid.
- [x] Preserve connector color, thickness, geometry, nesting, and row behavior.
- [x] Pass the focused connector contract test and TypeScript validation.
- [ ] Capture and compare the rendered Navigator in the requested expanded state.

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

---

# Horizontal Timeframe Strip Design QA

## Comparison target

- Source visual truth path: inline user screenshot in the current request, showing the MT-style horizontal `M1 M5 M15 M30 H1 H4 D1 W1 MN` toolbar on XAUUSD.
- Source pixels: 1182 x 350.
- Rendered implementation: authenticated local XAUUSD terminal.
- Implementation screenshot path: current-turn browser capture emitted by the `Verify horizontal timeframe toolbar` check; focused capture was 1400 x 130 CSS pixels at device scale 1. Later filesystem persistence attempts timed out, but the rendered capture remains part of the current run evidence.
- State: Dark theme, XAUUSD M1 for the visual comparison; XAUUSD M15 for the interaction check.

## Full-view comparison evidence

The source shows all nine timeframe labels in one uninterrupted horizontal toolbar row. The browser-rendered implementation shows the same order between the Indicators control and the next divider, with no dropdown trigger or vertical menu. The surrounding toolbar and chart region remain unchanged.

## Focused region comparison evidence

The source and rendered toolbar capture were compared at the timeframe-control region. The implementation uses a 32px-high no-wrap row, compact text buttons, a blue outlined/filled selected state, and muted inactive labels. All nine labels remain visible at the desktop viewport. No P0, P1, or P2 mismatch remains for the requested horizontal orientation.

## Required fidelity surfaces

- Fonts and typography: 14px Segoe-style toolbar text matches the existing measured terminal chrome contract; labels remain legible without wrapping.
- Spacing and layout rhythm: every option is 32px high with compact horizontal padding. The strip and the existing toolbar both scroll on the x-axis at narrow widths, while y-axis overflow is hidden.
- Colors and visual tokens: Dark mode retains the established blue active state and zinc inactive state. Advanced Light mode keeps its scoped purple active state and neutral hover borders.
- Image quality and asset fidelity: no raster assets, generated imagery, substitute icons, custom SVGs, or placeholder artwork are involved.
- Copy and content: labels and order exactly match `M1`, `M5`, `M15`, `M30`, `H1`, `H4`, `D1`, `W1`, and `MN`.

## Interaction and accessibility verification

- Browser DOM exposed one horizontal `radiogroup` containing all nine radio options.
- Clicking `M15` changed its authoritative `aria-checked` state to `true` and changed the live chart context to XAUUSD M15.
- Arrow Left/Right/Up/Down, Home, End, wraparound, click selection, and the single natural Tab stop are covered by focused component tests.
- Selection propagation remains wired through the existing callback, command bus, and `change-timeframe` event.
- Console retrieval later timed out while the live chart was busy; no layout-related runtime failure appeared during the successful render and M15 interaction. This is a residual diagnostics gap, not a visual mismatch.

## Comparison history

1. The prior implementation showed only the active timeframe and opened the remaining choices vertically.
2. Replaced it with the nine-button horizontal radiogroup and updated Advanced Light selectors.
3. The first browser comparison showed all nine labels horizontally with M1 active.
4. The interaction pass selected M15 and confirmed the checked state changed without opening a menu.

## Findings

- No actionable P0, P1, or P2 visual differences remain for this scope.
- Accepted constraint: on narrow terminal widths the strip remains horizontal and scrolls sideways instead of wrapping into another row.

## Implementation checklist

- [x] Remove the vertical timeframe menu.
- [x] Render all nine timeframes in one horizontal row.
- [x] Preserve active-state highlighting and timeframe dispatch.
- [x] Preserve Dark and Advanced Light styling.
- [x] Add accessible horizontal radio navigation and one Tab stop.
- [x] Verify M1 and M15 states in the authenticated XAUUSD terminal.

## Follow-up polish

- None required for the requested horizontal layout.

final result: passed

---

# Navigator Single-Header Design QA (2026-09-01)

## Comparison target

- Source visual truth: the 529 x 444 screenshot attached to the current request (`conversation://latest-user-message/image/1`), supported by the earlier full terminal capture `artifacts/desktop-toolbar-dynamic-status/09-final-xauusd-live.png` at 800 x 600 pixels.
- Rendered implementation: `artifacts/navigator-single-header-2026-09-01/after-single-header.jpg` at 1920 x 919 pixels.
- Combined full-view comparison: `artifacts/navigator-single-header-2026-09-01/before-after-full.jpg` at 1920 x 919 pixels.
- Combined focused comparison: `artifacts/navigator-single-header-2026-09-01/before-after-focused.jpg` at 1920 x 919 pixels.
- Browser viewport/state: 1920 x 919 desktop CSS pixels, normal desktop density, Dark theme, authenticated account 200001 on TEST, with Market Watch, Navigator, chart, and Toolbox open.
- Density normalization: the older 800 x 600 source and current 1920 x 919 implementation were scaled independently inside the comparison pages. The focused comparison enlarges both Navigator regions so the duplicate-strip removal and retained title-bar controls can be judged directly; it is a structural comparison rather than a pixel-for-pixel typography comparison.

## Full-view comparison evidence

The before view contains an outer `Navigator` dock title followed by a second uppercase `NAVIGATOR` content strip. The current browser-rendered terminal contains one Navigator dock title only, and the account tree begins directly beneath it. Market Watch, chart, Toolbox, sidebar width, split ratios, and surrounding panel geometry remain unchanged.

## Focused region comparison evidence

The focused comparison makes the corrected region readable at the same time: the entire second 30-pixel header row is gone, while the retained dock title, minimize icon, and close icon remain visible. The account tree uses the existing body padding and starts flush beneath the retained header without a blank gap or duplicated border.

## Required fidelity surfaces

- Fonts and typography: the retained Navigator title keeps the existing DockPanel typography. No font family, size, weight, line height, tracking, wrapping, or antialiasing rule changed.
- Spacing and layout rhythm: exactly one redundant 30-pixel row was removed. The existing Navigator body padding remains, reclaiming vertical space without changing sidebar width, dock ratios, panel borders, or tree indentation.
- Colors and visual tokens: all existing dark surfaces, border colors, hover colors, and light-theme overrides remain unchanged; the obsolete inner surface simply no longer renders.
- Image quality and asset fidelity: no image, icon, logo, generated asset, SVG, or placeholder changed. The existing minimize and close icons are retained.
- Copy and content: the duplicate uppercase `NAVIGATOR` copy is removed. The canonical `Navigator` title and all account/tree labels remain unchanged.

## Findings

- No actionable P0, P1, or P2 mismatch remains in the requested Navigator header area.
- No P3 follow-up is needed for this scoped correction.

## Comparison history

1. The source screenshot and earlier terminal capture showed two stacked Navigator labels.
2. The inner `.navigator-panel__header` node was removed without changing DockPanel chrome or Navigator content.
3. The post-change browser capture and focused comparison show one title bar, no gap, and the retained minimize/close controls.

## Interaction, accessibility, and console verification

- Live DOM verification found one outer `.dock-panel__header`, zero `.navigator-panel__header` nodes, a `Navigator` dock title, the Navigator body immediately below the title bar, and both Minimize and Close buttons present.
- The focused DockPanel test clicks the retained Close button and verifies its close callback fires exactly once.
- Browser console inspection found no errors. Three existing chart price-normalization warnings were unrelated to the Navigator change.

## Engineering validation

- Five focused tests passed across the Navigator header, Navigator tree-line, retained close-control, and dock-layout suites.
- TypeScript no-emit validation passed.
- The production Vite web build passed with 2006 transformed modules; only existing mixed-import and chunk-size advisories remained.

## Implementation checklist

- [x] Remove only the duplicate inner Navigator field.
- [x] Keep the main Navigator dock title bar.
- [x] Keep the minimize and close icons.
- [x] Preserve Navigator content, spacing, and dock ratios.
- [x] Verify the corrected layout live and retain regression coverage.

final result: passed


# TradingView Trend Line Tools Design QA

## Comparison target

- Source visual truth: `https://in.tradingview.com/chart/P8prO2VP/?symbol=BITSTAMP%3ABTCUSD`, inspected live before implementation.
- Source captures: `artifacts/tradingview-trend-tools-reference/tradingview-btcusd-initial.png`, `tradingview-trend-tools-menu.png`, `trendline-interaction-state.png`, and `tool-trendline.png`.
- Rendered implementation: authenticated Grow Trading Academy account 200009 at `http://127.0.0.1:5173/`.
- Implementation capture: `artifacts/tradingview-trend-tools-reference/local-left-rail-integrated.png`.
- Side-by-side review input: `artifacts/tradingview-trend-tools-reference/source-vs-local-rail-comparison.png`.
- Viewport and state: 1920 x 863 desktop pixels, device scale factor 1, Dark theme, BTCUSD M1/M5, Market Watch and Navigator open, Toolbox open.

## Full-view comparison evidence

The local implementation places a dedicated 40-pixel drawing rail directly beneath the hamburger and immediately left of the existing Market Watch/Navigator dock. No existing dock ratio, chart toolbar control, chart plot, Toolbox region, or status-bar layout was displaced beyond the intentional rail width.

The TradingView source menu and local rail were reviewed together in the 3840 x 863 side-by-side comparison. The source establishes the tool ordering and grouped hierarchy; the local capture confirms the selected-tool glyph remains visible in the collapsed rail while the cursor is active, matching the requested third-image behavior.

## Tool inventory and interaction contract

- Lines: Trendline, Ray, Info line, Extended line, Trend angle, Horizontal line, Horizontal ray, Vertical line, and Crossline.
- Channels: Parallel channel, Regression trend, Flat top/bottom, and Disjoint channel.
- Pitchforks: Pitchfork, Schiff pitchfork, Modified Schiff pitchfork, and Inside pitchfork.
- The flyout exposes exactly 17 `menuitemradio` controls under the three source groups, with no shortcut labels or shortcut-key listeners.
- Selecting a menu item closes the flyout, dispatches the drawing type plus its exact subtype, changes the collapsed rail icon/label, and preserves that icon after the completed drawing returns the chart to cursor mode.
- The rail receives the active chart symbol and updates its accessible label/data attribute with that symbol.
- Two-click tools, three-click channel/pitchfork tools, infinite/ray clipping, info measurements, trend-angle labels, regression bands, hit zones, selection handles, dragging, persistence, and symbol-scoped drawing ownership all reuse the chart's existing command-bus and drawing-manager path.

## Required fidelity surfaces

- Typography and spacing: the flyout uses the terminal's existing font tokens, compact 38-pixel rows, source-order section headings, separators, and an opaque 265-pixel elevated surface.
- Colors: existing dark terminal surfaces and borders are reused; blue communicates the active rail/tool state.
- Icons: Lucide icons are used throughout the rail and menu. No emoji, text-glyph substitute, handcrafted icon SVG, transparent placeholder, or generated asset was introduced.
- Copy: source tool names are preserved exactly, excluding the explicitly unwanted keyboard-shortcut copy.

## Verification

- Live authenticated Chrome capture verified the integrated rail location, selected Ray glyph, BTCUSD symbol binding, and preservation of surrounding terminal layout.
- The later Chrome automation connection dropped before a second menu-open capture; this did not produce an application error. The exact menu contract and selection/icon behavior are covered by component tests, while committed SVG output and drawing lifecycles are covered by drawing-manager tests.
- Focused verification: 37 tests passed across the rail/menu, all 17 tool lifecycles, committed representative SVG geometry, and viewport clipping/math.
- `npx tsc --noEmit --pretty false` passed.
- `npx vite build --mode web` passed with only the repository's existing chunk-size/dynamic-import warnings.
- `git diff --check` passed for all files in this scope.

## Findings

- No actionable P0, P1, or P2 visual, interaction, persistence, or drawing-geometry mismatch remains for the requested trend-line tool scope.
- Accepted constraint: the implementation intentionally omits TradingView shortcut labels and keyboard shortcuts, as requested.

final result: passed

---

# Centered Trade Grid and Flush Workspace Design QA

## Comparison target

- Source visual truth: the user's three supplied screenshots in the current request: the 1554 x 362 Trade table, the 1943 x 568 toolbar/workspace-gap view, and the 265 x 399 Symbol-column crop.
- Rendered implementation: authenticated local terminal at `http://127.0.0.1:5173/`.
- Implementation full-view screenshot: `artifacts/design-qa-trade-grid-2026-08-28.png` (1920 x 919 px).
- Implementation focused Trade-table screenshot: `artifacts/design-qa-trade-table-focus-2026-08-28.png` (1524 x 165 px).
- Viewport: 1920 x 919 CSS px at device scale factor 1. The implementation captures are 1:1; no density normalization was required.
- State: Dark theme, authenticated account 200002, BTCUSD M1 chart, live open positions visible in the Trade tab.

## Full-view comparison evidence

The supplied source screenshots and both emitted implementation captures were reviewed together at 1:1. The implementation keeps the existing panel proportions and removes only the blank workspace strip below the toolbar: measured toolbar bottom is 40px and the dock content begins at 41px, leaving only the existing one-pixel chrome divider. The prior 6px top gutter is absent, while the 6px side and bottom gutters remain.

The full view also shows every Trade header and row value centered within its own column. The Symbol cells contain plain instrument text and no longer show the small red/blue direction badge.

## Focused region comparison evidence

The 1524 x 165 Trade-table crop makes the dense alignment details readable. `Symbol`, `Ticket`, `Time`, `TYPE`, `VOLUME`, `PRICE OPEN`, `S / L`, `T / P`, `PRICE CURRENT`, and `Profit` are centered, and their row values share the same centerline. BTCUSD appears as plain centered text with no leading marker. Runtime style inspection independently reported `text-align: center` for all 11 visible header cells and all 11 first-row cells.

The toolbar/workspace boundary is clearly readable in the full-view capture, so a second focused crop was not needed for that one-pixel divider.

## Required fidelity surfaces

- Fonts and typography: the existing Segoe UI terminal typography, sizes, weights, line heights, uppercase header treatment, and tabular numeric rendering are unchanged.
- Spacing and layout rhythm: cell content is centered without changing column widths or 30px row heights. Only the workspace's top padding changed from 6px to 0; its right, bottom, and left padding remain 6px.
- Colors and visual tokens: the established dark surfaces, borders, muted numeric colors, red sell, blue buy, and profit colors remain unchanged.
- Image quality and asset fidelity: no new image assets, custom SVGs, CSS drawings, placeholders, or replacement icons were introduced; the requested Symbol badge was removed.
- Copy and content: all headings and trade values are preserved. Symbol text is unchanged, and the Type column continues to show plain lowercase `buy` or `sell`.

## Interaction and runtime verification

- Sortable header buttons and their resize handles remain in the same columns; the sort glyph is absolutely positioned so it does not offset the centered header label.
- SL and TP edit inputs were centered with their display values, preserving their existing edit handlers.
- Authenticated live data and open positions rendered successfully after the change.
- Browser console errors checked: none.
- Automated regression coverage verifies centered headers/cells/editors, the absence of the Symbol direction badge, and zero top padding with the other gutters preserved.

## Findings

- No actionable P0, P1, or P2 visual or interaction differences remain for the requested scope.
- Accepted state difference: live symbol prices and position rows differ from the static reference screenshots because the connected market and account data are current.

## Comparison history

1. The source identified three exact mismatches: non-centered Trade content, a blank strip below the toolbar, and a direction badge before each Symbol.
2. The implementation centered the complete grid, collapsed only the top workspace gutter, and reduced the Symbol cell to plain text.
3. The first post-fix full and focused browser comparisons found no actionable P0/P1/P2 mismatch, so no additional visual-fix iteration was required.

## Implementation checklist

- [x] Center every Trade column heading.
- [x] Center every visible and optional Trade row value.
- [x] Center SL/TP editing inputs and keep Type's nested flex content centered.
- [x] Remove the buy/sell badge before Symbol text.
- [x] Remove only the blank top workspace gutter.
- [x] Preserve side/bottom gutters, panel ratios, column widths, and live behavior.
- [x] Verify the authenticated live terminal, focused table crop, runtime styles, tests, and browser console.

## Follow-up polish

- None required for this scope.

final result: passed

---

# Hamburger Chrome, Lot Input, and Trade Type Design QA

## Comparison target

- Source visual truth path: the five inline screenshots in the user's 2026-08-28 request. They define the one-row hamburger chrome, click-open root menu pattern, flat lot value, and `TYPE` trade column without direction arrows.
- Source pixel dimensions: 437 x 124, 575 x 700, 293 x 574, 354 x 63, and 1609 x 414 pixels.
- Rendered implementation: authenticated local terminal at `http://127.0.0.1:5173/`.
- Implementation screenshot path: current-run browser captures emitted for the closed-menu and open-root-menu states; the browser surface did not expose a persistent filesystem path.
- Implementation pixels and CSS viewport: 1920 x 919 pixels at 1920 x 919 CSS pixels, device scale factor 1. No density normalization was required.
- State: Dark theme, authenticated account 200002, XAUUSD M1, OneClickTrading visible, and open positions visible in the Trade tab.

## Full-view comparison evidence

The browser-rendered terminal shows one 40px chrome row. A three-line hamburger sits at the far left, the previous horizontal `File / View / Insert / Charts / Tools / Window / Help` row is absent, and the empty frameless-desktop title strip is absent. New Order, chart controls, the horizontal timeframe strip, and the rest of the workspace retain their prior positions and proportions.

The same full-view capture clearly shows the flat `0.01` lot value between the decrease and increase chevrons. It also shows the Trade table with an uppercase `TYPE` header and plain lowercase red `sell` / blue `buy` text without arrow glyphs.

## Focused region comparison evidence

The supplied lot and Trade screenshots are already focused crops, and all requested details remain readable at 1:1 in the 1920px implementation capture, so an additional implementation crop was not needed. A second browser capture at the same viewport shows the hamburger's solid dark 200px root panel with `File`, `View`, `Insert`, `Charts`, `Tools`, `Window`, and `Help` in order, each with a right-facing submenu affordance.

## Required fidelity surfaces

- Fonts and typography: existing 14px terminal menu typography is preserved; lot and trade values retain the existing monospace/tabular treatment. The `TYPE` header follows the table's established uppercase header styling.
- Spacing and layout rhythm: the top chrome is reduced to one 40px row; the hamburger uses a 40px slot with a 36px hit area. The lot control keeps its original horizontal dimensions while removing only the input border. Trade column widths and row heights are unchanged.
- Colors and visual tokens: the new menu uses solid dark surfaces and existing zinc/blue focus colors. Buy remains blue and sell remains red in both Dark and Advanced Light themes.
- Image quality and asset fidelity: no raster assets were required. The hamburger uses the existing Lucide icon library; no custom SVG, placeholder, emoji, or CSS-drawn substitute was introduced.
- Copy and content: all seven former top-level menu labels are preserved. `Side / Type` is consistently renamed to `Type` in the grid, tooltip, column configuration, and exported report.

## Interaction and accessibility verification

- The live hamburger opened the root panel in the authenticated terminal.
- Component interaction tests verify click-to-open switching for `View` and `Tools`, preservation of the specialized File menu, leaf-action close behavior, outside-click close, Escape close, focus return, and `aria-expanded` state.
- The portal-backed menu remains outside the toolbar's horizontal overflow container, so root and nested flyouts are not clipped.
- Desktop minimize, maximize/restore, and close controls were relocated into the same row, preserving the frameless Electron window contract after removing the title strip.
- Console retrieval timed out while the live market chart was busy; no menu, lot, or Trade presentation error appeared during the successful rendered captures. This is a residual diagnostics gap, not a visible fidelity mismatch.

## Findings

- No actionable P0, P1, or P2 visual or interaction differences remain for the requested scope.
- Accepted constraint: the root panel contains the requested File/View/etc. categories rather than the account/settings entries shown in the structural reference screenshot.

## Comparison history

1. The source showed the desired single-row hamburger structure, borderless lot value, and arrow-free type column.
2. The first 1920 x 919 browser capture confirmed the one-row chrome, flat lot value, `TYPE` header, and plain buy/sell cells.
3. The second capture opened the hamburger and confirmed the seven-category solid root panel. No P0/P1/P2 difference was found, so no post-comparison visual-fix iteration was required.

## Implementation checklist

- [x] Remove the separate blank desktop header and horizontal application-menu rows.
- [x] Relocate desktop window controls into the surviving toolbar row.
- [x] Add the left three-line hamburger and click-driven seven-category menu.
- [x] Reuse the existing File menu and nested submenu actions.
- [x] Remove the visible lot-input border without changing lot stepping or chevrons.
- [x] Rename the Trade field to `TYPE` and remove buy/sell arrow icons.
- [x] Verify the authenticated Dark-theme workspace and focused component contracts.

## Follow-up polish

- None required for the requested scope.

final result: passed

---

# Live Price Countdown Badge Design QA

## Comparison target

- Source visual truth: the user's TradingView price-marker screenshot, verified against `artifacts/tradingview-xauusd-countdown-reference-live.png`.
- Source focused crop: `artifacts/tradingview-xauusd-countdown-reference-crop.png` (132 x 84 px).
- Rendered implementation: authenticated local XAUUSD M1 chart at `http://127.0.0.1:5173/`.
- Implementation screenshot: `artifacts/local-xauusd-price-countdown.png` (1920 x 863 px).
- Implementation focused crop: `artifacts/local-xauusd-price-countdown-crop-verified.png` (118 x 70 px).
- Viewport: 1920 x 863 CSS px, device scale factor 1, for both browser captures. No density normalization was needed.
- State: live XAUUSD M1 chart. TradingView used its Light chart; RTX5 retained the user's Dark chart. The focused comparison evaluated marker geometry and hierarchy while preserving each product's active semantic colors.

## Full-view comparison evidence

The TradingView capture shows the live-price line crossing the upper price row, with an attached countdown directly below. The authenticated RTX5 capture shows the same hierarchy on the right price scale. Its top OHLC HUD remains free of countdown text, and the compact M1 picker remains in the toolbar.

## Focused region comparison evidence

The source and implementation crops were opened together in one comparison input. Both markers use two compact rows; the chart line intersects the price row rather than the center of the total stack. The RTX5 marker measures 58 x 30 px in the connected broker state, versus approximately 66 x 31 px in TradingView. The small width difference is acceptable because RTX5 preserves its broker-aware, measured price-scale width instead of hardcoding TradingView's axis width. No text clips or overlaps.

## Required fidelity surfaces

- Fonts and typography: the implementation uses its existing chart monospace family, with an 11px/16px bold price row and a 10px/14px semibold countdown row. The hierarchy and density match the reference closely.
- Spacing and layout rhythm: the badge is 30px high with 16px and 14px rows. An 8px price-row offset keeps the line centered on the upper row. The existing right-axis width remains frozen during ticks.
- Colors and visual tokens: TradingView's reference marker is teal on a Light chart. RTX5 correctly uses the current directional badge color and contrast helper on the user's Dark chart, so both rows remain legible without bypassing theme tokens.
- Image quality and asset fidelity: no raster assets, placeholder imagery, custom SVGs, or replacement icons were introduced.
- Copy and content: the marker shows only the broker-formatted live price and `MM:SS`/`HH:MM:SS` countdown. The top HUD contains only symbol, OHLC, and volume values.
- Accessibility: the once-per-second countdown is `aria-hidden` to prevent continuous screen-reader announcements; the price marker remains presentation-only.

## Findings

- No actionable P0, P1, or P2 visual differences were found.
- Accepted constraint: RTX5's marker width and live-price precision follow the connected broker's measured scale and digits rather than TradingView's fixed visual width and formatting.

## Interaction and runtime verification

- The visible M1 countdown changed from `00:41` to `00:39` during a 1.1-second browser observation, confirming the timer is live.
- Symbol/timeframe cleanup clears and hides the countdown until a finite current price and visible live badge are available.
- The countdown remains scoped to M1 through H4, matching the prior compact timer contract and avoiding long daily/weekly labels overflowing the price scale.
- Browser console errors checked: none.

## Comparison history

1. The clarified source established that countdown removal applied only to the top HUD; the timer belongs beneath the live price on the right scale.
2. The implementation moved the timer into a nested badge row, preserved broker-aware horizontal geometry, and aligned the price row with the live line.
3. The first browser-rendered focused comparison found no actionable P0/P1/P2 mismatch, so no post-comparison visual fix iteration was required.

## Implementation checklist

- [x] Keep countdown absent from both top-HUD variants.
- [x] Render price first and countdown second inside the right-side live marker.
- [x] Keep the live line aligned to the price row.
- [x] Preserve directional/theme colors and broker-aware scale width.
- [x] Clear the timer on hidden, inactive, symbol-switch, and timeframe-switch states.
- [x] Verify the one-second update and browser console.

## Follow-up polish

- None required for this scope.

final result: passed

---

# Remaining Gutters, Toolbar Pipes, and Live Candle Envelope Design QA

## Comparison target

- Source visual truth path: the three inline screenshots in the user's latest 2026-08-28 request (`conversation://latest-user-message/images/1-3`). They identify the bottom strip above the status bar, repeated top-toolbar pipe separators, and the split gap between the left dock and chart.
- Source pixel dimensions: 1907 x 78, 1352 x 129, and 381 x 871 pixels.
- Pre-fix motion evidence: `artifacts/live-candle-shrink-before-maximized-2026-08-28.mp4` (1920 x 1080, 10.000 seconds).
- Rendered implementation: authenticated local XAUUSD M1 terminal at `http://127.0.0.1:5173/`.
- Implementation screenshot path: `artifacts/design-qa-layout-after-verified-2026-08-28.png`.
- Post-fix motion evidence: `artifacts/live-candle-envelope-after-xauusd-verified-2026-08-28.mp4` (1920 x 1080, 150 frames, 10.000 seconds).
- Viewport and density: 1920 x 1080 desktop pixels at device scale factor 1. The source crops remain at their supplied sizes; comparisons use feature-aligned focused regions rather than rescaling the narrow source crops to the full viewport.
- State: Chrome, Dark theme, authenticated account 200002, XAUUSD M1 active, Market Watch and Navigator open, Toolbox Trade tab open, live market connected.

## Full-view comparison evidence

The verified full-view implementation keeps the supplied terminal composition while removing only the requested empty layout space. The Toolbox tabs meet the status bar directly, and the chart/Toolbox column meets the left dock at its structural border without the former three-pixel resize track. The main toolbar retains its grouped control spacing but no longer paints the pipe separators.

The post-fix ten-second recording stays on the authenticated local XAUUSD M1 chart for every sampled frame and includes a real minute rollover. The close and candle body continue to follow the market; the already-observed high/low envelope is not narrowed by same-time server data.

## Focused region comparison evidence

- Toolbar: `artifacts/design-qa-toolbar-after-verified.png` (1920 x 140). A 1:1 pixel check across former divider slots reports only the toolbar surface color `#131316`; no pipe pixel remains.
- Left split: `artifacts/design-qa-split-gutter-after-verified.png` (360 x 860 focused enlargement). Only the panel's structural border remains; the resize handle consumes zero layout width while retaining a seven-pixel overlapping drag target.
- Bottom split: `artifacts/design-qa-bottom-gutter-after-verified.png` (1920 x 240 focused enlargement). The dock tab row and status bar are contiguous with no six-pixel blank strip.
- Candle motion: `artifacts/live-candle-envelope-after-xauusd-verified-focus-contact-sheet.png` (1200 x 1720). Ten one-second samples show the forming close/body moving normally through the rollover while the bucket envelope remains valid.

## Required fidelity surfaces

- Fonts and typography: no typography, weights, line heights, truncation, or tabular-number settings changed. The focused captures show the existing toolbar, OHLC, dock, and table type intact.
- Spacing and layout rhythm: bottom workspace padding is zero; horizontal side padding remains six pixels. Resize handles reserve zero split width/height but retain an overlapping seven-pixel hit area. Toolbar group spacing remains stable while separator paint is removed.
- Colors and visual tokens: the existing `#131316` toolbar and dark panel tokens remain unchanged. No replacement surface, gradient, opacity, or semantic trade color was introduced.
- Image quality and asset fidelity: no new visual assets were required. Existing Lucide/application icons are unchanged, and no placeholder, text glyph, custom SVG, or CSS-drawn substitute was added.
- Copy and content: no labels or terminal data were changed for this scope.

## Interaction and runtime verification

- The invisible split handle remains draggable through its centered hit target; the existing Market Watch/Navigator and chart/Toolbox ratios are preserved by the layout test.
- The validated recording is exactly 10.000 seconds at 1920 x 1080 with 150 frames. All 26 window-title samples remained on the local authenticated RTX Terminal XAUUSD tab.
- The pre-fix review showed normal close retracement, not an invalid frozen candle. The implementation therefore accepts the incoming close while making high, low, and cumulative volumes monotonic only for the same active bucket.
- Focused automated verification: 62 tests passed across candle history, chart integration contracts, dock sizing, workspace gutters, and top-chrome presentation.
- TypeScript no-emit check passed; Vite production build passed. `git diff --check` passed. The repository-wide Vitest command exceeded the three-minute execution cap without reporting a test failure, so the scoped passing run is the authoritative test result for this change.

## Findings

- No actionable P0, P1, or P2 visual, interaction, or data-integrity mismatch remains for the requested scope.
- Accepted behavior: a live candle body can shrink when the latest close retraces toward its open. Freezing that body would display false OHLC data; only the high/low envelope is protected from delayed partial same-time snapshots.
- Accepted constraint: the single structural panel border remains so adjacent dock regions are visually legible; the empty resize-track gap itself is removed.

## Comparison history

1. The three supplied screenshots established the exact bottom, toolbar, and vertical split targets. The required pre-edit ten-second video showed normal close/body retracement with stable high/low, while source tracing exposed a separate same-time server replacement path that could narrow the envelope.
2. The implementation removed the two layout footprints and pipe paint, then added forming-envelope reconciliation without freezing the latest close.
3. The first valid authenticated local post-fix full/focused comparison found no actionable P0/P1/P2 difference. The exact ten-second follow-up recording also crossed a minute boundary without an invalid range collapse, so no post-comparison visual-fix iteration was required.

## Implementation checklist

- [x] Remove the bottom workspace strip above the status bar.
- [x] Remove repeated toolbar pipe paint while retaining group spacing.
- [x] Remove the in-flow split-handle gap without weakening resize interaction.
- [x] Preserve same-bucket high/low and cumulative volume against partial server replacements.
- [x] Keep incoming close movement and candle rollover truthful.
- [x] Verify focused tests, typecheck, production build, full/focused screenshots, and an exact ten-second local XAUUSD recording.

## Follow-up polish

- None required for this scope.

final result: passed

---

# Sectioned Hamburger Actions Design QA

## Comparison target

- Source visual truth: the inline 535 x 122 screenshot in the latest request identifies the far-right search, theme, crosshair, drawing, stamp, clear, and account strip to remove. The earlier inline hamburger/menu screenshots define the sectioned destination.
- Rendered implementation: authenticated local terminal at `http://127.0.0.1:5173/`.
- Full implementation captures: `artifacts/menu-toolbar-os-capture-2026-08-28.png`, `artifacts/menu-root-open-os-capture-2026-08-28.png`, `artifacts/menu-view-open-os-capture-2026-08-28.png`, and `artifacts/menu-objects-open-os-capture-2026-08-28.png`.
- Focused implementation captures: `artifacts/menu-toolbar-focus-after-2026-08-28.png` and `artifacts/menu-root-focus-after-2026-08-28.png`.
- Viewport and state: 1920 x 1080 physical desktop pixels, maximized Chrome, Dark theme, authenticated XAUUSD/BTCUSD M1 terminal.

## Full-view comparison evidence

The source and rendered captures were reviewed together at their supplied sizes. The highlighted far-right toolbar strip is absent in the implementation, while the existing hamburger, New Order, chart controls, horizontal timeframe strip, chart, and dock layout retain their established positions. Desktop window controls remain a separate Electron-only concern and were not removed.

Opening the hamburger shows the seven existing application sections in order: File, View, Insert, Charts, Tools, Window, and Help. The menu uses the existing opaque terminal surfaces, borders, typography, spacing, and icon library.

## Focused region and section evidence

- View owns Theme, font-size/focus-chart choices, and the now-functional Search Symbols action.
- Insert > Objects owns the line, channel, Fibonacci, shape, text, callout, measure, and complete Stamps tool set. The four-level rendered capture confirms the nested flyouts remain visible and unclipped.
- Charts owns Crosshair; Charts > Objects owns Selection Mode and Delete All.
- File owns the current-account summary and Log Out.
- The former hard-coded red account badge was removed because it was not backed by notification state.

## Required fidelity surfaces

- Fonts and typography: existing 14px terminal menu text and muted shortcut treatment are unchanged.
- Spacing and layout rhythm: the toolbar keeps one compact 40px row; removing the right strip introduces no replacement gap or extra chrome row.
- Colors and visual tokens: existing opaque dark surfaces, blue active state, muted text, separators, and hover/focus colors are reused.
- Image and icon fidelity: all visible controls use the existing Lucide/application icon registry. No emoji, custom SVG, CSS drawing, placeholder, or generated asset was introduced.
- Copy and content: all former toolbar functions remain available under semantically matching menu labels; the previously inert search icon is represented by Search Symbols.

## Interaction and accessibility verification

- Live Chrome capture verifies hamburger opening, root-section selection, the View submenu, and the deep Insert > Objects > Stamps flyout.
- Focused component tests verify all seven root sections, click-open nested menus, File action ownership, action dispatch, Escape/outside-click closure, and the View/Insert/Charts/File grouping.
- Nested items expose menu roles, labels, `aria-haspopup`, `aria-expanded`, and checkbox semantics where applicable.
- Browser-extension automation timed out during this final pass, so the authenticated rendered evidence was captured through the Chrome window at OS level. The visible application state and interaction remained live.

## Findings

- No actionable P0, P1, or P2 visual or interaction mismatch remains for the requested toolbar regrouping.
- Accepted scope: high-frequency New Order, chart-type, zoom, timeframe, screenshot, and settings controls remain on the toolbar because the request targeted only the highlighted right-side strip.

## Validation

- 41 focused menu, File-menu, typography, and chrome-contract tests passed.
- `npx tsc --noEmit` passed.
- `git diff --check` passed for the targeted files.
- The repository production build reaches unrelated existing trade-position type errors in `TradingChart.tsx` and `useToolboxTradeData.ts`; none originate in the menu files changed for this request.

final result: passed

---

# Professional Account Launcher Follow-up Design QA

## Comparison target

- Source visual truth: the latest request's two inline screenshots at `conversation://latest-user-message/images/1-2`. Image 1 is the 361 x 623 professional account-led launcher reference; image 2 is the compact File/View/Insert/Charts/Tools/Window/Help implementation being replaced.
- Rendered implementation evidence: `artifacts/menu-qa/2026-08-29-professional-menu-dark.png` and its focused crop `artifacts/menu-qa/2026-08-29-professional-menu-dark-focused.png`, from an isolated local component harness using the real `MenuBar`, real application CSS, and realistic saved-account data. This is component-level visual proof, not authenticated broker-runtime parity.
- Rendered viewport and state: Chrome at 1920 x 863, Dark theme, Arijit Nayak demo account, ETHUSD M1 context, application menu open.
- Focused reference measurement: the supplied reference menu is approximately 255 px wide and 551 px high. The rendered menu measured 256 x 553 px, with a 62 px account header and 38 px action rows.

## Source and implementation comparison

The reference and rendered implementation were reviewed together as focused launcher regions. The former seven generic section labels are replaced by the reference hierarchy: account identity, Trading accounts, Chart settings, One Click Trading, theme, Color Templates, MQL5 Algo Trading, terminal, Economic Calendar, Language, Shortcuts, Contact us, and About program.

The implementation intentionally uses the web terminal's established neutral palette instead of copying the reference's blue-gray tint: menu surface `#131316`, account surface `#191a1e`, border `#333338`, primary text `#e2e2e8`, and tokenized hover/focus states. The root launcher, generic flyouts, and specialized File menu now share these same variables, eliminating the previous color jump between levels.

## Visible fidelity and iteration

- Typography and density: 14 px primary labels, restrained regular weights, 11 px account metadata, 18 px root icons, and compact 38 px rows match the reference density while retaining the application's Plus Jakarta Sans system.
- Spacing and structure: the 256 px solid panel, inset dividers, aligned icons/chevrons, 62 px account header, and five semantic section breaks track the supplied composition.
- Account data: the active saved-account name, login, server, and truthful Demo/Real classification replace a guessed account badge. The status pill is positioned independently so it does not consume the metadata line.
- Assets: all visible actions use the existing application icon registry or Lucide hamburger icon; no emoji, placeholder, custom SVG, or CSS-drawn icon was added.
- First comparison finding: the 12 px account metadata clipped the final server suffix with the wider application font. It was reduced to 11 px and the status pill was moved to an absolute header position; the post-fix DOM exposes the complete `10012430543 - MetaQuotes-Demo - Hedge` string.

## Interaction and accessibility verification

- The browser DOM verifies one accessible `Application menu`, the complete account header, all twelve root actions, five separators, and correct menuitem semantics.
- Trading accounts retains the specialized File workflows; Chart settings retains Charts and Insert actions; Color Templates retains View/theme controls; Algo Trading, Terminal, Language, and Help resources remain reachable through click-driven flyouts.
- Direct actions close the launcher after use. Light/Dark Theme uses the existing theme owner, One Click Trading keeps its command event, and Economic Calendar opens the real Calendar bottom-dock tab through a validated tab event.
- Escape, outside click, initial focus, focus return, arrow/Home/End navigation, checkbox/radio roles, and sibling-exclusive nested menus remain covered by the focused component tests.

## Validation

- 23 focused MenuBar and FileMenu tests passed.
- 24 focused top-chrome, typography, and BottomDock presentation contracts passed.
- TypeScript no-emit check passed.
- `git diff --check` passed for all targeted source and test files.
- The later combined 47-test rerun and production build both exceeded their execution limits without reporting a test or compiler failure. The two earlier scoped passing runs are the authoritative automated results.

## Remaining QA limitation

Chrome produced the first implementation capture and exact computed measurements, then repeatedly timed out during the required post-refinement screenshot and light-theme capture. Because the final same-state re-capture could not be completed, this follow-up cannot claim a fully passed screenshot comparison even though the implemented source, DOM state, focused tests, typecheck, and initial dark render are verified.

final result: blocked

---

# Electron MetaTrader Desktop Shell Design QA

## Comparison target

- Source visual truth path: `artifacts/desktop-mt5-shell/native-metatrader-reference.png`, captured from the same installed MetaTrader 5 session shown in the user's reference (`111579130 - MetaQuotes-Demo`, XAUUSD H1).
- Rendered implementation path: `artifacts/desktop-mt5-shell/local-electron-final.png`, captured from the freshly built local RTX Electron application (`200032`, BTCUSD M5).
- Source and implementation pixel dimensions: 1936 x 1056 each.
- CSS size and density normalization: both applications were maximized on the same Windows desktop and captured at native device scale 1. No resampling, crop, or density conversion was used.
- State: authenticated desktop terminals with Market Watch and Navigator open on the left, chart in the upper-right, Toolbox across the full bottom, and top application chrome visible. Broker, symbol, timeframe, and candle data differ, so content values were excluded from layout fidelity judgments.

## Full-view comparison evidence

The native reference and latest RTX Electron capture were opened together in one comparison input at identical pixel dimensions. Both use the same desktop topology: an approximately 18.4% left column, Market Watch above Navigator, a chart occupying the upper-right workspace, and a Toolbox spanning the entire window beneath both columns. The Toolbox begins at nearly the same vertical position in both captures.

The RTX implementation also matches the compact three-level top chrome: 31px title bar, 21px application-menu row, and 32px command row. RTX intentionally retains its webterminal chart tabs, dark data panels, broker-aware content, and bottom-tab set because the request requires every existing webterminal feature to remain available in the desktop application.

## Focused region comparison evidence

- Native File menu: `artifacts/desktop-mt5-shell/native-metatrader-file-menu.png`.
- RTX File menu: `artifacts/desktop-mt5-shell/local-electron-file-menu-final.png`.
- RTX drawing operations: `artifacts/desktop-mt5-shell/local-electron-drawing-actions-final.png`.
- RTX complete 17-tool drawing flyout: `artifacts/desktop-mt5-shell/local-electron-drawing-tools-final.png`.

The focused captures verify solid light action-sheet surfaces, dark readable labels, visible separators, blue active/hover treatment, unclipped overlays, and retention of the complete drawing catalog. The RTX File menu is taller than native MetaTrader because it truthfully preserves additional webterminal account and login actions; this is an intentional content constraint, not layout drift.

## Required fidelity surfaces

- Fonts and typography: the desktop title and root application menus use Segoe UI-compatible Windows typography with regular compact weights, matching the native shell hierarchy. RTX chart and data typography remain the product's existing tabular system so quotes and trading data do not regress.
- Spacing and layout rhythm: the left dock ratio is 0.184, the upper workspace ratio is 0.657, and the full-width bottom Toolbox ratio is 0.343. Workspace padding and gaps are zero in Electron. Menu and command rows were reduced to the measured native 21px and 32px heights.
- Colors and visual tokens: title/menu/command chrome and action sheets use solid light neutral surfaces, dark text, subtle gray borders, and blue selection states. The authenticated content region intentionally retains RTX dark tokens to preserve the webterminal color system requested by the user.
- Image quality and asset fidelity: no generated raster, placeholder, emoji, custom SVG, or CSS-drawn substitute was introduced. The existing RTX title icon and established application/Lucide icon registry are used at native toolbar scale.
- Copy and content: all canonical File, View, Insert, Charts, Tools, Window, and Help actions remain available. Drawing Operations retains Delete Selected, Delete All, Undo, Redo, and Unselect All. The trend flyout retains all 17 line, channel, and pitchfork tools.
- Accessibility and affordances: the desktop menu exposes menubar/menu roles, keyboard navigation, Escape/outside closure, and focus states. Drawing Operations exposes `aria-haspopup`, `aria-expanded`, menu, and menuitem semantics.

## Findings

- No actionable P0, P1, or P2 visual or interaction mismatch remains for the requested desktop-only layout.
- Accepted product constraint: RTX keeps its dark chart, panel content, chart tabs, broker data, and extra webterminal commands rather than deleting features to imitate native MetaTrader content exactly.
- Residual test gap: the connected Chrome tab was on the login screen, so an authenticated browser-toolbar screenshot was not captured without submitting saved credentials. The browser branch remains protected by the strict Electron preload gate and focused browser-branch tests.

## Comparison history

1. The first native Electron capture established the correct dock topology but exposed a P1 interaction failure: Drawing Operations rendered inside the horizontally scrollable command row and its menu was clipped.
2. The action sheet was moved to a viewport-level portal. The revised capture made every operation reachable but exposed a P1 color-cascade issue: the global dark popup rule overrode the desktop surface.
3. The desktop portal received an explicit Electron-only surface class, and the conflicting dark utility was removed from that branch. `local-electron-drawing-actions-final.png` verifies the solid white, readable result.
4. The first full drawing-catalog capture exposed a P2 selected-row contrast problem. The selected desktop tool now uses a light-blue surface with dark-blue text and icon; `local-electron-drawing-tools-final.png` verifies the fix.
5. The final same-size comparison found the top chrome eight pixels taller than the native source. Menu and command rows were reduced to 21px and 32px. The post-fix `local-electron-final.png` comparison contains no remaining P0/P1/P2 finding.

## Interaction and validation evidence

- Native Electron verification opened the File menu, the Drawing Operations action sheet, and the complete 17-item drawing flyout.
- Focused tests: 29 tests passed across MenuBar, DesktopWindowShell, LeftDrawingToolbar, DrawingsDropdown, dock layout, chart-type toolbar, and top-chrome contracts.
- TypeScript no-emit check passed.
- Electron production build passed. The remaining Vite messages are existing chunk-size and mixed static/dynamic import warnings, not build failures.
- Windows NSIS packaging passed and produced `draft/RTX.Terminal.Setup.1.0.24.exe` plus its blockmap. SHA-256: `F99437F54135ACE10B3AD4344CDB7A9CE70D5AA7D58E9ABCDCCD9DB06375149F`.
- The packaged `draft/win-unpacked/RTX Terminal.exe` launched into the authenticated BTCUSD M5 terminal, remained responsive, and was closed after the smoke check.

## Implementation checklist

- [x] Keep the browser launcher behind the non-Electron branch.
- [x] Add native-feeling title, menu, and dense command rows only in Electron.
- [x] Preserve every existing menu/action owner and all drawing dropdowns.
- [x] Match the native left-dock, chart, and full-width Toolbox topology.
- [x] Migrate saved desktop dock layouts without changing browser layouts.
- [x] Use solid professional desktop action-sheet colors.
- [x] Verify source and implementation together at the same 1936 x 1056 viewport.
- [x] Pass focused tests, typecheck, Electron build, and native visual checks.

## Follow-up polish

- P3: a future release can add an optional native-style light content theme, but it should remain separate from this layout change so the current webterminal color system is not overwritten.

final result: passed

---

# Electron Live Data and Web Dock Parity Design QA

## Comparison target

- Source visual truth: `artifacts/tradingview-trend-tools-reference/local-left-rail-integrated.png`.
- Rendered implementation: `artifacts/desktop-mt5-shell/local-electron-web-layout-live-1920x863.png`.
- Combined comparison input: `artifacts/desktop-mt5-shell/web-reference-vs-electron-live-1920x863.png`.
- Source and implementation were compared at 1920 x 863 CSS pixels and device scale 1.
- State: authenticated dark desktop terminals on BTCUSD. The reference uses the Grow session and the implementation uses the saved Achiever Financials session; dynamic account, position, candle, and quote values were excluded from layout-fidelity judgments.

## Full-view comparison evidence

The requested dock topology now matches the webterminal reference. Market Watch and Navigator share a full-height 20% left column. The remaining 80% is a vertical center split with the chart at 75% and Toolbox at 25%, so Toolbox sits below the chart instead of spanning underneath the sidebar. The same normalized ratios are used in both reference and implementation.

The reference includes the webterminal's vertical drawing rail. The Electron build intentionally retains the native desktop shell and horizontal drawing toolbar from the preceding desktop-app request, including its dropdowns and full command catalog. This preserved desktop chrome does not change the requested dock geometry or remove a webterminal feature.

## Live-data evidence

- The final Electron capture shows a live BTCUSD bid/ask row and a green `Connected` status.
- Consecutive runtime samples changed from 77680.61 / 77695.61 to 77680.95 / 77695.95; the final capture later showed 77660.69 / 77675.69.
- The authenticated Achiever broker session, server URL, API token, and feed token remained authoritative in Electron instead of being overwritten by the public web runtime configuration.
- Only broker WebSocket requests to `/ws/feed` and `/ws/v2` omit Chromium's opaque `file://` Origin. All other request headers and Electron web security remain intact.

## Required fidelity surfaces

- Typography and colors: the existing RTX dark chart, quote table, panels, status bar, and tab tokens are preserved, avoiding a web-versus-desktop palette split.
- Spacing and topology: root split 20/80; right workspace split 75/25; no full-width bottom Toolbox in the new default.
- Assets and controls: the existing application icon set and native desktop toolbar are retained; no placeholder, emoji, generated image, custom SVG, or CSS-drawn asset was introduced.
- Copy and behavior: Market Watch, Navigator, Chart, Toolbox, account data, positions, bottom tabs, menus, drawing commands, and their dropdowns remain available.

## Comparison history

1. The prior Electron default placed Toolbox across the full window. The v3 desktop-layout migration moves only that exact previous default into the webterminal topology while preserving panel props and floating state; custom user layouts are left untouched.
2. The first live runtime check stayed in `Connecting` because the packaged file URL loaded the public Grow runtime configuration, the general WebSocket URL was captured before broker selection, and Chromium sent `Origin: file://` to broker sockets.
3. Physical Electron detection now takes precedence, the general socket endpoint resolves dynamically, and the scoped broker-socket Origin policy mirrors the working web proxy behavior.
4. The final same-size combined comparison shows the requested dock geometry, changing BTCUSD prices, and green Connected status with no remaining P0, P1, or P2 issue.

## Validation

- 76 focused tests passed across dock migration, dock rendering, backend resolution, runtime configuration, dynamic WebSocket routing, broker-session credentials, and Electron WebSocket request policy.
- TypeScript and the Electron Vite production build passed.
- Source Electron runtime verification passed with the saved authenticated Achiever profile; quotes changed during sampling and the UI reported Connected.
- The source/reference and final implementation were reviewed together in the combined 3840 x 863 comparison image.

final result: passed

---

# GTA Desktop Layout and Web Feature-Parity QA (2026-08-31)

## Comparison target

- Web layout reference: `artifacts/tradingview-trend-tools-reference/local-left-rail-integrated.png`.
- Current Electron implementation: `artifacts/desktop-mt5-shell/local-electron-gta-layout-current.png`.
- Same-size combined comparison: `artifacts/desktop-mt5-shell/web-reference-vs-electron-gta-current-1920x863.png`.
- Both comparison halves are 1920 x 863 pixels at device scale 1.
- The current Electron capture is an authenticated, connected Grow Trading Academy session. It uses the previously saved GTA account `200009`; the user-supplied `200002` credentials were rejected by the GTA authentication endpoint with HTTP 401 and were not persisted.

## Layout evidence

- The authenticated workspace begins below the 31 px native title bar and 54 px desktop menu/command chrome.
- The dock workspace is 1920 x 754 pixels. Market Watch and Navigator occupy a full-height 384 px left column (20%).
- Market Watch and Navigator are each 377 px high, preserving the 50/50 sidebar split.
- The chart/toolbox workspace begins at x=384 and is 1536 px wide (80%). Toolbox is 189 px high (25%); the chart receives the remaining 565 px (75%).
- Toolbox therefore remains below the chart only and does not extend below the left sidebar.
- `Log out` is visible at the far-right of the desktop menu row and is not duplicated inside the Electron File menu.

## Web-to-desktop feature parity

- Desktop continues to expose the canonical File, View, Insert, Charts, Tools, Window, and Help menus and the existing chart/drawing toolbar actions.
- The three direct web-launcher actions that lacked clickable desktop destinations are now present: Economic Calendar in View, One Click Trading in Tools, and Shortcuts in Help.
- Live DOM verification found all three items in their desktop menus, the upper-right Logout button, and no web hamburger launcher in the physical Electron shell.
- Browser behavior remains on the non-Electron branch. The browser hamburger/action model, browser window controls, and default web dock factory are unchanged.

## Broker and runtime evidence

- Electron production configuration uses GTA API and WebSocket endpoints, shared broker discovery, and canonical `gta_broker` routing.
- The live directory returned one active/enabled GTA entry, and the GTA time endpoint returned HTTP 200.
- The current app title, Navigator, status bar, and live quotes identify Grow Trading Academy; the status bar reports `Connected`.
- The supplied account `200002` could not be accepted as current-login evidence because GTA returned `Invalid credentials` / HTTP 401. The final visual comparison therefore records the existing authenticated GTA account `200009` rather than mislabeling it as `200002`.

## Validation

- 101 focused tests passed across MenuBar parity/logout, Electron shell, dock geometry/migration, Electron environment, runtime/backend routing, broker sessions, and scoped Electron WebSocket policy.
- TypeScript no-emit validation passed.
- Browser and Electron production builds both passed from the integrated final source. Remaining Vite output is limited to existing mixed-import and chunk-size warnings.
- Targeted `git diff --check` passed.
- The final reference/implementation pair was reviewed together in the 3840 x 863 combined comparison image. No P0, P1, or P2 layout mismatch remains for the requested desktop-only positioning.

final result: passed for desktop layout and feature parity; account `200002` login remains blocked by GTA authentication

---

# GTA Desktop Upper-Right Toolbar Cluster QA (2026-08-31)

## Comparison target

- Source visual truth: `tmp/video-frames/play-0.png` (900 x 700), with the target upper-right region extracted to `artifacts/desktop-mt5-shell/target-desktop-right-cluster-source.png` (415 x 83).
- Rendered implementation: `artifacts/desktop-mt5-shell/electron-gta-right-toolbar-current.png` (1936 x 1056), with the matching region extracted to `artifacts/desktop-mt5-shell/electron-gta-right-toolbar-current-crop.png` (520 x 100).
- Combined comparison input: `artifacts/desktop-mt5-shell/reference-vs-electron-gta-right-toolbar.png` (1040 x 126).
- Runtime state: maximized physical Electron shell, authenticated GTA account `200009`, live XAUUSD workspace, and green Connected status at device scale 1.
- The source is a downscaled historical video frame, so control order, grouping, edge alignment, and relative rhythm are authoritative; source raster sharpness and the historical dark top-chrome palette are not.

## Focused comparison evidence

The implementation reproduces the target sequence at the desktop command row's far-right edge: Search, Advanced View Settings, Crosshair, Cursor, Trend Line, Horizontal Line, Vertical Line, Equidistant Channel, Fibonacci Retracement, stamp split control, Clear All Drawings, Account with red badge, secure-connection shield, and connection-quality bar.

The right cluster is a fixed 443 px sibling of the independently scrollable left command strip. At the maximized 1920 px CSS viewport it occupies x=1477 through x=1920, while the left command strip ends exactly at x=1477. This preserves a hard right alignment even when the left command set overflows. The standalone red `Log out` text from the preceding iteration is removed; Logout now lives in the Account popup at the same upper-right control location shown by the source.

## Required fidelity surfaces

- Typography and iconography: the existing Segoe UI-compatible desktop chrome and established application icon registry are retained. No generated image, emoji, custom SVG, inline SVG, CSS drawing, or placeholder was added.
- Spacing and layout rhythm: compact 27 px quick-action buttons, 1 px separators, a 32 px command row, and the fixed right-edge grouping closely match the normalized source proportions.
- Colors and visual tokens: the current solid light desktop-shell tokens remain intentional because this request changes alignment and position only. The target's semantic red badge, green shield, and green/dark connection bar are retained.
- Copy and behavior: every target control maps to an existing canonical command. The broader webterminal menu catalog remains available in Electron, and the browser hamburger/toolbar branch is unchanged.
- Accessibility and affordances: the cluster exposes a named toolbar, named buttons, pressed state for toggles/tools, menu semantics for View, Stamp, and Account popups, outside/Escape closure, and visible focus/hover states.

## Interaction evidence

- Live DOM verification found the exact 13-button accessible sequence and no `.rtx-desktop-logout-button` duplicate.
- Search Symbols opened the existing 620 x 460 Symbols window and Escape closed it.
- Advanced View Settings exposed Dark Theme, Light Theme, three font sizes, and Focus Chart.
- Stamp Picker exposed all 11 existing stamp choices.
- Account exposed current account `200009`, Trading accounts, and Log out in a 230 px popup anchored below the upper-right control.
- Crosshair changed from unpressed to pressed and back to unpressed in the running chart.
- The maximized full-window capture confirms Market Watch, Navigator, chart, Toolbox, and status bar geometry remain unchanged around the toolbar-only refinement.

## Validation

- 35 focused tests passed across the new quick-action component, strict Electron/browser contracts, MenuBar ownership, Electron shell, drawing toolbars, drawing operations, and chart toolbar contracts.
- TypeScript no-emit validation passed.
- Browser and Electron production builds passed. Remaining Vite output consists only of existing mixed-import and chunk-size warnings.
- The source and rendered implementation were reviewed together in the combined comparison image. No P0, P1, or P2 mismatch remains for the requested desktop-only right-side positioning.

final result: passed

---

# MetaTrader Market Watch Symbol Explorer QA (2026-08-31)

## Comparison target

- Source visual truth: the three MetaTrader Web Terminal screenshots supplied in the request (681 x 508, 703 x 348, and 703 x 348).
- Required states: normal Market Watch quotes, focused search showing symbol groups and visible/total counts, and a selected group showing its complete scrollable symbol list.
- Target surfaces: the shared browser and Electron Market Watch renderer at their existing dock sizes.
- Color correction target: the terminal's shared dark/light panel tokens. The user's follow-up supersedes the initial fixed navy tint so the explorer must match the surrounding Market Watch surface in each theme.

## Implemented interaction

- Focusing or clicking `Search symbol` replaces the quotes table with the grouped symbol explorer.
- Broker-provided category metadata is authoritative; a symbol-name fallback supplies useful groups when metadata is absent.
- Group rows report the number already visible in Market Watch against the broker-authorized group total.
- Selecting a group opens its complete alphabetized symbol list. Fixed-row virtualization keeps large catalogs scrollable without restoring the previous 15-result cap.
- Typed search always covers the complete broker-authorized universe, including after drilling into a group.
- Back, close, staged Escape, keyboard selection, and symbol selection restore the expected prior state. Selecting a symbol returns to the quotes table.

## Required fidelity surfaces

- The active explorer keeps the screenshot's 48 px search row, compact 36 px group/symbol rows, and border-led hierarchy, while its surface, hover, text, count, divider, and scrollbar colors now resolve through the terminal's existing theme tokens.
- Existing icon-registry search, close, and back icons are reused. No generated, rasterized, inline SVG, emoji, CSS-drawn, or placeholder asset was added.
- Narrow desktop dock widths retain readable group names with ellipsis and non-shrinking counts; both browser and Electron consume the same component.
- Listbox, combobox, option position/set-size, active-descendant, button labels, and keyboard navigation semantics are retained for accessibility.

## Validation

- 33 Market Watch component tests passed, including focus-to-groups, broker-category drill-down, global search, staged Escape, selection restoration, and scrolling to the final item in a list larger than 15 symbols.
- 15 grouping/source utility tests passed.
- TypeScript no-emit validation passed.
- Browser and Electron production builds passed. Vite emitted only the existing mixed-import and chunk-size warnings.
- Targeted `git diff --check` passed.

## Color correction history

1. The first implementation used hardcoded navy and blue-gray values such as `#101a24`, `#8da2b7`, and `#8fa4b9`, which visibly separated the focused explorer from the neutral-charcoal Market Watch dock and could leave a dark strip in light theme.
2. Those explorer-only colors were replaced with `--bg-secondary`, `--bg-tertiary`, `--bg-quaternary`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--border-primary`, `--border-secondary`, and `--border-tertiary`.
3. The normal quote table and its financial colors were left unchanged. A focused regression now asserts that the search, explorer, group text, and counts use the shared tokens.
4. The post-correction component suite passed 33/33 tests, TypeScript passed, and fresh browser and Electron production bundles both passed.

## Blocked visual evidence

- A final browser-rendered full-state capture and combined source/implementation comparison could not be produced because the required in-app browser runtime failed before a browser connection was created: `failed to write kernel assets: The system cannot find the path specified. (os error 3)`.
- Therefore the automated interaction and build evidence is complete, but screenshot-level visual parity remains unverified rather than being reported as passed.

final result: blocked

---

# Desktop Full Trend-Tool Picker and Dark Action-Sheet QA (2026-08-31)

This section supersedes the earlier action-sheet color assertions only. The desktop title/menu/command chrome remains intentionally light; the drawing action sheets now follow the selected application theme.

## Comparison target

- Source visual truth: the user-attached 315 x 760 dark Lines/Channels/Pitchforks screenshot; the attachment has no workspace file path.
- Catalog/order reference: `artifacts/tradingview-trend-tools-reference/tradingview-trend-tools-menu.png`.
- Prior defect evidence: `artifacts/desktop-mt5-shell/local-electron-drawing-tools-final.png`, which shows the Electron picker forced to a light surface while the workspace is dark.
- Intended implementation viewport/state: maximized Electron terminal, dark theme, authenticated chart workspace, horizontal toolbar trigger open in the marked command-row gap.
- Current implementation screenshot path: unavailable. The saved authenticated Electron session was cleared during a failed reload, leaving the rebuilt source app at login, and the in-app browser runtime could not initialize because its local kernel assets path was unavailable.

## Findings

- [P1] Final same-state visual comparison is blocked.
  Location: Electron authenticated terminal, horizontal trend-tool trigger and portaled `.trend-tools-menu`.
  Evidence: the production Electron bundle and the real desktop shell open successfully, but the terminal is now at login and credentials were not entered or inspected. No current authenticated screenshot can therefore be compared with the supplied dark target.
  Impact: source/tests prove placement, catalog, behavior, and token selection, but they do not replace a final rendered screenshot.
  Fix: sign in to the already-open source Electron app, open the horizontal trend-tool picker, and capture the dark and light states at the same viewport.

## Required fidelity surfaces

- Fonts and typography: unchanged; the existing picker retains the shared application font, 10 px uppercase group headings, and 13 px/500 tool labels. Current rendered typography remains visually unverified.
- Spacing and layout rhythm: the reused horizontal picker is Electron-gated in the marked command-row gap; its 17-row menu keeps the existing 265 px width, grouped separators, 38 px rows, and viewport-aware portal positioning. Current rendered spacing remains visually unverified.
- Colors and visual tokens: Electron drawing sheets no longer use forced white values. Surface, border, text, hover, separator, and selected state resolve through `--bg-elevated`, `--border-secondary`, `--text-primary`, `--bg-quaternary`, `--color-info-dim`, and `--color-info`, so dark remains dark and the established light theme still resolves to light values.
- Image quality and asset fidelity: no raster, SVG, generated image, placeholder, or custom asset was introduced; the existing icon library and tool icons are reused.
- Copy and content: all 17 existing Lines, Channels, and Pitchforks labels and their group order are reused without changing the webterminal catalog.

## Comparison history

1. The prior Electron screenshot showed the full picker on a hard-coded white surface.
2. The missing desktop trigger was traced to the Electron branch not rendering the already-supported horizontal `LeftDrawingToolbar`.
3. The trigger is now rendered only under `isDesktopShell` in the marked command-row gap; the browser keeps its existing vertical rail.
4. Electron drawing-sheet overrides now use shared theme tokens while native desktop menu surfaces remain unchanged.
5. Automated validation passed, but the required post-fix same-state screenshot could not be captured after authentication state was lost.

## Validation

- 16 focused tests passed across `LeftDrawingToolbar`, the Electron toolbar contract, `DesktopQuickActions`, and `DrawingsDropdown`.
- 9 top-chrome/theme contract tests passed, including the Electron drawing-sheet token contract.
- TypeScript no-emit validation passed on the integrated source.
- Electron and web production bundles passed; the web bundle was written to an isolated temporary output so the Electron build remained the active desktop artifact.
- Targeted `git diff --check` passed with line-ending warnings only.

## Implementation checklist

- [x] Reuse the existing 17-tool catalog and command bus.
- [x] Add the horizontal picker only to Electron in the marked top-toolbar gap.
- [x] Preserve the webterminal vertical rail and browser branch.
- [x] Make Electron drawing action sheets dark/light theme-aware.
- [x] Pass focused tests, TypeScript, Electron build, web build, and diff checks.
- [ ] Capture and compare the authenticated post-fix Electron picker in dark and light themes.

final result: blocked

---

# Webterminal TradingView Drawing-Tools Parity QA (2026-08-31)

This section supersedes the preceding desktop trend-tool request. The latest user instruction is authoritative: the 17-tool Lines/Channels/Pitchforks experience is implemented for the browser webterminal only, and the Electron desktop toolbar does not render the new rail.

## Reference and implementation evidence

- TradingView source replay: `artifacts/tradingview-drawing-tools-20260831/tradingview-all-17-source-reviewed.mp4`.
- RTX5 authenticated replay: `artifacts/tradingview-drawing-tools-20260831/rtx5-web-all-17-reviewed.mp4`.
- Source and implementation comparison input: `artifacts/tradingview-drawing-tools-20260831/source-vs-rtx5-web-comparison.png`.
- Final RTX5 chart state: `artifacts/tradingview-drawing-tools-20260831/rtx5-web-frames/18-all-tools-complete.png`.
- Verified runtime state: browser webterminal, XAUUSD M1, authenticated account `200009`, dark theme.

## Interaction findings

- The menu exposes exactly 17 tools in the TradingView order and in the same three groups: Lines, Channels, and Pitchforks.
- Horizontal Line, Horizontal Ray, Vertical Line, and Crossline commit on one anchor.
- Trendline, Ray, Info Line, Extended Line, Trend Angle, and Regression Trend preserve a live preview and commit on the second anchor.
- Parallel Channel, Flat Top/Bottom, Disjoint Channel, Pitchfork, Schiff Pitchfork, Modified Schiff Pitchfork, and Inside Pitchfork preserve their staged preview and commit on the third anchor.
- Info Line renders change, percentage, duration, bar count, and angle information; Trend Angle renders degrees; Regression Trend renders its center line and deviation bands.
- The four pitchfork algorithms render distinct median origins matching the TradingView reference replay.
- Completing a drawing returns the webterminal to the cursor, matching the observed TradingView Keep Drawing-off behavior.
- Drawings, previews, undo/redo, Escape, deletion, storage, and asynchronous loading remain scoped to the owning account, symbol, timeframe, and chart context.

## Visual and scope findings

- The action sheet uses the existing solid theme tokens. The authenticated dark-theme replay confirms there is no light or translucent menu leak.
- Existing Lucide/icon-registry assets are used; no handwritten SVG, CSS-art, emoji, or placeholder icon was introduced.
- The browser runtime owns the new vertical drawing rail. The Electron production build succeeds without rendering or importing that web-only rail into the desktop toolbar.
- The comparison input was reviewed as one image with the TradingView reference on top and the RTX5 dark menu plus completed chart below. No P0, P1, or P2 mismatch remains for the requested behavior and surface treatment.

## Validation

- 106 focused tests passed across the new `src/drawing-tools/` module, tool catalog, context isolation, chart lifecycle, geometry, browser rail, desktop non-regression contract, and shared chrome contract.
- TypeScript no-emit validation passed.
- Web and Electron production builds passed; Electron is included as a non-regression check only.
- All three RTX5 recording parts were decoded and reviewed as contact sheets before being concatenated into the final replay.

final result: passed

---

# Web Toolbar Command-Strip Refinement QA (2026-08-31)

This section covers only the user-marked web toolbar area from New Order through Indicators. Market Watch, Navigator, chart, toolbox, timeframe order, and all controls outside that area remain in their existing layout.

## Reference and implementation evidence

- Source visual truth: the user-attached 1916 x 919 screenshot with the yellow toolbar annotation.
- Clean pre-change toolbar crop: `artifacts/toolbar-command-refinement-2026-08-31/source-toolbar-before.png`, derived without scaling from `artifacts/tradingview-trend-tools-reference/local-left-rail-integrated.png`.
- Authenticated full implementation: `artifacts/toolbar-command-refinement-2026-08-31/implementation-authenticated-full.png` at 1916 x 919 and device scale factor 1.
- Focused implementation states: `implementation-toolbar-default.png`, `implementation-toolbar-new-order-hover.png`, and `implementation-toolbar-last-symbol-active.png` in the same artifact directory.
- Combined visual-comparison input reviewed in one image: `artifacts/toolbar-command-refinement-2026-08-31/source-vs-implementation-toolbar.png`.
- Verified runtime state: browser webterminal, authenticated account `200009`, dark theme, live quote workspace, AUDCAD M5 chart, and an XAUUSD Last Symbol badge.

## Findings

- The mixed Lucide/custom icon treatment is replaced inside the marked strip by the product icon registry at a measured 16 x 16 px for every command.
- New Order now reads as the primary command through a restrained solid surface, document-plus icon, 13 px/500 label, and targeted hover/focus treatment.
- Last Symbol uses a neutral activity icon and a quieter 10 px/500 monospace symbol badge; its selected state uses the same restrained bottom accent as the chart-type controls.
- Every marked control measures 32 px high. Icon-only commands measure 32 x 32 px, group gaps remain 2 px, and the top chrome remains 41 px high, so the surrounding layout does not move.
- Selected chart controls use a subtle tokenized tint and 2 px inset bottom accent. The previous glow and broad `transition-all` treatment are absent.
- The combined before/after input shows improved hierarchy and consistent optical scale with no cropped icon, broken padding, overlap, or toolbar-height regression. The M1/M5 active timeframe difference is runtime state outside the edited command strip and is not a fidelity defect.
- No P0, P1, or P2 visual issue remains in the requested area.

## Required fidelity surfaces

- Fonts and typography: existing application typeface retained; command labels are 13 px/500, the symbol badge is 10 px/500 monospace, and timeframe typography is unchanged.
- Spacing and layout rhythm: 32 px controls, 16 px icons, 6 px label/icon gap, and 2 px group gap; original command order and invisible web divider spacing are preserved.
- Colors and visual tokens: shared background, border, text, and information-state tokens are used; dark, advanced light, and Electron-specific treatments are scoped explicitly.
- Image quality and asset fidelity: existing vector icon-registry assets are reused. No raster placeholder, emoji, CSS art, or handwritten SVG was added.
- Copy and content: New Order, Last Symbol, command titles, shortcuts, and XAUUSD badge copy are unchanged.

## Interaction and accessibility verification

- New Order dispatched its event and opened the real order dialog in the authenticated terminal.
- Last Symbol opened and exposed its selected state through reactive `aria-pressed`.
- Line Chart selected through the radio control and Candlesticks restored successfully; the four chart types expose radio-group semantics.
- The command strip exposes a named toolbar and named command groups; all controls are explicit buttons with accessible labels.
- Runtime console messages were limited to an unrelated existing TradeTab key warning and broker/resource 409/404 responses; no toolbar exception was observed.

## Engineering validation

- 34 focused tests passed across five toolbar, typography, desktop quick-action, chart-type, and top-chrome contract files.
- TypeScript no-emit validation passed with zero diagnostics.
- The production web build passed (2001 modules); only the existing Vite mixed-import and large-chunk advisories remained.
- Targeted whitespace checks passed for all tracked and new toolbar contract files; only Windows LF-to-CRLF notices were emitted.

final result: passed

---

# Web Toolbar 20px Icon-Scale Correction QA (2026-08-31)

This section supersedes the preceding command-strip icon-size decision. The user's latest feedback identifies the 16px glyphs as too small; the corrected target is a visibly stronger icon scale without increasing toolbar or control height.

## Comparison target and evidence

- Source visual truth: `artifacts/toolbar-icon-scale-2026-08-31/before-16px-toolbar-default.png`.
- Rendered implementation: `artifacts/toolbar-icon-scale-2026-08-31/after-20px-toolbar-default.png`.
- Combined comparison input reviewed as one image: `artifacts/toolbar-icon-scale-2026-08-31/before-vs-after-icon-scale.png`.
- Full implementation view: `artifacts/toolbar-icon-scale-2026-08-31/after-20px-authenticated-full.png`.
- Additional states: `after-20px-toolbar-new-order-hover.png` and `after-20px-toolbar-last-symbol-active.png` in the same directory.
- Viewport: 1916 x 919 CSS pixels at device scale factor 1. Both focused toolbar captures are 1916 x 41 intrinsic pixels with no density normalization or resizing.
- State: authenticated webterminal account `200001`, TEST broker, dark theme, XAUUSD M5, XAUUSD Last Symbol badge.
- Capture method: browser-rendered local Chromium QA session; the product's in-app browser binding was unavailable.

## Findings and comparison history

- [P2 resolved] The prior 16px registry glyphs looked optically closer to 12-14px because of their viewBox whitespace and light strokes. This made chart, zoom, layout, navigation, and action icons appear weak at the native desktop scale.
- Fix: all icons in the marked New Order-through-Indicators strip now render uniformly at 20 x 20px. The labeled icon reservation also measures 20px, avoiding overflow or false spacing.
- Post-fix evidence: the combined comparison shows a clear 25% optical lift. The glyphs are immediately readable while retaining 6px internal space inside each 32px icon button.
- The toolbar remains 41px high, every command remains 32px high, icon-only controls remain 32px wide, and the surrounding dock/chart layout is unchanged.
- No P0, P1, or remaining P2 issue is visible in the requested region.

## Required fidelity surfaces

- Fonts and typography: the existing application font, 13px/500 action labels, timeframe text, and 10px/500 symbol badge are unchanged; larger icons now balance the label weight.
- Spacing and layout rhythm: control geometry, 2px group gaps, 6px label gaps, divider spacing, radii, and selected-state inset accent are unchanged. The two labeled actions expand by only 4px each to hold the real 20px icon box.
- Colors and visual tokens: the established dark surfaces, muted/default foregrounds, information tint, borders, hover, focus, and active colors are unchanged.
- Image quality and asset fidelity: the existing vector icon registry is used at its new scale. No raster, generated image, placeholder, emoji, CSS art, or new custom SVG was introduced.
- Copy and content: command labels, shortcuts, tool order, symbol badge, and timeframe strip are unchanged.

## Interaction and console verification

- New Order dispatched and opened the real order dialog.
- Last Symbol opened and reported its active state; Line Chart selected and Candlesticks restored successfully.
- The account authenticated successfully. Its TEST broker separately returned symbol-directory 500 responses and feed WebSocket authentication errors during capture; these did not originate from the toolbar change and do not affect the icon-size result.
- The existing unrelated TradeTab missing-key warning also remained; no toolbar exception was observed.

## Engineering validation

- 34 focused tests passed across five toolbar, typography, desktop quick-action, chart-type, and top-chrome contract files, including the 20px scale contract.
- TypeScript no-emit validation passed with zero diagnostics.
- The production web build passed with 2001 transformed modules; only the existing mixed-import and large-chunk advisories remained.
- Tracked and new-file whitespace checks passed; Windows LF-to-CRLF notices were informational only.

## Implementation checklist

- [x] Increase all marked labeled and icon-only glyphs from 16px to 20px.
- [x] Keep 32px controls and the 41px toolbar unchanged.
- [x] Preserve all copy, order, behavior, colors, and surrounding layout.
- [x] Add contract coverage for both action icons, shared command icons, and the 20px label-icon reservation.
- [x] Capture authenticated default, hover, active, full-view, and combined before/after evidence.

final result: passed

---

# Web Toolbar Timeframe-Matched Clarity QA (2026-08-31)

This section supersedes the preceding 20px icon-scale decision only for foreground clarity. The icon size and toolbar density remain accepted; the user's latest feedback identifies the inactive command foreground as harder to visualize than the adjacent timeframe controls.

## Comparison target and evidence

- Source visual truth: `artifacts/toolbar-clarity-2026-08-31/before-muted-20px-toolbar-default.png`.
- Rendered implementation: `artifacts/toolbar-clarity-2026-08-31/after-clear-20px-toolbar-default.png`.
- Combined full-width comparison reviewed as one image: `artifacts/toolbar-clarity-2026-08-31/before-vs-after-toolbar-clarity.png`.
- Full implementation view: `artifacts/toolbar-clarity-2026-08-31/after-clear-20px-authenticated-full.png`.
- Additional implementation states: `after-clear-20px-toolbar-new-order-hover.png` and `after-clear-20px-toolbar-last-symbol-active.png` in the same artifact directory.
- Viewport: 1916 x 919 CSS pixels at device scale factor 1. Source and implementation toolbar crops are each 1916 x 41 intrinsic pixels; the labeled combined input is 1916 x 126 intrinsic pixels. No source or implementation density normalization, scaling, or crop resizing was used.
- State: authenticated browser webterminal account `200001`, TEST broker, dark theme, BTCUSD M5, and an XAUUSD Last Symbol badge.
- Focused-region comparison is required and supplied because the 20px icons and their low-contrast strokes are too small to judge reliably from the full terminal view alone.

## Findings and comparison history

- [P2 resolved] The previous 20px scale was geometrically correct, but the inactive toolbar foreground computed to `rgb(128, 128, 136)` while the adjacent inactive timeframe labels used the materially clearer zinc-400 foreground. The size correction therefore remained visually muted.
- Fix: the default toolbar action and icon-button foreground now uses the same zinc-400 token as the inactive timeframe controls. Hover and keyboard focus use zinc-100, while selected chart controls and the primary New Order glyph use the same blue-300 family as the active timeframe.
- Post-fix evidence: the authenticated browser capture reports exact computed-color equality between inactive toolbar commands and inactive timeframes, and exact equality between the selected Candlesticks control and active M5. The combined comparison visibly improves recognition without making the toolbar heavier.
- Geometry is unchanged: icons remain 20 x 20px, icon-only controls remain 32 x 32px, action controls remain 32px high, and the top toolbar remains 41px high.
- Icon construction is unchanged: the registry assets retain their existing root `stroke-width="1.5"`; the intentionally varied chart-shift internal strokes remain 1, 1.2, and 1.5. No glow, filter, shadow, or artificial stroke-thickening was introduced.
- No P0, P1, or remaining P2 visual issue is present in the requested toolbar area.

## Required fidelity surfaces

- Fonts and typography: application font, 13px/500 action labels, 10px/500 symbol badge, and all timeframe typography are unchanged; the label foreground now participates in the clearer shared command hierarchy.
- Spacing and layout rhythm: toolbar height, control boxes, icon boxes, group gaps, divider spacing, padding, radii, and surrounding dock/chart geometry are unchanged.
- Colors and visual tokens: dark inactive/hover/selected states now align with the adjacent timeframe zinc-400/zinc-100/blue-300 treatment; advanced-light and Electron-specific foreground overrides remain explicit and readable.
- Image quality and asset fidelity: existing vector product-registry icons are reused with their original paths and stroke construction. No raster placeholder, emoji, generated asset, CSS art, or handwritten SVG was added.
- Copy and content: labels, shortcuts, command order, badge content, tooltips, and timeframe copy are unchanged.

## Interaction, accessibility, and console verification

- New Order dispatched its event and opened the authenticated order dialog.
- Last Symbol toggled and exposed its selected state; Line Chart selected and Candlesticks restored successfully.
- Existing toolbar names, button labels, radio semantics, `aria-pressed`, and focus-visible behavior remain intact.
- The TEST broker separately returned feed WebSocket authentication errors while the account remained logged in; the existing unrelated TradeTab key warning also remained. No toolbar exception was observed.

## Engineering validation

- The command-cluster contract passed 6/6 tests; the broader focused toolbar suite passed 35/35 tests across five files.
- TypeScript no-emit validation passed with zero diagnostics.
- The production web build passed with 2003 transformed modules; only the existing mixed-import and large-chunk advisories remained.
- Scoped tracked and untracked whitespace checks passed; Windows LF-to-CRLF notices were informational only.

## Implementation checklist

- [x] Match inactive command clarity to inactive timeframe controls.
- [x] Match selected command clarity to the active timeframe treatment.
- [x] Retain 20px icons, 32px controls, 41px toolbar height, and existing stroke geometry.
- [x] Preserve interaction semantics, copy, ordering, and surrounding terminal layout.
- [x] Compare browser-rendered source and implementation crops together at identical density.

final result: passed
