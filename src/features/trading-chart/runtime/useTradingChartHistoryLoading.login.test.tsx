// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candleAggregationService } from '../../../services/candleAggregationService';
import { createSelectedTimeframeHistoryCoordinator, createChartHistoryBackfillDiagnostics } from '../../../services/chartHistoryLoader';
import { createRenderedPriceReference } from '../../../services/chartPriceGuards';
import { defaultChartProperties } from '../../../store/useChartSettingsStore';
import type { Candle } from '../../../types/chart';
import { CANDLE_TIMEFRAMES, getTimeframePeriodSeconds } from '../../../utils/timeframeBoundary';
import { useTradingChartHistoryLoading } from './useTradingChartHistoryLoading';

const transport = vi.hoisted(() => ({ fetch: vi.fn(), derive: vi.fn(), ticks: {} as Record<string, unknown> }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ ticks: transport.ticks }) } }));
vi.mock('../../../services/chartDataService', () => ({
  chartDataService: { fetchCandles: transport.fetch },
}));
vi.mock('../../../services/derivedTimeframeHistoryService', async importOriginal => ({
  ...await importOriginal<typeof import('../../../services/derivedTimeframeHistoryService')>(),
  fetchDerivedTimeframeCandlesFromM1: transport.derive,
}));
vi.mock('../../../startup/waitForTerminalReady', () => ({
  // This test owns only the initial replacement, not background gap repair.
  waitForTerminalReady: () => Promise.resolve(false),
}));

type Options = Parameters<typeof useTradingChartHistoryLoading>[0];
const ref = <T,>(current: T) => ({ current });
const candles: Candle[] = [
  { time: 1_788_240_000, open: 100, high: 103, low: 99, close: 101, volume: 8, closed: true },
  { time: 1_788_243_600, open: 101, high: 105, low: 100, close: 104, volume: 12, closed: true },
];
const derivedResponse = (rows: Candle[]) => ({
  candles: rows, m1Candles: [], pagesFetched: 1, m1CandlesFetched: 0,
  requestedTo: null, targetTimeframe: 'H1', reachedBeginning: rows.length === 0, aborted: false,
});

const createHarness = () => {
  let retainedPublicSurface = true;
  const priceSetData = vi.fn();
  const volumeSetData = vi.fn();
  const discard = vi.fn(() => { retainedPublicSurface = false; });
  const coordinator = createSelectedTimeframeHistoryCoordinator();
  const options = {
    symbol: 'XAUUSD.raw', timeframe: 'H1', brokerTimeOffsetSec: 0,
    brokerTimeOffsetSecRef: ref(0),
    candlesRef: ref<Candle[]>([]), currentCandleRef: ref<Candle | null>(null),
    chartRef: ref({ timeScale: () => ({ scrollToRealTime: vi.fn() }) }),
    chartSettingsRef: ref(defaultChartProperties),
    seriesRef: ref({ setData: priceSetData }), volumeRef: ref({ setData: volumeSetData }),
    historyRequestCoordinatorRef: ref(coordinator),
    historyBackfillDiagnosticsRef: ref(createChartHistoryBackfillDiagnostics()),
    hasDisplayedHistoryRef: ref(false), protectedDisplayedHistoryRef: ref<Candle[]>([]),
    hasReachedBeginningRef: ref(false), isLoadingMoreRef: ref(false), isDisposedRef: ref(false),
    initialHistoryLoadPendingRef: ref(false), initialHistoryLoadSequenceRef: ref(0),
    lastStoreCandleSecRef: ref(0), prevPriceRef: ref(null), prevTimeframeRef: ref('H1'),
    liveCandleMutationGenerationRef: ref(0), liveCandleMutationGenerationByTimeRef: ref(new Map()),
    renderedPriceReferenceRef: ref(createRenderedPriceReference([])),
    resetVisibleRangeOnNextDataRef: ref(true), scheduleBoundaryTimerRef: ref(null),
    hydrateHistoryFromCache: vi.fn(() => false), restoreProtectedDisplayedHistory: vi.fn(() => false),
    reconcileCandlesWithLiveQuote: vi.fn((rows: Candle[]) => rows),
    getLatestRenderableCandle: (rows: Candle[]) => rows.at(-1) ?? null,
    discardRetainedPublicChartSurface: discard,
    resetEmptyHistoryState: vi.fn(), resetLiveQuotePriceGuard: vi.fn(),
    setLoadingPhase: vi.fn(), setApiError: vi.fn(),
    updateChartData: vi.fn(), requestChartDataRender: vi.fn(), updateLegendDOM: vi.fn(),
    setHistoryCache: vi.fn(), mergeHistoryCache: vi.fn(), reloadAggregationCandles: vi.fn(),
    buildHistoryCacheTarget: vi.fn(), fetchOlderHistoryPage: vi.fn(),
    isVisibleRangeHistoryLoadSuppressed: () => false,
  } as unknown as Options;
  return { options, discard, priceSetData, volumeSetData, coordinator,
    surfaceIsRetained: () => retainedPublicSurface };
};

beforeEach(() => {
  transport.fetch.mockReset().mockResolvedValue([]);
  transport.derive.mockReset().mockResolvedValue(derivedResponse([]));
  transport.ticks = {};
});
afterEach(() => {
  cleanup();
  candleAggregationService.clearSymbol('XAUUSD.raw');
  candleAggregationService.clearSymbol('BTCUSD');
});

describe('retained public canvas during account history replacement', () => {
  it.each(['empty REST history', 'history rejected by the live-quote guard'])
    ('restores the full loader before clearing the canvas for %s', async reason => {
      const harness = createHarness();
      if (reason === 'history rejected by the live-quote guard') {
        transport.derive.mockResolvedValue(derivedResponse(candles));
        vi.mocked(harness.options.reconcileCandlesWithLiveQuote).mockReturnValue([]);
      }
      const view = renderHook(() => useTradingChartHistoryLoading(harness.options));
      await act(() => view.result.current.loadHistory('XAUUSD.raw', 'H1'));

      expect(harness.discard).toHaveBeenCalledTimes(1);
      expect(harness.surfaceIsRetained()).toBe(false);
      expect(harness.priceSetData).toHaveBeenCalledExactlyOnceWith([]);
      expect(harness.volumeSetData).toHaveBeenCalledExactlyOnceWith([]);
      expect(harness.discard.mock.invocationCallOrder[0]).toBeLessThan(harness.priceSetData.mock.invocationCallOrder[0]);
      expect(harness.discard.mock.invocationCallOrder[0]).toBeLessThan(harness.volumeSetData.mock.invocationCallOrder[0]);
      expect(harness.options.updateChartData).not.toHaveBeenCalled();
      expect(harness.options.setLoadingPhase).toHaveBeenLastCalledWith('receiving');
    });

  it('keeps the public surface until usable current-owner history is handed to the render owner', async () => {
    const harness = createHarness();
    let resolveHistory!: (value: ReturnType<typeof derivedResponse>) => void;
    transport.derive.mockReturnValue(new Promise(resolve => { resolveHistory = resolve; }));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));
    let loading!: Promise<void>;
    act(() => { loading = view.result.current.loadHistory('XAUUSD.raw', 'H1'); });
    expect(harness.options.initialHistoryLoadPendingRef.current).toBe(true);
    expect(harness.surfaceIsRetained()).toBe(true);
    expect(harness.discard).not.toHaveBeenCalled();
    expect(harness.priceSetData).not.toHaveBeenCalled();

    await act(async () => { resolveHistory(derivedResponse(candles)); await loading; });

    expect(harness.options.updateChartData).toHaveBeenCalledExactlyOnceWith(candles, undefined, expect.objectContaining({
      immediate: true, finishLoadingAfterRender: true, reason: 'initial-history',
    }));
    expect(harness.options.candlesRef.current).toEqual(candles);
    // The hook queues the replacement; it never exposes an empty canvas or
    // dismisses the retained presentation before that render actually commits.
    expect(harness.surfaceIsRetained()).toBe(true);
    expect(harness.discard).not.toHaveBeenCalled();
    expect(harness.priceSetData).not.toHaveBeenCalled();
    expect(harness.volumeSetData).not.toHaveBeenCalled();
  });

  it('ignores an abandoned owner response instead of invalidating the current retained surface', async () => {
    const harness = createHarness();
    let resolveHistory!: (value: ReturnType<typeof derivedResponse>) => void;
    transport.derive.mockReturnValue(new Promise(resolve => { resolveHistory = resolve; }));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));
    let loading!: Promise<void>;
    act(() => { loading = view.result.current.loadHistory('XAUUSD.raw', 'H1'); });
    harness.coordinator.abort();
    await act(async () => { resolveHistory(derivedResponse(candles)); await loading; });
    expect(harness.discard).not.toHaveBeenCalled();
    expect(harness.options.updateChartData).not.toHaveBeenCalled();
    expect(harness.priceSetData).not.toHaveBeenCalled();
    expect(harness.volumeSetData).not.toHaveBeenCalled();
    expect(harness.options.candlesRef.current).toEqual([]);
    expect(harness.surfaceIsRetained()).toBe(true);
  });
});

describe('current-session live candle while loading initial history', () => {
  it.each(['BTCUSD', 'XAUUSD.raw'].flatMap(symbol => CANDLE_TIMEFRAMES.map(timeframe => ({ symbol, timeframe }))))
    ('keeps a proven live $symbol $timeframe bucket received before the history request', async ({ symbol, timeframe }) => {
    const harness = createHarness();
    harness.options.symbol = symbol;
    harness.options.timeframe = timeframe;
    harness.options.prevTimeframeRef.current = timeframe;
    const period = getTimeframePeriodSeconds(candles[0].time, timeframe)!;
    const history: Candle[] = [
      { ...candles[0], time: getTimeframePeriodSeconds(period.startTime - 1, timeframe)!.startTime },
      { ...candles[0], time: period.startTime },
    ];
    const forming: Candle = {
      time: period.closeTime,
      open: 104, high: 106, low: 103, close: 105, volume: 2, tickVolume: 2, closed: false,
    };
    harness.options.candlesRef.current = [forming];
    harness.options.currentCandleRef.current = forming;
    harness.options.liveCandleMutationGenerationRef.current = 1;
    harness.options.liveCandleMutationGenerationByTimeRef.current.set(forming.time, 1);
    if (timeframe === 'M1') transport.fetch.mockResolvedValue(history);
    else transport.derive.mockResolvedValue(derivedResponse(history));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));

    await act(() => view.result.current.loadHistory(symbol, timeframe));

    expect(harness.options.candlesRef.current).toEqual([...history, forming]);
    expect(harness.options.currentCandleRef.current).toEqual(forming);
    expect(harness.options.updateChartData).toHaveBeenCalledWith([...history, forming], undefined, expect.objectContaining({
      reason: 'initial-history',
    }));
  });

  it('keeps the proven live bucket when cache hydration replaces the working refs first', async () => {
    const harness = createHarness();
    const forming: Candle = { ...candles[1], time: Math.floor(candles[1].time / 3600) * 3600 + 3600, closed: false };
    harness.options.candlesRef.current = [forming];
    harness.options.currentCandleRef.current = forming;
    harness.options.liveCandleMutationGenerationRef.current = 1;
    harness.options.liveCandleMutationGenerationByTimeRef.current.set(forming.time, 1);
    vi.mocked(harness.options.hydrateHistoryFromCache).mockImplementation(() => {
      harness.options.candlesRef.current = [...candles];
      harness.options.currentCandleRef.current = { ...candles[1] };
      return true;
    });
    transport.derive.mockResolvedValue(derivedResponse(candles));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));

    await act(() => view.result.current.loadHistory('XAUUSD.raw', 'H1'));

    expect(harness.options.candlesRef.current).toEqual([...candles, forming]);
    expect(harness.options.currentCandleRef.current).toEqual(forming);
  });

  it.each(['unproven cache', 'completed current candle'])('does not keep a later tail from %s', async source => {
    const harness = createHarness();
    const tail: Candle = { ...candles[1], time: candles[1].time + 3600, closed: source === 'completed current candle' };
    harness.options.candlesRef.current = [tail];
    harness.options.currentCandleRef.current = tail;
    if (source === 'completed current candle') {
      harness.options.liveCandleMutationGenerationRef.current = 1;
      harness.options.liveCandleMutationGenerationByTimeRef.current.set(tail.time, 1);
    }
    transport.derive.mockResolvedValue(derivedResponse(candles));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));

    await act(() => view.result.current.loadHistory('XAUUSD.raw', 'H1'));

    expect(harness.options.candlesRef.current).toEqual(candles);
  });

  it('keeps backend finality authoritative when history covers the live bucket', async () => {
    const harness = createHarness();
    const localForming: Candle = { ...candles[1], high: 107, close: 106, closed: false };
    harness.options.candlesRef.current = [localForming];
    harness.options.currentCandleRef.current = localForming;
    harness.options.liveCandleMutationGenerationRef.current = 1;
    harness.options.liveCandleMutationGenerationByTimeRef.current.set(localForming.time, 1);
    transport.derive.mockResolvedValue(derivedResponse(candles));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));

    await act(() => view.result.current.loadHistory('XAUUSD.raw', 'H1'));

    expect(harness.options.candlesRef.current).toEqual(candles);
  });

  it.each(['forming', 'final', 'receipt-only timestamp', 'another period', 'another exact symbol'] as const)
    ('reconciles same-period initial history with the raw live Bid for %s quote ownership', async scenario => {
    const harness = createHarness();
    const boundary = getTimeframePeriodSeconds(candles[1].time, 'H1')!.startTime;
    const history = [{ ...candles[0], time: boundary - 3600 }, {
      ...candles[1], time: boundary, closed: scenario === 'final',
    }];
    const forming = { ...history[1], close: 106, high: 108, closed: false };
    harness.options.candlesRef.current = [forming];
    harness.options.currentCandleRef.current = forming;
    harness.options.liveCandleMutationGenerationRef.current = 1;
    harness.options.liveCandleMutationGenerationByTimeRef.current.set(forming.time, 1);
    transport.ticks['XAUUSD.raw'] = {
      symbol: scenario === 'another exact symbol' ? 'XAUUSD' : 'XAUUSD.raw',
      bid: 105.5, ask: 108.5, rawBid: 106, rawAsk: 108,
      timestamp: (boundary + 10) * 1000,
      sourceTimestamp: scenario === 'receipt-only timestamp' ? undefined
        : (boundary + (scenario === 'another period' ? -10 : 10)) * 1000,
    };
    transport.derive.mockResolvedValue(derivedResponse(history));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));

    await act(() => view.result.current.loadHistory('XAUUSD.raw', 'H1'));

    expect(harness.options.candlesRef.current).toEqual(scenario === 'forming' ? [history[0], {
      ...history[1], high: 106, close: 106,
    }] : history);
  });

  it('keeps a newer server partial of the proven live bucket while history is in flight', async () => {
    const harness = createHarness();
    const forming: Candle = { ...candles[1], time: Math.floor(candles[1].time / 3600) * 3600 + 3600, closed: false };
    harness.options.candlesRef.current = [forming];
    harness.options.currentCandleRef.current = forming;
    harness.options.liveCandleMutationGenerationRef.current = 1;
    harness.options.liveCandleMutationGenerationByTimeRef.current.set(forming.time, 1);
    let resolveHistory!: (value: ReturnType<typeof derivedResponse>) => void;
    transport.derive.mockReturnValue(new Promise(resolve => { resolveHistory = resolve; }));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));
    let loading!: Promise<void>;
    act(() => { loading = view.result.current.loadHistory('XAUUSD.raw', 'H1'); });
    const expanded = { ...forming, high: 110, close: 109, volume: 16, tickVolume: 16 };
    harness.options.currentCandleRef.current = expanded;
    harness.options.candlesRef.current = [expanded];

    await act(async () => { resolveHistory(derivedResponse(candles)); await loading; });

    expect(harness.options.candlesRef.current).toEqual([...candles, expanded]);
    expect(harness.options.currentCandleRef.current).toEqual(expanded);
  });

  it('does not reopen a captured live bucket finalized while history is in flight', async () => {
    const harness = createHarness();
    const forming: Candle = { ...candles[1], time: Math.floor(candles[1].time / 3600) * 3600 + 3600, closed: false };
    harness.options.candlesRef.current = [forming];
    harness.options.currentCandleRef.current = forming;
    harness.options.liveCandleMutationGenerationRef.current = 1;
    harness.options.liveCandleMutationGenerationByTimeRef.current.set(forming.time, 1);
    let resolveHistory!: (value: ReturnType<typeof derivedResponse>) => void;
    transport.derive.mockReturnValue(new Promise(resolve => { resolveHistory = resolve; }));
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));
    let loading!: Promise<void>;
    act(() => { loading = view.result.current.loadHistory('XAUUSD.raw', 'H1'); });
    harness.options.currentCandleRef.current = { ...forming, closed: true };
    harness.options.candlesRef.current = [harness.options.currentCandleRef.current];

    await act(async () => { resolveHistory(derivedResponse(candles)); await loading; });

    expect(harness.options.candlesRef.current).toEqual(candles);
  });

  it('retains the real M1 builder tail behind a proven later derived H1 candle', async () => {
    const harness = createHarness();
    const period = getTimeframePeriodSeconds(candles[0].time, 'H1')!;
    const sourceM1: Candle = { ...candles[0], time: period.closeTime - 60, closed: true };
    candleAggregationService.processTick({ symbol: 'XAUUSD.raw', bid: 111, ask: 112, timestamp: period.closeTime + 5, volume: 1 });
    const updates = candleAggregationService.processTick({ symbol: 'XAUUSD.raw', bid: 105, ask: 106, timestamp: period.closeTime + 6, volume: 1 });
    const currentH1 = updates.get('H1')!;
    const forming: Candle = { ...currentH1, tickVolume: currentH1.volume, closed: false };
    const liveM1 = candleAggregationService.getCandles('XAUUSD.raw', 'M1', true, false).at(-1)!;
    harness.options.candlesRef.current = [forming];
    harness.options.currentCandleRef.current = forming;
    harness.options.liveCandleMutationGenerationRef.current = 2;
    harness.options.liveCandleMutationGenerationByTimeRef.current.set(forming.time, 2);
    transport.derive.mockResolvedValue({
      ...derivedResponse([{ ...candles[0], time: period.startTime }]),
      m1Candles: [sourceM1], m1CandlesFetched: 1,
    });
    const view = renderHook(() => useTradingChartHistoryLoading(harness.options));

    await act(() => view.result.current.loadHistory('XAUUSD.raw', 'H1'));

    expect(harness.options.currentCandleRef.current).toMatchObject(forming);
    expect(candleAggregationService.getCandles('XAUUSD.raw', 'M1', true, false).at(-1)).toEqual(liveM1);
    expect(candleAggregationService.getCandles('XAUUSD.raw', 'H1', true, false).at(-1)).toMatchObject({
      time: forming.time, open: 111, high: 111, low: 105, close: 105,
    });
  });
});
