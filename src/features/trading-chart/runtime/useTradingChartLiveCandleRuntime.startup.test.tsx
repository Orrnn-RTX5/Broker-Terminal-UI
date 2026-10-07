import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandleStreamOptions } from '../../../services/chartDataService';
import type { Candle } from '../../../types/chart';
import { candleAggregationService } from '../../../services/candleAggregationService';
import { CANDLE_TIMEFRAMES, getTimeframePeriodSeconds } from '../../../utils/timeframeBoundary';
import { getTradingChartDefaultVisibleBars } from '../../../utils/chartTimeFormat';
import { useTradingChartLiveCandleRuntime } from './useTradingChartLiveCandleRuntime';
import { getStartupSnapshotCandleCount } from './chartRuntime';

const transport = vi.hoisted(() => ({
  streams: [] as CandleStreamOptions[],
  close: vi.fn(),
}));
vi.mock('../../../services/chartDataService', () => ({
  chartDataService: { subscribeCandles: (options: CandleStreamOptions) => {
    transport.streams.push(options);
    return { close: transport.close };
  } },
}));
vi.mock('../../../services/quoteSocketManager', () => ({
  getQuoteSocketManager: () => ({ onQuoteSnapshot: () => vi.fn() }),
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ ticks: {} }) } }));

type Options = Parameters<typeof useTradingChartLiveCandleRuntime>[0];
const ref = <T,>(current: T) => ({ current });
const createOptions = (): Options => ({
  symbol: 'BTCUSD', timeframe: 'M1', authToken: 'account-a-token',
  brokerAccountSessionScope: 'account-a',
  chartSelectionPresentationKey: 'account-a:BTCUSD:M1',
  visibleRuntime: { history: true, status: true, quote: true, candle: true, interval: true, overlay: true },
  isActive: true, isActiveRef: ref(true), isDisposedRef: ref(false), isRebuildingRef: ref(false),
  liveMarketDataFrozenRef: ref(false), isChartInteractionActiveRef: ref(false),
  initialHistoryLoadPendingRef: ref(true),
  brokerTimeOffsetSecRef: ref(0), synchronizedMarketClockRef: ref(null),
  prevTimeframeRef: ref('M1'), candlesRef: ref([]), currentCandleRef: ref(null),
  liveCandleMutationGenerationByTimeRef: ref(new Map()),
  liveCandleMutationGenerationRef: ref(0),
  postInteractionCallbacksRef: ref({}), postInteractionCoordinatorRef: ref(null),
  seriesRef: ref(null),
  getSynchronizedChartMarketNowMs: () => 1_788_250_045_000,
  reconcileCandlesWithLiveQuote: (candles: Candle[]) => candles,
  validateRenderedCandlesAgainstLivePrice: () => true,
  setHistoryCache: vi.fn(), updateChartData: vi.fn(), setApiError: vi.fn(),
  scheduleBoundaryTimerRef: ref(null),
} as unknown as Options);
const snapshot = (count: number): Candle[] => Array.from({ length: count }, (_, index) => ({
  time: 1_788_240_000 + index * 60, open: 100, high: 102, low: 99, close: 101,
  volume: 10, closed: true,
}));

beforeEach(() => {
  vi.useFakeTimers();
  transport.streams = [];
  transport.close.mockClear();
  candleAggregationService.getSymbols().forEach(symbol => candleAggregationService.clearSymbol(symbol));
});
afterEach(() => { vi.useRealTimers(); });

describe('current-session candle snapshot startup', () => {
  it.each(CANDLE_TIMEFRAMES.flatMap(timeframe => ['BTCUSD', 'XAUUSD.r'].map(symbol => ({ timeframe, symbol }))))(
    'reveals correctly aggregated $symbol $timeframe snapshots before REST settles', ({ symbol, timeframe }) => {
      const options = createOptions();
      options.symbol = symbol;
      options.timeframe = timeframe;
      options.prevTimeframeRef.current = timeframe;
      const periods = getStartupSnapshotCandleCount(timeframe);
      let cursor = getTimeframePeriodSeconds(1_788_240_000, timeframe)!.startTime;
      const candles: Candle[] = [];
      for (let index = 0; index < periods; index += 1) {
        candles.push({ time: cursor, open: 100, high: 102, low: 99, close: 101, volume: 10, closed: true });
        cursor = getTimeframePeriodSeconds(cursor, timeframe)!.closeTime;
      }
      const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
      act(() => transport.streams[0].onSnapshot?.(candles));
      expect(transport.streams[0].symbol).toBe(symbol);
      expect(options.initialHistoryLoadPendingRef.current).toBe(true);
      expect(options.candlesRef.current).toHaveLength(periods);
      expect(options.candlesRef.current.map(candle => candle.time)).toEqual(candles.map(candle => candle.time));
      expect(options.updateChartData).toHaveBeenCalledWith(options.candlesRef.current, undefined, expect.objectContaining({
        immediate: true, finishLoadingAfterRender: true, reason: 'stream-snapshot',
      }));
      expect(options.setHistoryCache).toHaveBeenCalledWith(
        timeframe, options.candlesRef.current, 0, timeframe === 'M1' ? 'backend' : 'derived-m1',
      );
      view.unmount();
    },
  );

  it('combines M1 OHLC and volume into M5 and omits an incomplete leading bucket', () => {
    const options = createOptions();
    options.timeframe = 'M5';
    options.prevTimeframeRef.current = 'M5';
    options.initialHistoryLoadPendingRef.current = false;
    const start = getTimeframePeriodSeconds(1_788_240_000, 'M5')!.startTime;
    const candles = [
      { time: start + 60, open: 90, high: 92, low: 89, close: 91, volume: 5, closed: true },
      { time: start + 300, open: 100, high: 102, low: 99, close: 101, volume: 10, closed: true },
      { time: start + 360, open: 101, high: 105, low: 98, close: 104, volume: 20, closed: true },
    ];
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    act(() => transport.streams[0].onSnapshot?.(candles));
    expect(options.candlesRef.current).toEqual([expect.objectContaining({
      time: start + 300, open: 100, high: 105, low: 98, close: 104, volume: 30,
    })]);
    view.unmount();
  });
  it('reveals a full snapshot while REST is still pending', () => {
    const options = createOptions();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    const candles = snapshot(getTradingChartDefaultVisibleBars('M1'));
    act(() => transport.streams[0].onSnapshot?.(candles));
    expect(options.initialHistoryLoadPendingRef.current).toBe(true);
    expect(options.updateChartData).toHaveBeenCalledWith(candles, undefined, expect.objectContaining({
      immediate: true, finishLoadingAfterRender: true, reason: 'stream-snapshot',
    }));
    view.unmount();
  });

  it('keeps a sparse snapshot covered until REST settles', () => {
    const options = createOptions();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    act(() => transport.streams[0].onSnapshot?.(snapshot(2)));
    expect(options.updateChartData).toHaveBeenLastCalledWith(expect.any(Array), undefined, expect.objectContaining({
      finishLoadingAfterRender: false,
    }));
    options.initialHistoryLoadPendingRef.current = false;
    act(() => transport.streams[0].onSnapshot?.(snapshot(2)));
    expect(options.updateChartData).toHaveBeenLastCalledWith(expect.any(Array), undefined, expect.objectContaining({
      finishLoadingAfterRender: true,
    }));
    view.unmount();
  });

  it('rejects closed-session, frozen and invalid snapshots', () => {
    const options = createOptions();
    const view = renderHook(({ token, scope }) => useTradingChartLiveCandleRuntime({
      ...options, authToken: token, brokerAccountSessionScope: scope,
    }), { initialProps: { token: 'account-a-token', scope: 'account-a' } });
    const oldStream = transport.streams[0];
    view.rerender({ token: 'account-b-token', scope: 'account-b' });
    const candles = snapshot(getTradingChartDefaultVisibleBars('M1'));
    act(() => oldStream.onSnapshot?.(candles));
    expect(options.updateChartData).not.toHaveBeenCalled();
    options.liveMarketDataFrozenRef.current = true;
    act(() => transport.streams[1].onSnapshot?.(candles));
    expect(options.updateChartData).not.toHaveBeenCalled();
    options.liveMarketDataFrozenRef.current = false;
    act(() => transport.streams[1].onSnapshot?.(candles.map(candle => ({ ...candle, open: NaN }))));
    expect(options.updateChartData).not.toHaveBeenCalled();
    view.unmount();
  });
});
