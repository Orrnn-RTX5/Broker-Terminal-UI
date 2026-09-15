# RTX5 light theme: professional quality, visibility and eye comfort

Review date: September 15, 2026.

## 1. Direct verdict

**Yes: the current core palette is a credible professional light theme for a trading terminal. Keep its general direction.** The light gray surfaces, dark financial text and restrained action colors fit established enterprise design practice. The implementation still contains specific visibility problems, so I would not describe the entire interface as fully accessible or completely validated for professional use.

| Question | Assessment |
| --- | --- |
| Is `#F7F8FA` a professional trading-app background? | Yes. A reasonable, restrained, very light cool gray. |
| Are the core text colors readable? | Strong overall: all 56 tested core text/surface combinations clear 4.5:1. Individual components that bypass those tokens still fail. |
| Are Buy/Sell colors appropriate? | Yes. Blue Buy and red Sell have industry precedent and the current white labels pass contrast. |
| Are charts readable? | The default light candles and crosshair pass the evaluated graphic contrast threshold. Two alternate preset mappings and one header value need correction. |
| Is this an industry-standard list of hex codes? | No reviewed standard or platform documentation establishes such a list. Professional practice concerns roles, consistency and usable states. |
| Is it good for the eyes? | A reasonable option for light-mode reading. Comfort remains dependent on monitor brightness, room lighting, text size and the individual. |
| Can it be rated “90% eye-friendly”? | No evidence supports that percentage. Contrast ratios can be measured; eye comfort needs user testing. |
| Should the whole palette be replaced? | No. Fix the exceptions and improve state visibility. |

These judgments concern this web terminal's light renderer, not trading performance or execution reliability.

## 2. Evidence and scope

I reviewed `LIGHT_THEME_COLOR_RESEARCH.md`, the current shared stylesheet, chart palette mapping, chart text and graphic rendering, Market Watch, one-click trading, order/dialog aliases, selection and focus rules. I also researched official accessibility guidance, enterprise design systems, trading-platform documentation and primary display studies.

A fresh authenticated Chrome inspection at `http://127.0.0.1:5173/` confirmed the light skin and rendered core tokens. It covered the visible workspace, selected Market Watch row, chart header, Buy/Sell controls, lot-size field and keyboard focus on Sell. No order was submitted and no application source was changed. Only this report and its research artifacts were added.

Evidence:

- [Current workspace screenshot](artifacts/light-theme-deep-review-20260915/live-workspace.png)
- [Live computed colors](artifacts/light-theme-deep-review-20260915/live-colors.json)
- [Live chart-header colors](artifacts/light-theme-deep-review-20260915/ohlc-colors.json)
- [Sell keyboard-focus screenshot](artifacts/light-theme-deep-review-20260915/sell-focus.png) and [computed focus](artifacts/light-theme-deep-review-20260915/sell-focus.json)
- [Reproducible calculation script](artifacts/light-theme-deep-review-20260915/calculate-contrast.mjs)
- [Contrast data](artifacts/light-theme-deep-review-20260915/contrast-pairs.csv) and [full calculation results](artifacts/light-theme-deep-review-20260915/contrast-results.json)

Dialogs, alternate chart schemes and less frequent states were assessed from source and, where relevant, clearly dated September 12 artifacts. They were not all reopened in this pass. This is a detailed color review with targeted live verification, not an exhaustive accessibility certification, monitor calibration or long-session human study. Previous builds and test counts in `design-qa.md` are historical evidence, not checks rerun today.

### The existing research file needs a clearer version boundary

The September 15 preface correctly identifies the new `#F7F8FA` canvas/chart. However, later sections still call the old `#E8E8E8` canvas, charcoal accent and old quote colors “current,” and describe implementation as future work. Those sections describe the September 12 pre-implementation snapshot.

The newer code already contains fixed blue/red one-click fills, darker financial text, component aliases and opaque default light volume bars. Repeating the old failures as today's defects would be misleading. Preserve that document as historical research or clearly label its old sections; use the actual source and current measurements for present decisions.

## 3. What professional systems actually establish

Microsoft Fluent organizes neutral surfaces, brand accents and meaningful status colors. IBM Carbon supports white and gray light themes with coordinated surface layers. These are precedents for RTX5's restrained structure, not endorsements of its exact hex codes. [Fluent color guidance](https://fluent2.microsoft.design/color), [Carbon color usage](https://carbondesignsystem.com/elements/color/usage/).

TradingView documents customizable light/dark interface palettes, including chart-related roles. A terminal does not become professional merely by copying one screenshot's background. The cited Advanced Charts theme API is a design reference; RTX5 uses Lightweight Charts, which has its own chart-color options. [TradingView custom themes](https://tradingview.com/charting-library-docs/latest/customization/styles/custom-themes/), [Lightweight Charts colors](https://tradingview.github.io/lightweight-charts/tutorials/customization/chart-colors).

MetaTrader documents blue rising quotes, red falling quotes and gray unchanged quotes. Its Depth of Market documentation also uses blue for Buy and red for Sell in tick charts. RTX5's blue upward quote convention is therefore legitimate. [MetaTrader Market Watch](https://www.metatrader5.com/en/terminal/help/trading/market_watch), [MetaTrader Depth of Market](https://www.metatrader5.com/en/terminal/help/trading/depth_of_market).

IBKR supports other movement conventions and configurable rise/fall colors. Its mobile settings also offer Light, Dark and System themes. That supports accommodating user preference rather than declaring one universal color mapping. [IBKR TWS text colors](https://ibkrguides.com/traderworkstation/text-colors.htm), [IBKR Android settings](https://ibkrguides.com/android/configuration.htm).

**Design conclusion:** industry-level practice means readable numbers, recognizable controls, reliable state indications and consistent meanings. A background measured from LeetCode can be a useful visual reference, but its origin does not establish suitability for trading or eye health.

## 4. Current palette, role by role

Current source of truth: [enterprise-light.css](src/styles/enterprise-light.css), particularly the initial token block.

| Role | Current color | Assessment |
| --- | --- | --- |
| Workspace and chart | `#F7F8FA` | Keep. Neutral enough for dense data; slight cool tint is a style choice. |
| Market Watch and table surfaces | `#FAFAFA` | Keep. Very close to the canvas; layout must supply structure. |
| Toolbars, headers and neutral hover | `#F2F4F8` | Keep. A coherent repeated chrome surface. Hover may be subtle on similar backgrounds. |
| Dialogs and menus | `#FFFFFF` | Keep. White is acceptable for focused floating surfaces. |
| Input fill | `#F2F6FC` | Keep with its functional outline. |
| Selected-row wash | `#EEF2FF` | Good backing for readable colored text; insufficient by itself as a strong state indicator. |
| Pressed neutral surface | `#E8ECF2` | Reasonable. This is the darkest surface in the core text calculation set. |
| Primary text | `#111827` | Excellent contrast. |
| Ordinary financial numbers | `#0F172A` | Excellent contrast. |
| Secondary text and axes | `#4B5563` | Strong supporting text. |
| Muted but useful text | `#5F6B7A` | Passes, with limited margin on the darkest tested fill. Preserve full opacity. |
| Interaction accent | `#4338CA` | Readable on light surfaces. Do not assume it contrasts with saturated buttons. |
| Buy/Sell fills | `#2563EB` / `#DC2626` | Appropriate with visible BUY/SELL labels. |
| Profit/loss numbers | `#047857` / `#B91C1C` | Appropriate darker text shades. |
| Rising/falling quotes | `#1D4ED8` / `#B91C1C` | Readable, familiar convention in MetaTrader-style terminals. |
| Default bull/bear candles | `#059669` / `#DC2626` | Pass against the current chart; candle shapes/alternate schemes still matter for color vision. |
| Functional input outline | `#7D8796` | Passes 3:1 against all seven tested light surfaces, including 3.07:1 on pressed fill. |
| Quiet structural border | `#E3E8F0` | Suitable for subtle separation, not the sole identifying edge of an essential control. |
| Stronger structural border | `#D1D5DB` | Still only 1.39:1 against the canvas. Its name does not make it a high-contrast control outline. |
| Disabled gray | `#9CA3AF` | Low contrast: about 2.43:1 on panels. Reserve for truly inactive controls or decoration. |

Keep different meanings separate: order side, latest tick direction and profit are different information. For example, a SELL position can have positive green P/L while its side label remains SELL/red.

## 5. Measured visibility

### How the thresholds apply

Normal-sized text needs at least 4.5:1 for WCAG AA; 12–13px semibold text is still normal-sized. The large-text exception begins at approximately 24 CSS px regular or 18.67 CSS px bold. The enhanced normal-text target is 7:1. These are contrast criteria, not proof of comfortable reading. [W3C minimum text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [enhanced contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html).

Essential graphical information and control-identifying features generally require 3:1 against adjacent colors. Decorative rules and surface differences are not automatically subject to that requirement. [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

### Core text: all 56 modeled pairs pass

Each of eight core colors was evaluated against seven actual theme surfaces: white, panel, chart/canvas, chrome/hover, field, selection and pressed fill. These combinations assess token robustness; they do not claim every combination appears in the current UI.

| Text role | Color | Lowest ratio across those surfaces | Result |
| --- | --- | ---: | --- |
| Primary | `#111827` | 14.96:1 | Excellent; clears enhanced text target |
| Financial value | `#0F172A` | 15.06:1 | Excellent; clears enhanced text target |
| Secondary | `#4B5563` | 6.37:1 | Strong; clears AA |
| Muted | `#5F6B7A` | 4.58:1 | Clears AA with little spare margin |
| Accent | `#4338CA` | 6.67:1 | Strong; clears AA |
| Rising quote | `#1D4ED8` | 5.65:1 | Clears AA |
| Profit | `#047857` | 4.63:1 | Clears AA with limited margin on pressed fill |
| Loss/falling quote | `#B91C1C` | 5.46:1 | Clears AA |

On the chart specifically, primary text reaches 16.69:1. Such strong contrast is useful for reading. There is no need to make ordinary financial text faint to make the design look softer.

**56/56 is the pass count for this deliberately selected set, not “100% of the app is accessible.”** The component exceptions below demonstrate why that distinction matters.

### Solid labels, chart graphics and the grid

| Pair | Ratio | Assessment |
| --- | ---: | --- |
| White on Buy `#2563EB` | 5.17:1 | Normal-text pass |
| White on Sell `#DC2626` | 4.83:1 | Normal-text pass; modest margin |
| White on indigo `#4338CA` | 7.90:1 | Enhanced text target passed |
| White on positive price badge `#047857` | 5.48:1 | Normal-text pass |
| Default green candle on chart | 3.55:1 | Essential-graphic contrast pass |
| Default red candle on chart | 4.54:1 | Essential-graphic contrast pass |
| Crosshair `#64748B` on chart | 4.48:1 | Essential-graphic contrast pass; do not reuse indiscriminately for small text |
| Configured grid after alpha composition | 1.22:1 | Quiet supplementary guides; not a standalone precision aid |

Buy and Sell hover/pressed colors get darker, improving white-label contrast. Current default light volume marks use opaque series colors; the old warning about a 10%-opacity mobile volume reference is not a current-default defect.

The grid `rgba(46,46,46,0.11)` composites to approximately `#E1E2E4` on `#F7F8FA`. Keeping it faint is reasonable when labeled axes and the crosshair support precision. Offer stronger optional guides if users need them; making every gridline 3:1 would add unnecessary visual competition.

## 6. What is wrong now, and the specific correction

### A. Chart high-price text is too bright — live verified

The `H:` value in the chart header renders at 13px in `#16A34A`. Its effective backing is the chart; the old tinted pill is removed by CSS. Contrast is **3.10:1**, below 4.5:1.

- Owner: [TradingChart.tsx](src/components/TradingChart.tsx), around line 10183; background reset in [enterprise-light.css](src/styles/enterprise-light.css), around line 935.
- Correction: use existing text green `#047857`, giving **5.16:1** on the chart. Keep candle green separate.
- The nearby `L:` value currently passes narrowly at **4.54:1**; `#B91C1C` would provide more margin if harmonizing the header with financial text.
- “High” and “Low” describe extrema, not profit and loss. Their labels must retain that meaning even if green/red styling is kept.

### B. Market Watch error/warning message is too faint

A transient “No fresh quote…” message was visible during the initial browser inspection. Source renders this alert using `#F87171`, 10px text and a 6% red background, outside the shared semantic tokens. Over the verified `#FAFAFA` panel, the composed background is approximately `#FAF2F2` and text contrast is **2.50:1**.

- Owner: [MarketWatchPanel.tsx](src/components/layout/MarketWatchPanel.tsx), around line 1538.
- Correction: use `#B91C1C` or the relevant shared warning/error role; the dark red would achieve **5.86:1** on that backing. Use the normal supporting-text scale, preferably at least the existing 12px caption size.
- The message disappeared before a separate computed-alert capture. Its ratio is calculated from source alpha and the verified panel, rather than claimed as a captured computed pair.

### C. One-click keyboard focus is weak — Sell live verified

The focused Sell button has a 2px `#4338CA` outline with `outline-offset: -2px` and no shadow separation. The outline sits inside the red fill, producing **1.64:1**. The same source rule on Buy gives **1.53:1**.

- Owner: [enterprise-light.css](src/styles/enterprise-light.css), around lines 1690–1709; one-click is absent from the external-focus exceptions.
- Correction: use an external ring with a contrasting separation layer, coordinated with the one-click CSS that currently removes box shadows. Validate both buttons and hover/pressed states after the CSS cascade settles.
- General inputs already have a solid indigo focused border plus a soft halo. The faint halo alone does not invalidate a visible solid border.

Visible keyboard focus is required at AA. WCAG 2.2's more specific focus-area and focused/unfocused contrast criterion is AAA; do not present every aspect of that enhanced rule as AA. [Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html), [Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html).

### D. Alternate built-in chart palettes are not fully adapted

`getEffectiveChartColors()` applies the light background to these built-in schemes while retaining unsuitable dark-theme marks.

| Preset/mark | Color on `#F7F8FA` | Ratio | Assessment |
| --- | --- | ---: | --- |
| Blue on Black: bullish mark | `#4597FF` | 2.77:1 | Below essential-graphic target |
| Blue on Black: bearish mark | `#FF5858` | 2.91:1 | Below target |
| Yellow on Black: line/wick/border | `#FACC15` | 1.44:1 | Poor visibility |
| Yellow on Black: pale bearish fill | `#F8FAFC` | 1.02:1 | Nearly merges with chart; weak yellow outline does not rescue it |

Owner: [useChartSettingsStore.ts](src/store/useChartSettingsStore.ts), constants near line 14 and mapping around lines 383–447.

Correction: provide complete light variants for built-in presets, or preserve an appropriately dark chart for explicitly dark schemes. For example, blue `#2563EB` and red `#DC2626` yield 4.86:1 and 4.54:1 on this chart; amber `#A16207` yields 4.63:1 for a light-surface yellow-family line. These are candidate mappings, not a fully validated replacement preset. Keep user-customized schemes authoritative.

Do not flag the Black on White preset merely because it has white candle bodies. Its black borders preserve visible hollow-candle shapes.

### E. Independent Ask movement lacks a second visible cue

The Market Watch arrow represents Bid movement. Ask has its own movement color but no separate visible direction marker in the inspected row component. When Bid and Ask move differently, the Bid arrow is not a substitute for Ask direction.

Owner: [MarketWatchPanel.tsx](src/components/layout/MarketWatchPanel.tsx), around lines 265 and 333. Add an Ask-specific arrow or another visible direction cue if independent Ask movement is intended information. Color must not be the only means of conveying that distinction. [W3C Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

## 7. What is acceptable but deserves care

### Surface hierarchy is extremely subtle

Panel `#FAFAFA` versus canvas `#F7F8FA` is only **1.018:1**. Header versus panel is about **1.055:1**. This is not an automatic contrast violation: surfaces are not text, and titles, spacing and layout can define regions. It does mean these fills cannot provide strong separation on their own.

Keep the current background if this quiet appearance is desired. Strengthen only useful boundaries, active-panel indications and draggable handles when necessary; dark outlines around every cell would add clutter.

### Selected fills need a clear marker

The selected wash versus panel is only **1.071:1**. Market Watch has an indigo selection strip, which is useful. The Trade table's source appears to rely on the wash; confirm its selected state with an existing position and add a marker if needed. There were no open positions in the fresh browser view, so a live selected-trade-row claim would be unsupported.

### Color vision and financial meaning

The default candle colors each contrast with the background, but their contrast with each other is only about **1.28:1**. That number is not a color-blindness simulation or a separate universal candle-pair requirement. It shows why background contrast alone cannot prove distinguishability.

Retain explicit BUY/SELL labels, negative signs and direction arrows. Consider an optional hollow/filled candle scheme or another redundant distinction. Positive numbers without a plus sign are not automatically wrong; adding `+` can improve scanning. A screen-reader label alone does not replace a visible cue for sighted users with color-vision differences.

### Interaction blue and trading blue are close

Indigo interaction and blue Buy are distinguishable in the current layout through labels and placement. Do not rely on hue alone if these actions appear together without context. There is no need to introduce another bright accent merely to increase the number of colors.

### Readiness and keyboard access are separate quality concerns

Source shows one-click actions may remain saturated while execution is blocked, with tooltip/click feedback and an execution guard. That is a readiness-feedback design choice worth reviewing, not evidence of unguarded execution. Some Navigator interactions also use clickable divs; palette improvements alone cannot establish full keyboard accessibility.

### Text size matters alongside contrast

The terminal's common 12–13px text supports density, but can be uncomfortable on small or distant displays. Keep tabular numerals and clear decimal/minus shapes; verify larger-text settings and browser zoom. The 10px alert is a particularly weak choice. Text should be enlargable to 200% without loss of content or function; this pass did not test that requirement. [W3C Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html).

## 8. Eye comfort: what research supports

### Reading accuracy and comfort are different outcomes

A primary study by Piepenbrock, Mayr and Buchner tested 160 analyzed participants aged 18–44 in an approximately 45-minute proofreading experiment. Dark text on a light background improved error detection, particularly for smaller characters. Participants nevertheless reported more glare with the light display. Its bright white screen and very dark room limit direct application to a normally lit RTX5 workstation. It did not test these exact colors or all-day trading. [Original study](https://www.psychologie.hhu.de/fileadmin/redaktion/Oeffentliche_Medien/Fakultaeten/Mathematisch-Naturwissenschaftliche_Fakultaet/Psychologie/AAP/Publikationen/in_press/Piepenbrock_Mayr_Buchner_inpress_.pdf).

A 2025 crossover study of 30 young female tablet users found increased subjective visual fatigue after one-hour use in both modes, with no statistically significant between-mode difference. Other outcomes, including dry-eye symptoms, differed between modes; the nonsignificant result concerns subjective fatigue specifically. Its restricted sample and tablet setting prevent broad claims about desktop traders; lack of significance does not establish equivalence for everyone. [Original tablet study](https://www.mdpi.com/1660-4601/22/4/609).

**Practical conclusion:** light mode is defensible for dense reading. No evidence here proves that light or dark mode universally prevents fatigue.

### What `#F7F8FA` actually changes

| Surface | Calculated sRGB relative luminance |
| --- | ---: |
| White `#FFFFFF` | 1.0000 |
| Panel `#FAFAFA` | 0.9560 |
| Current canvas `#F7F8FA` | 0.9381 |
| Old chart `#F7F7F7` | 0.9301 |
| Chrome `#F2F4F8` | 0.9036 |

The current canvas is about **6.2% lower than white in this mathematical luminance metric**. That is not 6.2% less eye strain, and does not measure the monitor's emitted brightness. It remains a very bright near-white surface. It is also slightly higher in calculated luminance than the old `#F7F7F7` chart; the change is not evidence of a darker or medically gentler chart.

“Softer-looking than pure white” is a reasonable design description. “Scientifically safer for the eyes” is unsupported. The small cool tint also does not establish harmful blue-light exposure: a hex color is not a measurement of a display's emitted spectrum.

### What matters in real use

OSHA emphasizes managing reflected/direct glare and arranging lighting and screens appropriately. Its monitor guidance also addresses small text, viewing distance and uninterrupted viewing. A pale-gray background cannot compensate for a glaring window or text that requires leaning forward. [Workstation environment](https://www.osha.gov/etools/computer-workstations/workstation-environment), [monitor guidance](https://www.osha.gov/etools/computer-workstations/components/monitors).

For RTX5, retain both themes, allow comfortable text scaling, reduce unnecessary persistent saturation and keep meaningful text dark. Adjust screen brightness to the environment and take regular visual breaks. The American Optometric Association offers the 20-20-20 rule as practical guidance; it is not a guarantee against symptoms. [AOA computer vision guidance](https://www.aoa.org/healthy-eyes/eye-and-vision-conditions/computer-vision-syndrome).

To measure comfort rather than guess, compare the current palette with a stronger-contrast or dark option during realistic reading tasks. Record number-reading errors, time to locate fields and self-reported discomfort separately. Include typical monitors, scaling settings and people with differing vision needs. This would be product usability evidence, not a clinical safety study.

## 9. Recommended order of work

| Priority | Work | Acceptance evidence |
| --- | --- | --- |
| 1 | Correct OHLC high text and Market Watch alert | Computed small-text contrast at least 4.5:1 on actual backing surfaces |
| 1 | Correct one-click focus | Clearly visible ring on Buy and Sell in keyboard, hover and pressed states |
| 1 | Adapt built-in Blue/Yellow chart presets | Lines, bodies and wicks visible on the effective light background; label text checked separately |
| 2 | Add Ask-direction redundancy | Direction interpretable without distinguishing its hue |
| 2 | Verify table selection, draggable boundaries and blocked-action feedback | State identifiable without relying only on a very pale wash or hover tooltip |
| 2 | Verify larger text/zoom and color-vision alternatives | Real numbers and controls remain usable during representative tasks |
| 3 | Consolidate component exceptions and update the old report's version labels | Tokens and documentation accurately describe the rendered result |

Do not change the core gray background just to imitate another product. Do not replace readable dark text with pale gray, make every gridline heavy, or copy dark-theme candle colors onto a light chart without measurement.

## 10. Final assessment

**Professional palette: yes. Core visibility: strong. Current implementation: needs targeted corrections. Eye comfort: reasonable potential, individually dependent, not numerically established. Industry readiness: a good visual foundation, with identifiable work remaining before a broad accessibility claim.**

The largest improvement will come from fixing the bright chart-header green, pale warning text, weak action focus and alternate chart mappings. Replacing `#F7F8FA` would leave those problems unresolved.

### Calculation reproducibility

Run from the project root:

```powershell
node artifacts/light-theme-deep-review-20260915/calculate-contrast.mjs
```

The script uses standard sRGB linearization and WCAG relative luminance. Alpha layers are composited before calculation; displayed hex values are rounded only for presentation. Pass/fail uses unrounded ratios. Black/white and identical-color sanity checks return 21:1 and 1:1. Rows marked `CONTEXT` deliberately avoid assigning a text/control threshold to decorative or reference colors. These calculations are not a screenshot-wide accessibility scan.
