// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  enqueueLiveTick,
  isLiveMarketDataFrozen,
  setLiveMarketDataFrozen,
  type LiveTick,
} from './liveTickDispatcher';

const tick = (symbol: string, bid: number): LiveTick => ({
  symbol,
  bid,
  ask: bid + 0.0002,
  spread: 0.0002,
  timestamp: 1_788_176_700_000,
  volume: 1,
});

describe('liveTickDispatcher market data freeze', () => {
  beforeEach(() => {
    window.rtxTickCache = new Map();
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', false);
    setLiveMarketDataFrozen('test-chart-b', 'GBPUSD', false);
  });

  it('keeps the last cached tick while a symbol is frozen', () => {
    window.rtxTickCache.set('GBPUSD', tick('GBPUSD', 1.3349));

    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    enqueueLiveTick('GBPUSD', tick('GBPUSD', 1.3355));

    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(true);
    expect(window.rtxTickCache.get('GBPUSD')?.bid).toBe(1.3349);
  });

  it('freezes suffixed variants of the same symbol', () => {
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    enqueueLiveTick('GBPUSD.r', tick('GBPUSD.r', 1.3355));

    expect(isLiveMarketDataFrozen('GBPUSD.r')).toBe(true);
    expect(window.rtxTickCache.get('GBPUSD.r')).toBeUndefined();
  });

  it('keeps a symbol frozen until every source releases it', () => {
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    setLiveMarketDataFrozen('test-chart-b', 'GBPUSD', true);

    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', false);
    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(true);

    setLiveMarketDataFrozen('test-chart-b', 'GBPUSD', false);
    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(false);
  });

  it('accepts ticks again after the symbol is unfrozen', () => {
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', false);

    enqueueLiveTick('GBPUSD', tick('GBPUSD', 1.3351));

    expect(window.rtxTickCache.get('GBPUSD')?.bid).toBe(1.3351);
  });
});
