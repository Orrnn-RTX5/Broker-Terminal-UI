# Shortcut verification

This report separates keyboard registration and command routing from the effect observed in a real terminal. A passing mocked callback does not establish that a printer, broker, or operating-system feature completed its action.

The inventory comes from the mounted shortcut registry and `getShortcutHelpEntries()`. `DEFAULT_SHORTCUTS` contains legacy and desktop-only definitions and is not the web-terminal inventory. One row identifies one action, key combination, and scope; aliases remain separate rows.

## Evidence levels

- **Browser verified:** the key was sent through the supported browser-control runtime and its expected visible result was observed.
- **Handler verified:** a component received a keyboard event and its expected state change, command, or callback was asserted in an automated test. Mocked dependencies are identified.
- **Registration verified:** the binding and displayed metadata match the actual mounted registry. The downstream action still needs separate evidence.
- **Not exercised:** no execution evidence is recorded in this report yet.
- **Platform-specific:** the binding belongs to a different platform or native feature and requires the corresponding runtime for end-to-end verification.

The native Windows On-Screen Keyboard was confirmed open in interactive session 1 with a visible, non-minimized window titled `On-Screen Keyboard`. Automated browser checks use the browser-control runtime; they are not automated clicks on the native keyboard. No live trade is needed for this audit.

## Global bindings

The current mounted manifest contains **78 active global bindings plus 12 local help entries: 90 rows total**. The additional binding is **Ctrl+Alt+N — Add chart**. `GlobalShortcuts.matrix.test.tsx` mounts `GlobalShortcuts`, `TopToolbar`, and `WebDrawingToolsRail`, checks that every active binding has an assertion, and rejects conflicts. Counts were confirmed from `tmp/shortcut-matrix-inventory.json`, including the enabled `window.add-chart` registration. Earlier browser observations and completed validation runs below retain their original 77-binding/89-entry counts.

Shared automated fixtures cover four configured broker identities with exact suffixed symbols, two active-chart targets, and all nine timeframes. Broker changes and active-chart switches are exercised without remounting the shortcut owners. Callback/API boundaries are mocked where stated; these are not live broker tests. All active global bindings are also checked for suppression inside a locally scoped dialog.

<!-- GLOBAL_SHORTCUT_MATRIX_START -->
| ID | Keys | Action / context | Automated evidence | Browser result |
| --- | --- | --- | --- | --- |
| `file.save` | Ctrl+S | Save workspace | Actual key handler → mocked application callback; native/downstream action not exercised by matrix. | Not exercised in this pass |
| `file.close-chart` | Shift+Alt+Q | Close active chart | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `file.print` | Ctrl+P | Print chart | Actual key handler → mocked application callback; native/downstream action not exercised by matrix. | Not exercised in this pass |
| `view.fullscreen` | F11 | Full Screen | Actual key handler → mocked application callback; native/downstream action not exercised by matrix. | Not exercised in this pass |
| `view.data-window` | Ctrl+D | Data Window | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `tools.new-order` | F9 | New Order | Actual key handler → mocked application callback; native/downstream action not exercised by matrix. | Not exercised in this pass |
| `view.depth-of-market` | Alt+B | Depth of Market | Actual key handler → mocked application callback; native/downstream action not exercised by matrix. | Not exercised in this pass |
| `trading.quick-sell` | Alt+S | Quick Sell | Actual key handler → mocked quick-sell callback with exact active symbol; no broker transaction. | Not exercised in this pass |
| `trading.toggle-one-click` | Shift+Alt+T | One Click Trading | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Browser verified: Shift+Alt+T toggled all four views of the same symbol, reflecting the shared symbol preference; toggled again to restore. |
| `charts.indicator-list` | Ctrl+I | Indicator List | Actual key handler → scoped OPEN_INDICATOR_LIST command; dialog consumer separate. | Not exercised in this pass |
| `charts.toggle-crosshair` | C | Toggle Crosshair | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `charts.object-list` | Ctrl+B | Object List | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `charts.bar-chart` | Alt+1 | Bar Chart | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Browser verified: Alt+1 selected the Bar Chart toolbar radio; native bar rendering not separately captured. |
| `charts.candlestick` | Alt+2 | Candlesticks | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Browser verified: Alt+2 selected Candlesticks and an actual chart screenshot confirmed candles. |
| `charts.line-chart` | Alt+3 | Line Chart | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Browser verified: Alt+3 selected Line; actual chart screenshot confirmed the line conversion. |
| `charts.toggle-grid` | Ctrl+G | Toggle Grid | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `charts.toggle-volumes` | Ctrl+K | Toggle Volumes | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `timeframe.m1` | Alt+4 | M1 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `timeframe.m5` | Alt+5 | M5 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `timeframe.m15` | Alt+6 | M15 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `timeframe.m30` | Alt+7 | M30 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `timeframe.h1` | Alt+8 | H1 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `timeframe.h4` | Alt+9 | H4 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `charts.zoom-in` | + | Zoom In | Actual key handler → scoped zoom command and toolbar candleWidth state; rendered chart scale separate. | Not exercised in this pass |
| `charts.zoom-out` | - | Zoom Out | Actual key handler → scoped zoom command and toolbar candleWidth state; rendered chart scale separate. | Not exercised in this pass |
| `charts.toggle-grid-alt` | Alt+G | Toggle Grid | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `charts.scroll-left` | ← | Scroll Chart Left | Actual chart-scroll consumer → mocked chart time-scale range; sibling chart unchanged. | Not exercised in this pass |
| `charts.scroll-right` | → | Scroll Chart Right | Actual chart-scroll consumer → mocked chart time-scale range; sibling chart unchanged. | Not exercised in this pass |
| `charts.undo-drawing` | Ctrl+Z | Undo Last Drawing | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `charts.redo-drawing` | Ctrl+Y | Redo Last Drawing | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `charts.delete-drawing` | Del | Delete Selected Drawing | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `charts.delete-last-drawing` | ⌫ | Delete Last Drawing | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `charts.properties` | F8 | Chart Properties | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Browser verified: F8 opened Chart Properties for ADAUSD M1. |
| `navigation.close-modal` | Esc | Close Modal | Actual key handler → cursor-selection command for active chart; modal consumers separate. | Not exercised in this pass |
| `help.shortcuts` | F1 | Keyboard Shortcuts | Actual key handler → help-open state; full dialog separately covered in ShortcutHelpDialog.test.tsx. | Browser verified: F1 opened Keyboard Shortcuts with 89 entries and the minimized-window scope for Arrange Icons. |
| `trading.order-history` | Shift+Alt+O | Order History | Actual key handler → requested BottomDock tab state; rendered panel content separate. | Not exercised in this pass |
| `view.market-watch` | Ctrl+M | Market Watch | Actual key handler → togglePanel event with correct panel name; panel mounting separate. | Not exercised in this pass |
| `view.navigator` | Shift+Alt+N | Navigator | Actual key handler → togglePanel event with correct panel name; panel mounting separate. | Not exercised in this pass |
| `view.terminal` | Shift+Alt+W | Terminal | Actual key handler → togglePanel event with correct panel name; panel mounting separate. | Not exercised in this pass |
| `view.toolbox` | Shift+Alt+U | Toolbox | Actual key handler → requested BottomDock tab state; rendered panel content separate. | Not exercised in this pass |
| `view.symbols` | Alt+U | Search Symbols | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `view.drawing-tools` | Shift+Alt+D | Drawing tools | Actual key handler → drawing sidebar visibility state. | Not exercised in this pass |
| `drawing.emojis` | Alt+E | Emojis | Actual key handler → rendered rail popup and visible sidebar. | Not exercised in this pass |
| `drawing.stamps` | Shift+Alt+G | Icons and Stamps | Actual key handler → rendered rail popup and visible sidebar. | Not exercised in this pass |
| `charts.area-chart` | Alt+0 | Area Chart | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Browser verified: Alt+0 selected the Area Chart toolbar radio; native area rendering not separately captured. |
| `charts.period-separators` | Shift+Alt+P | Show period separators | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `charts.trade-history` | Shift+Alt+I | Show trade history | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `charts.ohlc` | Shift+Alt+L | Show OHLC | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `charts.auto-scroll` | Shift+Alt+A | Auto Scroll | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `charts.chart-shift` | Shift+Alt+F | Chart Shift | Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable. | Not exercised in this pass |
| `timeframe.d1` | Shift+Alt+4 | D1 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `timeframe.w1` | Shift+Alt+5 | W1 | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `timeframe.mn` | Shift+Alt+6 | MN | Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged. | Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine. |
| `tools.history-center` | F2 | History Center | Actual key handler → requested BottomDock tab state; rendered panel content separate. | Not exercised in this pass |
| `tools.options` | Ctrl+O | Options | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `window.add-chart` | Ctrl+Alt+N | Add chart | Mounted key dispatch verified across four broker fixtures. Uses the shared `add-chart-panel` action also invoked by the toolbar and Window menu; dock manager/store tests cover creation and the six-chart limit. | Browser verified: consecutive Ctrl+Alt+N actions reached six chart headers; the next add retained six and displayed Maximum 6 charts are open. |
| `window.tile` | Alt+R | Tile Windows | Actual key handler → expected layout API method/argument (method mocked); layout geometry requires separate evidence. | Browser verified: Alt+R restored a 2×2 grid of four charts. |
| `window.cascade` | Shift+Alt+C | Cascade | Actual key handler → expected layout API method/argument (method mocked); layout geometry requires separate evidence. | Browser verified: Shift+Alt+C rendered four floating charts above the Toolbox. |
| `window.tile-horizontal` | Shift+Alt+H | Tile Horizontally | Actual key handler → expected layout API method/argument (method mocked); layout geometry requires separate evidence. | Browser verified: menu action and Shift+Alt+H both rendered four rows. |
| `window.tile-vertical` | Shift+Alt+V | Tile Vertically | Actual key handler → expected layout API method/argument (method mocked); layout geometry requires separate evidence. | Browser verified: Shift+Alt+V rendered four columns. |
| `window.arrange-icons` | Shift+Alt+M | Arrange Icons — When floating windows are minimized | Actual key handler → expected layout API method/argument (method mocked); layout geometry requires separate evidence. | Browser verified: minimized chart titlebar arranged above the Toolbox by Shift+Alt+M; disabled menu state checked before minimizing. |
| `window.undo` | Shift+Alt+Z | Undo layout | Key routing and actual layout-history consumer verified: four-chart grid → columns → undo → redo; chart properties preserved. | Browser verified: Shift+Alt+Z restored the previous three-chart grid from columns; all chart IDs retained. |
| `window.redo` | Shift+Alt+Y | Redo layout | Key routing and actual layout-history consumer verified: four-chart grid → columns → undo → redo; chart properties preserved. | Browser verified: Shift+Alt+Y restored three columns after undo; all chart IDs retained. |
| `window.reset` | Shift+Alt+R | Reset Windows | Actual key handler → shared reset action. Updated component regression verifies six panes become exactly one active chart, retaining its DOM and draft; old arrangement undo steps are cleared. | Browser verified: toolbar Reset Layout reduced two AAPL.US panes to one. Ctrl+Alt+N added a second pane, then Shift+Alt+R returned to one. Final screenshot confirmed the single-chart workspace. |
| `file.print-preview` | Ctrl+Shift+P | Print Preview | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Browser verified: Ctrl+Shift+P opened a rendered ADAUSD M5 preview; screenshot visually checked. Native printing not invoked. |
| `file.save-picture` | Ctrl+Shift+S | Save as Picture | Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate. | Not exercised in this pass |
| `drawing.select-all` | Ctrl+A | Select all drawings | Actual key handler → drawingManager.selectAll with active context (method mocked). | Not exercised in this pass |
| `drawing.trendline` | T | Select Trendline Tool | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.hline` | H | Select Horizontal Line Tool | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.vline` | V | Select Vertical Line Tool | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.text` | X | Select Text Tool | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.rail.trendline` | Alt+T | Trend Line | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.rail.horizontal_line` | Alt+H | Horizontal Line | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.rail.horizontal_ray` | Alt+J | Horizontal Ray | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.rail.vertical_line` | Alt+V | Vertical Line | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.rail.crossline` | Alt+C | Cross Line | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.rail.fibonacci` | Alt+F | Fib Retracement | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
| `drawing.rail.text` | Alt+X | Text | Actual key handler → scoped chart command and corresponding toolbar state; renderer separate. | Not exercised in this pass |
<!-- GLOBAL_SHORTCUT_MATRIX_END -->

## Local bindings

These interactions are handled by their owning component rather than registered as global commands. Help describes their context explicitly. Last Symbol shortcuts are available while its panel is open; they are not restricted to focus inside that panel. Input fields, overlays, composition, repeat events, and extra modifier combinations are excluded by its trading handler.

| ID | Keys | Action and required context | Automated evidence | Browser result |
| --- | --- | --- | --- | --- |
| `local.print-preview` | Ctrl+P | Print while Print Preview owns focus and is ready | Handler verified in `PrintPreviewDialog.shortcuts.test.tsx`: loaded preview invokes the mocked print callback once with its preferences; loading/error and in-flight duplicate calls blocked; no global key bubbling | Native printer not exercised |
| `local.print-preview` | Cmd+P | Print while Print Preview owns focus and is ready | Same actual React handler assertions as Ctrl+P in `PrintPreviewDialog.shortcuts.test.tsx`; no native printing | Platform-specific; Windows session |
| `local.measure` | Shift+Drag | Measure on the chart when another drawing tool does not own the gesture | Consumer verified: `chartRuler.test.ts` passed in the broad regression run, covering Shift activation, drag completion, pointer ownership, and axes exclusion | Not exercised in this pass |
| `local.finish-drawing` | Enter | Finish an active path, polyline, or ghost feed on its chart | Consumer verified: `TradingChart.drawingLifecycle.test.ts` passed in the broad regression run, including Enter completion for ghost feed and committed path vertices | Not exercised in this pass |
| `local.save-annotation` | Ctrl+Enter | Save while editing an annotation | Handler verified in `AnnotationEditor.test.tsx`: inline and full editor; preserves multiline text and originating chart; save mocked at drawing manager boundary; no key bubbling | Not exercised in this pass |
| `local.save-annotation` | Cmd+Enter | Save while editing an annotation | Handler verified in `AnnotationEditor.test.tsx`: inline and full editor; same assertions as Ctrl+Enter | Platform-specific; Windows session |
| `local.save-table-cell` | Enter | Save the active table cell without moving to another cell | Handler verified in `AnnotationTableCellEditor.test.tsx`: exact changed cell, neighboring cells/style preserved, no navigation or key bubbling; drawing manager boundary mocked | Not exercised in this pass |
| `local.next-table-cell` | Tab | Save and move to the next cell while editing a table cell | Handler verified in `AnnotationTableCellEditor.test.tsx`: 2×2 table moves from row 2/column 1 to row 2/column 2; save and navigation boundary mocked | Not exercised in this pass |
| `local.previous-table-cell` | Shift+Tab | Save and move to the previous cell while editing a table cell | Handler verified in `AnnotationTableCellEditor.test.tsx`: 2×2 table moves from row 2/column 1 to row 1/column 2; save and navigation boundary mocked | Not exercised in this pass |
| `local.quick-buy` | Shift+B | Buy the Last Symbol while that panel is open | Handler verified in `LastSymbolPanel.orderTransport.test.tsx`: four broker fixtures, exact symbols, actual handler into mocked `api.orders.placeMarketOrder`; account 900001 is a test fixture | Not exercised; no live order submitted |
| `local.quick-sell` | Shift+S | Sell the Last Symbol while that panel is open | Handler verified in `LastSymbolPanel.orderTransport.test.tsx`: four broker fixtures, exact symbols, actual handler into mocked `api.orders.placeMarketOrder`; account 900001 is a test fixture | Not exercised; no live order submitted |
| `local.quick-close` | Shift+X | Close positions for the Last Symbol while that panel is open | Handler verified in `LastSymbolPanel.orderTransport.test.tsx`: four broker fixtures, actual handler into mocked `api.positions.closePosition`; no network request | Not exercised; no live position closed |

## Window layout browser observations

The browser audit observed four open charts through the following sequence:

- Application menu → RTX5 Terminal → Window layout → Tile Horizontally produced four rows; Shift+Alt+H independently produced the same four-row layout.
- Shift+Alt+V produced four columns; Shift+Alt+C produced four floating charts with titlebars. Every floating-chart bottom was at or above y=431 while the Toolbox started at y=453.98.
- Minimizing one chart reduced its height from 298 to 30 pixels while its chart subtree remained mounted. Shift+Alt+M positioned the minimized titlebar at x=512.86, y=415.98, width=240, height=30, above the Toolbox.
- Restore followed by Alt+R produced a 2×2 chart grid. The earlier Shift+Alt+R behavior preserved all four chart IDs; this has since been replaced by the requested single-chart reset verified in the table above.
- Resolution was disabled, and Arrange Icons was disabled before a floating chart was minimized.

These are browser-visible layout observations. The automated matrix separately verifies the associated key-to-layout-method routing.

The final undo/redo check used three charts after a development reload: ADAUSD M5, XAUUSD M1, and BTCUSD M1. Alt+R produced a grid with the first chart at x=427, y=42, height=596 and the other two at x=1174, y=42/341, height=297. Shift+Alt+V produced three columns at x=427/925/1423, y=42. Shift+Alt+Z restored the grid; Shift+Alt+Y restored the columns. All three chart IDs were retained throughout. Alt+R left the terminal in its final grid layout.

Layout undo/redo now uses actual history capped at 30 entries, preserves chart properties, and clears history when panels or accounts change. The consumer tests independently exercise a four-chart grid → columns → undo → redo sequence.

F1 opened the full help dialog with 89 shortcuts and the contextual Arrange Icons description. All nine timeframe key combinations changed the active ADAUSD chart's label and toolbar checked state to M1/M5/M15/M30/H1/H4/D1/W1/MN; the other three chart IDs and timeframes were unchanged. The active chart was restored to M1. Shift+Alt+T toggled all four ADAUSD views together because one-click visibility is a symbol-scoped preference; a second toggle restored the original state.

Ctrl+Shift+P opened a rendered ADAUSD M5 print preview whose chart screenshot was visually checked; no native print was requested. F8 opened Chart Properties for ADAUSD M1. Alt+1/3/0/2 selected the expected chart-type toolbar radios; screenshots separately confirmed Line and Candlesticks rendering. Pointer focus alone correctly changed toolbar selection from the first Line/M5 chart to a second Candlesticks/M1 chart and back, without changing either chart's type; Alt+2 restored the first chart to candles.

For Alt+S, the matrix verifies the callback receives the exact active chart symbol. The source path is `GlobalShortcuts` → `App.handleQuickSell(requestedSymbol)` → the existing `placeOrder('SELL', targetSymbol)` flow, retaining its eligibility and account checks. This is callback verification plus source inspection, not a mocked transport test or live order. The Shift+B/S/X rows use the separate Last Symbol handler tests with mocked broker APIs.

## Local help and translation checks

`ShortcutHelpDialog.test.tsx` verifies the precise Last Symbol context, both annotation save modifiers, table commit/navigation distinctions, and the minimized-window context required for Arrange Icons. It also verifies that typing `Ctrl+Enter`, `Cmd+Enter`, or `Shift+Tab` finds commands whose displayed keycaps use symbols. Local entries do not register new executable global shortcuts.

All 20 unique presentation labels used by the 12 local entries are present in all 19 supported UI catalogs. The seven new local labels and three new Window labels were translated in all 19 languages; no key bindings or API contracts changed.

The annotation editor and table-cell editor tests execute their actual React keyboard handlers with the drawing manager update/navigation boundaries mocked. This verifies invocation, arguments, context, and event ownership, not reload persistence or browser input delivery.

The final focused run passed **3 suites and 40 tests**:

```powershell
npx vitest run src/components/ShortcutHelpDialog.test.tsx src/drawing-tools/AnnotationEditor.test.tsx src/drawing-tools/AnnotationTableCellEditor.test.tsx --reporter=dot
```

The earlier recorded matrix run executed 77 registered bindings across four broker fixtures (308 key invocations) and 72 scoped timeframe changes across four brokers, two charts, and nine timeframes. It checked invalid/stale targets, Alt+S dialog/menu suppression, hydration without command rebroadcast, per-panel type/timeframe display on focus changes, and selector clicks producing one scoped command. Mocked Last Symbol transport tests cover all four broker fixtures. The exact per-binding limitations are recorded above.

The additional `PrintPreviewDialog.shortcuts.test.tsx` suite passed **5 tests**, exercising Ctrl/Cmd+P against the actual focused preview handler. This exposed and fixed a mismatch where a supplied error disabled the button but did not prevent the shortcut from invoking the callback. The handler now follows the same disabled state; generated preview HTML and the print callback are mocked, so no native print dialog was opened by these tests.

## Add chart and desktop extension

Ctrl+Alt+N is shared by the web terminal and Electron renderer. It adds one chart using the active chart's symbol, timeframe, and chart type, subject to the six-chart limit. The toolbar remains available when no charts are open. `DesktopWindowShell.chartParity.test.tsx` checks the real toolbar's empty/capped states and event ownership in both renderer compositions; dock manager/store tests exercise the actual add operation and cap independently.

The shared drawing rail and its seven Alt drawing shortcuts are now enabled in Electron as well as the browser. Its full emoji/sticker/icon picker is available inside the existing desktop shell. The desktop composition test and focused Electron Alt+T rail test check active-chart command targeting without invoking native window actions. These are renderer tests with a mocked Electron bridge, not native desktop visual verification.

All nine new chart action labels are present in all 19 UI catalogs with matching interpolation tokens. See `MULTI_CHART_LAYOUT.md` for the chart controls and test boundaries. The earlier browser F1 observation of 89 entries remains historical; the current registry-derived count is 90.

## Earlier shortcut audit validation runs

These runs overlap; their test counts must not be added together.

| Scope | Result |
| --- | --- |
| Broad regression coverage, including `chartRuler` and `TradingChart.drawingLifecycle` | 19 suites / 538 tests passed. The remaining MenuBar suite's stale mocks were corrected and verified below. |
| Consolidated shortcut/menu/print/active-chart checks | 7 suites / 58 tests passed, including the corrected 22-test MenuBar suite and the 5-test Print Preview shortcut suite. |
| Final chart-type regression: mounted matrix, toolbar contract, and dialogs | 3 suites / 27 tests passed: matrix 11, toolbar contract 1, dialogs 15. |
| Local help and annotation/table handlers | 3 suites / 40 tests passed. |
| Layout history consumers | 3 suites / 26 tests passed, including four-chart grid → columns → undo → redo. |
| File menu and shared shortcut hints | 29 tests passed; Close uses Shift+Alt+Q, Save as Picture uses Ctrl+Shift+S, and Print Preview uses Ctrl+Shift+P. |
| Final production web build | `npm run build:web` passed after all production changes. Log: `tmp/shortcut-final-build.log`. Existing chunk-size and mixed-import warnings remain. |

Bindings without browser evidence remain explicitly labeled in the tables. Native printing and live trading were not performed.
