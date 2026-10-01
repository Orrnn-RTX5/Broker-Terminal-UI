import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRADING_VIEW_HANDLE_SCALE } from '../features/trading-chart/runtime/chartInteractionOptions';
import { TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS } from '../features/trading-chart/presentation/tradeOverlayPresentation';

// CRLF-normalized so anchors match on Windows checkouts too.
const readChartSource = (relativePath: string) => readFileSync(
  resolve(process.cwd(), relativePath),
  'utf8',
).replace(/\r\n/g, '\n');
const chartSource = [
  'src/components/TradingChart.tsx',
  'src/features/trading-chart/runtime/useTradingChartInitialization.ts',
  'src/features/trading-chart/runtime/useTradingChartReconfiguration.ts',
  'src/features/trading-chart/runtime/useTradingChartTradeRuntime.ts',
  'src/features/trading-chart/runtime/createTradeOverlayModelRuntime.ts',
  'src/features/trading-chart/runtime/createTradeOverlayDomRuntime.ts',
  'src/features/trading-chart/runtime/useTradingChartTradeOverlayRenderer.ts',
  'src/features/trading-chart/runtime/bindTradeOverlayRuntimeSubscriptions.ts',
  'src/features/trading-chart/runtime/useTradingChartTradeLevelDrag.ts',
  'src/features/trading-chart/runtime/tradeOverlayRuntimeConstants.ts',
].map(readChartSource).join('\n');
const closeHandlerSource = readChartSource('src/app/trading/createPositionCloseHandler.ts');
const appSource = readFileSync(
  resolve(process.cwd(), 'src/App.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const modifyDialogHostSource = readFileSync(
  resolve(process.cwd(), 'src/components/ChartModifyPositionDialogHost.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

const chartSection = (startText: string, endText: string) => {
  const start = chartSource.indexOf(startText);
  const end = chartSource.indexOf(endText, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return chartSource.slice(start, end);
};

describe('cTrader-style position controls contract', () => {
  it('replaces live-trade text labels with control bars in the active overlay', () => {
    expect(chartSource).toContain("labelVariant: showTradeControls ? 'none' : 'lineText'");
    expect(chartSource).toContain('createEntryControlsForTrade(');
    expect(chartSource).toContain("createLevelControlsForTrade(trade, 'SL', levels");
    expect(chartSource).toContain("createLevelControlsForTrade(trade, 'TP', levels");
    // Bars must survive transient live<->retained flaps of the positions feed:
    // controls render for retained trades too, so the UI never blinks while
    // the store refreshes. Retained bars are inert for dragging.
    expect(chartSource).toContain('const showTradeControls = isLiveActiveTrade || isVisuallyRetainedTrade;');
    expect(chartSource).toContain('activeTradeSnapshotsRef.current = renderActiveSnapshots;');
    expect(chartSource).toContain("window.addEventListener('rtx:new-trade-placed', handleNewTradePlaced);");
    expect(chartSource).toContain('if (showTradeControls) {');
    const retainedGuard = chartSource.indexOf('it is not draggable right now');
    expect(retainedGuard).toBeGreaterThan(-1);
    // The guard must sit before the pointer-down proximity fallback so an
    // inert retained badge can't hand the press to another trade's level.
    const proximityFallbackAfterGuard = chartSource.indexOf('findClosestTradeLevel(y, TRADE_LEVEL_HIT_AREA_PX / 2)', retainedGuard);
    expect(proximityFallbackAfterGuard).toBeGreaterThan(retainedGuard);
    // The 'none' variant must keep the entry line and drag hit-area intact.
    const noneGuard = chartSource.indexOf("if (options.labelVariant === 'none') return;");
    const hitAreaAppend = chartSource.indexOf("appendActiveInteractionNode(hitArea, { kind: 'price-hit-area', price });");
    expect(noneGuard).toBeGreaterThan(-1);
    expect(hitAreaAppend).toBeGreaterThan(-1);
    expect(hitAreaAppend).toBeLessThan(noneGuard);
  });

  it('uses the same inline entry controls and SL/TP shortcuts on web and desktop', () => {
    const entryControls = chartSection('const createEntryControlsForTrade =', 'const createLevelControlsForTrade =');
    expect(entryControls).not.toContain('isDesktopBackendTarget');
    expect(entryControls).toContain('plainLabel: true');
    expect(entryControls).toContain('createDockedLevelChip({');
    expect(entryControls).toContain('if (!(levels.sl > 0)) {');
    expect(entryControls).toContain('if (!(levels.tp > 0)) {');
    expect(entryControls).toContain("appendDockChip(slChip, 'SL');");
    expect(entryControls).toContain("appendDockChip(tpChip, 'TP');");
    expect(entryControls).toContain("label: 'SL'");
    expect(entryControls).toContain("label: 'TP'");
    expect(entryControls).not.toContain('dockSuffix');
    expect(entryControls).not.toContain('slDockOffset');
    // Controls stay at their actual price and above the line's drag target.
    expect(entryControls).toContain("appendActiveInteractionNode(controlBar.root, { kind: 'price-badge', price: trade.entryPrice });");
    expect(chartSource).toContain("appendOverlayNode(levelBar, { kind: 'price-badge', price: levelPrice }, 'active');");
    // Relayout must restore each node's own display mode — forcing 'block'
    // onto the flex control bars drops their buttons onto the text baseline.
    expect(chartSource).toContain("el.style.display = el.dataset.display || 'block';");
  });

  it('keeps outlined trade prices on exact axis coordinates on web and desktop', () => {
    const axisBadge = chartSection('const addTradeAxisPriceLine = (', 'const submitTradeLevelChange = (');
    expect(axisBadge).not.toContain('isDesktopBackendTarget');
    expect(axisBadge).not.toContain('createPriceLine');
    expect(axisBadge).toContain("badge.className = 'rtx-trade-axis-price-badge';");
    expect(axisBadge).toContain("appendActiveInteractionNode(badge, { kind: 'axis-price-badge', price });");
    expect(axisBadge).toContain('badge.textContent = seriesRef.current.priceFormatter().format(price);');
    expect(axisBadge).toContain('isChartSurfaceLight()');
    expect(chartSource).toContain("if (node.kind === 'axis-price-badge')");
    expect(chartSource).toContain('el.style.width = `${priceScaleWidth}px`;');
    expect(chartSource).toContain('snappedY + 10 > plotHeight');
    expect(chartSource).toContain('pointer-events:none;z-index:8;');
    expect(chartSource).toContain('addTradeAxisPriceLine(`${trade.key}:entry`, trade.entryPrice, getEntryLineColor(trade.side));');
    // Disable native collision shifting in both chart creation and hot apply.
    // Close prices then overlap at their real coordinate instead of forming a
    // misleading vertical stack when the visible price range is very wide.
    expect(chartSource.match(/alignLabels: false/g)).toHaveLength(2);
  });

  it('keeps control-bar buttons out of the capture-phase drag handler', () => {
    const guard = chartSource.indexOf("e.target.closest('.rtx-trade-control-btn')");
    const badgeLookup = chartSource.indexOf("e.target.closest('.rtx-trade-level-badge') as HTMLElement | null");
    expect(guard).toBeGreaterThan(-1);
    expect(badgeLookup).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(badgeLookup);
  });

  it('refreshes live Pips/USD chips inside the relayout frame', () => {
    expect(chartSource).toContain('tradeControlLiveUpdatersRef.current.push(refreshLiveMetrics);');
    expect(chartSource).toContain('for (const refreshTradeControlMetrics of tradeControlLiveUpdatersRef.current) {');
    // Cleared together with the active overlay layer.
    expect(chartSource).toContain('tradeControlLiveUpdatersRef.current = [];');
  });

  it('submits SL/TP removal through the optimistic modify flow', () => {
    expect(chartSource).toContain('const submitTradeLevelChange = (');
    expect(chartSource).toContain('const slRemovalPending = overrideSl <= 0 && serverSl > 0 && hasActiveModifyWindow;');
    expect(chartSource).toContain('const tpRemovalPending = overrideTp <= 0 && serverTp > 0 && hasActiveModifyWindow;');
    expect(chartSource).toContain("onRemove: () => submitTradeLevelChange(");
  });

  it('shows projected money without pips during SL/TP dragging on both platforms', () => {
    const preview = chartSection('const previewState = useAppStore.getState();', 'dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${drawY}px))`;');
    expect(preview).not.toContain('isDesktopBackendTarget');
    expect(preview).toContain('const previewMoney = estimateTradeLevelMoney({');
    expect(preview).not.toContain('previewPips');
    expect(preview).toContain("previewBadge.textContent = `${tr(role)} ${price.toFixed(digits)}  ${previewCurrency}: ${formatMoneyLabel(previewMoney)}`;");
    const dragOverlays = chartSection("dragLineOverlay = document.createElement('div');", 'const handlePointerMove = (e: PointerEvent) => {');
    expect(dragOverlays).not.toContain('isDesktopBackendTarget');
    expect(dragOverlays).toContain("dragZoneOverlay.className = 'rtx-trade-drag-zone';");
    expect(dragOverlays).toContain('overlayRef.current?.appendChild(dragZoneOverlay);');
    // The stale bar hides during the drag and is restored on release/cancel.
    expect(chartSource).toContain('hideDraggedLevelControls(closestTrade.key, grabbedType);');
    expect(chartSource.match(/restoreDraggedLevelControls\(\);/g)).toHaveLength(2);
  });

  it('supplies the same SL/TP hover details and interaction targets on both platforms', () => {
    const levelControls = chartSection('const createLevelControlsForTrade = (', 'const pruneCloseSuppressedTradeKeys = (');
    expect(levelControls).not.toContain('isDesktopBackendTarget');
    expect(levelControls).toContain('hoverDetails: {');
    expect(levelControls).toContain('entryPrice: trade.entryPrice');
    expect(levelControls).toContain('tickSize: getPricePointFromDigits(digits)');
    expect(levelControls).toContain("levelBar.setAttribute('aria-label', title);");
    expect(levelControls).toContain('bindTradeLevelHoverTarget(levelBar, node)');
    expect(levelControls).toContain('onHoverChange: active => {');
  });

  it('opens Modify Position only on an SL/TP double click without replacing drag-to-edit', () => {
    const pointerRelease = chartSection('const handlePointerUp = (e: PointerEvent) => {', 'const handlePointerCancel = () => {');
    expect(pointerRelease).toContain("const isLevelClick = grabbedType !== 'ENTRY'");
    expect(pointerRelease).toContain('hasChartTradeLevelGestureDragged(pointerDownY, y, dragState.didDrag)');
    expect(pointerRelease).toContain('const isDoubleLevelClick = lastLevelClick !== null');
    expect(pointerRelease).toContain('clickedAt - lastLevelClick.at <= CHART_LEVEL_MODIFY_DOUBLE_CLICK_MS');
    expect(pointerRelease).toContain('if (isDoubleLevelClick) {');
    expect(pointerRelease).toContain('dispatchChartPositionModify({');
    expect(pointerRelease).toContain('sessionScope: brokerAccountSessionScope');
    expect(pointerRelease).toContain('} else if (rawFinalPrice !== null) {');
    expect(pointerRelease).toContain('applyTradeLevelDragUpdate({');
    expect(pointerRelease).toContain('api.positions.modifyPosition(ticket, tradeLevelModifyPatch(update.role, update.price))');
  });

  it('never starts a trade-level gesture from UI overlaid on the chart', () => {
    const pointerPress = chartSection(
      'const handlePointerDown = (e: PointerEvent) => {\n      cancelQueuedTradeHover();',
      'const handlePointerUp = (e: PointerEvent) => {',
    );
    // The one-click BUY/SELL panel, menus, and popovers live inside the same
    // interaction root; only the chart surface and level controls may grab.
    expect(pointerPress).toContain("e.target.closest('.rtx-trade-controls, .rtx-trade-level-badge, .rtx-trade-level-hit-area, .rtx-trade-level-line')");
    expect(pointerPress).toContain('container.contains(e.target)');
  });

  it('scopes every chart level-modified event to its ticket and symbol owner', () => {
    const removalSubmit = chartSection('const submitTradeLevelChange = (', 'const createEntryControlsForTrade = (');
    const dragRelease = chartSection('const handlePointerUp = (e: PointerEvent) => {', 'const handlePointerCancel = () => {');
    for (const section of [removalSubmit, dragRelease]) {
      expect(section).toContain("new CustomEvent('rtx:trade-modified'");
      expect(section).toContain('symbol: tradeObj.symbol');
      expect(section).toContain('sessionScope: brokerAccountSessionScope');
    }
  });

  it('owns chart Modify Position requests in the persistent App shell', () => {
    expect(appSource).toContain('<ChartModifyPositionDialogHost');
    expect(appSource).toContain('onClosePosition={handleClosePosition}');
    expect(appSource).toContain('resolveAllowedSymbol={getAllowedSymbol}');
    expect(modifyDialogHostSource).toContain('window.addEventListener(CHART_POSITION_MODIFY_EVENT, handleChartPositionModify);');
    expect(modifyDialogHostSource).toContain('resolveChartPositionModifyTarget(');
    expect(modifyDialogHostSource).toContain('getCommittedBrokerAccountSessionScopeKey(');
    expect(modifyDialogHostSource).toContain('<LazyModifyPositionDialog');
    expect(modifyDialogHostSource).toContain('onClosePosition={onClosePosition}');
    expect(modifyDialogHostSource).toContain("window.dispatchEvent(new CustomEvent('rtx:trade-modified'");
  });

  it('colors entry lines by side: dotted blue for BUY, dotted red for SELL', () => {
    expect(chartSource).toContain("const TRADE_ENTRY_LINE_BUY_COLOR = '#2962ff';");
    expect(chartSource).toContain("const TRADE_ENTRY_LINE_SELL_COLOR = '#ef4444';");
    expect(chartSource).toContain('lineColor: getEntryLineColor(trade.side)');
    // The entry axis label matches the line color.
    expect(chartSource).toContain('addTradeAxisPriceLine(`${trade.key}:entry`, trade.entryPrice, getEntryLineColor(trade.side));');
    // The old neutral gray entry line is gone.
    expect(chartSource).not.toContain('TRADE_ENTRY_LEVEL_COLOR');
  });

  it('copies a share deep link from the entry bar share button', () => {
    expect(chartSource).toContain('onShare: () => {');
    expect(chartSource).toContain('const shareUrl = buildTradeShareUrl({');
    expect(chartSource).toContain('void copyTextToClipboard(shareUrl).then((copied) => {');
    expect(chartSource).toContain("window.dispatchEvent(new CustomEvent('rtx:order-feedback', {");
  });

  it('renders the shared trade annotation from the URL payload', () => {
    expect(chartSource).toContain('const sharedTrade = getSharedChartTrade();');
    expect(chartSource).toContain("!activeTradeKeys.has(`trade:${sharedTrade.ticket}`)");
    expect(chartSource).toContain('const sharedLabel = `Shared ${sharedTrade.side} ');
    // Annotation participates in the redraw signature so it paints on first render.
    expect(chartSource).toContain('const sharedTradeSignature = sharedTradeForSignature');
    expect(chartSource).toContain('sharedTradeSignature,\n        activeSignature,');
  });

  it('applies the share deep link to symbol and timeframe on startup', () => {
    expect(appSource).toContain("import { getSharedChartTrade } from './utils/tradeShareLink';");
    expect(appSource).toContain('const sharedTradeLinkAppliedRef = useRef(false);');
    expect(appSource).toContain('handleSymbolSelect(sharedTrade.symbol);');
    expect(appSource).toContain('setTimeframe(sharedTrade.timeframe as Timeframe);');
  });

  it('never blinks the overlay off for a level-cross guess on a routine feed gap', () => {
    // The optimistic SL/TP-cross close needs a real dwell before it fires,
    // and never fires while the whole positions feed is down.
    expect(TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS).toBe(1_500);
    expect(chartSource).toContain('&& elapsedMs >= TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS');
    expect(chartSource).toContain('&& appPositions.length > 0');
    // Missing trades are retained until PROVEN closed — no 30s giving-up.
    expect(chartSource).toContain('Retain until the trade is PROVEN closed');
    // …and a wrong guess is lifted the moment the broker reports the position open.
    expect(chartSource).toContain('crossCloseGuessedTradeKeysRef.current.add(key);');
    const invalidation = chartSource.indexOf('the guess was wrong. Lift the');
    expect(invalidation).toBeGreaterThan(-1);
    expect(chartSource).toContain('closeSuppressedTradeKeys.delete(key);');
    // Real close requests take ownership of their suppression.
    expect(chartSource).toContain('crossCloseGuessedTradeKeysRef.current.delete(key);');
  });

  it('uses the same pane-relative price-axis scaling on web and desktop', () => {
    // Native hyperbolic axis drag is off; the custom exponential drives it.
    expect(TRADING_VIEW_HANDLE_SCALE.axisPressedMouseMove).toEqual({ time: true, price: false });
    expect(chartSource).toContain('handleScale: TRADING_VIEW_HANDLE_SCALE');
    expect(chartSource).toContain("import { computePriceAxisDragRange } from '../../../utils/priceAxisDragZoom';");
    expect(chartSource).toContain('const nextRange = computePriceAxisDragRange({');
    // Range is captured at press time and applied against absolute drag travel.
    expect(chartSource).toContain('rightPriceScaleDragStartRange = { from: startFrom, to: startTo };');
    expect(chartSource).toContain('const dragDeltaY = event.clientY - rightPriceScaleDragStartY;');
    const dragGeometry = chartSection('rightPriceScaleDragGeometry = {', 'const handleRightPriceScalePointerMove =');
    expect(dragGeometry).not.toContain('isDesktopBackendTarget');
    expect(dragGeometry).toContain('paneHeight: Math.max(1, rect.height - chart.timeScale().height())');
    expect(dragGeometry).toContain('startY: event.clientY - rect.top');
    expect(chartSource).toContain('...rightPriceScaleDragGeometry,');
    expect(chartSource).toContain("chart.priceScale('right').setVisibleRange(nextRange);");
    // Double-click reset stays native.
    expect(TRADING_VIEW_HANDLE_SCALE.axisDoubleClickReset).toEqual({ time: true, price: true });
  });

  it('routes reverse/double/close chart actions into App handlers', () => {
    expect(appSource).toContain('CHART_POSITION_ACTION_EVENT,');
    expect(appSource).toContain('type ChartPositionActionDetail,');
    expect(appSource).toContain('window.addEventListener(CHART_POSITION_ACTION_EVENT, handleChartPositionAction);');
    expect(appSource).toContain('window.removeEventListener(CHART_POSITION_ACTION_EVENT, handleChartPositionAction);');
    expect(appSource).toContain('const handleReversePosition = async (ticket: number) => {');
    expect(appSource).toContain('const handleDoublePosition = async (ticket: number) => {');
    // Reverse must not send the opposite order when the close failed.
    const closeAwait = appSource.indexOf('const closed = await handleClosePosition(ticket, { showFailureFeedback: false });');
    const closeGuard = appSource.indexOf('if (!closed) {', closeAwait);
    const reverseOrder = appSource.indexOf('side: reverseSide,', closeAwait);
    expect(closeAwait).toBeGreaterThan(-1);
    expect(closeGuard).toBeGreaterThan(closeAwait);
    expect(reverseOrder).toBeGreaterThan(closeGuard);
    // Close returns a boolean so reverse can sequence without showing a single-close success sheet.
    expect(appSource).toContain('const handleClosePosition = createPositionCloseHandler({');
    expect(closeHandlerSource).toContain('const handleClosePosition = async (\n    id: number,\n    { showFailureFeedback = true }: { showFailureFeedback?: boolean } = {},\n  ): Promise<boolean> => {');
  });
});
