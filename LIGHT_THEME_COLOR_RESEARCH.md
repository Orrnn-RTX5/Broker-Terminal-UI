# RTX5 light-theme color research

Background update, September 15, 2026: the workspace canvas, resize gutters, unused shell and light-theme chart background now use #F7F8FA, measured from the outer background of the user's [LeetCode reference page](https://leetcode.com/u/hEIZpYXBm3/) in Chrome. The page's `.bg-layer-bg` container resolves to `rgb(247, 248, 250)` with no background image. The chart loading surface and Chart Properties preview use the same color. This supersedes the earlier #ECEFF1 reference and the original #F2F4F8 workspace and #F7F7F7 chart recommendations below.

Implementation update, September 12, 2026: the user approved this palette after the research pass. It is now applied to the shared web/Electron light renderer. See [implementation verification](design-qa.md#approved-light-palette---2026-09-12-implementation) for current screenshots, checks and limitations. The research observations below describe the earlier snapshot.

The recommended direction is a restrained adaptation of the mobile palette: a cool gray workspace, near-white data panels, the existing soft off-white chart, one indigo interaction accent, blue Buy actions, red Sell actions, and darker colors for small financial text.

The mobile palette is suitable as a starting point for a professional terminal. Copying every value directly would introduce contrast problems and retain inconsistencies between components. Professional presentation comes from predictable roles, coherent states, readable data and restrained emphasis; the reviewed industry sources do not establish a universal list of enterprise hex codes.

This is a research proposal. No application source, theme setting defaults or trading behavior was changed for this report. The scope is the web terminal's light theme. The mobile core palette was verified against its source; the additional mobile component colors supplied alongside it are reference values, not a claim of a separate screen-by-screen mobile audit.

## Evidence and scope

The review covers the current light-theme stylesheet, legacy light overrides, stylesheet loading order, chart palette resolution, chart grid and preview rendering, Market Watch, docked tables and navigation, one-click trading, New Order, Last Symbol, Historical Data and shared surface styles. The code snapshot and browser observations were taken on September 12, 2026.

The authenticated terminal was inspected at 1920 × 863 CSS pixels and device scale 1. Its active skin was confirmed as rtx-skin-untitled-light. The chart and main controls were inspected without placing a trade. Detailed dialog color ownership below is based on source inspection; it is not a claim that every dialog state was measured in this research pass.

Supporting files:

- [Current light terminal screenshot](artifacts/light-theme-color-research-20260912/current-light-theme.jpg)
- [Computed colors from the current terminal](artifacts/light-theme-color-research-20260912/current-rendered-colors.json)
- [336 foreground/background contrast calculations](artifacts/light-theme-color-research-20260912/contrast-matrix.csv)
- [Proposed palette reference](artifacts/light-theme-color-research-20260912/proposed-palette.svg)

## Findings from established systems

Microsoft Fluent separates neutral surfaces, brand colors and semantic status colors. It recommends restrained use of brand color and pairing semantic color with other indicators. This supports a mostly neutral trading workspace with selected controls and meaningful status information carrying color. It does not prescribe RTX5's exact indigo or gray values.[^1]

IBM Carbon provides both White and Gray 10 light themes and a layering model for surfaces. Its token architecture assigns colors to roles such as text, border, field and focus. A gray workspace with brighter data surfaces is therefore an established enterprise design approach. Carbon's own hex values differ from this proposal; the relevant precedent is the organized hierarchy.[^2]

TradingView's Advanced Charts documentation describes separate palette assignments for interface elements, axes, grid and series. Its customization support demonstrates that a professional chart does not depend on one immutable palette. RTX5 uses Lightweight Charts, whose chart colors are configured through chart options; the Advanced Charts Custom Themes API is a design reference, not an API to introduce into this application.[^3][^4]

MetaTrader explicitly documents blue for rising quotes, red for falling quotes and gray for unchanged quotes. Consequently, RTX5's blue upward quote text is a recognizable market convention, not a defect simply because the mobile token uses green. Price movement, trade side and account profit should remain separate semantic roles.[^5]

For RTX5's 12–13px text, use a minimum 4.5:1 foreground/background ratio. Being medium or semibold at these sizes does not qualify it for the large-text exception. Required graphic or control-identifying information generally needs 3:1 against adjacent colors. Decorative dividers and a gentle hover wash do not automatically require that ratio.[^6][^7]

Color should have a second visible cue where it carries meaning: plus/minus signs, Buy/Sell labels, a selected indicator or a direction marker. A screen-reader label alone does not solve a color-only distinction for sighted people who cannot distinguish the colors.[^8]

## Current code assessment

| Current area | Verified implementation | Consequence for a palette change |
| --- | --- | --- |
| Main light skin | Canvas #E8E8E8; panels #F7F7F7; headers #F0F0F0; fields #FAFAFA | Already restrained, but closely related grays provide limited separation between workspace, controls and data |
| Main text | #242424, #454545 and #656565 | These ordinary text colors are readable; replacing them is primarily a visual-family choice |
| Selection | #E3E3E3 with charcoal indicator | Darkens the surface enough to reduce contrast of some colored data |
| Brand / general action | Charcoal #363636 | Coherent with the current neutral theme, but different from the mobile brand |
| Market Watch movement | Up #0B6CF0; down #D61F2C | Preserves blue/red quote semantics; upward text needs more contrast on off-white and selected rows |
| Profit / loss | #087A49 / #B42318 | Ordinary off-white surfaces work; positive text needs a lighter selected background or a darker color in selected rows |
| One-click Buy | #0078D4, explicitly forced in its component CSS | Will not automatically follow a new global Buy token |
| One-click Sell quote area | Legacy light rules vary fill by quote direction; the observed rising state used #3183FF for the price and #2A6FD9 for the side label | A Sell control can appear blue. This has a market precedent, but currently differs from the forced blue Buy behavior |
| New Order | Local --order-* tokens and color-mix() action backgrounds | The resulting Buy/Sell colors will differ from literal global values unless the local aliases and mixes are considered |
| Last Symbol | Independent --lst-* palette, including #7A8699 muted text, #1669B2 Buy and #C43245 Sell tokens | Main theme token changes alone do not align this panel |
| Main chart | Runtime light surface #F7F7F7; grid rgba(46,46,46,0.11); default mapped candles #089981 / #F23645 | Chart colors require a runtime palette update as well as CSS changes |
| Chart Properties | Uses effective chart colors and the shared grid helper | Its preview must continue to match the real chart |
| Finish | Flat light surfaces are already explicit in surface-finish.css | Colored glows and decorative gradients would reverse an existing coherent choice |

Source ownership is listed at the end of the report. Existing differences are distinguished here from proposals: a blue rising quote is intentional; a low-contrast small label is a measurable issue.

### Measured problems that matter most

Ratios are calculated from the specified colors using WCAG relative luminance. Displayed results are rounded to two decimals; thresholds are evaluated before rounding. These are pair-level results, not a full application accessibility certification.

| Pair | Ratio | Assessment |
| --- | ---: | --- |
| Current rising quote #0B6CF0 on current selected row #E3E3E3 | 3.70:1 | Below the normal-text target |
| Current rising quote #0B6CF0 on #F7F7F7 | 4.44:1 | Slightly below the target |
| Current falling quote #D61F2C on #E3E3E3 | 4.00:1 | Below the target in selected rows |
| Current profit #087A49 on #E3E3E3 | 4.21:1 | Below the target if that pair is used for selected profit text |
| Current one-click white digits on #3183FF | 3.61:1 | Below the target for 13px text |
| Mobile profit #059669 on white | 3.77:1 | Suitable for some graphical marks, not normal-size financial text |
| Mobile muted #6B7280 on #F2F4F8 | 4.39:1 | Below the target |
| Mobile muted #6B7280 on input fill #F2F6FC | 4.46:1 | Still below; rounding to 4.5 must not turn this into a pass |
| Mobile loss #DC2626 on selected fill #EEF2FF | 4.32:1 | Below the target for small loss text |
| Mobile dimmed text #9CA3AF on white | 2.54:1 | Restrict to unavailable controls or decoration |
| Mobile bright positive #10B981 on white | 2.54:1 | Too weak even for a required standalone status mark at 3:1 |
| Mobile crosshair #94A3B8 on #F7F7F7 | 2.39:1 | Too faint as the sole essential position indicator |
| Mobile structural border #E3E8F0 on white | 1.23:1 | Fine for quiet separation, insufficient if it alone identifies a required control |

The same green can be appropriate for a candle body and inappropriate for a small P/L number because the applicable contrast roles differ. Likewise, white text on a solid #DC2626 Sell button passes at 4.83:1, while #DC2626 text on a tinted selected row does not.

## Recommended palette and placement

These values are the proposed RTX5 design decision. They are informed by the research and measurements, not an assertion that Fluent, Carbon or TradingView uses this exact combination.

### Surfaces and structure

| Element in the web terminal | Recommended value | Placement and reason |
| --- | --- | --- |
| Workspace canvas, resize gutters and unused shell | #F2F4F8 | Reuse the mobile canvas; separates the shell from content |
| Market Watch, Navigator and Toolbox data bodies | #FAFAFA | A near-white adaptation that retains the existing preference for soft large surfaces |
| Main chart canvas | #F7F7F7 | Keep the existing soft chart background; the largest reading surface does not need to become pure white |
| Main toolbar, dock titles, table headers and status bar | #F2F4F8 | Give repeated chrome one shared surface |
| Dialog bodies, dropdowns and menus | #FFFFFF | A clear raised surface over the workspace; reserve pure white primarily for focused interactions |
| Input, select and numeric stepper fill | #F2F6FC | Reuse the mobile recessed field color consistently |
| Neutral hover | #F2F4F8 | Quiet change on data rows, menu items and neutral controls |
| Selected rows / active tab wash | #EEF2FF | A light selected surface that leaves financial text readable |
| Neutral pressed surface | #E8ECF2 | A defined pressed state; avoid independently invented gray values |
| Structural panel border | #E3E8F0 | Separate panels without outlining every item heavily |
| Quiet row divider | #F3F4F6 | Decoration only; use spacing and alignment to establish rows |
| Strong structural boundary / splitter | #D1D5DB | For larger region boundaries, not a substitute for a control-identifying outline |
| Input outline or required small control boundary | #7D8796 | Added darker functional token; at least 3.25:1 on the proposed white, field and selected surfaces |
| Hovered input outline / essential neutral icon | #64748B | Stronger interaction boundary and visible icon color |
| Disabled control fill | #F3F4F6 | Pair with disabled semantics; do not use disabled styling for merely secondary actions |

Do not put every data cell inside a dark outline. The stronger functional border belongs to editable fields and controls whose edge is necessary for recognition. Most table dividers can remain subtle.

### Text and interaction

| Element | Recommended value | Placement and reason |
| --- | --- | --- |
| Primary text | #111827 | Symbols, ordinary values, dialog titles and primary labels |
| Default financial price | #0F172A | Unchanged prices and numeric values; a dedicated semantic alias even though it is close to primary text |
| Secondary text | #4B5563 | Column headings, field labels and secondary navigation |
| Muted readable text | #5F6B7A | Added darker variant for timestamps, descriptions, placeholders and empty states |
| Disabled-only text | #9CA3AF | Unavailable actions; not timestamps, placeholders or working controls |
| Faint / ghost colors | #D1D5DB / #E5E7EB | Skeletons or decoration, not meaningful small text |
| General accent | #4338CA | Mobile indigo for selected tools, active tab indicators, links and non-trading primary actions |
| Accent hover | #3730A3 | General primary-action hover |
| Accent pressed | #312E81 | General primary-action press |
| Accent selected fill | #EEF2FF | Light background paired with indigo indicator and readable text |
| Keyboard focus | #4338CA plus a white separation ring where necessary | A solid visible outline; the translucent glow is optional decoration |
| Text on solid actions | #FFFFFF | General primary, Buy and Sell actions |
| Connected status | #047857 | Dark green text and icon, accompanied by the word Connected |
| Disconnected/error | #B91C1C | Red with a visible state label |
| Warning | #78350F on #FFFBEB | Separate amber warning treatment with an icon and explicit message |

The proposed muted #5F6B7A is deliberate: the supplied #6B7280 fails on some pale backgrounds, and even Help's #667085 falls to 4.45:1 on #EEF2FF. #5F6B7A stays above 4.5:1 across all seven proposed ordinary, selected and pressed surface backgrounds in the matrix.

General accent and Buy blue may share a visual family, but should have separate tokens. Changing the brand accent later must not accidentally change trade-side meaning.

### Trading controls and financial data

| Role | Default | Hover / pressed or supporting treatment |
| --- | --- | --- |
| Buy action fill | #2563EB | #1D4ED8 hover; #1E40AF pressed |
| Sell action fill | #DC2626 | #B91C1C hover; #991B1B pressed |
| Positive P/L text | #047857 | Retain this readable shade on normal and selected rows |
| Negative P/L text | #B91C1C | Retain this readable shade on normal and selected rows |
| Rising bid/ask text | #1D4ED8 | Preserve the existing blue-up convention; pair with a direction marker where needed |
| Falling bid/ask text | #B91C1C | Red-down convention with a direction marker where needed |
| Unchanged bid/ask text | #0F172A | Do not make an unchanged but usable quote look disabled |
| Daily positive / negative percentage | #047857 / #B91C1C | Signed values distinguish performance from the latest tick direction |
| Buy/Sell position badges | #1D4ED8 / #B91C1C text | Light blue / light red badge fill; always include BUY or SELL |
| Positive/negative chart price label fill | #047857 / #B91C1C | White text; separate label tokens from candle fills |

For one-click trading, the preferred proposed behavior is fixed side identity: Buy remains blue and Sell remains red; quote movement is communicated by a small direction marker or local tick cue. This aligns execution controls with the supplied mobile model and with New Order.

That is a product choice, not an industry compliance requirement. MetaTrader also supports quote-driven trading-panel colors.[^5] If preserving that behavior is preferred, apply it consistently to both sides and darken the quote fills enough for their white digits. The current mixed treatment, where Buy is forced blue while Sell follows a direction-dependent fill, should be resolved explicitly.

Do not reuse green profit text for Buy solely because both feel positive. A Buy can lose money, a Sell can gain money, and a rising quote can have a different consequence for each open position. Separate tokens keep those meanings clear.

### Chart

| Chart element | Recommended value | Reason |
| --- | --- | --- |
| Background | #F7F7F7 | Retain the current soft working surface |
| Grid | Existing rgba(46,46,46,0.11) | Keep the already restrained grid initially; it composites to about #E1E1E1 over this background |
| Axis labels | #4B5563 | Readable small text with lower emphasis than live prices |
| Crosshair | #64748B | About 4.44:1 against the chart; stronger than the supplied #94A3B8 |
| Crosshair label fill | #334155 | White label text |
| Bull candle and wick | #059669 | Mobile candle token; 3.52:1 against #F7F7F7 |
| Bear candle and wick | #DC2626 | Mobile candle token; 4.51:1 against #F7F7F7 |
| Volume bars, if essential to interpretation | #059669 / #DC2626 | Full-opacity marks or a sufficiently contrasting outline; verify against the adjacent chart |
| Drawing selection outline / handles | #4338CA | Same interaction accent as the rest of the terminal |
| User-selected drawing / indicator colors | Retain their chosen values | Defaults and selection chrome should not overwrite saved analytical choices |

The supplied grid #F1F5F9 is almost indistinguishable from the current chart background: approximately 1.02:1. It is acceptable as decorative texture, but is a poor replacement if traders rely on the grid to align prices. A chart can keep quiet optional gridlines when labeled axes and the crosshair carry the precision task. If a gridline itself becomes essential information, evaluate that role accordingly.

The existing candle pair also clears 3:1 against the current chart. Moving to the mobile candle pair is a cross-product consistency choice, not a contrast repair. Custom chart schemes should stay authoritative.

The 10%-opacity volume colors from mobile should not be assumed sufficient as the only data marks. Their effective colors depend on the background. Low-opacity fills are useful for a supplementary area beneath a solid line or outline.

### Categories and decorative colors

Keep category colors inside the symbol selector or a small category badge. Do not use them as full Market Watch row fills or a competing palette for P/L.

Forex indigo and commodity green can remain small accents with readable category labels. Crypto #F59E0B and metal #EAB308 have only 2.15:1 and 1.92:1 against white. Their names should use neutral dark text, and any category identity that depends on the marker needs a visible outline or an additional shape/label. Index #64748B is suitable for a small neutral mark, but is not the recommended general muted text token on every background.

Skip decorative dot gradients, colored glows around ordinary cards and permanent action-button glows. A subtle neutral dropdown shadow can identify a floating layer. Keep docked panels flat.

## Applying the mapping to the actual screens

| Screen or component | Proposed treatment |
| --- | --- |
| Main command bar and drawing rail | Gray surface, neutral icons, indigo selected indicator; keep Buy/Sell colors out of general navigation |
| Market Watch | Near-white body, shared gray headings, indigo selected-row marker, darker blue/red quote text, dark neutral unchanged values |
| Navigator | Same panel and label colors as Market Watch; preserve actual broker branding; use indigo only for active selection |
| Trade and History tables | Same data surface, heading surface and separators; use signed green/red P/L with the lighter selected-row background |
| Account summary and status bar | Gray chrome, dark readable numbers, muted descriptive labels; explicit Connected/Disconnected text |
| Exposure | Neutral table and signed values; graph colors only where they describe exposure, not decorative brand stripes |
| Journal | Neutral normal entries; amber warning and red error with severity words/icons; one indigo filter selection |
| Historical Data | Shared surface/input tokens; indigo Download action; ordinary controls remain neutral |
| New Order and Modify Position | White dialog, recessed fields, shared labels, stable blue/red execution actions; chart and price-label colors mapped separately |
| Last Symbol | Alias its local palette to the same light roles; align actions with New Order and one-click controls |
| Chart Properties, symbol explorer, options and menus | Shared white floating surface, neutral headings and indigo selected/focused controls |
| Login | Apply the same field, label, accent and error roles if its actual light mode is selected; do not infer its mode from the authenticated workspace |

The current typography work should remain a separate, stable layer. This proposal changes color assignments, not font sizes, weights, spacing, market data, order submission or saved layouts.

## Contrast acceptance for the proposed text roles

The minimum below is the lowest ratio across white, #FAFAFA, #F7F7F7, #F2F4F8, #F2F6FC, #EEF2FF and #E8ECF2.

| Proposed text role | Color | Lowest ratio |
| --- | --- | ---: |
| Primary | #111827 | 14.96:1 |
| Default financial value | #0F172A | 15.06:1 |
| Secondary | #4B5563 | 6.37:1 |
| Muted | #5F6B7A | 4.58:1 |
| Brand/link/selected label | #4338CA | 6.67:1 |
| Rising quote | #1D4ED8 | 5.65:1 |
| Profit | #047857 | 4.63:1 |
| Loss | #B91C1C | 5.46:1 |

For solid buttons, white on Buy #2563EB is 5.17:1, white on Sell #DC2626 is 4.83:1 and white on indigo #4338CA is 7.90:1. The proposed darker hover and pressed fills improve those text ratios.

The mobile Buy gradient includes #3B82F6, where white text is only 3.68:1; its Sell gradient includes #EF4444, where white text is only 3.76:1. A gradient must be checked at the actual area behind each glyph. Flat action fills remove that uncertainty and match the existing light-theme finish.

The 8-digit colors in the supplied table are rounded representations of RGBA tokens. Their result depends on the layer underneath. For implementation, retain exact alpha values where appropriate and composite before assessing contrast; do not treat a shadow, tint or glow as an opaque border.

## Visual comfort: evidence and limits

A 2013 study by Piepenbrock, Mayr, Mund and Buchner found a dark-text-on-light-background advantage for visual acuity and proofreading in both younger and older adults. This supports light interfaces for reading tasks, but it did not test this palette, modern RTX5 charts or hours of trading. It cannot establish that #F7F7F7 or #F2F4F8 prevents eye fatigue.[^9]

HSE's display-screen guidance emphasizes readable text and adjusting brightness and contrast to ambient conditions. Color choice is only part of that relationship.[^10] The design recommendation is to retain a soft chart background, preserve readable contrast and avoid large persistent saturated areas. The exact preference between #FAFAFA and white still needs a visual review on the actual monitor.

White is used in established enterprise systems and is not automatically unprofessional or harmful. Equally, making every text label faint to reduce perceived brightness can make the terminal harder to read. The proposed system softens surfaces while keeping working text dark.

## Code ownership and future implementation scope

The main risk is partial propagation. These are the specific owners to coordinate in a later implementation; no changes to them were made for this report.

| File | Relevant responsibility |
| --- | --- |
| [Mobile glass.ts](/C:/Users/ADMIN/RTX-5Mobile-App/rtx5-app/src/ui/theme/glass.ts:160) | Verified GLight reference: surface, text, trading, chart and category tokens |
| [src/styles/enterprise-light.css](src/styles/enterprise-light.css) | Main scoped light tokens, surface remaps, selected rows, data colors and focus rules |
| [src/styles/advanced-untitled-light.css](src/styles/advanced-untitled-light.css) | Legacy light overrides, including direction-dependent one-click fills |
| [src/index.css](src/index.css) and [src/authenticatedStyles.ts](src/authenticatedStyles.ts) | Import order; later component styles and final finish layer can affect computed results |
| [src/styles/last-symbol-panel.css](src/styles/last-symbol-panel.css) | Independent local surface, action, text and focus palette |
| [src/styles/history-downloader.css](src/styles/history-downloader.css) | Local aliases, controls, focus, coverage and download states |
| [src/styles/order-panel-dialog.css](src/styles/order-panel-dialog.css) | Order action aliases, color mixes, quote and chart label colors |
| [src/components/OneClickTrading.tsx](src/components/OneClickTrading.tsx) and [its CSS](src/components/OneClickTrading.css) | Hardcoded action states, quote direction presentation and forced Buy background |
| [src/store/useChartSettingsStore.ts](src/store/useChartSettingsStore.ts) | getEffectiveChartColors: light palette resolved without discarding saved custom schemes |
| [src/components/TradingChart.tsx](src/components/TradingChart.tsx) | Axis, crosshair, series, HUD and live-price label rendering |
| [src/utils/chartGridStyle.ts](src/utils/chartGridStyle.ts) | Effective grid color and opacity calculation |
| [src/components/dialogs/ChartPropertiesDialog.tsx](src/components/dialogs/ChartPropertiesDialog.tsx) | Chart preview uses effective palette and grid colors |
| [src/styles/surface-finish.css](src/styles/surface-finish.css) | Final surface overlays, control sheen and shadows |
| [src/components/layout/MarketWatchPanel.tsx](src/components/layout/MarketWatchPanel.tsx), [BottomDock](src/components/BottomDock.tsx) and [ConnectionStatus](src/components/ConnectionStatus.tsx) | Semantic hooks, selected state and visible status labels |

A later implementation should establish one set of light semantic roles, alias the component palettes to those roles, and update chart options from the same design decisions. New aliases are preferable to replacing every matching hex literal indiscriminately: the same existing color may currently represent several unrelated meanings.

A scoped visual acceptance pass should include the selected and hovered row with live quote movement, positive and negative P/L in existing history, disabled controls, New Order and Last Symbol, input focus, nested menus, tool selection, chart load/ready states and saved custom schemes. It should measure the final computed colors after all styles have loaded.

The first implementation priorities would be readable colored data, consistent action states, then coordinated surface and accent changes. The recommended values are ready for review; their appearance has not been applied to or validated in the running terminal.

## Sources

Primary sources were accessed on September 12, 2026. Undated live documentation is identified as such. The scientific and occupational-display references are older evidence used for bounded readability guidance, not evidence of current product palette choices.

[^1]: Microsoft. [Color — Fluent 2 Design System](https://fluent2.microsoft.design/color). Live documentation, no publication date displayed. Used for neutral, brand and semantic roles and restrained accent usage.

[^2]: IBM. [Color overview — Carbon Design System](https://carbondesignsystem.com/elements/color/overview/). Live documentation, no publication date displayed. Used for light surface layering and role-based tokens. See also [Color tokens](https://carbondesignsystem.com/elements/color/tokens/) for distinct focus and contrast-inset roles.

[^3]: TradingView. [Custom themes API — Advanced Charts documentation](https://www.tradingview.com/charting-library-docs/latest/customization/styles/custom-themes/). Live documentation. Used as evidence that professional chart interface colors are customizable across distinct roles.

[^4]: TradingView. [Chart colors — Lightweight Charts documentation](https://tradingview.github.io/lightweight-charts/tutorials/customization/chart-colors). Live documentation. Used for the distinction between page/CSS colors and chart API colors.

[^5]: MetaQuotes. [Market Watch — MetaTrader 5 Help](https://www.metatrader5.com/en/terminal/help/trading/market_watch). Live documentation. Used for blue/red/gray quote movement and quote-dependent trading-panel colors.

[^6]: W3C WAI. [Understanding WCAG 2.2 SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Live explanatory guidance. Used for normal-text thresholds, exceptions and calculation interpretation.

[^7]: W3C WAI. [Understanding WCAG 2.2 SC 1.4.11: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Live explanatory guidance. Used for essential control/graphic contrast and the distinction from decorative visual separation.

[^8]: W3C WAI. [Understanding WCAG 2.2 SC 1.4.1: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). Live explanatory guidance. Used for visible cues in addition to color.

[^9]: Piepenbrock, C., Mayr, S., Mund, I. and Buchner, A. [Positive display polarity is advantageous for both younger and older adults](https://www.psychologie.hhu.de/fileadmin/redaktion/Oeffentliche_Medien/Fakultaeten/Mathematisch-Naturwissenschaftliche_Fakultaet/Psychologie/AAP/Publikationen/2013/Piepenbrock-2013-Positive_display_polarity_is_.pdf). Ergonomics, 2013. Primary study, university-hosted copy. Used for the bounded light-background legibility finding.

[^10]: UK Health and Safety Executive. [Working with display screen equipment (DSE)](https://www.hse.gov.uk/pubns/indg36.pdf). INDG36, older guidance. Used for readable text and adjustment of display brightness/contrast to room lighting.

## Calculation method

For each sRGB channel c normalized to 0–1, the linear channel is c/12.92 when c ≤ 0.04045; otherwise it is ((c + 0.055) / 1.055)^2.4. Relative luminance is 0.2126R + 0.7152G + 0.0722B. Contrast is (lighter luminance + 0.05) / (darker luminance + 0.05).[^6]

The CSV contains 42 candidate/current colors against eight backgrounds. Its PASS/FAIL columns apply numerical thresholds to that pair; they do not determine whether a particular element is text, an essential graphic, disabled content or decoration. Those role decisions are stated in the report. Opacity must be composited against its actual background before using the same method.
