# Chart windows in web and desktop

Use **Add chart** in the chart toolbar or Window menu, or press **Ctrl+Alt+N**, to add one chart at a time. The new chart starts with the active chart's symbol, timeframe, and chart type. Existing charts keep their own settings. Up to six charts may be open, including minimized and floating charts.

Click the intended chart, then select a symbol in **Market Watch** or its symbol search. Only that pane changes, retaining its timeframe and chart type. Moving the pointer over neighboring panes does not change the selection. This works even when the symbol is already open elsewhere or all six slots are occupied. Use **Add chart** to create another independent pane.

**Reset Layout / Reset Windows** (toolbar, Window menu, or **Shift+Alt+R**) restores the standard workspace with exactly one chart. It keeps the active chart's symbol, timeframe, and local state, closes the other chart panes, and restores the remaining chart if minimized. If all charts are closed, Reset creates one default chart. Closed chart configurations remain available through **Open Deleted**; old arrangement undo steps are cleared.

Every chart has a header:

- Select its symbol to choose another authorized broker instrument for that chart. Its timeframe and chart type stay the same.
- Select **Minimize** to collapse the chart while retaining its state. Select **Restore** to expand it again.
- Select **Close** to remove that chart and free one of the six slots.

Adding, closing, tiling, and cascading move the existing chart contents without recreating surviving charts. Their local drawings, viewport, and lot input remain mounted. A temporary or incomplete broker symbol feed cannot overwrite saved chart selections during startup.

Use the global timeframe and chart-type controls after activating the intended chart. Each chart's one-click trade controls use that chart's instrument and lot size. In narrow panes, Buy/Sell and lot controls rearrange to stay accessible.

Older seven- or eight-chart layouts are reduced to six, retaining selected tabs. Extra chart configurations are available in **Open Deleted** during the session; close a chart to free a slot before restoring one. Before updating a saved layout, the original full layout is backed up under `dock-layout-six-chart-backup-v1:<layout-storage-key>`.

The Electron desktop app uses the same login, chart windows, limit, Market Watch selection, symbol picker, trading controls, keyboard commands, and drawing toolbar. The complete drawing toolbar is horizontal above the desktop workspace and vertical on the web terminal's left side. It includes the full emoji, sticker, and icon picker, drawing selection controls, and the same drawing shortcuts. The desktop's native title bar, menu and command rows, account/connection controls, and saved sidebar/Toolbox arrangement remain available. Its View menu controls drawing-toolbar visibility, and Charts includes Color Templates. Chart Minimize and Close buttons act on their chart, independently of the native window controls.

The Add chart button remains available when all charts have been closed. At six open charts it is disabled and shows the chart limit. The same limit also applies to the Window menu and keyboard action. All nine new chart action labels, including symbol names and chart counts, are translated in the 19 supported interface languages.

## Verification boundaries

| Coverage | Automated fixtures |
| --- | --- |
| Shared web and desktop composition | `DesktopWindowShell.chartParity.test.tsx` mounts the real shell, toolbar, dock container, and drawing rail with a mocked native window bridge and stateful chart content. It checks per-chart actions, retained chart content, empty/capped Add chart states, drawing shortcut targeting, and the bundled picker. |
| Native shell and drawing availability | `DesktopWindowShell.test.tsx`, `TopToolbar.desktopQuickActions.contract.test.ts`, and `drawing-tools/runtime.test.ts` verify the native chrome boundary and shared drawing availability for browser, preload bridge, legacy Electron bridge, file protocol, and Electron user-agent signals. |
| Chart creation and limits | Dock manager/store tests exercise one-at-a-time additions, the six-chart cap, migration of older seven/eight-chart layouts, and restoration without discarding blocked records. |
| Chart state across arrangements | `StableChartHosts.test.tsx` asserts the same DOM element, React state, and active source through additions, tiling, cascading, floating, minimizing, restoring, and closing neighboring charts. |
| Instrument and trade targeting | `chartPanelNavigation.test.ts`, `SymbolsDialog.openChart.test.tsx`, and `OneClickTrading.multiChart.test.tsx` check explicit chart targets, broker instruments, independent symbols/lots, and narrow chart controls. |

These component tests use local chart fixtures or mocked API transports; they do not place live orders. A mocked Electron bridge establishes renderer composition and event ownership, not a native Electron visual smoke test. Earlier browser shortcut observations are recorded separately in `SHORTCUT_VERIFICATION.md`.

The current focused regression run passed 14 suites / 267 tests, including Market Watch selection, six-chart limits and migration, reset, desktop/web composition, menus, and drawing toolbar orientation. Navigation tests target each of six panes in grid, horizontal, vertical, and cascade arrangements without changing sibling settings. Browser verification confirmed that selecting XAUUSD after clicking the lower-right pane changed only that pane; clicking the left pane and selecting the same symbol then changed only the left pane, preserving the three-chart count in both cases. In both checks the pointer crossed another pane before reaching Market Watch.

The final drawing/authentication/trade regression run passed 8 suites / 505 tests (overlapping the earlier run). It verifies drawing-tool handoff to a clicked sibling before the first drawing point, chart interaction priority, shared login handoff, desktop composition, and per-chart one-click order payloads using mocked transport. Browser checks also retained H1 while changing the left pane to BTCUSD, reached exactly six panes, rejected a seventh keyboard add, and changed only the sixth vertical pane to JPN225/H1. Alt+R restored the six-pane grid afterward. No live orders were submitted.

Build the web application with `npm run build:web` and the desktop renderer with `npm run build:electron`. Package a local Windows installer with `npx electron-builder --win --publish never`; its output is `draft/RTX.Terminal.Setup.1.0.24.exe`. Publishing a release is a separate step.

The Windows x64 installer was built successfully from this source on September 10, 2026. Install that local build to use the updated desktop interface; it has not been published as an automatic update.
