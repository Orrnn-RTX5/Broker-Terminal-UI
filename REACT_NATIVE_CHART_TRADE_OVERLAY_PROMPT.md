# Implement the chart position controls in the React Native mobile app

Implement and test the active-position chart overlay highlighted in the supplied RTX5 desktop/web screenshot. Deliver working mobile behavior, not only a design or recommendations.

This prompt is stored in the Web Terminal project root. The implementation target is the React Native project, currently `C:/Users/ADMIN/RTX-5Mobile-App/rtx5-app`. Confirm the target checkout and read its applicable repository instructions before editing. Preserve existing user changes. Do not commit, push, publish, submit, deploy, or trigger EAS/OTA release workflows without approval.

## Scope and visual reference

The highlighted feature is an open position's horizontal entry-price line with a compact action strip on its left, a corresponding outlined price badge on the right price axis, and a separate execution arrow on the chart. The yellow annotation is only a screenshot marker; do not implement it.

The web strip has this order:

`Share | Double | Reverse | TP | SL | BUY/SELL + lots | live P/L + account currency | Close`

TP/SL shortcuts are available when the corresponding protection is missing. Existing protection levels have their own lines and modification controls. The entry price is the broker's executed price and must never be edited by dragging this overlay.

Use the current web implementation as a behavior reference, not as code to paste into a native component. Inspect these files in the Web Terminal checkout:

- `src/utils/chartTradeControls.ts`: `createEntryTradeControlBar`, icons, layout, money formatting and action dispatch.
- `src/features/trading-chart/runtime/createTradeOverlayDomRuntime.ts`: entry strip, TP/SL shortcuts and right-axis price badges. Locate the file if this reference has moved.
- `src/features/trading-chart/runtime/useTradingChartTradeRuntime.ts` and `useTradingChartTradeOverlayRenderer.ts`: price/time projection, live position ownership, retention and geometry repainting.
- `src/features/trading-chart/runtime/useTradingChartTradeLevelDrag.ts`: creating and modifying protection levels.
- `src/App.tsx`: the actual Close, Double and Reverse execution semantics.
- `src/utils/tradeShareLink.ts`: share payload fields; do not copy its preservation of page query parameters into a public share URL.

Work primarily on this highlighted feature. Keep candle rendering, indicators, drawing tools, trading tickets, navigation and backend contracts intact. Adapt chart motion to mobile pan/pinch gestures; do not paste desktop mouse-wheel event handling into React Native.

## Reuse the mobile implementation

First trace the current renderer, payload, live-update bridge and mutation ownership. The paths below existed when this prompt was prepared; verify them against the target checkout:

- `src/features/chart/ChartScreen.native.tsx`: chart host, WebView messages, active chart/session and native action handoff.
- `src/features/chart/rendering/ChartWebViewHtml.ts`: existing chart renderer and DOM overlay geometry.
- `src/features/chart/chartOverlays/buildPayload.ts`, `types.ts`, `symbolUtils.ts`, `tradeHistory.ts`, and `positionStopDragKeys.ts`: overlay identity, position data, markers and protection keys.
- `src/features/chart/components/ChartTradeOverlayLiveBridge.tsx`: live overlay values.
- `src/features/chart/preview/LiveChartPreview.native.tsx`, `preview/liveChartPreviewTradeOverlayScript.ts`, and `auxiliaryChartTradeOverlays.ts`: divided/auxiliary chart panes.
- `src/features/trade/tradePositionActionHostController.ts`, `closePositionFlow.ts`, `modifyPositionCoordinator.ts`, `modifyPositionCoordinatorCore.ts`, and `modifyPositionSessionKey.ts`: existing native close/modify flow and reconciliation.
- `src/features/chart/components/ChartTradeButtonsFeature/useTradeHandler.ts`, `chartTradeDispatch.ts`, and `src/query/orders.ts`: existing order entry/execution path.
- `src/state/activeBrokerSession.ts`, `src/features/chart/exactChartQuote.ts`, `src/market/quoteIntegrity.ts`, and the existing `tradeBackendCapabilities.ts`: session provenance, quote freshness and broker capabilities.
- `src/ui/theme/useTheme.ts` and the existing theme/surface helpers: colors and appearance. Use the installed professional outline icon system, including `@expo/vector-icons`, rather than improvised text glyphs or a new icon dependency.

Extend the existing WebView/native bridge and chart overlays. Do not introduce a replacement chart engine, a second positions store, or a separate trading API client. Share presentation/action logic across the primary and auxiliary panes where practical. Keep helpers focused rather than growing a second monolithic implementation inside the HTML string.

## Data, broker and position identity

1. Bind every actionable overlay to the exact broker identity, account/session epoch, position ticket, backend symbol identity, chart pane and renderer generation. Preserve opaque broker suffixes and instrument identifiers.
2. The current `normalizeChartOverlaySymbol()` strips suffixes and truncates symbols. Audit and correct its use for actionable overlays so instruments such as `XAUUSD`, `XAUUSDm`, and `XAUUSD.r` cannot select or act on each other's positions. Do not silently use the first position with a similar symbol. Cosmetic names may differ from canonical execution identity, but must not drive trading mutations.
3. Obtain side, filled volume, entry price, entry time, SL and TP from authoritative position data. Respect instrument digits, tick size and volume step. Do not hardcode screenshot tickets, prices, symbols, lots, currencies or broker values.
4. Remove the hardcoded `USD` suffix from affected overlay payload formatting. Display the active account currency from backend/account metadata. If it is unknown, show an unavailable state rather than guessing USD.
5. Prefer authoritative live account-currency P/L. Do not label an unconverted quote-currency estimate as account-currency P/L. If estimates are needed, use only established contract/conversion metadata, label them explicitly, and preserve quote integrity. For mark-price calculations, BUY closes against bid and SELL against ask.
6. Positive P/L uses the same semantic blue as the terminal's positive market values, negative P/L uses the existing loss red, and zero uses neutral text. Use theme tokens and support light/dark themes. Updates must not blink, flash row backgrounds, or change control geometry.
7. Preserve controls during a verified temporary position-refresh gap, with stale/retained controls inert. Remove the active overlay after a confirmed close. Keep historical execution markers according to the existing trade-history setting; do not remove history merely because a position closed.
8. All brokers use configured discovery/session/backend contracts. Add no broker-specific hostname, ID, credentials, symbol exception or fallback. Preserve authentication, TLS, quote freshness checks, backend authorization and broker capability gates.

## Geometry and smooth mobile gestures

- Anchor the entry line and its right-axis badge at `series.priceToCoordinate(authoritativeEntryPrice)`. Place an execution marker using the established price/time projection and candle high/low convention. The price badge contains the formatted price, not an execution arrow.
- Reproject after pan, pinch/time zoom, right-price-axis stretch, time-range changes, candle updates, layout/viewport resize, orientation change and pane activation. Never persist a screen Y coordinate as the position's price.
- The current collision layout can move the entry connector/axis badge to a displaced label lane. Correct that behavior: entry lines, axis badges and execution anchors stay at the real price. Move only the label/capsule when needed and use a small connector to its true anchor. Do not alter the data or stretch the price scale to make labels fit.
- Keep badges inside the price-axis bounds and clip markers to the plot. Hide out-of-range price overlays rather than pinning them to the top or bottom at an incorrect price.
- Coalesce geometry updates to one animation frame and reuse keyed overlay nodes. Avoid React state changes and native/WebView round trips for every pointer movement. Skip drawing/overlay work when the pane is hidden or has no content.
- Pan and pinch should remain continuous while positions/P/L update. Preserve manual price-scale settings, drawing locks, stop-drag ownership, and chart history loading rules. Cancel queued work on context/generation changes, blur/background, unmount, and competing gestures; reject stale callbacks.
- Handle multiple nearby positions and identical entry prices without changing which ticket an action targets. Maintain a stable label order and selection treatment. Cover all supported symbols/timeframes through shared logic, not per-instrument patches.

## Controls and execution behavior

Implement professional outline icons, clear accessibility labels, compact spacing and mobile-safe hit areas. Keep controls readable at font scaling and on small portrait screens. If the full strip cannot fit, keep side/lots/P/L, Close and protection access visible and put secondary actions in the existing compact native action sheet. Every action remains discoverable. Use the same surface/theme family as the mobile Trade area.

- **Share:** open the native share/copy flow for a safe trade summary or a supported public trade link. Sharing never executes a trade. Include only permitted annotation fields such as exact symbol, timeframe, side, lots, entry and protection levels. Build public links from a clean configured origin; never copy session query parameters, credentials, access tokens or privileged account data into them. Verify the backend/deep-link contract before claiming a link works. Existing native text sharing is reusable; chart image capture was not found during preparation, so do not pretend screenshot sharing already exists or add it silently.
- **Double:** submit another same-side market order for the selected position's exact symbol and original volume through the existing native order flow. Respect the app's order-confirmation/one-click policy. Never just double displayed volume. Let the broker's netting/hedging behavior determine the authoritative result.
- **Reverse:** match the web meaning: close the selected ticket first, wait for confirmed success, then open an opposite-side market order for its original symbol/volume. This is sequential, not atomic. Do not describe merely opening an opposite hedge as Reverse. A failed close must prevent the new order. A failed new order after successful close must clearly report that the original position is closed; do not restore a fictitious position. Respect confirmation, capability and duplicate-submission rules at both stages and recheck session/position ownership after every await.
- **TP/SL:** reuse native Modify Position and protection-draft flows. A tap opens the correct ticket's modification UI. If drag editing is supported, preserve tick-grid, stop-distance and broker capability validation, explicit submit behavior and rollback. Dragging entry controls creates/modifies protection; it never modifies an already executed entry price. Removing an SL/TP closes only that protection, not the position.
- **Close:** close only the exact selected ticket through the existing native close flow. Prevent repeat submissions while pending, reconcile backend confirmation, and restore the pending visual state on rejection only if the original session/position is still current.

Taps on an icon must not start chart pan, pinch, entry drag or an order-sheet action twice. Native gestures must not swallow the controls. Gate any unsupported operation with the app's established capability/unavailable presentation.

## Bridge, updates and lifecycle

Use a typed, validated WebView-to-native action message with the minimum required position/chart identity and an action/request identity. Re-resolve the current position in the native owner before executing it. Reject malformed, stale-generation, wrong-account, wrong-broker, wrong-symbol, wrong-pane, or closed-ticket messages. Never execute trading HTTP requests directly from injected chart HTML and never expose authentication secrets to new bridge payloads.

The renderer currently patches P/L by assuming exactly three child spans and updating `childNodes[2]`. Adding buttons breaks that assumption. Replace affected positional patching with stable keyed/value selectors so live P/L updates cannot overwrite icons, volume, TP/SL or Close. Keep node identity and listeners stable across quotes, selection, theme changes and reconciliation.

Bind mutations, pending states, retries, errors, rollback, quote lookup and reconciliation to the captured broker/account session. Logout or switching accounts/brokers during a pending close/modify/reverse must not mutate the new account or use its credentials. Do not serialize automatic stale retries as new trades. Preserve existing idempotency and receipt behavior.

## Verification and acceptance

Add meaningful behavioral tests for action bridge validation, exact-ticket routing, suffix-distinct instruments, non-USD accounts, partial close/netting reconciliation, failed mutations, duplicate taps, reverse partial failure, session changes during awaits, stale WebView messages, price anchoring and keyed live-value updates. Test with multiple positions and auxiliary panes. Assert no stale or invalid action sends a broker request.

From the confirmed mobile app root, run the relevant available checks. These existing commands/paths were found during preparation; adjust only if the checkout has moved them:

```powershell
npm.cmd run typecheck
node scripts/run-tsx-cli.js --test tests/chart-webview/overlay-resync.test.ts tests/chart-webview/trade-marker-viewport.test.ts tests/chart-webview/trade-sheet-chart-interaction.test.ts tests/chart-webview/switching-contracts.test.ts src/features/chart/chartOverlays/tradeHistory.test.ts src/features/chart/exactChartQuote.test.ts src/features/trade/modifyPositionCoordinatorCore.test.ts src/features/trade/modifyPositionCoordinatorSession.test.ts src/api/positions/closePositionContract.test.ts src/features/chart/preview/liveChartPreviewTradeOverlayScript.test.ts
```

Also run tests for newly changed helpers/bridge code, and the repository's relevant stability checks. Use its actual native build/test tooling; do not use the web project's Vitest command for this mobile repository.

Verify on Android and iOS when available, in portrait and landscape: compact layout and hit areas; pan/pinch and price-scale stretch; price-badge/marker alignment; light/dark themes; missing/present SL/TP; multiple overlapping positions; same symbol in separate panes; account/broker/symbol/timeframe switching; background/foreground; stale messages; pending-state repeat taps; and backend rejection. Use mocks or an explicitly authorized demo test account for mutations. Do not place, reverse or close live positions just to demonstrate the UI.

Capture screenshots or a short recording for actual device/emulator verification if supported. Distinguish source/tests from device evidence, and report unavailable platforms or backend capabilities. Do not claim live trading, image sharing, every-symbol verification or exact TradingView frame-rate parity unless actually established.

Completion requires a working overlay with correct action meanings, authoritative data, true price anchors and stable live updates, while existing chart/trade flows keep working. Report files changed, test/build results, visual proof, remaining backend/platform limitations and any release steps that require approval.
