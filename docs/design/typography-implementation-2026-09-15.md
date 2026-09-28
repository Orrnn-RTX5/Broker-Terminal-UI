# RTX5 application typography implementation

Implemented September 15, 2026, following the [typography research](typography-research-2026-09-15.md).

## Shared hierarchy

| Role | Normal size | Weight |
|---|---:|---:|
| Ordinary text, navigation, inputs, financial table values | 14px | 400 |
| Controls and form labels | 14px | 400 |
| Table headings, panel titles and active tabs | 14px | 500 |
| Section headings | 16px | 500 |
| Dialog titles and prominent order prices | 20px | 500 |
| Main page title | 24px | 500 |
| Longer onboarding explanations | 16px | 400 |

Both themes use these role meanings. Functional terminal text now shares the existing Segoe UI stack, avoiding perceived weight differences between neighboring panels. Code, Journal logs, entry branding and user-authored drawings retain their separate font roles. No new font dependency was introduced. Small/Normal/Large terminal preferences resolve to 13/14/15px, and heading sizes follow the base preference.

## Weight consistency and candle-color refinement

- Removed legacy utility classes as a source of inherited weight. Nested labels and financial values now inherit their semantic container, including Exposure's formerly mixed 400/500/600 cells.
- Reduced functional headings and selected states from 600 to 500; ordinary controls now match body text at 400. Sortable and plain table headings both use 500.
- Set candle bodies, borders and wicks to green **#089981** and red **#F23645**, matching the supplied reference palette in both themes. Saved built-in defaults migrate globally and per symbol; custom colors remain configurable.
- Verified computed weights and families in light and dark workspaces, populated History, Exposure and New Order. Exposure values and nested asset labels all measured 400; table headings and selected states measured 500; the order title measured 20px/500.
- Refinement checks: 107 style/chart/Depth of Market checks passed, including a corrected stale contract rerun; 52 candle palette/series checks passed; 34 entry checks passed.
- The production build passed again after the refinement, including TypeScript checking. Vite retained its bundle-size and mixed-import warnings.

Historical capture (not stored in this repository): Current light Exposure and candle palette — `artifacts/weight-candle-refinement-20260915/light-exposure.jpg`.

Historical capture (not stored in this repository): Current dark History and candle palette — `artifacts/weight-candle-refinement-20260915/dark-history.jpg`.

## Changes

- [app-typography.css](../../src/styles/app-typography.css) supplies shared tokens and semantic roles, including portalled dialogs and nested price digits. A screen-only CSS layer replaces legacy micro-size overrides while retaining meaningful headings and emphasis.
- [light-typography.css](../../src/styles/light-typography.css) now handles the existing light dock layout and aliases the shared tokens. Its blanket 14px/450 text rule was removed.
- Navigator, Market Watch, Trade, History, other Toolbox panels, menus, controls, status text and dialogs share the new roles. Dark bottom tabs can shrink and scroll while their close-action group remains visible.
- Login, startup, the welcome screen and Open Account use their respective body/control/heading roles. Scrollable content protects shorter windows.
- Open Account now uses the light theme's surfaces and foreground colors. Its title remains readable and its primary action uses white text on violet.
- Main chart axes, system annotations, crosshair labels and the order mini-chart use the shared size. Native chart axes retain the renderer's normal weight. User-created drawing typography remains separate.
- Depth of Market resolves real canvas font values and measures labels. Ladder rows now fit the font preference rather than assuming 19px text rows.
- Journal virtualization uses measured row/header heights, and compact-density CSS exempts its spacer rows.

## Initial implementation validation

- Production build passed (`npm run build`, including TypeScript checking). Vite reported bundle-size and mixed static/dynamic import warnings.
- Shared styles and dock checks: 72 tests passed.
- Chart, crosshair and order-dialog checks: 101 focused tests passed.
- Entry and onboarding checks: 34 focused tests passed.
- After the final Open Account contrast repair, all 5 account-wizard tests passed again.
- Depth of Market and Journal checks: 30 focused tests passed, including live row-height changes and reaching the end of a 1,000-row fixture.
- Browser inspection covered light workspace, populated History in both themes, New Order in both themes, Depth of Market, Login and Open Account. Normal desktop and 1366-by-768 layouts were inspected.
- Initial measurements used 600 for titles. The refinement above replaces that with 500 and supersedes the initial weight measurements.

The live Journal endpoint returned HTTP 404. Its populated scrolling behavior was verified in regression tests, not against live server rows. This pass does not establish full WCAG conformance, packaged Electron rendering, every locale, or prolonged-use comfort. No trading order or account-registration form was submitted during verification.

## Initial browser evidence (before the weight refinement)

Historical capture (not stored in this repository): Light workspace — `artifacts/app-typography-20260915/01-light-workspace.jpg`.

Historical capture (not stored in this repository): Light New Order — `artifacts/app-typography-20260915/02-light-order.jpg`.

Historical capture (not stored in this repository): Light History — `artifacts/app-typography-20260915/03-light-history.jpg`.

Historical capture (not stored in this repository): Dark History — `artifacts/app-typography-20260915/04-dark-history.jpg`.

Historical capture (not stored in this repository): Dark New Order at 1366px — `artifacts/app-typography-20260915/05-dark-order-1366.jpg`.

Historical capture (not stored in this repository): Depth of Market and the corrected dark tab row — `artifacts/app-typography-20260915/06-dark-depth-1366.jpg`.

Historical capture (not stored in this repository): Light Login at 1366px — `artifacts/app-typography-20260915/07-light-login-1366.jpg`.

Historical capture (not stored in this repository): Corrected light Open Account at 1366px — `artifacts/app-typography-20260915/08-light-onboarding-1366.jpg`.
