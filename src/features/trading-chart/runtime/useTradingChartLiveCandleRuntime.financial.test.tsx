import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../../types/chart';
import type { NormalizedQuoteTick } from '../../../services/quotePayloadNormalizer';
import { candleAggregationService } from '../../../services/candleAggregationService';
import { createChartPostInteractionCoordinator, type ChartPostInteractionCallbacks } from '../../../utils/chartPostInteractionCoordinator';
import { useTradingChartLiveCandleRuntime } from './useTradingChartLiveCandleRuntime';

const transport = vi.hoisted(() => ({
  financial: undefined as ((tick: NormalizedQuoteTick) => void) | undefined,
  candle: undefined as ((candle: Candle) => void) | undefined,
  snapshot: undefined as ((candles: Candle[]) => void) | undefined,
  close: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('../../../services/quoteSocketManager', () => ({
  getQuoteSocketManager: () => ({ onFinancialQuote: (_symbol: string, callback: (tick: NormalizedQuoteTick) => void) => {
    transport.financial = callback; return transport.unsubscribe;
  } }),
}));
vi.mock('../../../services/chartDataService', () => ({ chartDataService: {
  subscribeCandles: (options: { onCandle: (candle: Candle) => void; onSnapshot: (candles: Candle[]) => void }) => {
    transport.candle = options.onCandle; transport.snapshot = options.onSnapshot; return { close: transport.close };
  },
} }));
vi.mock('../../../services/chartQuoteDiagnostics', () => ({ recordChartQuoteSelection: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ accountId: '200001', ticks: {} }) } }));

const epoch = Date.UTC(2026, 9, 5, 10);
const bar = (time = epoch / 1000): Candle => ({ time, open: 100, high: 100, low: 100, close: 100, volume: 1, tickVolume: 1 });
const quote = (offset: number, bid: number, sequence: string, kind: 'snapshot' | 'event'): NormalizedQuoteTick => ({
  symbol: 'BTCUSD', bid, ask: bid + 1, spread: 1, timestamp: epoch + offset, sourceTimestamp: epoch + offset,
  provider_timestamp: epoch + offset, source: 'cserver', sequence, quoteDeliveryKind: kind,
});
const ref = <T,>(current: T) => ({ current });

function fixture() {
  const initial = bar();
  const currentCandleRef = ref<Candle | null>({ ...initial });
  const candlesRef = ref<Candle[]>([]);
  const isChartInteractionActiveRef = ref(false);
  const repaint = vi.fn();
  const seriesUpdate = vi.fn();
  const callbacks: ChartPostInteractionCallbacks = {
    consumeHistory: vi.fn(), prepareLiveModel: vi.fn(), paintModel: () => false,
    paintLive: vi.fn(), paintSeparators: vi.fn(), layoutOverlay: vi.fn(),
  };
  const coordinator = createChartPostInteractionCoordinator(callbacks);
  const backing: Record<string, unknown> = {
    diagnosticChartId: 'test-chart', symbol: 'BTCUSD', timeframe: 'M1', authToken: null,
    brokerAccountSessionScope: 'test-session', isActive: true, visibleRuntime: { candle: true },
    chartSelectionPresentationKey: 'selection',
    chartSelectionPresentationRef: ref({ selectionKey: 'selection', livePaintAllowed: true }),
    currentCandleRef, candlesRef, isChartInteractionActiveRef,
    isActiveRef: ref(true), isDisposedRef: ref(false), isRebuildingRef: ref(false), liveMarketDataFrozenRef: ref(false),
    brokerTimeOffsetSecRef: ref(0), autoScrollEnabledRef: ref(false), prevChartTypeRef: ref('candlestick'),
    prevSymbolRef: ref('BTCUSD'), prevTimeframeRef: ref('M1'), chartRef: ref(null), volumeRef: ref(null),
    seriesRef: ref({ update: seriesUpdate }), chartSettingsRef: ref({ chartAutoScroll: false }),
    chartThemeRef: ref({}), drawingRuntimeContextRef: ref({ contextId: 'test', symbol: 'BTCUSD', timeframe: 'M1' }),
    lastRenderedCandlesRef: ref<Candle[]>([]), protectedDisplayedHistoryRef: ref<Candle[]>([]), periodSeparatorsRef: ref([]),
    hasDisplayedHistoryRef: ref(true), initialHistoryLoadPendingRef: ref(false), incompatibleQuoteCountRef: ref(0),
    lastAcceptedQuoteRef: ref<number | null>(100), liveCandleMutationGenerationRef: ref(0),
    liveCandleMutationGenerationByTimeRef: ref(new Map()), activeTradeSnapshotsRef: ref(new Map()),
    tradeLevelCrossCloseCandidatesRef: ref(new Map()), tradeLevelCrossRefreshPendingRef: ref(new Set()),
    lastCrossRefreshDispatchAtRef: ref(0),
    postInteractionCallbacksRef: ref(callbacks), postInteractionCoordinatorRef: ref(coordinator),
    flushPostInteractionWork: () => isChartInteractionActiveRef.current ? false : coordinator.flush(),
    getSynchronizedChartMarketNowMs: () => Date.now(), synchronizeChartMarketClock: vi.fn(),
    validateRenderedCandlesAgainstLivePrice: () => true, isLivePriceSafeForCandles: () => true,
    isPotentialMarketClosedPlaceholder: () => false, reconcileCandlesWithLiveQuote: (rows: Candle[]) => rows,
    repaintLivePriceOverlayFromCurrentPrice: repaint,
    mergeCandleIntoRef: (incoming: Candle) => {
      candlesRef.current = [...candlesRef.current.filter(row => row.time !== incoming.time), incoming].sort((a, b) => a.time - b.time);
    },
  };
  // Unused presentation callbacks are inert; refs default to null. Actual
  // interval, raw listener, aggregation, mutation and interaction coordinator run.
  const options = new Proxy(backing, { get(target, key: string) {
    if (!(key in target)) target[key] = key.endsWith('Ref') ? ref(null) : vi.fn();
    return target[key];
  } }) as unknown as Parameters<typeof useTradingChartLiveCandleRuntime>[0];
  const mounted = renderHook(() => useTradingChartLiveCandleRuntime(options));
  const poll = (tick: NormalizedQuoteTick) => act(() => {
    window.rtxTickCache.set('BTCUSD', tick);
    vi.advanceTimersByTime(50);
  });
  const financial = (tick: NormalizedQuoteTick) => act(() => transport.financial!(tick));
  return { options, initial, currentCandleRef, candlesRef, isChartInteractionActiveRef, repaint, seriesUpdate, poll, financial, mounted };
}

describe('actual live candle runtime financial/snapshot boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(epoch + 70_000);
    window.rtxTickCache = new Map();
    candleAggregationService.clearSymbol('BTCUSD');
    transport.close.mockClear(); transport.unsubscribe.mockClear();
  });
  afterEach(() => {
    cleanup(); candleAggregationService.clearSymbol('BTCUSD');
    vi.restoreAllMocks(); vi.useRealTimers();
  });

  it('paints snapshot price and refreshes crossed SL/TP without mutating candle or counting a tick', () => {
    const f = fixture();
    f.options.activeTradeSnapshotsRef.current.set('trade:1', { key: 'trade:1', side: 'BUY', tp: 110 } as never);
    const refresh = vi.fn(); window.addEventListener('rtx:force-refresh-positions', refresh);
    try {
      f.poll(quote(69_000, 115, '4', 'snapshot'));
      expect(f.currentCandleRef.current).toEqual(f.initial);
      expect(f.candlesRef.current).toEqual([]);
      expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toEqual([]);
      expect(f.seriesUpdate).not.toHaveBeenCalled();
      expect(f.repaint).toHaveBeenLastCalledWith({ ...f.initial, close: 115 });
      expect(f.options.syncSupplementalPriceLines).toHaveBeenLastCalledWith(116, 115);
      expect(f.options.synchronizeChartMarketClock).toHaveBeenCalledWith(epoch + 69_000);
      expect(refresh).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('rtx:force-refresh-positions', refresh); }
  });

  it('defers snapshot ASK/LAST lines until the account baseline owns the canvas', () => {
    const f = fixture();
    f.options.chartSelectionPresentationRef.current.livePaintAllowed = false;
    const tick = quote(69_000, 115, '4', 'snapshot');
    f.poll(tick);
    expect(f.options.syncSupplementalPriceLines).not.toHaveBeenCalled();
    expect(f.repaint).not.toHaveBeenCalled();
    f.options.chartSelectionPresentationRef.current.livePaintAllowed = true;
    f.poll(tick);
    expect(f.options.syncSupplementalPriceLines).toHaveBeenLastCalledWith(116, 115);
    expect(f.currentCandleRef.current).toEqual(f.initial);
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toEqual([]);
  });

  it('retains cross-minute raw extremes and paints caught-up identical snapshot identity', () => {
    const f = fixture();
    f.financial(quote(1000, 100, '1', 'event'));
    f.poll(quote(69_000, 102, '4', 'snapshot'));
    expect(f.currentCandleRef.current?.time).toBe(epoch / 1000);
    for (const tick of [quote(59_000, 130, '2', 'event'), quote(61_000, 80, '3', 'event'), quote(69_000, 102, '4', 'event')]) f.financial(tick);
    f.poll(quote(69_000, 102, '4', 'event'));
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toMatchObject([
      { time: epoch / 1000, open: 100, high: 130, low: 100, close: 130, volume: 2 },
      { time: epoch / 1000 + 60, open: 80, high: 102, low: 80, close: 102, volume: 2 },
    ]);
    expect(f.currentCandleRef.current).toMatchObject({ time: epoch / 1000 + 60, open: 80, high: 102, low: 80, close: 102, volume: 2 });
    expect(f.seriesUpdate).toHaveBeenCalled();
  });

  it('releases the latest deferred snapshot overlay without a new quote or candle mutation', () => {
    const f = fixture(); f.isChartInteractionActiveRef.current = true;
    f.poll(quote(68_000, 110, '3', 'snapshot'));
    f.poll(quote(69_000, 115, '4', 'snapshot'));
    expect(f.repaint).not.toHaveBeenCalled();
    act(() => { f.isChartInteractionActiveRef.current = false; f.options.flushPostInteractionWork(); });
    expect(f.repaint).toHaveBeenLastCalledWith({ ...f.initial, close: 115 });
    expect(f.currentCandleRef.current).toEqual(f.initial);
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toEqual([]);
    f.mounted.unmount();
    expect(transport.close).toHaveBeenCalledOnce(); expect(transport.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps REST out of a forming server candle while retaining its latest price overlay', () => {
    const f = fixture();
    f.poll(quote(59_000, 130, '4', 'snapshot'));
    act(() => transport.candle!({ ...bar(), high: 105, low: 95, close: 101, volume: 40, tickVolume: 40, closed: false }));
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toMatchObject([
      { open: 100, high: 105, low: 95, close: 101, volume: 40 },
    ]);
    expect(f.currentCandleRef.current).toMatchObject({ high: 105, low: 95, close: 101, volume: 40 });
    expect(f.repaint.mock.calls.at(-1)?.[0]?.close).toBe(130);
  });

  it.each([true, false])('restores an explicit closed=%s snapshot through the mounted hook despite an opposing PC clock', (closed) => {
    vi.setSystemTime(epoch + (closed ? -120_000 : 120_000));
    const f = fixture();
    const snapshot = { ...bar(), high: 130, low: 80, close: 105, volume: 40, tickVolume: 40, closed };
    act(() => transport.snapshot!([snapshot]));
    expect(f.options.updateChartData).toHaveBeenCalled();
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toMatchObject([
      { high: 130, low: 80, close: 105, volume: 40, isComplete: closed },
    ]);
    f.financial(quote(30_000, 108, '10', 'event'));
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toMatchObject([
      { high: 130, low: 80, close: closed ? 105 : 108, volume: closed ? 40 : 41, isComplete: closed },
    ]);
  });
});
