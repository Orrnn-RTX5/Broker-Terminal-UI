import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candleCache } from '../../../services/candleCache';
import { chartDataService } from '../../../services/chartDataService';
import type { Candle } from '../../../types/chart';
import { useTradingChartHistoryCache } from './useTradingChartHistoryCache';

const candle = (time: number, close = time): Candle => ({
  time, open: close - 1, high: close + 1, low: close - 2, close, volume: 1,
});

describe('live chart history cache writes', () => {
  beforeEach(() => {
    candleCache.clearAll();
    vi.spyOn(chartDataService, 'getCandleCacheScope').mockReturnValue('test-session');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    candleCache.clearAll();
  });

  it('updates the latest candle without sorting retained history or returning a snapshot', () => {
    // This fixture exercises only the merge callback, whose dependencies are
    // the symbol, cache target and broker offset. Other callbacks are not run.
    const options = { symbol: 'BTCUSD', brokerTimeOffsetSecRef: { current: 0 } } as
      Parameters<typeof useTradingChartHistoryCache>[0];
    const { result } = renderHook(() => useTradingChartHistoryCache(options));
    const { key, metadata } = result.current.buildHistoryCacheTarget('M1');
    const history = Array.from({ length: 2_000 }, (_, index) => candle(index + 1));
    const previousSnapshot = candleCache.setLatest(key, history, metadata);
    const sort = vi.spyOn(Array.prototype, 'sort');

    for (let update = 1; update <= 20; update += 1) {
      expect(result.current.mergeHistoryCache('M1', [candle(2_000, 2_000 + update)])).toBeUndefined();
    }

    expect(sort).not.toHaveBeenCalled();
    sort.mockRestore();
    expect(candleCache.getLatest(key)?.candles.at(-1)?.close).toBe(2_020);
    expect(previousSnapshot.candles.at(-1)?.close).toBe(2_000);
    expect(history.at(-1)?.close).toBe(2_000);
  });
});
