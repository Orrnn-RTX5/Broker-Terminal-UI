// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';

// The two runtime factories build DOM nodes and chart price lines. They are stubbed
// so this test mounts the real renderer hook: its effect, its refs and its render pass.
const runtimeFactories = vi.hoisted(() => {
  // Callable at any depth: every property is another stub and every call returns one.
  type Stub = (...args: unknown[]) => Stub;
  const deepStub = (): Stub => {
    const children = new Map<PropertyKey, unknown>();
    return new Proxy(function stub() {} as unknown as Stub, {
      get(_target, key) {
        if (key === 'then') return undefined;
        if (key === Symbol.toPrimitive) return () => 0;
        if (!children.has(key)) children.set(key, deepStub());
        return children.get(key);
      },
      apply() {
        return deepStub();
      },
    });
  };
  return {
    deepStub,
    domFactory: vi.fn(() => deepStub()),
    modelFactory: vi.fn(() => deepStub()),
  };
});

vi.mock('./createTradeOverlayDomRuntime', () => ({
  createTradeOverlayDomRuntime: runtimeFactories.domFactory,
}));
vi.mock('./createTradeOverlayModelRuntime', () => ({
  createTradeOverlayModelRuntime: runtimeFactories.modelFactory,
}));

type RendererOptions = Parameters<typeof useTradingChartTradeOverlayRenderer>[0];

const makeOptions = (): RendererOptions => {
  const overlay = document.createElement('div');
  document.body.appendChild(overlay);
  const series = {
    priceToCoordinate: vi.fn(() => 100),
    coordinateToPrice: vi.fn(() => 100),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
  };
  const ref = <T,>(current: T) => ({ current });
  return {
    activeOverlayNodeDataRef: ref([]),
    activeOverlayNodesRef: ref([]),
    activeTradeSnapshotsRef: ref(new Map()),
    brokerAccountSessionScope: 'Test:200003',
    brokerTimeOffsetSec: 0,
    candlesRef: ref([]),
    chartRef: ref(runtimeFactories.deepStub()),
    chartThemeRef: ref({ background: '#000000' }),
    clearFrozenEntryTime: vi.fn(),
    clearStableActiveMarkerTime: vi.fn(),
    clearTradeOverlayLayer: vi.fn(),
    clearTradeOverlayVisualRuntime: vi.fn(),
    closeSuppressedTradeKeysRef: ref(new Map()),
    currentCandleRef: ref(null),
    drawingRuntimeContextRef: ref({ contextId: 'test-context', symbol: 'ETHUSD', timeframe: 'M1' }),
    frozenEntryPricesRef: ref(new Map()),
    frozenEntryTimesRef: ref(new Map()),
    getNearestCandleByTime: vi.fn(() => null),
    historyOverlayNodeDataRef: ref([]),
    historyOverlayNodesRef: ref([]),
    hydrateTradeLevelOverrides: vi.fn(),
    isActiveRef: ref(true),
    isChartInteractionActiveRef: ref(false),
    isChartSurfaceLight: () => false,
    isDisposedRef: ref(false),
    isLivePriceSafeForCandles: () => true,
    lastActiveTradeOverlaySignatureRef: ref(''),
    lastHistoryTradeOverlaySignatureRef: ref(''),
    lastRenderedCandlesRef: ref([]),
    optimisticClosedTradeSnapshotsRef: ref(new Map()),
    overlayRef: ref(overlay),
    pendingClosedTradeSnapshotsRef: ref(new Map()),
    pendingMissingActiveTradesRef: ref(new Map()),
    pendingTradeLevelModifyRequestsRef: ref(new Map()),
    persistTradeLevelOverrides: vi.fn(),
    postInteractionCoordinatorRef: ref(null),
    prevTimeframeRef: ref('M1'),
    resolvedPriceDigits: 2,
    seriesRef: ref(series),
    stableActiveMarkerTimesRef: ref(new Map()),
    symbol: 'ETHUSD',
    timeframe: 'M1',
    tr: <T,>(source: T) => source,
    tradeControlLiveUpdatersRef: ref([]),
    tradeHistoryRefreshTimerRef: ref(null),
    tradeLevelCrossRefreshPendingRef: ref(new Set()),
    tradeLevelLastKnownLevelsRef: ref(new Map()),
    tradeLevelModifyRequestSeqRef: ref(0),
    tradeLevelOptimisticGraceUntilRef: ref(new Map()),
    tradeLevelOverridesRef: ref(new Map()),
    tradeMissingGraceTimerRef: ref(null),
    tradeOverlayRafRef: ref(null),
    updateLabelPositions: vi.fn(),
    visibleRuntime: { overlay: true },
  } as unknown as RendererOptions;
};

describe('useTradingChartTradeOverlayRenderer mounted', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    runtimeFactories.domFactory.mockClear();
    runtimeFactories.modelFactory.mockClear();
  });

  it('mounts, runs the overlay effect through its render pass, and raises no invalid hook call', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const options = makeOptions();

    // A hook call inside the effect throws here, failing the mount.
    const { unmount } = renderHook(() => useTradingChartTradeOverlayRenderer(options));

    expect(runtimeFactories.domFactory).toHaveBeenCalled();
    unmount();
    const logged = consoleError.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).not.toMatch(/Invalid hook call/);
  });

  it('positions rebuilt trade overlay nodes immediately even during active chart cursor interaction and freezes pending order entryTime across ticks', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    let nowMs = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    let liveTrailTime = 1_700_000_000;
    runtimeFactories.modelFactory.mockImplementation(() => ({
      ...runtimeFactories.deepStub(),
      queueTradeOverlayRelayout: vi.fn(),
      normalizeUnixSeconds: (value: unknown) => {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? Math.floor(num > 1e11 ? num / 1000 : num) : null;
      },
      pickPositiveNumber: (...values: unknown[]) => {
        for (const value of values) {
          const num = Number(value);
          if (Number.isFinite(num) && num > 0) return num;
        }
        return 0;
      },
      getTradeTicketLabel: (key: string) => `#${key}`,
      formatTradeLevelBadgePrice: (price: number) => price.toFixed(2),
      resolveSymbolTick: () => null,
      mapTradeTimestampToChartTime: () => null,
      getClosedTradeLineColor: () => '#2962ff',
      getLiveTrailTime: () => liveTrailTime,
      getActiveMarkerTimeKey: (key: string) => `${key}:marker`,
      canResolveOverlayTime: (ts: number) => ts > 0,
      getLiveTrailPrice: (_side: string, price: number) => price,
      buildImmediateClosedTrade: () => null,
      buildClosedTradeFromEventSnapshot: () => null,
      mapStoredClosedTradeToChart: () => null,
      scheduleHistoryRefresh: vi.fn(),
      getTradeLevelStateKeys: (trade: { key: string }) => [trade.key],
      setTradeLevelState: vi.fn(),
      deleteTradeLevelState: vi.fn(),
      clearTradeLevelRuntimeState: vi.fn(),
      clearTradeLevelRuntimeStateByKey: vi.fn(() => false),
      resolveTradeLevels: (trade: { sl?: number; tp?: number }) => ({ sl: trade.sl || 0, tp: trade.tp || 0 }),
      formatSignaturePrice: (value?: number) => (Number(value) || 0).toFixed(2),
      priceTolerance: 0.01,
    }) as unknown as ReturnType<typeof runtimeFactories.deepStub>);

    const prevOrders = useAppStore.getState().orders;
    useAppStore.setState({
      orders: [
        {
          id: '9001',
          ticket: 9001,
          symbol: 'ETHUSD',
          side: 'BUY',
          type: 'buy_limit',
          volume: 0.5,
          price: 2500.25,
          status: 'pending',
        } as never,
      ],
    });

    try {
      const options = makeOptions();
      // Simulate active cursor/chart drag interaction while trade overlay renders
      options.isChartInteractionActiveRef.current = true;

      const { unmount } = renderHook(() => useTradingChartTradeOverlayRenderer(options));
      while (frames.length > 0) {
        const frame = frames.shift()!;
        frame(16);
      }

      // First rebuild must call updateLabelPositions even when isChartInteractionActiveRef is true
      expect(options.clearTradeOverlayLayer).toHaveBeenCalledWith('active');
      expect(options.clearTradeOverlayLayer).toHaveBeenCalledTimes(2);
      expect(options.updateLabelPositions).toHaveBeenCalledTimes(1);
      expect(options.frozenEntryTimesRef.current.get('order:9001::M1')).toBe(1_700_000_000);

      // Advance wall clock + liveTrailTime and trigger a reconcile pass without cursor movement:
      // frozen pending-order entryTime must prevent an unnecessary active-layer wipe/rebuild.
      nowMs = 1_700_000_060_000;
      liveTrailTime = 1_700_000_060;
      window.dispatchEvent(new Event('rtx:new-trade-placed'));
      while (frames.length > 0) {
        const frame = frames.shift()!;
        frame(32);
      }

      expect(options.frozenEntryTimesRef.current.get('order:9001::M1')).toBe(1_700_000_000);
      expect(options.clearTradeOverlayLayer).toHaveBeenCalledTimes(2);
      unmount();
    } finally {
      useAppStore.setState({ orders: prevOrders });
    }
  });

  it('keeps observed price digits monotonic per symbol scope so crosshair cursor moves and live ticks do not oscillate resolvedPriceDigits and tear down trade lines', () => {
    const chartFacadeSource = readFileSync(
      resolve(process.cwd(), 'src/components/TradingChart.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const syncStart = chartFacadeSource.indexOf('const syncObservedChartPriceDigits = useCallback');
    const syncEnd = chartFacadeSource.indexOf('const updateLegendDOM = useCallback', syncStart);
    const syncDigits = chartFacadeSource.slice(syncStart, syncEnd);
    const formatEffectStart = chartFacadeSource.indexOf('useTradingChartPriceFormat({');
    const formatEffectEnd = chartFacadeSource.indexOf('// ── Chart Shift (standalone effect)', formatEffectStart);
    const formatEffect = chartFacadeSource.slice(formatEffectStart, formatEffectEnd);

    expect(syncStart).toBeGreaterThan(-1);
    expect(syncEnd).toBeGreaterThan(syncStart);
    expect(syncDigits).toContain('observedPriceDigitsRef.current === null || inferred > observedPriceDigitsRef.current');
    expect(syncDigits).not.toContain('inferred !== observedPriceDigitsRef.current');
    expect(syncDigits).toContain('prev.scopeKey === activeScopeKey && prev.digits !== null && prev.digits >= nextObservedDigits');
    expect(formatEffect).toContain('if (dataWindowHoverTimeRef.current === null) {');
  });
});
