import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTradingChartInitialLogicalRange } from '../utils/chartTimeFormat';
import { shouldResetInitialHistoryVisibleRange } from './TradingChart.helpers';

const chartSource = readFileSync(
  resolve(process.cwd(), 'src/components/TradingChart.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const liveCandleSource = readFileSync(
  resolve(process.cwd(), 'src/features/trading-chart/runtime/useTradingChartLiveCandleRuntime.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const historyLoadingSource = readFileSync(
  resolve(process.cwd(), 'src/features/trading-chart/runtime/useTradingChartHistoryLoading.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const loadingPresentationSource = readFileSync(
  resolve(process.cwd(), 'src/features/trading-chart/presentation/useTradingChartLoadingPresentation.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const viewportResetSource = readFileSync(
  resolve(process.cwd(), 'src/features/trading-chart/runtime/useTradingChartViewportReset.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const chartRuntimeSource = `${chartSource}\n${liveCandleSource}\n${historyLoadingSource}\n${loadingPresentationSource}`;

describe('TradingChart initial viewport contract', () => {
  it('reports rendered candles to the terminal startup boundary', () => {
    expect(loadingPresentationSource).toContain("import { useTerminalStartupReady } from '../../../startup/TerminalStartupBoundary';");
    expect(loadingPresentationSource).toMatch(/useTerminalStartupReady\(\s*'chart',\s*loadingPhase === 'ready' \|\| loadingPhase === 'hidden',?\s*\)/);

    const renderStart = chartSource.indexOf('series.setData(seriesData);');
    const reportReady = chartSource.indexOf('markCandlesReady();', renderStart);
    expect(renderStart).toBeGreaterThan(-1);
    expect(reportReady).toBeGreaterThan(renderStart);
    expect(chartSource.slice(renderStart, reportReady)).toContain('pending.finishLoadingAfterRender && seriesData.length > 0');
  });

  it('moves from a sparse live range to the latest uncached history range', () => {
    const sparseLiveRange = getTradingChartInitialLogicalRange({
      timeframe: 'M1',
      totalBars: 5,
      adaptiveVisibleBars: 30,
    });
    expect(sparseLiveRange).toEqual({ from: -25, to: 13 });

    const shouldResetForHistory = shouldResetInitialHistoryVisibleRange({
      resetVisibleRangeOnNextData: false,
      hydratedFromCache: false,
    });
    expect(shouldResetForHistory).toBe(true);

    const delayedHistoryRange = shouldResetForHistory
      ? getTradingChartInitialLogicalRange({
        timeframe: 'M1',
        totalBars: 500,
        adaptiveVisibleBars: 30,
      })
      : sparseLiveRange;
    expect(delayedHistoryRange).toEqual({ from: 470, to: 508 });
  });

  it('wires the uncached-history decision into the authoritative history render', () => {
    const initialHistoryStart = historyLoadingSource.indexOf('// Update chart - live data');
    const initialHistoryEnd = historyLoadingSource.indexOf('// Set current forming candle', initialHistoryStart);
    const initialHistoryRender = historyLoadingSource.slice(initialHistoryStart, initialHistoryEnd);

    expect(initialHistoryStart).toBeGreaterThan(-1);
    expect(initialHistoryEnd).toBeGreaterThan(initialHistoryStart);
    expect(initialHistoryRender).toContain('shouldResetInitialHistoryVisibleRange({');
    expect(initialHistoryRender).toContain('hydratedFromCache,');
    expect(initialHistoryRender).toContain('resetVisibleRange: shouldResetVisibleRange');
  });

  it('resets candle zoom and scroll when Reset Layout fires', () => {
    const listenerStart = viewportResetSource.indexOf('// Reset Layout restores the default candle zoom and scroll');
    const listenerEnd = viewportResetSource.indexOf('return {', listenerStart);
    const listener = viewportResetSource.slice(listenerStart, listenerEnd);

    expect(listenerStart).toBeGreaterThan(-1);
    expect(listenerEnd).toBeGreaterThan(listenerStart);
    expect(listener).toContain("window.addEventListener('resetLayout', handleResetLayoutZoom);");
    expect(listener).toContain('const totalBars = lastRenderedCandlesRef.current.length;');
    expect(listener).toContain("seriesRef.current?.priceScale().applyOptions({ autoScale: true });");
    expect(listener).toContain('applyInitialVisibleLogicalRange(chart, totalBars, timeframe);');
  });

  it('keeps sparse live data covered until history settles without blocking live updates', () => {
    const firstLiveStart = liveCandleSource.indexOf('if (shouldCommitFirstLiveSelectionBaseline({');
    const firstLiveEnd = liveCandleSource.indexOf('} else {', firstLiveStart);
    const firstLiveRender = liveCandleSource.slice(firstLiveStart, firstLiveEnd);
    const snapshotStart = liveCandleSource.indexOf('onSnapshot: (snapshot) => {');
    const snapshotEnd = liveCandleSource.indexOf('onCandle: (candle) =>', snapshotStart);
    const snapshotRender = liveCandleSource.slice(snapshotStart, snapshotEnd);

    for (const provisionalRender of [firstLiveRender, snapshotRender]) {
      expect(provisionalRender).toContain('releaseLivePaintAfterRender: true');
      expect(provisionalRender).toContain(
        'finishLoadingAfterRender: !initialHistoryLoadPendingRef.current',
      );
    }

    expect(chartRuntimeSource).toContain('initialHistoryLoadPendingRef.current = true;');
    expect(chartRuntimeSource).toContain('initialHistoryLoadPendingRef.current = false;');
    expect(chartRuntimeSource).toContain('requestChartDataRender({\n            immediate: true,\n            finishLoadingAfterRender: true,');
  });
});
