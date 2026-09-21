# Code cleanup - 2026-09-21

This cleanup removes confirmed unused implementations while preserving the web and Electron entry points and the work already present in this checkout. The earlier CODEBASE_AUDIT_REPORT.md is a historical snapshot; this document records the subsequent removals.

## What changed

- Removed 103 unused source, stylesheet, and obsolete test files (37,867 lines). Removed the inactive Tailwind configuration separately.
- Removed the old Toolbox tree. The active toolbox remains DockWorkspace -> BottomDock.
- Removed old dashboards, workspace management, disconnected AI/chart/trade/analytics screens, their private styles, and exclusive supporting stores/hooks. Active workspace saving uses SaveWorkspaceDialog -> localWorkspaceProfiles. Active chart templates use useTemplateStore.
- Replaced duplicate quote-field readers in FIX, quote, and enhanced WebSocket transports with src/utils/recordFields.ts. Alias order, numeric coercion, missing-value behavior, and record precedence are preserved.
- Reused the canonical timeframe duration map from timeframeBoundary.ts in periodSeparators.ts and marketClosedGaps.ts. The nine duration values and case/unknown-input handling are unchanged.
- Removed unused private retry/delay helpers from historyClient.ts, unused toolbar button implementations/imports, and unused socket constants/properties. Updated obsolete hook references in accountSocketManager comments.
- Removed six direct packages: axios, install, autoprefixer, happy-dom, lodash-es, and @types/lodash-es. The lockfile loses 15 package nodes; retained package versions are unchanged. Installed node_modules was not modified by the lock-only operations.

## How removals were selected

The audit traced static imports, re-exports, literal dynamic imports, type imports, and worker URLs from main.tsx and the desktop WelcomeTerminal alias. Candidates were checked against tests, scripts, HTML, configuration, and plain source references. Locale and SVG import globs were reviewed separately. Files deleted wholesale were tracked and unchanged when removed.

Examples, demonstrations, public barrels, tested optional libraries, profiling support, runtime configuration, deployment scripts, and shared theme layers were retained. An absent application-entry import alone was not treated as proof that these files were disposable. This is not a claim that every remaining unused declaration or potential duplication has been eliminated.

## Validation

| Check | Result |
| --- | --- |
| Web production build, including TypeScript project checks | Passed |
| Electron production renderer build, including TypeScript project checks | Passed |
| Final import graph | 817 code files scanned; zero unresolved imports |
| Fresh Vitest file discovery | 336 files; removed PositionsPanel test absent |
| Directly relevant regression tests | 160 assertions passed across 12 files |
| Docker runtime configuration retry | All 11 assertions passed |
| Desktop startup and editor-preview script tests | All 22 tests passed |
| ESLint for shared parsers, parser tests, and timeframe consumers | Passed |
| Manifest/lock consistency and cleanup diff whitespace | Passed |

The broad Vitest run completed with 3,990 passing and 25 failing assertions. It began before all deletions finished, so it also recorded one obsolete PositionsPanel test file that had already been discovered and was then removed. That collection artifact has no assertions. The 12 directly relevant parser, socket, timeframe, history, and toolbar suites passed all 160 assertions.

Nine failing suites (22 assertions) were already recorded as failed in the pre-cleanup Vitest cache. That proves previous suite-level failures, not an exact before/after comparison of every assertion:

- GlobalShortcuts.matrix: seven radio-state/command-payload mismatches.
- useQuoteSubscription: five subscription expectations with unauthenticated fixtures; the modified socket manager is mocked.
- TradingChart.drawingLifecycle: two absent volume-profile cursor labels and an Arc logical-index mismatch. Its effective drawing/source dependency closure has no cleanup changes.
- DesktopWindowShell.chartParity: two missing Add chart action expectations. The removed toolbar helpers had no callers.
- productionHardcoding, locales/catalogs, bottomDockNavigation, TradingChart.chartMenuRuntime.contract, and TradingChart.forecastingMeasurement.contract: one failure each, concerning existing drawing constants, untranslated messages, M5 versus the M1 default, and chart input-handler source assertions.

The three additional assertion failures were investigated against the saved pre-cleanup source:

- Docker runtime configuration exceeded a Git Bash subprocess timeout. Its isolated retry passed all 11 tests.
- drawingInteractionPriority expects two overlay children, while the pre-cleanup chart already appends three: line, badge, and drag overlay.
- useClosedMarketDailyChanges uses a September 4 fixture that is 17 days old on September 21 and is rejected by the unchanged 14-day cache expiry.

Fresh test discovery resolves the obsolete PositionsPanel collection artifact. The broad suite has not been reported as green. No authenticated browser, installed Electron, or installer packaging validation is claimed.

Build outputs are isolated under the local audit directory below, leaving the existing dist directory intact. Vite's large-chunk warnings are non-fatal.

## Review and recovery

Exact pre-edit copies, deletion SHA256 hashes, import reports, test JSON, and build logs are saved locally under:

`C:/Users/ADMIN/AppData/Local/Temp/rtx-code-cleanup-20260921/`

The deletion manifest is unused-deletion-manifest.json; removed files are in agent-unused-before with their original relative paths. Other original files are in agent-duplicate-before, agent-tooling-before, and root-before. The initial working-tree diff is baseline.patch. These are local review/recovery artifacts, not deployment files.

## Removed files

- src/components/Toolbox.tsx
- src/components/AlertManager.tsx
- src/components/MarketSessions.tsx
- src/components/CorrelationMatrix.tsx
- src/components/PositionsPanel.tsx
- src/components/StrategyTester.tsx
- src/store/useBacktestStore.ts
- src/components/TradingSignals.tsx
- src/store/useSignalStore.ts
- src/components/RiskHeatmap.tsx
- src/components/SentimentAnalysis.tsx
- src/store/useSentimentStore.ts
- src/components/SymbolScreener.tsx
- src/store/useScreenerStore.ts
- src/components/MultiTimeframeAnalysis.tsx
- src/components/PnLCalendar.tsx
- src/components/DrawingTools.tsx
- src/store/useDrawingStore.ts
- src/components/TradeAnalytics.tsx
- src/components/AdvancedOrders.tsx
- src/store/useAdvancedOrdersStore.ts
- src/components/MarketReplay.tsx
- src/components/CopyTradingLeaderboard.tsx
- src/components/NewsImpactAnalyzer.tsx
- src/components/PositionSizeCalculator.tsx
- src/store/usePositionSizeStore.ts
- src/components/EquityCurveTracker.tsx
- src/store/useEquityCurveStore.ts
- src/components/VolatilityAnalyzer.tsx
- src/store/useVolatilityStore.ts
- src/components/CurrencyConverter.tsx
- src/store/useCurrencyStore.ts
- src/components/TradeJournalV2.tsx
- src/store/useTradeJournalStore.ts
- src/components/SessionHeatMap.tsx
- src/store/useSessionMapStore.ts
- src/components/RiskExposurePanel.tsx
- src/store/useRiskExposureStore.ts
- src/components/OrderFlowVisualizer.tsx
- src/store/useOrderFlowStore.ts
- src/components/MarketProfile.tsx
- src/store/useMarketProfileStore.ts
- src/components/TradingSimulator.tsx
- src/store/useTradingSimStore.ts
- src/components/WorkspaceManager.tsx
- src/hooks/useWorkspace.ts
- src/services/workspaceManager.ts
- src/types/workspace.ts
- src/services/workspaceApi.ts
- src/components/PositionsPanel.symbolIdentity.test.ts
- src/pages/TradingPage.tsx
- src/components/ProfessionalTradingDashboard.tsx
- src/components/ProfessionalTradingDashboard.css
- src/components/MetaTraderDashboard.tsx
- src/components/MetaTraderDashboard.css
- src/components/AIChartAnalysisPage.tsx
- src/components/ChartImageUpload.tsx
- src/components/LiveForexChart.tsx
- src/components/BootstrapLoader.tsx
- src/components/ChartLoginPlaceholder.tsx
- src/components/ChartTemplateManager.tsx
- src/components/ChartTabs.tsx
- src/components/dialogs/ColorPickerDialog.tsx
- src/components/dialogs/DataFolderExplorer.tsx
- src/services/dataFolderManager.ts
- src/components/EconomicCalendar.tsx
- src/components/FixApiChart.tsx
- src/components/charts/CandlestickChart.tsx
- src/hooks/useFixMarketData.ts
- src/components/MultiAccountManager.tsx
- src/components/NewsFeed.tsx
- src/store/useNewsStore.ts
- src/components/notifications/NotificationBadge.tsx
- src/components/notifications/NotificationCenter.tsx
- src/components/OHLCDataWindow.tsx
- src/components/OHLCTerminalView.tsx
- src/components/PerformanceAnalytics.tsx
- src/components/PipCalculator.tsx
- src/components/PortfolioOverview.tsx
- src/components/QuickTradeWidget.tsx
- src/components/RoutingIndicator.tsx
- src/components/RoutingIndicator.types.ts
- src/components/ShortcutHint.tsx
- src/components/SplitText.tsx
- src/components/TradePanel.tsx
- src/components/ui/SubmenuItem.tsx
- src/components/WatchlistManager.tsx
- src/components/AnalyticsDashboard.tsx
- src/components/AlertRulesManager.tsx
- src/components/RuleEffectivenessDashboard.tsx
- src/components/AIChartAnalysisPage.css
- src/components/ChartImageUpload.css
- src/components/LiveForexChart.css
- src/helpers/menuData.tsx
- src/hooks/useCanvasSelection.ts
- src/hooks/useChartExport.ts
- src/hooks/useConnectionHealth.ts
- src/hooks/usePositionsState.ts
- src/hooks/useLiveAccountState.ts
- src/services/bootstrapApp.ts
- src/services/chartAnalysisService.ts
- src/store/useChartTemplateStore.ts
- src/store/useNewsImpactStore.ts
- tailwind.config.js
