import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const chartSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/TradingChart.tsx'),
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

describe('TradingChart trade-history presentation contract', () => {
  it('renders clean outlined entry and close arrows joined by a thin high-contrast trade segment', () => {
    expect(chartSource).toContain("getTradeHistoryExecutionSide(trade.side, 'CLOSE')");
    expect(chartSource).toContain("createTradeSegment(trade.entryPrice, trade.entryTime, deriveClosedTradeColor(trade), 'solid', 'history', trade.exitPrice, trade.exitTime");
    expect(chartSource).toContain("createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, entryPriceLabel, entryColor, 'history', 1, undefined, 'open', trade.side, trade.entryExecutionTime)");
    expect(chartSource).toContain("createTradeMarker(exitSide, trade.exitPrice, trade.exitTime, closePriceLabel, getHistoryExitColor(trade.side), 'history', 1, undefined, 'close', trade.side, trade.exitExecutionTime)");
    expect(chartSource).toContain("const TRADE_HISTORY_PROFIT_COLOR = '#00e6a8';");
    expect(chartSource).toContain("const TRADE_HISTORY_LOSS_COLOR = '#ff5a67';");
    expect(chartSource).toContain("const TRADE_HISTORY_LIGHT_PROFIT_COLOR = '#007a55';");
    expect(chartSource).toContain("const TRADE_HISTORY_LIGHT_LOSS_COLOR = '#c6283d';");
    expect(chartSource).toContain('const entryColor = getHistoryEntryColor(trade.side);');
    expect(chartSource).toContain('const width = emphasized ? 12 : 20;');
    expect(chartSource).toContain('const height = emphasized ? 15 : 26;');
    expect(chartSource).toContain('const viewBoxWidth = 20;');
    expect(chartSource).toContain('const viewBoxHeight = emphasized ? 24 : 26;');
    expect(chartSource).toContain('viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}"');
    expect(chartSource).toContain('const strokeWidth = emphasized ? 1.75 : 1.15;');
    expect(chartSource).toContain('return pnl >= 0 ? chartThemeRef.current.candleUp : chartThemeRef.current.candleDown;');
    expect(chartSource).toContain("const thickness = isHistoryLine ? 1 : lineStyle === 'solid' ? 2 : 1;");
    expect(chartSource).toContain('const historyVisualOpacity = safeOpacity > 0 ? 0.78 + safeOpacity * 0.22 : 0;');
    expect(chartSource).not.toContain('const historyGlow');
    expect(chartSource).toContain("el.style.transformOrigin = isHistoryLine ? '0 50%' : '0 0';");
    expect(chartSource).toContain("const TRADE_HISTORY_PRESENTATION_VERSION = 'visibility-v6-thin-candle-connectors';");
    expect((chartSource.match(/TRADE_HISTORY_PRESENTATION_VERSION/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(chartSource).not.toContain('createTradeHistoryLabel');
  });

  it('shows position lifecycle, exact price, and GMT execution time from a generous hover or focus target', () => {
    expect(chartSource).toContain("hoverTarget.dataset.hoverPrice = title;");
    expect(chartSource).toContain('hoverTarget.dataset.hoverTime = timeLabel;');
    expect(chartSource).toContain('hoverTarget.dataset.positionSide = historyPositionSide;');
    expect(chartSource).toContain('formatTradeHistoryGmtTime(executionTime, { includeSeconds: true })');
    expect(chartSource).toContain('buildTradeHistoryBadgeText({');
    expect(chartSource).toContain('const markerWidth = isHistoryMarker ? 12 : 20;');
    expect(chartSource).toContain('const markerHeight = isHistoryMarker ? 15 : 26;');
    expect(chartSource).toContain("hoverTarget.style.cssText = 'position:absolute;display:none;width:32px;height:36px;z-index:22;pointer-events:auto;");
    expect(chartSource).toContain("tooltip.className = 'rtx-trade-marker__price-tooltip';");
    expect(chartSource).toContain('tooltipHeader.textContent = `${historyPositionSide} ${lifecycleLabel}`;');
    expect(chartSource).toContain("appendTooltipDetail('Price', title);");
    expect(chartSource).toContain("appendTooltipDetail('Time', timeLabel);");
    expect(chartSource).toContain('pointer-events:none;opacity:0;visibility:hidden;');
    expect(chartSource).toContain("hoverTarget.addEventListener('pointerenter'");
    expect(chartSource).toContain("hoverTarget.addEventListener('pointerleave'");
    expect(chartSource).toContain("hoverTarget.addEventListener('focus'");
    expect(chartSource).toContain("hoverTarget.addEventListener('blur'");
    expect(chartSource).toContain('const fitsAbove = markerTop - tooltipGap - tooltipHeight >= 4;');
    expect(chartSource).toContain('appendHistoryInteractionNode(');
  });

  it('removes the obsolete persistent text-box controls', () => {
    expect(chartSource).not.toContain('showTradeHistoryBoxes');
    expect(toolbarSource).not.toContain('Text boxes');
    expect(toolbarSource).not.toContain('tradeHistoryBoxOpacity');
    expect(propertiesDialogSource).not.toContain('Show trade history boxes');
    expect(propertiesDialogSource).not.toContain('tradeHistoryBoxOpacity');
  });
});
