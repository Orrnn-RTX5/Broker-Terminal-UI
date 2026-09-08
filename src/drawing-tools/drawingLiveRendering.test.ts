// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { updateDrawingCandle } from './drawingCandleUpdates';

const source = ts.createSourceFile('TradingChart.tsx', readFileSync('src/components/TradingChart.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function productionCallback(name: string, dependencies: Record<string, unknown>) {
  let code = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) code = node.initializer!.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(code).not.toBe('');
  const javascript = ts.transpileModule(`return (${code});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}

it('the production candle push refreshes drawing OHLCV and coalesces rapid ticks', () => {
  const first = { time: 120, open: 100, high: 105, low: 99, close: 101, volume: 1 };
  const candles = { current: [first] };
  const pending = { current: null as number | null };
  const schedule = vi.fn(() => { pending.current = 1; });
  const update = vi.fn();
  const push = productionCallback('push', {
    isDisposedRef: { current: false }, liveMarketDataFrozenRef: { current: false }, canPaintLiveChart: () => true,
    seriesRef: { current: { update } }, prevChartTypeRef: { current: 'candlestick' }, volumeRef: { current: null },
    updateDrawingCandle, lastRenderedCandlesRef: candles,
    drawingRuntimeContextRef: { current: { symbol: 'XAUUSD', timeframe: 'M1' } },
    drawingRenderFrameRef: pending, drawingRenderSettledFrameRef: { current: null }, scheduleDrawingRenderAfterChartData: schedule,
    updateLegendDOM: vi.fn(), getDisplayVolume: (c: typeof first) => c.volume, chartSettingsRef: { current: {} },
  });
  const tick = { ...first, close: 103, volume: 5 };
  push(tick, false); push({ ...tick, close: 104, volume: 8 }, false);
  expect(update).toHaveBeenCalledTimes(2);
  expect(candles.current[0]).toMatchObject({ close: 104, volume: 8 });
  expect(schedule).toHaveBeenCalledExactlyOnceWith('XAUUSD', 'M1');
  expect(first.close).toBe(101);
});

it('a price-only axis repaint also schedules drawings after the chart transform', () => {
  const frameCallbacks: FrameRequestCallback[] = [];
  const drawingFrame = { current: null as number | null };
  const schedule = vi.fn(() => { drawingFrame.current = 1; });
  const queue = productionCallback('queuePriceBoundOverlayGeometryRepaint', {
    priceBoundOverlayGeometryRepaintFrame: null,
    window: { requestAnimationFrame: (callback: FrameRequestCallback) => { frameCallbacks.push(callback); return frameCallbacks.length; } },
    repaintLivePriceOverlayGeometry: vi.fn(), repaintTradeOverlayGeometryRef: { current: vi.fn() },
    drawingRenderFrameRef: drawingFrame, drawingRenderSettledFrameRef: { current: null },
    drawingRuntimeContextRef: { current: { symbol: 'EURUSD', timeframe: 'H1' } }, scheduleDrawingRenderAfterChartData: schedule,
  });
  queue(); queue();
  expect(frameCallbacks).toHaveLength(1);
  frameCallbacks.shift()!(0);
  expect(schedule).toHaveBeenCalledExactlyOnceWith('EURUSD', 'H1');
  queue(); frameCallbacks.shift()!(1);
  expect(schedule).toHaveBeenCalledTimes(1);
});
