# RTX5 typography: research, current audit, and recommended system

Date: September 15, 2026  
Scope: the web terminal's light and dark typography, with representative screen inspection and a broader source audit.  
Deliverable: research and recommendations. This pass adds documentation and audit artifacts; it does not implement a new application design.

## 1. Verdict

**Use 14px / 20px / 400 as the main interface text role, with 500 for controls and 600 for headings.** Use one deliberately selected interface font across the two themes. Give dialog titles and prominent order prices their own larger roles.

Here, `14 / 20 / 400` means a 14 CSS-pixel font, a 20 CSS-pixel line box, and Regular weight.

14px is a credible base for a dense trading terminal. The current implementation's larger problem is that unrelated elements share the same visual priority: a panel title, a field label, an ordinary value, and a prominent order price often all request **14px / 450**.

My preferred font for a future cross-platform implementation is **Inter Variable**, using a small, documented set of weights. The already bundled Plus Jakarta Sans Variable is also a viable candidate; it should not be rejected merely because the current styling is inconsistent. Segoe UI is a valid Windows-oriented choice, with a different weight-availability tradeoff.

“Premium” and “enterprise level” are design judgments, not certifications assigned to a font size. The evidence supports a coherent hierarchy, predictable rendering, readable numbers, and resilient layouts. It does not establish one scientifically optimal font for every trader.

## 2. What was actually checked

### Current browser evidence

I inspected the running terminal at `http://127.0.0.1:5173/`, with a 1920 × 919 CSS-pixel viewport and the Normal text preference. I captured and reviewed these screens during this research pass:

| Step | Screen | Assessment |
|---|---|---|
| 1 | Light workspace: Market Watch, Navigator, chart, Trade | Legible base; panel titles and routine information have weak differentiation |
| 2 | Light History with populated rows | Numeric columns scan reasonably well; headings and body have the same requested weight |
| 3 | Light New Order dialog | Main hierarchy issue: title, labels, inputs, and prominent prices all compute to the same size and weight |
| 4 | Dark History and surrounding workspace | More differentiated emphasis, but several font families and text scales coexist |

The order dialog was opened for inspection and dismissed. No order was submitted. The terminal was returned to light mode and Trade after capture.

Computed CSS confirms the requested family, size, and weight. It does **not** identify the exact physical font face selected by the browser or prove perceived sharpness on another monitor.

### Broader source inspection

The source review also covered shared typography tokens, style import order, chart text, order-dialog canvas text, Depth of Market, Journal virtualization, font preferences, and technical details text.

The browser screenshots are representative rather than exhaustive. Login/onboarding, every popup, every locale, 200% zoom, native packaged Electron, macOS, Linux, and prolonged-use comfort were not fully tested.

## 3. What official design systems actually recommend

These are authoritative descriptions of their own systems, not comparative experiments demonstrating the best configuration for RTX5.

| Source | Published examples | Relevance to RTX5 |
|---|---|---|
| IBM Carbon | Productive body: 14/20/400; compact body: 14/18/400; component heading: 14/20/600; expressive body: 16/24/400 | Shows that dense enterprise interfaces can use 14px and still distinguish headings at the same size |
| Microsoft Fluent 2 | Web Body 1: 14/20 Regular; Body 1 Strong: 14/20 Semibold; Subtitle 2: 16/22 Semibold | Supports a regular body role and stronger labels/headings rather than one weight everywhere |
| Atlassian | Default product body: 14/20 Regular; longer reading: 16/24 Regular; secondary body: 12/16 Regular | Separates short operational content from sustained reading and secondary metadata |
| TradingView Lightweight Charts | Default price/time-scale font size: 12px | A chart-library default, not a standard for the whole TradingView product or all financial software |

Sources: [Carbon type sets](https://carbondesignsystem.com/elements/typography/type-sets/), [Carbon usage strategies](https://carbondesignsystem.com/elements/typography/style-strategies/), [Fluent typography](https://fluent2.microsoft.design/typography), [Fluent numeric font tokens](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/fonts.ts), [Atlassian typography](https://atlassian.design/foundations/typography), [Atlassian application guidance](https://atlassian.design/foundations/typography/applying-typography), [Lightweight Charts layout options](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/LayoutOptions#fontsize).

### Conclusions supported by these sources

- **16px/400 is not a universal industry requirement.** It is a useful reading-text choice; 14px/400 has strong enterprise-interface precedents.
- **Uniformity does not require identical typography.** A system can consistently assign different roles to body text, headings, controls, and supporting information.
- A 14px heading can work well when its weight, placement, and surrounding space identify it as a heading.
- Copying a chart library's 12px default into order inputs or account tables would require a separate usability justification.

## 4. Findings in the current app

### Finding A — The light theme flattens the information hierarchy

**Priority: high. Confirmed in source and browser.**

The current light rules apply size and weight with `!important` to `h1` through `h6`, `strong`, `b`, `small`, ordinary text, controls, and nested spans. Most receive 14px/450. Bottom tabs and the vertical Toolbox title retain a local 400 weight.

Selected browser measurements:

| Element | Current light typography | Recommended interpretation |
|---|---|---|
| Navigator item | 14px / 21px / 450 | Normal navigation content |
| Panel title | 14px / 21px / 450 | Should have a stronger heading role |
| Market Watch price | 14px / 21px / 450, tabular numerals | Good size and numeric alignment; use a defined regular or emphasized value role |
| History heading | 14px / 21px / 450 | Should differ from the rows beneath it |
| History data cell | 14px / 21px / 450 | Regular data text is appropriate |
| New Order title | 14px / 21px / 450 | Should clearly introduce the dialog |
| New Order field label | 14px / 21px / 450 | Supporting control identification |
| New Order prominent price | 14px / 21px / 450 | Should have greater prominence than a supporting label |
| Selected bottom tab | 14px / 21px / 400 | Selected-state emphasis could complement its existing outline |

The original order-price CSS contains 24px prices and 29px emphasized digits. The later broad override removes that size distinction. Restoring those exact old values is not automatically the right design; it demonstrates why changing all descendants together has consequences.

Evidence: [central light typography](../../src/styles/light-typography.css), [order-price roles](../../src/styles/order-panel-dialog.css), screenshots 1–3 described below, and the historical light computed styles path `artifacts/typography-deep-research-20260915/light-computed-styles.json` (the artifact is not stored in this repository).

### Finding B — Family changes make identical numerical settings look different

**Priority: high. Confirmed in source and computed CSS.**

The bundled family is Plus Jakarta Sans Variable. The light theme selects Segoe UI with Tahoma/Arial fallbacks. Dark Navigator and Market Watch use the Jakarta stack; dark History uses Segoe UI; the dark chart information line uses a monospace stack.

In the captured dark screen, Navigator computed to 14px/400, Market Watch prices to 14px/500, History headings to 12px/400, History rows to 13px/400, and the selected bottom tab to 12px/600. Theme switching therefore changes more than the background and text colors.

Different families have different letter shapes, x-heights, spacing, and number widths. A 14px value is the em size; it does not guarantee equal visible letter height between fonts.

Evidence: [authenticated imports](../../src/authenticatedStyles.ts), [shared font tokens](../../src/styles/theme.css), [light font selection](../../src/styles/enterprise-light.css), and the historical dark computed styles path `artifacts/typography-deep-research-20260915/dark-computed-styles.json` (the artifact is not stored in this repository).

### Finding C — 450, 495, and 498 are not quality levels

**Priority: medium. Font matching is documented; exact browser face selection remains unverified.**

Intermediate CSS weights are valid. A variable font can provide intermediate instances. A static family supplies discrete faces, so the browser uses matching rules when a requested weight is unavailable. Several requested values can consequently select the same face. Seeing `450` in computed CSS alone does not prove a distinct 450-weight drawing. [W3C font matching](https://www.w3.org/TR/css-fonts-4/#font-style-matching).

The installed Segoe UI faces inspected in this audit are static; the checked weights were 300, 350, 400, 600, and 700. This is consistent with Microsoft's separate Segoe family/style listings. [Microsoft Segoe UI](https://learn.microsoft.com/en-us/typography/font-list/segoe-ui).

The practical improvement is to choose available, purposeful roles and inspect their rendering. Tiny weight adjustments should not replace a hierarchy decision.

### Finding D — Weight-token names can mislead implementation

**Priority: medium. Confirmed in source.**

The shared definitions currently map `normal` to 400, `medium` to 400, `semibold` to 500, and `bold` to 600. Raw numerical weights also appear in components.

This can be intentional, but the names do not communicate their usual numerical meanings. A maintainer expecting `medium` to produce a distinct 500 face will get 400 instead.

Use explicit semantic roles such as `body`, `control`, and `heading`, or consistently documented numeric mappings. Avoid correcting this with another layer of broad overrides. Evidence: [theme weight definitions](../../src/styles/theme.css).

### Finding E — Canvas and row geometry need their own audit

**Priority: high for implementation reliability. Source-confirmed discrepancies; runtime impact is not fully measured.**

1. **Depth of Market:** several canvas labels still assign 9px fonts. CSS applied to HTML text cannot resize those drawings. Its font strings also include literal CSS-variable expressions, which need renderer-level verification. Resolve font values before passing them to the canvas. The price ladder assumes 19px rows, so larger text requires a fitting check. Evidence: [DepthOfMarket.tsx](../../src/components/DepthOfMarket.tsx), lines 53–54, 239, 412, 427, 456, 479, and 679.
2. **Compact Journal:** compact light CSS forces table rows to 26px, while Journal's scrolling calculations assume 30px. Its virtual spacer rows also receive inline heights that conflict with that `!important` rule. This is a concrete conflict between layout assumptions; skipped rows or scrolling defects require a focused runtime test. Evidence: [compact light rules](../../src/styles/legacy-light-overrides.css), lines 723–730; [Journal](../../src/components/layout/JournalTab.tsx), lines 69, 399–421, and 451.
3. **Main chart axes:** the chart API receives size and family separately. The global HTML weight does not establish the native axis weight. Evidence: [TradingChart.tsx](../../src/components/TradingChart.tsx), the `readChartAxisFontSize` helper and chart layout options.

These findings explain why “set the whole app to one number” is insufficient as an implementation strategy.

### What already works

- The default 14px size is a reasonable terminal baseline.
- Market Watch and financial tables use tabular numerals.
- The application has central tokens and an explicit style-load order.
- Recent footer and bottom-tab heights follow their text dimensions.
- User-authored drawing typography is protected from ordinary UI overrides.
- The order-dialog chart already reads resolved light font values and adjusts label geometry.

## 5. Recommended RTX5 type specification

**This table is my proposed starting specification, synthesized for this app. It is not an industry mandate or an implemented change.**

| RTX5 role | Size | Line height | Weight | Reason |
|---|---:|---:|---:|---|
| Market Watch values, History/Trade cells, normal inputs | 14px | 20px | 400 | Sustained scanning with restrained emphasis |
| Navigator items and ordinary menu entries | 14px | 20px | 400 | Keeps navigation calm |
| Selected Navigator item | 14px | 20px | 500 | Moderate emphasis without enlarging the row |
| Buttons and form labels | 14px | 20px | 500 | Makes actionable controls and labels identifiable |
| Bottom tabs, inactive | 14px | 20px | 400 | Preserves the recent readable-size preference |
| Bottom tabs, selected | 14px | 20px | 600 | Adds a clear selected state alongside the existing shape |
| Table column headings | 14px | 20px | 500 | Separates headings from regular data |
| Panel titles: Navigator, Toolbox, Market Watch | 14px | 20px | 600 | Stronger structure without consuming much space |
| Key account-summary values | 14px | 20px | 500 | Highlights totals selectively |
| Dialog title: New Order, Options | 20px | 28px | 600 | Makes the current task clear |
| Prominent bid/ask display inside order dialog | 20px | 28px | 600 | Separates the decision value from surrounding form details |
| Section heading inside a larger dialog | 16px | 24px | 600 | Intermediate hierarchy |
| Help, longer explanations, onboarding reading | 16px | 24px | 400 | Gives prose more reading space |
| Status metadata and supporting captions | 13px | 18px | 400 | Optional density role, subject to user preference |
| Chart axes and secondary chart labels | 13px | Renderer managed | 400 where supported | Start with readable density; allow 14px in a comfortable mode |
| Critical validation or trading error text | 14px | 20px | 500 | Should remain clearly readable |
| Major settings/page title | 24px | 32px | 600 | Appropriate for a full page, not every small dock |

Do not turn an essential price, volume, stop-loss value, or error message into small secondary text just to fit a cramped container.

### If the all-14px preference remains a firm constraint

Keep normal labels, tables, navigation, status text, and chart labels at 14px. Use **400 / 500 / 600** by role, plus spacing and placement, to establish hierarchy. A compact panel heading can remain 14px/600.

Larger dialog titles and reading text are recommendations for consideration, not a prerequisite for a clean interface. A deliberate all-14px design can still improve substantially over all-14px/all-450 styling.

### Weight policy

- **400:** the default for ordinary content and repeated table values.
- **500:** controls, form labels, selected items, and selected important values.
- **600:** headings and a limited number of high-priority values or states.
- **700:** reserved for a specific strong-emphasis need; not a default for the terminal.

Avoid thin 300-weight critical text. Also avoid making every price bold: when all values are emphasized, the emphasis conveys little information.

## 6. Font-family decision

### Preferred future option: Inter Variable

Inter provides a variable weight range, optical sizing, tabular figures, and character-disambiguation features. Its text design has a tall x-height. Those are relevant capabilities for a numerical interface; they do not prove superiority over every other font. [Official Inter documentation](https://rsms.me/inter/).

For a controlled rollout, load a known font version locally and verify the available weights. Use the same UI family in light and dark modes. Keep monospace for code or a clearly justified annotation role. Check script coverage against the app's actual languages before committing to the family.

### Viable alternatives

| Choice | Advantage | Main consideration |
|---|---|---|
| Inter Variable | Designed for detailed UI; supports the proposed numeric weight roles | Requires a new, measured integration and layout comparison |
| Existing Plus Jakarta Sans Variable | Already bundled; real intermediate weights available | Needs consistent application and density review; mixing families is the present problem |
| Segoe UI | Familiar Windows interface appearance; used by Fluent Web | Platform availability and static weight matching vary; do not assume a distinct 500 face |

I would compare Inter and the already loaded Jakarta family on the same table, order form, and error message before selecting the final family. If retaining static Segoe UI, a simpler Regular/Semibold hierarchy is more dependable than requesting tiny intermediate differences.

## 7. Numbers, spacing, and layout

Typography quality includes the space around the text.

- Use tabular numerals for changing prices, balances, times, and aligned financial columns. Check that the selected font really supports the feature. Inter specifically provides equal-width tabular figures across its weights. [Inter numeric features](https://rsms.me/inter/#features).
- Right-align comparable numeric values, keep precision consistent, and preserve clear decimal separators and minus signs. Retain explicit buy/sell or gain/loss meaning beyond color alone.
- Start ordinary UI text with normal letter spacing. The current global tracking computes to approximately -0.084px at 14px. This is small, but it should be deliberate rather than inherited everywhere.
- Start default table rows around 30–32px for 14/20 text. Offer denser rows only after checking the full row, control hit areas, and scrolling calculations. These heights are proposed layout values, not accessibility standards.
- Use a shared row-height source for virtualized lists. Changing CSS height alone can invalidate the calculations that decide which rows to render.
- Fit tab labels, translated labels, status controls, and order fields at the actual font weight. Avoid clipped glyphs or width shifts when an item becomes selected.
- Preserve consistent baseline alignment between icons and labels. Font size and icon dimensions are separate decisions.

## 8. Light theme, dark theme, and visual comfort

Start both themes with the same family, role sizes, line heights, and weight meanings. Then tune foreground/background colors and validate the result on real displays. Do not assume light mode universally needs heavier text or dark mode universally needs lighter text.

For normal-sized text, WCAG AA requires at least 4.5:1 contrast, subject to its defined exceptions. A 14px semibold label remains normal-sized text. Thin strokes and antialiasing can make text appear weaker even where the nominal color pair passes; a comfortable margin above the threshold is useful. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Text must be enlargable to 200% through an applicable supported mechanism without loss of content or function. Fixed CSS pixels are not automatically a failure, because browser zoom can scale them; root-relative units and adaptable containers can make user preferences easier to support. This audit did not establish zoom conformance. [W3C text resizing](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html).

Allow user overrides of line height, paragraph spacing, letter spacing, and word spacing without losing information. The WCAG text-spacing values are override-resilience requirements, not a rule that every compact trading label must have a default 1.5 line height. Canvas text needs separate consideration. [W3C text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html).

There is no defensible percentage score for how “good for the eyes” this proposed font is. Comfort depends on text size, viewing distance, glare, display quality, ambient lighting, and the person. OSHA's workstation guidance also treats monitor placement and lighting as relevant factors. [OSHA monitor guidance](https://www.osha.gov/etools/computer-workstations/components/monitors), [workstation environment](https://www.osha.gov/etools/computer-workstations/workstation-environment).

## 9. Implementation order and acceptance criteria

### Recommended order

1. Choose one UI font policy and document the available faces/weights.
2. Introduce semantic body, control, heading, value, and supporting-text roles.
3. Replace the broad heading/emphasis flattening with role-aware rules. Preserve the 14px terminal base.
4. Apply the same role meanings to light and dark themes.
5. Align canvas fonts and row geometry, particularly Depth of Market and Journal.
6. Validate before extending the change across all remaining dialogs and onboarding screens.

### What should be verified

| Check | Evidence required |
|---|---|
| Font loading | Actual rendered faces in browser font tooling; expected weights available |
| Hierarchy | Titles, labels, values, controls, and help text distinguishable without excessive bolding |
| Financial scanning | Stable digit widths; readable decimals, minus signs, volumes, timestamps, SL/TP values |
| Dense layouts | No clipping at representative 1366px and 1920px desktop widths; intentional table scrolling |
| Scaling | Browser zoom through 200%; Small/Normal/Large settings; text-spacing overrides |
| Canvas | Main chart, order mini-chart, Depth of Market, tooltips, and system trade labels checked separately |
| Virtualization | Journal renders and scrolls correctly through long lists in both density settings |
| Theme parity | Same roles in light/dark; contrast and selected/disabled states checked independently |
| Task usability | Traders can locate a symbol, compare bid/ask, enter volume, distinguish SL/TP, and find a history result without extra effort |

A small representative user evaluation should measure task errors, completion time, readability preferences, and comfort over a realistic session. I have not measured those outcomes, so the proposed system is a well-supported starting point rather than a proven optimum.

## 10. Current screenshot evidence

These are observations of the current application, not mockups of the recommendation.

### Step 1 — Light workspace: readable base, limited hierarchy

Historical capture (not stored in this repository): Current light workspace — `artifacts/typography-deep-research-20260915/01-light-workspace.png`.

The main controls are readable. Panel titles, ordinary rows, footer information, and chart metadata compete at similar sizes and weights. This supports Findings A and B.

### Step 2 — Light History: useful alignment, weak heading distinction

Historical capture (not stored in this repository): Current light History — `artifacts/typography-deep-research-20260915/02-light-history.png`.

The table presents consistent numeric columns and visible horizontal separation. Its heading and row text both compute to 14px/450, so the background strip carries most of the header distinction.

### Step 3 — Light New Order: the main hierarchy opportunity

Historical capture (not stored in this repository): Current light order dialog — `artifacts/typography-deep-research-20260915/03-light-order-dialog.png`.

The dialog has clear grouping and recognizable actions. Its title and prominent bid/ask values do not receive stronger size/weight roles than supporting labels. This is the best first screen for evaluating a revised hierarchy.

### Step 4 — Dark History: stronger selected-state emphasis, mixed typography

Historical capture (not stored in this repository): Current dark History — `artifacts/typography-deep-research-20260915/04-dark-history.png`.

The selected tab stands out clearly. The surrounding workspace uses Jakarta, the table uses Segoe UI, and chart metadata uses monospace. The family and scale changes should become deliberate exceptions or be consolidated.

## Final recommendation

**For RTX5, keep a 14px terminal base, make ordinary text Regular 400, use Medium 500 for controls, and Semibold 600 for structure. Prefer a consistently loaded variable UI family, with Inter as the leading candidate.**

The first implementation target should be the New Order dialog and one populated financial table. They expose the hierarchy, numeric clarity, and layout tradeoffs clearly before a whole-app rollout.
