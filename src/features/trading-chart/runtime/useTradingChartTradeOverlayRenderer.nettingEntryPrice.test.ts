// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';

// ui-term-19: the open-position entry line must follow the backend open price.
// A netting add/reduce re-averages price_open on the SAME ticket; the line,
// axis badge, control bar and marker must move on the frame that applies it.
// The DOM/model runtimes are stubbed; the real renderer hook, its refs, its
// store subscription and its render pass run.

const runtime = vi.hoisted(() => {
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
  // Explicit members first, a deep stub for everything else.
  const stubWith = (members: Record<string, unknown>) => {
    const fallback = deepStub() as unknown as Record<PropertyKey, unknown>;
    return new Proxy({}, {
      get(_target, key) {
        if (typeof key === 'string' && key in members) return members[key];
        return fallback[key];
      },
    });
  };
  return {
    deepStub,
    stubWith,
    domFactory: vi.fn(() => deepStub()),
    modelFactory: vi.fn(() => deepStub()),
  };
});

vi.mock('./createTradeOverlayDomRuntime', () => ({
  createTradeOverlayDomRuntime: runtime.domFactory,
}));
vi.mock('./createTradeOverlayModelRuntime', () => ({
  createTradeOverlayModelRuntime: runtime.modelFactory,
}));

type RendererOptions = Parameters<typeof useTradingChartTradeOverlayRenderer>[0];
type Snapshot = { key: string; entryPrice: number; entryTime: number; volume: number; side: string };

const SYMBOL = 'ETHUSD';
const TICKET = 501;
const KEY = `trade:${TICKET}`;
const OPEN_TIME_SEC = 1_699_999_000;

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
    brokerAccountSessionScope: 'Test:netting',
    brokerTimeOffsetSec: 0,
    candlesRef: ref([]),
    chartRef: ref(runtime.deepStub()),
    chartThemeRef: ref({ background: '#000000' }),
    clearFrozenEntryTime: vi.fn(),
    clearStableActiveMarkerTime: vi.fn(),
    clearTradeOverlayLayer: vi.fn(),
    clearTradeOverlayVisualRuntime: vi.fn(),
    closeSuppressedTradeKeysRef: ref(new Map()),
    currentCandleRef: ref(null),
    drawingRuntimeContextRef: ref({ contextId: 'netting-context', symbol: SYMBOL, timeframe: 'M1' }),
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
    symbol: SYMBOL,
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

const position = (overrides: Record<string, unknown>) => ({
  id: TICKET,
  ticket: TICKET,
  symbol: SYMBOL,
  side: 'BUY',
  volume: 0.1,
  quantity: 0.1,
  openTime: OPEN_TIME_SEC,
  currentPrice: 2501,
  current_price: 2501,
  sl: 0,
  tp: 0,
  ...overrides,
});

describe('useTradingChartTradeOverlayRenderer entry price follows the backend open price', () => {
  let frames: FrameRequestCallback[];
  let prevPositions: unknown;
  let prevOrders: unknown;
  let prevTrades: unknown;
  const dom = {
    createEntryPriceLevels: vi.fn(),
    createTradeMarker: vi.fn(),
    createEntryControlsForTrade: vi.fn(),
  };

  const flushFrames = () => {
    while (frames.length > 0) frames.shift()!(16);
  };
  const setPositions = (rows: Array<Record<string, unknown>>) => {
    useAppStore.setState({ positions: rows as never });
  };
  const lastEntryLevelPrice = (key = KEY): number | undefined => {
    const calls = dom.createEntryPriceLevels.mock.calls;
    const snapshots = calls.at(-1)?.[0] as Snapshot[] | undefined;
    return snapshots?.find((trade) => trade.key === key)?.entryPrice;
  };
  const lastControlBarPrice = (key = KEY): number | undefined => {
    const calls = dom.createEntryControlsForTrade.mock.calls.filter(([trade]) => (trade as Snapshot).key === key);
    return (calls.at(-1)?.[0] as Snapshot | undefined)?.entryPrice;
  };
  const lastMarkerPrice = (): number | undefined => dom.createTradeMarker.mock.calls
    .filter((args) => args[4] === 'active')
    .at(-1)?.[1] as number | undefined;
  const activeRebuilds = (options: RendererOptions) => vi.mocked(options.clearTradeOverlayLayer).mock.calls
    .filter(([layer]) => layer === 'active').length;
  const snapshotPrice = (options: RendererOptions, key = KEY) =>
    (options.activeTradeSnapshotsRef.current.get(key) as Snapshot | undefined)?.entryPrice;

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000);
    dom.createEntryPriceLevels.mockReset();
    dom.createTradeMarker.mockReset();
    dom.createEntryControlsForTrade.mockReset();
    runtime.domFactory.mockImplementation(() => runtime.stubWith(dom) as never);
    runtime.modelFactory.mockImplementation(() => runtime.stubWith({
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
      getLiveTrailTime: () => 1_700_000_000,
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
    }) as never);
    const state = useAppStore.getState();
    prevPositions = state.positions;
    prevOrders = state.orders;
    prevTrades = state.trades;
    useAppStore.setState({ positions: [] as never, orders: [] as never, trades: [] as never });
  });

  afterEach(() => {
    useAppStore.setState({ positions: prevPositions as never, orders: prevOrders as never, trades: prevTrades as never });
    document.body.replaceChildren();
    vi.restoreAllMocks();
    runtime.domFactory.mockReset();
    runtime.modelFactory.mockReset();
  });

  it('moves the line, badge, control bar and marker to the re-averaged price_open of a netting add on the next frame', () => {
    // First buy: backend fill 2500.25; the click quote (chartEntryPrice) was 2500.50.
    setPositions([position({
      price_open: 2500.25, open_price: 2500.25, openPrice: 2500.25, chartEntryPrice: 2500.5, state_version: 1,
    })]);
    const options = makeOptions();
    const { unmount } = renderHook(() => useTradingChartTradeOverlayRenderer(options));
    flushFrames();

    expect(snapshotPrice(options)).toBe(2500.25);
    expect(lastEntryLevelPrice()).toBe(2500.25);
    const firstSignature = options.lastActiveTradeOverlaySignatureRef.current;
    const pinnedTime = options.frozenEntryTimesRef.current.get(`${KEY}::M1`);
    expect(pinnedTime).toBe(OPEN_TIME_SEC);

    // Second buy on a netting account: SAME ticket, double volume, new average
    // price_open. The stale click quote is still carried on the row by the merge.
    setPositions([position({
      volume: 0.2, quantity: 0.2,
      price_open: 2505.75, open_price: 2505.75, openPrice: 2505.75, chartEntryPrice: 2500.5, state_version: 2,
    })]);
    expect(frames.length).toBe(1);
    flushFrames();

    expect(snapshotPrice(options)).toBe(2505.75);
    expect(options.frozenEntryPricesRef.current.get(KEY)).toBe(2505.75);
    expect(lastEntryLevelPrice()).toBe(2505.75);
    expect(lastControlBarPrice()).toBe(2505.75);
    expect(lastMarkerPrice()).toBe(2505.75);
    expect(options.lastActiveTradeOverlaySignatureRef.current).not.toBe(firstSignature);
    expect(options.lastActiveTradeOverlaySignatureRef.current).toContain('2505.75');
    // A netting add keeps the original open time.
    expect(options.frozenEntryTimesRef.current.get(`${KEY}::M1`)).toBe(pinnedTime);
    expect((options.activeTradeSnapshotsRef.current.get(KEY) as Snapshot).entryTime).toBe(OPEN_TIME_SEC);
    unmount();
  });

  it('follows a same-ticket side/price change (flip/reduce re-average) and a flip onto a new ticket', () => {
    setPositions([position({ price_open: 2500.25, openPrice: 2500.25, state_version: 1 })]);
    const options = makeOptions();
    const { unmount } = renderHook(() => useTradingChartTradeOverlayRenderer(options));
    flushFrames();
    expect(snapshotPrice(options)).toBe(2500.25);

    // Same ticket now reports the opposite side at a new open price.
    setPositions([position({
      side: 'SELL', volume: 0.05, quantity: 0.05, price_open: 2490.5, openPrice: 2490.5, state_version: 2,
    })]);
    flushFrames();
    expect(snapshotPrice(options)).toBe(2490.5);
    expect((options.activeTradeSnapshotsRef.current.get(KEY) as Snapshot).side).toBe('SELL');
    expect(lastEntryLevelPrice()).toBe(2490.5);

    // Engine flip semantics: the old ticket closes, the remainder opens on a new ticket.
    const newTicket = 777;
    setPositions([position({
      id: newTicket, ticket: newTicket, side: 'SELL', volume: 0.1, quantity: 0.1,
      price_open: 2488, openPrice: 2488, state_version: 1,
    })]);
    flushFrames();
    expect(snapshotPrice(options, `trade:${newTicket}`)).toBe(2488);
    expect(lastEntryLevelPrice(`trade:${newTicket}`)).toBe(2488);
    unmount();
  });

  it('draws a new hedging position from the click quote, then moves to the real fill once the backend reports it', () => {
    // Immediate row: only the click quote is known.
    setPositions([position({ chartEntryPrice: 2500.5, openPrice: 0, price_open: 0 })]);
    const options = makeOptions();
    const { unmount } = renderHook(() => useTradingChartTradeOverlayRenderer(options));
    flushFrames();
    expect(snapshotPrice(options)).toBe(2500.5);
    expect(options.frozenEntryPricesRef.current.get(KEY)).toBe(2500.5);

    // The stream reports the real fill; the click quote stays on the row.
    setPositions([position({ chartEntryPrice: 2500.5, openPrice: 2500.75, price_open: 2500.75, state_version: 1 })]);
    flushFrames();
    expect(snapshotPrice(options)).toBe(2500.75);
    expect(lastEntryLevelPrice()).toBe(2500.75);
    expect(lastControlBarPrice()).toBe(2500.75);
    unmount();
  });

  it('keeps the entry line and does not rebuild when only the current price changes', () => {
    setPositions([position({ price_open: 2500.25, openPrice: 2500.25, state_version: 1 })]);
    const options = makeOptions();
    const { unmount } = renderHook(() => useTradingChartTradeOverlayRenderer(options));
    flushFrames();
    const rebuilds = activeRebuilds(options);
    const signature = options.lastActiveTradeOverlaySignatureRef.current;

    // P/L frames: same row, only the current price moves.
    for (const currentPrice of [2502, 2499.5, 2510.25]) {
      setPositions([position({
        price_open: 2500.25, openPrice: 2500.25, state_version: 1, currentPrice, current_price: currentPrice,
      })]);
      flushFrames();
    }
    // A plain tick only relayouts.
    useAppStore.setState({ ticks: { ...useAppStore.getState().ticks } });
    flushFrames();

    expect(snapshotPrice(options)).toBe(2500.25);
    expect(activeRebuilds(options)).toBe(rebuilds);
    expect(options.lastActiveTradeOverlaySignatureRef.current).toBe(signature);
    unmount();
  });

  it('keeps a live-price fallback pinned across ticks while no backend open price exists', () => {
    setPositions([position({ openPrice: 0, price_open: 0, currentPrice: 2501, current_price: 2501 })]);
    const options = makeOptions();
    const { unmount } = renderHook(() => useTradingChartTradeOverlayRenderer(options));
    flushFrames();
    expect(snapshotPrice(options)).toBe(2501);
    const rebuilds = activeRebuilds(options);

    for (const currentPrice of [2503, 2498.75]) {
      setPositions([position({ openPrice: 0, price_open: 0, currentPrice, current_price: currentPrice })]);
      flushFrames();
    }
    expect(snapshotPrice(options)).toBe(2501);
    expect(options.frozenEntryPricesRef.current.get(KEY)).toBe(2501);
    expect(activeRebuilds(options)).toBe(rebuilds);
    unmount();
  });
});
