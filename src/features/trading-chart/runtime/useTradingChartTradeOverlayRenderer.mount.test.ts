// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
