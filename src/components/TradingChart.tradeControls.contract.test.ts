import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// CRLF-normalized so anchors match on Windows checkouts too.
const chartSource = readFileSync(
  resolve(process.cwd(), 'src/components/TradingChart.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const appSource = readFileSync(
  resolve(process.cwd(), 'src/App.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

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

  it('docks SL/TP drag handles beside the entry bar until a level exists', () => {
    expect(chartSource).toContain('createDockedLevelChip({');
    expect(chartSource).toContain('if (!(levels.sl > 0)) {');
    expect(chartSource).toContain('if (!(levels.tp > 0)) {');
    expect(chartSource).toContain("const slDockOffset = trade.side === 'SELL' ? -22 : 22;");
    // Docked chips ride the entry price with a pixel offset.
    expect(chartSource).toContain('pixelOffsetY: slDockOffset');
    expect(chartSource).toContain('pixelOffsetY: -slDockOffset');
    expect(chartSource).toContain('${snappedY + (node.pixelOffsetY ?? 0)}px');
    // Bars anchor exactly on their price line: bar, dashed line and the
    // right-scale price box always share one horizontal line (no stagger).
    expect(chartSource).toContain("appendOverlayNode(controlBar.root, { kind: 'price-badge', price: trade.entryPrice }, 'active');");
    expect(chartSource).toContain("appendOverlayNode(levelBar, { kind: 'price-badge', price: levelPrice }, 'active');");
    // Relayout must restore each node's own display mode — forcing 'block'
    // onto the flex control bars drops their buttons onto the text baseline.
    expect(chartSource).toContain("el.style.display = el.dataset.display || 'block';");
  });

  it('keeps native trade prices on their exact right-axis coordinates', () => {
    expect(chartSource).toContain('const addTradeAxisPriceLine = (');
    expect(chartSource).toContain('axisLabelVisible: true');
    expect(chartSource).toContain('lineVisible: false');
    expect(chartSource).toContain('addTradeAxisPriceLine(`${trade.key}:entry`, trade.entryPrice, getEntryLineColor(trade.side));');
    expect(chartSource).toContain('tradeAxisPriceLinesRef.current.set(key, priceLine);');
    // Disable native collision shifting in both chart creation and hot apply.
    // Close prices then overlap at their real coordinate instead of forming a
    // misleading vertical stack when the visible price range is very wide.
    expect(chartSource.match(/alignLabels: false/g)).toHaveLength(2);
    // Native labels are torn down whenever the active overlay layer clears.
    expect(chartSource).toContain('series?.removePriceLine(priceLine);');
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

  it('shows live Pips/USD in the drag preview and hides the stale level bar', () => {
    // While dragging, the floating badge recomputes pips and projected money.
    expect(chartSource).toContain('const previewMoney = estimateTradeLevelMoney({');
    expect(chartSource).toContain('const previewPips = computeSignedPips(tradeObj.side, tradeObj.entryPrice, price, digits);');
    expect(chartSource).toContain("previewBadge.textContent = `${tr(role)} ${price.toFixed(digits)}  ${tr('pips')}: ${formatPipsLabel(previewPips)}  ${previewCurrency}: ${formatMoneyLabel(previewMoney)}`;");
    // The stale bar hides during the drag and is restored on release/cancel.
    expect(chartSource).toContain('hideDraggedLevelControls(closestTrade.key, grabbedType);');
    expect(chartSource.match(/restoreDraggedLevelControls\(\);/g)).toHaveLength(2);
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
    expect(chartSource).toContain('const TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS = 1_500;');
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

  it('drives the right price-scale drag with the MT5-style gentle curve', () => {
    // Native hyperbolic axis drag is off; the custom exponential drives it.
    expect(chartSource).toContain('axisPressedMouseMove: { time: true, price: false }');
    expect(chartSource).toContain("import { computePriceAxisDragRange } from '../utils/priceAxisDragZoom';");
    expect(chartSource).toContain('const nextRange = computePriceAxisDragRange({');
    // Range is captured at press time and applied against absolute drag travel.
    expect(chartSource).toContain('rightPriceScaleDragStartRange = { from: startFrom, to: startTo };');
    expect(chartSource).toContain('const dragDeltaY = event.clientY - rightPriceScaleDragStartY;');
    expect(chartSource).toContain("chart.priceScale('right').setVisibleRange(nextRange);");
    // Double-click reset stays native.
    expect(chartSource).toContain('axisDoubleClickReset: { time: true, price: true }');
  });

  it('routes reverse/double/close chart actions into App handlers', () => {
    expect(appSource).toContain("import { CHART_POSITION_ACTION_EVENT, type ChartPositionActionDetail } from './utils/chartTradeControls';");
    expect(appSource).toContain('window.addEventListener(CHART_POSITION_ACTION_EVENT, handleChartPositionAction);');
    expect(appSource).toContain('window.removeEventListener(CHART_POSITION_ACTION_EVENT, handleChartPositionAction);');
    expect(appSource).toContain('const handleReversePosition = async (ticket: number) => {');
    expect(appSource).toContain('const handleDoublePosition = async (ticket: number) => {');
    // Reverse must not send the opposite order when the close failed.
    const closeAwait = appSource.indexOf('const closed = await handleClosePosition(ticket);');
    const closeGuard = appSource.indexOf('if (!closed) {', closeAwait);
    const reverseOrder = appSource.indexOf('side: reverseSide,', closeAwait);
    expect(closeAwait).toBeGreaterThan(-1);
    expect(closeGuard).toBeGreaterThan(closeAwait);
    expect(reverseOrder).toBeGreaterThan(closeGuard);
    // Close reports success so reverse can sequence on it.
    expect(appSource).toContain('const handleClosePosition = async (id: number): Promise<boolean> => {');
  });
});
