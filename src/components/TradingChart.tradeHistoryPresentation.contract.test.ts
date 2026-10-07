import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readChartSource = (relativePath: string) => fs.readFileSync(
  path.resolve(process.cwd(), relativePath),
  'utf8',
);
const chartSource = [
  'src/components/TradingChart.tsx',
  'src/features/trading-chart/runtime/useTradingChartTradeRuntime.ts',
  'src/features/trading-chart/runtime/createTradeOverlayModelRuntime.ts',
  'src/features/trading-chart/runtime/createTradeOverlayDomRuntime.ts',
  'src/features/trading-chart/runtime/createHistoryTradeOverlayGroups.ts',
  'src/features/trading-chart/runtime/useTradingChartTradeOverlayRenderer.ts',
  'src/features/trading-chart/runtime/bindTradeOverlayRuntimeSubscriptions.ts',
  'src/features/trading-chart/runtime/tradeOverlayRuntimeConstants.ts',
  'src/features/trading-chart/runtime/useTradingChartContextMenu.ts',
].map(readChartSource).join('\n');
const tradeOverlayPresentationSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/features/trading-chart/presentation/tradeOverlayPresentation.ts'),
  'utf8',
);
const toolbarSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/layout/TopToolbar.tsx'),
  'utf8',
);
const propertiesDialogSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/dialogs/ChartPropertiesDialog.tsx'),
  'utf8',
);
const themeSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/styles/theme.css'),
  'utf8',
);

describe('TradingChart trade-history presentation contract', () => {
  it('retains both execution markers while a closing position lingers in the feed', () => {
    const start = chartSource.indexOf('getTradeOverlayOptimisticClosedSnapshots(normalizedChartSymbol).forEach');
    const end = chartSource.indexOf('closedHistorySnapshots.forEach', start);
    const optimisticHistory = chartSource.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(optimisticHistory).toContain('if (activeTradeKeys.has(trade.key))');
    expect(optimisticHistory).toContain('if (activeTradeKeys.has(key))');
    expect(optimisticHistory).not.toContain('rawActiveTradeKeys.has(');
    expect(chartSource).toContain('filterActiveTradeKeysForHistory(rawActiveTradeKeys, closeSuppressedTradeKeys)');
  });

  it('uses the same execution chevrons for active and closed trades on web and desktop', () => {
    const arrowStart = chartSource.indexOf('const createArrowSvg =');
    const markerStart = chartSource.indexOf('const createTradeMarker =');
    const markerEnd = chartSource.indexOf('const createPriceLevel =', markerStart);
    expect(arrowStart).toBeGreaterThan(-1);
    expect(markerStart).toBeGreaterThan(arrowStart);
    expect(markerEnd).toBeGreaterThan(markerStart);
    const arrowBuilder = chartSource.slice(arrowStart, markerStart);
    const markerBuilder = chartSource.slice(markerStart, markerEnd);
    expect(arrowBuilder).not.toContain('isDesktopBackendTarget');
    expect(markerBuilder).not.toContain('isDesktopBackendTarget');
    expect(arrowBuilder).toContain("const color = side === 'BUY' ? '#2962ff' : '#f23645';");
    expect(arrowBuilder).toContain('viewBox="0 0 14 20" fill="none"');
    expect(arrowBuilder).toContain('stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"');
    expect(arrowBuilder).toContain("'M3 7 7 3l4 4M3 11l4-4 4 4M7 8v9'");
    expect(arrowBuilder).toContain("'M3 13l4 4 4-4M3 9l4 4 4-4M7 3v9'");
    expect(markerBuilder).toContain('marker.innerHTML = createArrowSvg(side);');
    expect(markerBuilder).toContain("markerAnchor: 'candle', pixelOffsetY: side === 'BUY' ? 3 : -3");
    expect(chartSource).toContain('getTradeHistoryMarkerPrice(node.markerSide, node.price, tradeMarkerCandles.get(markerTime))');
    expect(chartSource).toContain('markerTime = fallbackTime;');
    expect(chartSource).toContain("getTradeHistoryExecutionSide(trade.side, 'CLOSE')");
    expect(chartSource).toContain('const showAnyTradeHistoryOverlay = showTradeHistoryLine || showTradeHistoryArrows;');
    expect(chartSource).toContain('const showTradeHistoryLine = chartProperties.showTradeHistory !== false;');
    expect(chartSource).toContain('const createTradeHistoryLine = (');
    expect(chartSource).toContain("createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, entryPriceLabel, 'history', 1, undefined, 'open', trade.side, trade.entryExecutionTime)");
    expect(chartSource).toContain("createTradeMarker(exitSide, trade.exitPrice, trade.exitTime, closePriceLabel, 'history', 1, undefined, 'close', trade.side, trade.exitExecutionTime)");
    expect(chartSource).toContain("const TRADE_HISTORY_PRESENTATION_VERSION = 'visibility-v13-entry-close-connectors';");
    expect((chartSource.match(/TRADE_HISTORY_PRESENTATION_VERSION/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(chartSource).not.toContain('createTradeHistoryLabel');
  });

  it('shows position lifecycle, exact price, and GMT execution time from a generous hover or focus target', () => {
    expect(chartSource).toContain("hoverTarget.dataset.hoverPrice = title;");
    expect(chartSource).toContain('hoverTarget.dataset.hoverTime = timeLabel;');
    expect(chartSource).toContain('hoverTarget.dataset.positionSide = historyPositionSide;');
    expect(chartSource).toContain('formatTradeHistoryGmtTime(executionTime, { includeSeconds: true })');
    expect(chartSource).toContain('buildTradeHistoryBadgeText({');
    expect(chartSource).toContain('const markerWidth = 14;');
    expect(chartSource).toContain('const markerHeight = 20;');
    expect(chartSource).toContain('pointer-events:none;opacity:${opacity};filter:none;');
    expect(chartSource).toContain("hoverTarget.style.cssText = 'position:absolute;display:none;width:32px;height:36px;z-index:22;pointer-events:auto;");
    expect(chartSource).toContain("tooltip.className = 'rtx-trade-marker__price-tooltip';");
    expect(chartSource).toContain("tooltipHeader.textContent = `${tr(historyPositionSide)} ${tr(lifecycle === 'open' ? 'Open' : 'Close')}`;");
    expect(chartSource).toContain("appendTooltipDetail('Price', title);");
    expect(chartSource).toContain("appendTooltipDetail('Time', timeLabel);");
    expect(chartSource).toContain('pointer-events:none;opacity:0;visibility:hidden;');
    expect(chartSource).toContain("hoverTarget.addEventListener('pointerenter'");
    expect(chartSource).toContain("hoverTarget.addEventListener('pointerleave'");
    expect(chartSource).toContain("hoverTarget.addEventListener('focus'");
    expect(chartSource).toContain("hoverTarget.addEventListener('blur'");
    expect(tradeOverlayPresentationSource).toContain('const fitsAbove = markerTop - tooltipGap - tooltipHeight >= 4;');
    expect(chartSource).toContain('appendHistoryInteractionNode(');
  });

  it('removes the obsolete persistent text-box controls', () => {
    expect(chartSource).not.toContain('showTradeHistoryBoxes');
    expect(toolbarSource).not.toContain('Text boxes');
    expect(toolbarSource).not.toContain('tradeHistoryBoxOpacity');
    expect(propertiesDialogSource).not.toContain('Show trade history boxes');
    expect(propertiesDialogSource).not.toContain('tradeHistoryBoxOpacity');
  });

  it('keeps entry-close lines and arrows independently configurable', () => {
    expect(chartSource).toContain("showTradeHistoryLine ? 'history-lines:on' : 'history-lines:off'");
    expect(chartSource).toContain("showTradeHistoryArrows ? 'arrows:on' : 'arrows:off'");
    expect(chartSource).toContain('if (showTradeHistoryLine) {');
    expect(chartSource).toContain('createTradeHistoryLine(');
    expect(chartSource).toContain('if (showTradeHistoryArrows) {');
    expect(chartSource).toContain("currentProperties.showTradeHistory !== previousProperties.showTradeHistory");
    expect(toolbarSource).toContain('Entry / close line');
    expect(toolbarSource).toContain("updateTradeHistorySetting('showTradeHistory', checked)");
    expect(toolbarSource).toContain('Entry / close arrows');
    expect(propertiesDialogSource).toContain("{ key: 'showTradeHistory', label: 'Show entry/close line' }");
    expect(propertiesDialogSource).toContain("{ key: 'showTradeHistoryArrows', label: 'Show entry/close arrows' }");
    const historyToggleStart = chartSource.indexOf('const handleCtxToggleTradeHistory =');
    const historyToggleEnd = chartSource.indexOf('const handleCtxToggleTradeHistoryLine =', historyToggleStart);
    expect(historyToggleStart).toBeGreaterThan(-1);
    expect(historyToggleEnd).toBeGreaterThan(historyToggleStart);
    const historyToggle = chartSource.slice(historyToggleStart, historyToggleEnd);
    expect(historyToggle).not.toContain('isDesktopBackendTarget');
    expect(historyToggle).toContain("store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', next);");
  });

  it('uses the terminal theme and accessible switches for the trade-history settings popover', () => {
    expect(toolbarSource).toContain('className="rtx-menu-surface rtx-history-overlay-menu fixed z-[9999]"');
    expect(toolbarSource).toContain('role="dialog"');
    expect(toolbarSource).toContain('ariaHasPopup="dialog"');
    expect(toolbarSource).toContain('role="switch"');
    expect(toolbarSource).toContain('disabled={tradeHistorySettingsAreDefault}');
    expect(toolbarSource).toContain("event.key !== 'Escape'");
    expect(toolbarSource).not.toContain('bg-[#151820]');
    expect(toolbarSource).not.toContain('accent-blue-500');

    expect(themeSource).toMatch(/\.rtx-history-overlay-menu \{[\s\S]*--rtx-history-overlay-accent: var\(--color-primary\);[\s\S]*background: var\(--bg-secondary\);/);
    expect(themeSource).toMatch(/\.rtx-history-overlay-menu__control input:checked \+ \.rtx-history-overlay-menu__switch \{[\s\S]*background: var\(--rtx-history-overlay-accent\);/);
    expect(themeSource).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('joins the entry-close line to the arrow tips when arrows are shown', () => {
    expect(chartSource).toContain('showTradeHistoryArrows ? { start: trade.side, end: exitSide } : undefined');
    expect(chartSource).toContain('const y1 = resolveSegmentEndY(node.price, node.time, node.startMarkerSide);');
    expect(chartSource).toContain('const y2 = resolveSegmentEndY(endPrice, endTime, node.endMarkerSide);');
    expect(chartSource).toContain("resolveTradeMarkerAnchorPrice({ kind: 'marker', price, time, markerSide, markerAnchor: 'candle' })");
  });
});
