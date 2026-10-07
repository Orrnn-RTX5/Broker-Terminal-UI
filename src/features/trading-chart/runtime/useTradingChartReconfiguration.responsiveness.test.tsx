// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartReconfiguration } from './useTradingChartReconfiguration';

afterEach(cleanup);

describe('chart command prop catch-up', () => {
  const options = () => ({
    isDisposedRef: { current: false }, chartRef: { current: {} }, seriesRef: { current: {} },
    prevChartTypeRef: { current: 'line' }, chartType: 'line',
    prevSymbolRef: { current: 'BTCUSD' }, symbol: 'BTCUSD',
    prevTimeframeRef: { current: 'M1' }, timeframe: 'M1',
    candlesRef: { current: [{ time: 1000 }] },
    applyChartTypeInPlace: vi.fn(() => true), updateChartData: vi.fn(),
  } as unknown as Parameters<typeof useTradingChartReconfiguration>[0]);

  it('does not repaint full history when the command already populated the series', () => {
    const runtime = options();
    renderHook(() => useTradingChartReconfiguration(runtime));
    expect(runtime.updateChartData).not.toHaveBeenCalled();
    expect(runtime.applyChartTypeInPlace).not.toHaveBeenCalled();
  });

  it('still applies a changed chart type received through props', () => {
    const runtime = options(); runtime.chartType = 'area';
    renderHook(() => useTradingChartReconfiguration(runtime));
    expect(runtime.applyChartTypeInPlace).toHaveBeenCalledExactlyOnceWith('area');
    expect(runtime.updateChartData).not.toHaveBeenCalled();
  });
});
