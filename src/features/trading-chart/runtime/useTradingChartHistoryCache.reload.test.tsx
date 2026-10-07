// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { candleCache } from '../../../services/candleCache';
import { createRenderedPriceReference } from '../../../services/chartPriceGuards';
import { defaultChartProperties } from '../../../store/useChartSettingsStore';
import type { Candle, Timeframe } from '../../../types/chart';
import { CANDLE_TIMEFRAMES, getTimeframePeriodSeconds } from '../../../utils/timeframeBoundary';
import { getInitialHistoryCount } from './chartRuntime';
import { useTradingChartHistoryCache } from './useTradingChartHistoryCache';

vi.mock('../../../services/chartDataService', () => ({
  chartDataService: {
    normalizeTimeframe: (timeframe: string) => timeframe,
    getCandleCacheScope: () => 'reload-current-session',
  },
}));

type Options = Parameters<typeof useTradingChartHistoryCache>[0];
const ref = <T,>(current: T) => ({ current });
const candle = (time: number, close: number, closed = false): Candle => ({
  time, open: close - 1, high: close + 1, low: close - 2,
  close, volume: 4, tickVolume: 4, closed,
});

const createHarness = (symbol = 'BTCUSD', timeframe: Timeframe = 'M1') => {
  const currentTime = getTimeframePeriodSeconds(Date.UTC(2026, 9, 5, 10, 1) / 1000, timeframe)!.startTime;
  const previousTime = getTimeframePeriodSeconds(currentTime - 1, timeframe)!.startTime;
  const olderTime = getTimeframePeriodSeconds(previousTime - 1, timeframe)!.startTime;
  const history = [candle(olderTime, 100, true), candle(previousTime, 101, true)];
  const live = candle(currentTime, 105);
  const metadata = { scope: 'reload-current-session', symbol, timeframe, limit: getInitialHistoryCount(timeframe) };
  const key = candleCache.createKey(metadata);
  candleCache.setLatest(key, history, metadata);
  const options = {
    symbol, timeframe, brokerTimeOffsetSecRef: ref(0),
    candlesRef: ref<Candle[]>([live]), currentCandleRef: ref<Candle | null>(live),
    liveCandleMutationGenerationByTimeRef: ref(new Map([[live.time, 1]])),
    cancelQueuedChartRender: vi.fn(), chartSettingsRef: ref(defaultChartProperties),
    clearPeriodSeparators: vi.fn(), firstRenderedCandleTimeRef: ref(live.time),
    getCachedRenderedPriceReference: () => createRenderedPriceReference([]),
    getLatestRenderableCandle: (rows: Candle[]) => rows.at(-1) ?? null,
    hasDisplayedHistoryRef: ref(false), hasReachedBeginningRef: ref(false), isLoadingMoreRef: ref(false),
    lastRenderedCandlesRef: ref<Candle[]>([live]), lastStoreCandleSecRef: ref(0),
    lastVisibleLogicalRangeRef: ref(null), periodSeparatorsRef: ref([]), prevPriceRef: ref(live.close),
    protectedDisplayedHistoryRef: ref<Candle[]>([]), reloadAggregationCandles: vi.fn(),
    renderedPriceReferenceRef: ref(createRenderedPriceReference([live])),
    resetVisibleRangeOnNextDataRef: ref(false), scheduleBoundaryTimerRef: ref(null),
    setApiError: vi.fn(), updateChartData: vi.fn(), updateLegendDOM: vi.fn(),
  } as unknown as Options;
  const view = renderHook(() => useTradingChartHistoryCache(options));
  return { options, view, history, live, key, metadata };
};

afterEach(() => { cleanup(); candleCache.clearAll(); });

describe('cache baseline arriving after a live candle on reload', () => {
  it.each(['BTCUSD', 'XAUUSD.raw'].flatMap(symbol => CANDLE_TIMEFRAMES.map(timeframe => ({ symbol, timeframe }))))(
    'keeps the proven current $symbol $timeframe candle in the first cached render', ({ symbol, timeframe }) => {
      const harness = createHarness(symbol, timeframe as Timeframe);
      act(() => { expect(harness.view.result.current.hydrateHistoryFromCache(timeframe as Timeframe, 'cached-history')).toBe(true); });
      const expected = [...harness.history, harness.live];
      expect(harness.options.updateChartData).toHaveBeenCalledExactlyOnceWith(expected, undefined, expect.objectContaining({
        immediate: true, resetVisibleRange: true, finishLoadingAfterRender: true,
      }));
      expect(harness.options.candlesRef.current).toEqual(expected);
      expect(harness.options.currentCandleRef.current).toEqual(harness.live);
      expect(harness.options.reloadAggregationCandles).toHaveBeenCalledWith(expected, timeframe, 0);
    },
  );

  it('does not promote an unproven cached tail to live data', () => {
    const harness = createHarness();
    harness.options.liveCandleMutationGenerationByTimeRef.current.clear();
    act(() => { harness.view.result.current.hydrateHistoryFromCache('M1', 'cached-history'); });
    expect(harness.options.candlesRef.current).toEqual(harness.history);
    expect(harness.options.currentCandleRef.current).toEqual(harness.history.at(-1));
  });

  it('does not retain a finalized candle as a forming live tail', () => {
    const harness = createHarness();
    harness.options.currentCandleRef.current = { ...harness.live, closed: true };
    act(() => { harness.view.result.current.hydrateHistoryFromCache('M1', 'cached-history'); });
    expect(harness.options.candlesRef.current).toEqual(harness.history);
  });

  it('does not attach a live candle from an incompatible price range', () => {
    const harness = createHarness();
    harness.options.currentCandleRef.current = candle(harness.live.time, 10_500);
    act(() => { harness.view.result.current.hydrateHistoryFromCache('M1', 'cached-history'); });
    expect(harness.options.candlesRef.current).toEqual(harness.history);
  });

  it('does not rewind a newer cache with a quote from an earlier bucket', () => {
    const harness = createHarness();
    const newerCached = candle(harness.live.time + 60, 106);
    candleCache.setLatest(harness.key, [...harness.history, newerCached], harness.metadata);
    act(() => { harness.view.result.current.hydrateHistoryFromCache('M1', 'cached-history'); });
    expect(harness.options.currentCandleRef.current).toEqual(newerCached);
  });

  it('does not merge the old timeframe candle into a preloaded new timeframe', () => {
    const harness = createHarness();
    const metadata = { ...harness.metadata, timeframe: 'H1', limit: getInitialHistoryCount('H1') };
    candleCache.setLatest(candleCache.createKey(metadata), harness.history, metadata);
    act(() => { harness.view.result.current.hydrateHistoryFromCache('H1', 'cached-timeframe-command'); });
    expect(harness.options.candlesRef.current).toEqual(harness.history);
  });

  it('preserves the real quote close and range when cache ends in the same open bucket', () => {
    const harness = createHarness();
    const cachedForming = { ...harness.live, open: 98, high: 106, low: 97, close: 102 };
    candleCache.setLatest(harness.key, [...harness.history, cachedForming], harness.metadata);
    act(() => { harness.view.result.current.hydrateHistoryFromCache('M1', 'cached-history'); });
    expect(harness.options.currentCandleRef.current).toEqual(expect.objectContaining({
      time: harness.live.time, open: 98, close: harness.live.close, high: 106, low: 97,
    }));
  });

  it('keeps a cached explicit final authoritative in the same bucket', () => {
    const harness = createHarness();
    const final = { ...harness.live, close: 102, closed: true };
    candleCache.setLatest(harness.key, [...harness.history, final], harness.metadata);
    act(() => { harness.view.result.current.hydrateHistoryFromCache('M1', 'cached-history'); });
    expect(harness.options.currentCandleRef.current).toEqual(final);
  });
});
