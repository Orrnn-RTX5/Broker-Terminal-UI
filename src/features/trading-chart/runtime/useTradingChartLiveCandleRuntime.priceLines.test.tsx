import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candleAggregationService } from '../../../services/candleAggregationService';
import type { LiveTick } from '../../../services/liveTickDispatcher';
import type { Candle } from '../../../types/chart';
import { LIVE_CHART_UPDATE_INTERVAL_MS } from './chartRuntime';
import { useTradingChartLiveCandleRuntime } from './useTradingChartLiveCandleRuntime';

vi.mock('../../../services/chartDataService', () => ({
  chartDataService: { subscribeCandles: () => ({ close: vi.fn() }) },
}));
vi.mock('../../../services/quoteSocketManager', () => ({
  getQuoteSocketManager: () => ({ onQuoteSnapshot: () => vi.fn() }),
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ ticks: {} }) } }));

type Options = Parameters<typeof useTradingChartLiveCandleRuntime>[0];
const ref = <T,>(current: T) => ({ current });
const currentTime = 1_788_240_000;
const createOptions = (): Options => ({
  symbol: 'BTCUSD', timeframe: 'M1', authToken: 'account-a-token',
  brokerAccountSessionScope: 'account-a',
  chartSelectionPresentationKey: 'account-a:BTCUSD:M1',
  chartSelectionPresentationRef: ref({ selectionKey: 'account-a:BTCUSD:M1', livePaintAllowed: true }),
  visibleRuntime: { history: true, status: true, quote: true, candle: true, interval: true, overlay: true },
  isActive: true, isActiveRef: ref(true), isDisposedRef: ref(false), isRebuildingRef: ref(false),
  liveMarketDataFrozenRef: ref(false), isChartInteractionActiveRef: ref(false),
  initialHistoryLoadPendingRef: ref(false),
  brokerTimeOffsetSecRef: ref(0), synchronizedMarketClockRef: ref(null),
  prevTimeframeRef: ref('M1'), candlesRef: ref([]),
  currentCandleRef: ref<Candle>({ time: currentTime, open: 100, high: 102, low: 99, close: 100, volume: 10 }),
  liveCandleMutationGenerationByTimeRef: ref(new Map()), liveCandleMutationGenerationRef: ref(0),
  postInteractionCallbacksRef: ref({}), postInteractionCoordinatorRef: ref(null),
  seriesRef: ref({ update: vi.fn() }), chartRef: ref(null), volumeRef: ref(null),
  chartSettingsRef: ref({ chartShift: false, chartAutoScroll: false, showTickVolumes: true }),
  prevChartTypeRef: ref('candlestick'), lastRenderedCandlesRef: ref([]),
  drawingRuntimeContextRef: ref({ contextId: 'chart-a', symbol: 'BTCUSD', timeframe: 'M1' }),
  drawingRenderFrameRef: ref(1), drawingRenderSettledFrameRef: ref(1),
  updateLegendDOM: vi.fn(), repaintLivePriceOverlayFromCurrentPrice: vi.fn(),
  flushPostInteractionWork: vi.fn(),
  hasDisplayedHistoryRef: ref(true), protectedDisplayedHistoryRef: ref([]),
  lastAcceptedQuoteRef: ref(null), incompatibleQuoteCountRef: ref(0),
  activeTradeSnapshotsRef: ref(new Map()), tradeLevelCrossRefreshPendingRef: ref(new Set()),
  tradeLevelCrossCloseCandidatesRef: ref(new Map()),
  getSynchronizedChartMarketNowMs: () => (currentTime + 10) * 1000,
  synchronizeChartMarketClock: vi.fn(),
  validateRenderedCandlesAgainstLivePrice: vi.fn(() => true), isLivePriceSafeForCandles: vi.fn(() => true),
  syncSupplementalPriceLines: vi.fn(), setApiError: vi.fn(), discardRetainedPublicChartSurface: vi.fn(),
  scheduleBoundaryTimerRef: ref(null),
} as unknown as Options);

const quote = (overrides: Partial<LiveTick> = {}): LiveTick => ({
  symbol: 'BTCUSD', bid: 101, ask: 101.2, timestamp: currentTime + 10,
  ...overrides,
} as LiveTick);
const pollQuote = (tick: LiveTick, symbol = tick.symbol): void => {
  window.rtxTickCache.set(symbol, tick);
  act(() => { vi.advanceTimersByTime(LIVE_CHART_UPDATE_INTERVAL_MS); });
};

let previousTickCache: Window['rtxTickCache'];
beforeEach(() => {
  vi.useFakeTimers();
  previousTickCache = window.rtxTickCache;
  window.rtxTickCache = new Map();
  candleAggregationService.getSymbols().forEach(symbol => candleAggregationService.clearSymbol(symbol));
});
afterEach(() => {
  window.rtxTickCache = previousTickCache;
  vi.useRealTimers();
});

describe('validated quote price-line painting', () => {
  it.each([
    ['M1', '2026-10-06T23:59:00Z', '2026-10-07T00:00:00Z', 0],
    ['M5', '2026-10-06T23:55:00Z', '2026-10-07T00:00:00Z', 0],
    ['M15', '2026-10-06T23:45:00Z', '2026-10-07T00:00:00Z', 0],
    ['M30', '2026-10-06T23:30:00Z', '2026-10-07T00:00:00Z', 0],
    ['H1', '2026-10-06T23:00:00Z', '2026-10-07T00:00:00Z', 0],
    ['H4', '2026-10-04T20:00:00Z', '2026-10-05T00:00:00Z', 0],
    ['D1', '2026-10-31T00:00:00Z', '2026-11-01T00:00:00Z', 0],
    ['W1', '2026-12-28T00:00:00Z', '2027-01-04T00:00:00Z', 0],
    ['MN', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z', 0],
    ['M1', '2026-10-06T21:59:00Z', '2026-10-06T22:00:00Z', 7200],
  ] as const)('rebuilds separators once when a live %s quote opens a new period', (timeframe, previous, next, offset) => {
    const options = createOptions();
    options.timeframe = timeframe;
    options.prevTimeframeRef.current = timeframe;
    options.prevSymbolRef = ref('BTCUSD');
    options.brokerTimeOffsetSecRef.current = offset;
    options.currentCandleRef.current!.time = Date.parse(previous) / 1000;
    options.chartRef = ref({} as NonNullable<Options['chartRef']['current']>);
    options.autoScrollEnabledRef = ref(false);
    options.requestChartDataRender = vi.fn();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    const timestamp = Date.parse(next) / 1000;
    pollQuote(quote({ timestamp }));
    expect(options.currentCandleRef.current?.time).toBe(timestamp);
    expect(options.seriesRef.current!.update).toHaveBeenCalled();
    expect(options.requestChartDataRender).toHaveBeenCalledExactlyOnceWith({ reason: 'market-gap-refresh' });
    pollQuote(quote({ timestamp: timestamp + 1, bid: 101.1 }));
    expect(options.requestChartDataRender).toHaveBeenCalledOnce();
    view.unmount();
  });

  it.each([
    { name: 'rendered candle scale', guard: 'validateRenderedCandlesAgainstLivePrice' },
    { name: 'live price safety', guard: 'isLivePriceSafeForCandles' },
  ] as const)('does not paint ASK or LAST when the $name guard rejects a quote', ({ guard }) => {
    const options = createOptions();
    vi.mocked(options[guard]).mockReturnValue(false);
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    pollQuote(quote());
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(options.currentCandleRef.current?.close).toBe(100);
    expect(options.setApiError).toHaveBeenCalledWith(expect.stringContaining('outside the candle range'));
    view.unmount();
  });

  it.each([NaN, Infinity, 0, -1, undefined])(
    'does not paint ASK or LAST for an invalid source timestamp %s', timestamp => {
      const options = createOptions();
      const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
      pollQuote(quote({ timestamp }));
      expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
      expect(options.currentCandleRef.current?.close).toBe(100);
      view.unmount();
    },
  );

  it('rejects a malformed source timestamp even when the receipt timestamp is valid', () => {
    const options = createOptions();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    pollQuote(quote({ sourceTimestamp: NaN }));
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(options.currentCandleRef.current?.close).toBe(100);
    view.unmount();
  });

  it('does not paint an ASK line for a quote without a valid raw price', () => {
    const options = createOptions();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    pollQuote(quote({ bid: NaN, ask: NaN }));
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(options.liveCandleMutationGenerationRef.current).toBe(0);
    view.unmount();
  });

  it.each([1, 1000])('ignores a late quote with a timestamp in seconds multiplied by %s', factor => {
    const options = createOptions();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    pollQuote(quote({ sourceTimestamp: (currentTime - 1) * factor, ask: 110 }));
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(options.currentCandleRef.current?.close).toBe(100);
    expect(options.liveCandleMutationGenerationRef.current).toBe(0);
    pollQuote(quote({ sourceTimestamp: (currentTime + 10) * factor }));
    expect(options.syncSupplementalPriceLines).toHaveBeenCalledExactlyOnceWith(101.2, 101);
    expect(options.currentCandleRef.current?.close).toBe(101);
    view.unmount();
  });

  it('paints the executable ASK and raw LAST only for an accepted current quote', () => {
    const options = createOptions();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    pollQuote(quote({ bid: 100.9, ask: 101.3, rawBid: 101, rawAsk: 101.2 }));
    expect(options.syncSupplementalPriceLines).toHaveBeenCalledExactlyOnceWith(101.3, 101);
    expect(options.currentCandleRef.current?.close).toBe(101);
    expect(options.liveCandleMutationGenerationRef.current).toBe(1);
    view.unmount();
  });

  it('holds ASK and LAST behind the selection gate and paints them after history opens it', () => {
    const options = createOptions();
    options.chartSelectionPresentationRef.current.livePaintAllowed = false;
    options.requestChartDataRender = vi.fn();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    pollQuote(quote());
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(options.currentCandleRef.current?.close).toBe(101);
    options.chartSelectionPresentationRef.current.livePaintAllowed = true;
    act(() => { vi.advanceTimersByTime(LIVE_CHART_UPDATE_INTERVAL_MS); });
    expect(options.syncSupplementalPriceLines).toHaveBeenCalledExactlyOnceWith(101.2, 101);
    expect(options.liveCandleMutationGenerationRef.current).toBe(1);
    view.unmount();
  });

  it('rejects a pending quote when the newly committed baseline has a different price scale', () => {
    const options = createOptions();
    options.chartSelectionPresentationRef.current.livePaintAllowed = false;
    options.requestChartDataRender = vi.fn();
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    pollQuote(quote());
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    vi.mocked(options.validateRenderedCandlesAgainstLivePrice).mockReturnValue(false);
    options.chartSelectionPresentationRef.current.livePaintAllowed = true;
    act(() => { vi.advanceTimersByTime(2 * LIVE_CHART_UPDATE_INTERVAL_MS); });
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(options.validateRenderedCandlesAgainstLivePrice).toHaveBeenCalledTimes(2);
    expect(options.liveCandleMutationGenerationRef.current).toBe(1);
    view.unmount();
  });

  it('discards the retained public surface before clearing mismatched sparse H1 data', () => {
    const options = createOptions();
    options.timeframe = 'H1';
    options.prevTimeframeRef.current = 'H1';
    options.chartSelectionPresentationKey = 'account-a:BTCUSD:H1';
    options.chartSelectionPresentationRef.current = {
      selectionKey: options.chartSelectionPresentationKey, livePaintAllowed: false,
    };
    options.hasDisplayedHistoryRef.current = false;
    options.candlesRef.current = [{ ...options.currentCandleRef.current! }];
    vi.mocked(options.validateRenderedCandlesAgainstLivePrice).mockReturnValue(false);
    options.restoreProtectedDisplayedHistory = vi.fn(() => false);
    options.resetLiveQuotePriceGuard = vi.fn();
    options.cancelQueuedChartRender = vi.fn();
    options.clearPeriodSeparators = vi.fn();
    options.hideLivePriceOverlay = vi.fn();
    options.requestChartDataRender = vi.fn();
    options.prevPriceRef = ref(null);
    options.renderedPriceReferenceRef = ref(null);
    options.periodSeparatorsRef = ref([]);
    options.firstRenderedCandleTimeRef = ref(null);
    options.resetVisibleRangeOnNextDataRef = ref(false);
    options.leftVisibleTimeRef = ref(null);
    options.lastVisibleLogicalRangeRef = ref(null);
    options.lastStoreCandleSecRef = ref(0);
    const setData = vi.fn();
    options.seriesRef.current!.setData = setData;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = renderHook(() => useTradingChartLiveCandleRuntime(options));
    for (let index = 0; index < 3; index += 1) {
      pollQuote(quote({ timestamp: currentTime + 10 + index }));
    }
    expect(options.discardRetainedPublicChartSurface).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledExactlyOnceWith([]);
    expect(vi.mocked(options.discardRetainedPublicChartSurface).mock.invocationCallOrder[0])
      .toBeLessThan(setData.mock.invocationCallOrder[0]);
    expect(options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(options.hideLivePriceOverlay).toHaveBeenCalledOnce();
    view.unmount();
    warning.mockRestore();
  });
});
