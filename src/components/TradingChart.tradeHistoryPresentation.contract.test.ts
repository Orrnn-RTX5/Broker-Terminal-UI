import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const chartSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/TradingChart.tsx'),
  'utf8',
);

describe('TradingChart trade-history presentation contract', () => {
  it('renders an explicit open and close marker/label pair', () => {
    expect(chartSource).toContain("getTradeHistoryExecutionSide(trade.side, 'CLOSE')");
    expect(chartSource).toContain("createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, entryLabel, entryColor, 'history', 1, undefined, 'open')");
    expect(chartSource).toContain("createTradeMarker(exitSide, trade.exitPrice, trade.exitTime, `${closeLabel} (${exitSide} execution)`, getExitColor(trade.side), 'history', 1, undefined, 'close')");
    expect(chartSource).toContain("createTradeHistoryLabel(trade.side, trade.side, 'OPEN'");
    expect(chartSource).toContain("createTradeHistoryLabel(trade.side, exitSide, 'CLOSE'");
  });

  it('uses GMT badge formatting and collision-safe placement in the shared chart path', () => {
    expect(chartSource).toContain('formatTradeHistoryGmtTime(time)');
    expect(chartSource).toContain('resolveTradeHistoryLabelPlacement({');
    expect(chartSource).toContain('resolveTradeHistoryLabelVerticalPlacement({');
    expect(chartSource).toContain("details.textContent = [ticketLabel, price.toFixed(digits), timeLabel].filter(Boolean).join(' · ')");
  });
});
