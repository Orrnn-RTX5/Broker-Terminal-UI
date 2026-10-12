// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTradeOverlayRuntimeSubscriptions } from './bindTradeOverlayRuntimeSubscriptions';
import { requestChartTradeOverlayRefresh, TRADE_OVERLAY_REFRESH_EVENT } from '../../../services/tradeOverlayRefreshEvents';
import { TRADE_OVERLAY_CLOSE_STATE_EVENT } from '../../../services/tradeOverlayHistory';

const appSubscribers = vi.hoisted(() => new Set<(state: unknown, previousState: unknown) => void>());
vi.mock('../../../store/useAppStore', () => ({ useAppStore: {
  subscribe: (listener: (state: unknown, previousState: unknown) => void) => {
    appSubscribers.add(listener);
    return () => appSubscribers.delete(listener);
  },
} }));
vi.mock('../../../store/useChartSettingsStore', () => ({ useChartSettingsStore: { subscribe: () => () => undefined } }));
vi.mock('../../../store/useChartObjectStateStore', () => ({
  useChartObjectStateStore: { subscribe: () => () => undefined }, getChartObjectState: vi.fn(),
}));

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
beforeEach(() => {
  appSubscribers.clear();
  frames.clear();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function harness(contextId = 'chart-a') {
  let onRangeChange: () => void = () => undefined;
  const timeScale = {
    subscribeVisibleLogicalRangeChange: vi.fn((handler: () => void) => { onRangeChange = handler; }),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
  };
  const renderTradeOverlay = vi.fn();
  const queueTradeOverlayRelayout = vi.fn();
  const isActiveRef = { current: true };
  const closeSuppressedTradeKeysRef = { current: new Map<string, number>() };
  const activeTradeSnapshotsRef = { current: new Map() };
  const pendingMissingActiveTradesRef = { current: new Map() };
  const clearTradeOverlayLayer = vi.fn();
  const scheduleHistoryRefresh = vi.fn();
  const cleanup = bindTradeOverlayRuntimeSubscriptions({
    chartRef: { current: { timeScale: () => timeScale } },
    drawingRuntimeContextRef: { current: { contextId } },
    resolveSymbolTick: () => undefined,
    closeSuppressedTradeKeysRef,
    activeTradeSnapshotsRef,
    pendingMissingActiveTradesRef,
    pendingClosedTradeSnapshotsRef: { current: new Map() },
    optimisticClosedTradeSnapshotsRef: { current: new Map() },
    tradeLevelCrossRefreshPendingRef: { current: new Set() },
    frozenEntryPricesRef: { current: new Map() },
    clearTradeLevelRuntimeStateByKey: vi.fn(() => false),
    clearFrozenEntryTime: vi.fn(),
    clearStableActiveMarkerTime: vi.fn(),
    scheduleHistoryRefresh,
    clearTradeOverlayLayer,
    renderTradeOverlay, queueTradeOverlayRelayout, isActiveRef, clearTradeOverlayVisualRuntime: vi.fn(),
  } as unknown as Parameters<typeof bindTradeOverlayRuntimeSubscriptions>[0]);
  const flush = () => {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(0);
  };
  return {
    frames, onRangeChange: () => onRangeChange(), renderTradeOverlay, queueTradeOverlayRelayout,
    isActiveRef, cleanup, flush, timeScale, closeSuppressedTradeKeysRef, clearTradeOverlayLayer,
    scheduleHistoryRefresh,
  };
}

describe('viewport-driven trade history DOM', () => {
  it('batches initial controls with presentation, candle loading and range notifications, then reconciles pan and zoom', () => {
    const h = harness();
    expect(h.renderTradeOverlay).not.toHaveBeenCalled();
    requestChartTradeOverlayRefresh('chart-a', 'reconcile');
    requestChartTradeOverlayRefresh('chart-a', 'rebuild');
    for (let i = 0; i < 20; i++) h.onRangeChange();
    expect(h.frames.size).toBe(1);
    expect(h.renderTradeOverlay).not.toHaveBeenCalled();
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledOnce();
    h.onRangeChange(); h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledTimes(2);
    h.cleanup();
  });

  it('cancels the discarded StrictMode setup before constructing any controls', () => {
    const discarded = harness();
    discarded.cleanup();
    expect(discarded.frames.size).toBe(0);
    const retained = harness();
    retained.flush();
    expect(discarded.renderTradeOverlay).not.toHaveBeenCalled();
    expect(retained.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();
    retained.cleanup();
  });

  it('does not rebuild hidden charts and cancels pending viewport work on disposal', () => {
    const h = harness();
    h.flush();
    h.onRangeChange(); h.isActiveRef.current = false; h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledOnce();
    h.onRangeChange();
    h.cleanup();
    expect(h.frames.size).toBe(0);
    expect(h.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
  });

  it('preserves the initial controls for an inactive pane', () => {
    const h = harness();
    h.isActiveRef.current = false;
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();
    h.cleanup();
  });

  it('reprojects only the resized chart without rebuilding either pane', () => {
    const a = harness('chart-a');
    const b = harness('chart-b');
    a.flush();
    a.renderTradeOverlay.mockClear();
    b.renderTradeOverlay.mockClear();

    requestChartTradeOverlayRefresh('chart-a', 'geometry');

    expect(a.queueTradeOverlayRelayout).toHaveBeenCalledOnce();
    expect(b.queueTradeOverlayRelayout).not.toHaveBeenCalled();
    expect(a.renderTradeOverlay).not.toHaveBeenCalled();
    expect(b.renderTradeOverlay).not.toHaveBeenCalled();
    a.cleanup(); b.cleanup();
  });

  it('rebuilds only the chart whose presentation changed', () => {
    const a = harness('chart-a');
    const b = harness('chart-b');
    a.flush();
    a.renderTradeOverlay.mockClear();
    b.renderTradeOverlay.mockClear();

    requestChartTradeOverlayRefresh('chart-b', 'rebuild');

    expect(a.renderTradeOverlay).not.toHaveBeenCalled();
    expect(b.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith(true);
    expect(a.queueTradeOverlayRelayout).not.toHaveBeenCalled();
    expect(b.queueTradeOverlayRelayout).not.toHaveBeenCalled();
    a.cleanup(); b.cleanup();
  });

  it('reconciles loaded candle mappings only in their chart without forcing a rebuild', () => {
    const a = harness('chart-a');
    const b = harness('chart-b');
    a.flush();
    a.renderTradeOverlay.mockClear();
    b.renderTradeOverlay.mockClear();

    requestChartTradeOverlayRefresh('chart-b', 'reconcile');

    expect(a.renderTradeOverlay).not.toHaveBeenCalled();
    expect(b.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();
    expect(a.queueTradeOverlayRelayout).not.toHaveBeenCalled();
    expect(b.queueTradeOverlayRelayout).not.toHaveBeenCalled();
    a.cleanup(); b.cleanup();
  });

  it('preserves immediate unscoped mutation and rollback rebuilds before initial rendering', () => {
    const a = harness('chart-a');
    const b = harness('chart-b');
    a.renderTradeOverlay.mockClear();
    b.renderTradeOverlay.mockClear();

    window.dispatchEvent(new CustomEvent(TRADE_OVERLAY_REFRESH_EVENT));

    expect(a.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith(true);
    expect(b.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith(true);
    expect(frames.size).toBe(0);
    a.flush();
    expect(a.renderTradeOverlay).toHaveBeenCalledOnce();
    expect(b.renderTradeOverlay).toHaveBeenCalledOnce();
    a.cleanup(); b.cleanup();
  });

  it('still reconciles changed positions after a geometry-only refresh', () => {
    const h = harness();
    h.renderTradeOverlay.mockClear();
    requestChartTradeOverlayRefresh('chart-a', 'geometry');
    const previous = { ticks: {}, positions: [], trades: [] };
    const next = { ...previous, positions: [{ ticket: 17, sl: 100 }] };
    appSubscribers.forEach(listener => listener(next, previous));

    expect(h.queueTradeOverlayRelayout).toHaveBeenCalledOnce();
    expect(h.renderTradeOverlay).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();
    expect(frames.size).toBe(0);
    h.cleanup();
  });

  it('batches a new trade with initial rendering and keeps close rollback immediate', () => {
    const placed = harness();
    window.dispatchEvent(new Event('rtx:new-trade-placed'));
    expect(placed.renderTradeOverlay).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    placed.flush();
    expect(placed.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();
    placed.cleanup();

    const rollback = harness();
    window.dispatchEvent(new CustomEvent(TRADE_OVERLAY_CLOSE_STATE_EVENT, {
      detail: { status: 'failed', ticket: 17 },
    }));
    expect(rollback.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith({ forceActive: true, forceHistory: false });
    expect(frames.size).toBe(0);
    rollback.cleanup();
  });

  it('reconciles every filled ticket from the latest state once per frame across redundant notifications', () => {
    const h = harness();
    h.flush();
    h.renderTradeOverlay.mockClear();
    let current = { ticks: {}, positions: [] as { ticket: number }[], trades: [] as { ticket: number }[] };
    const renderedTickets: number[][] = [];
    h.renderTradeOverlay.mockImplementation(() => {
      renderedTickets.push(current.positions.map(position => position.ticket));
    });

    for (let ticket = 1; ticket <= 20; ticket++) {
      const previous = current;
      current = { ...current, positions: [...current.positions, { ticket }] };
      appSubscribers.forEach(listener => listener(current, previous));
      window.dispatchEvent(new Event('rtx:refresh-trade-overlay'));
      window.dispatchEvent(new Event('rtx:new-trade-placed'));
      h.onRangeChange();
    }
    const previous = current;
    current = { ...current, trades: [{ ticket: 30 }] };
    appSubscribers.forEach(listener => listener(current, previous));

    expect(h.renderTradeOverlay).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();
    expect(renderedTickets).toEqual([Array.from({ length: 20 }, (_, index) => index + 1)]);

    window.dispatchEvent(new Event('rtx:refresh-trade-overlay'));
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledTimes(2);
    h.cleanup();
  });

  it('keeps retained inactive panes current when trade state changes', () => {
    const h = harness();
    h.flush();
    h.renderTradeOverlay.mockClear();
    h.isActiveRef.current = false;
    h.onRangeChange();
    const previous = { ticks: {}, positions: [], trades: [] };
    appSubscribers.forEach(listener => listener({ ...previous, positions: [{ ticket: 17 }] }, previous));

    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();
    h.cleanup();
  });

  it('applies SL/TP rebuilds immediately and consumes a pending fill reconciliation', () => {
    const h = harness();
    h.flush();
    h.renderTradeOverlay.mockClear();
    window.dispatchEvent(new Event('rtx:new-trade-placed'));
    window.dispatchEvent(new CustomEvent(TRADE_OVERLAY_REFRESH_EVENT));

    expect(h.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith(true);
    expect(frames.size).toBe(0);
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledOnce();
    h.cleanup();
  });

  it('suppresses a closed ticket and restores a failed close before any queued fill repaint', () => {
    const h = harness();
    h.flush();
    h.renderTradeOverlay.mockClear();
    window.dispatchEvent(new Event('rtx:new-trade-placed'));
    window.dispatchEvent(new CustomEvent(TRADE_OVERLAY_CLOSE_STATE_EVENT, {
      detail: { status: 'confirmed', ticket: 17 },
    }));

    expect(h.closeSuppressedTradeKeysRef.current.has('trade:17')).toBe(true);
    expect(h.clearTradeOverlayLayer).toHaveBeenCalledExactlyOnceWith('active');
    expect(h.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith({ forceActive: true, forceHistory: true });
    expect(h.scheduleHistoryRefresh).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);

    window.dispatchEvent(new Event('rtx:refresh-trade-overlay'));
    window.dispatchEvent(new CustomEvent(TRADE_OVERLAY_CLOSE_STATE_EVENT, {
      detail: { status: 'failed', ticket: 17 },
    }));
    expect(h.closeSuppressedTradeKeysRef.current.has('trade:17')).toBe(false);
    expect(h.renderTradeOverlay).toHaveBeenLastCalledWith({ forceActive: true, forceHistory: false });
    expect(frames.size).toBe(0);
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledTimes(2);
    h.cleanup();
  });

  it('coalesces delayed position refreshes and cancels their timer and frame on disposal', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    h.flush();
    h.renderTradeOverlay.mockClear();
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('rtx:force-refresh-positions'));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(h.renderTradeOverlay).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledExactlyOnceWith();

    window.dispatchEvent(new Event('rtx:force-refresh-positions'));
    window.dispatchEvent(new Event('rtx:new-trade-placed'));
    const queuedFrame = [...frames.values()][0];
    h.cleanup();
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.size).toBe(0);
    queuedFrame(0);
    vi.advanceTimersByTime(500);
    expect(h.renderTradeOverlay).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('ignores scoped refresh events after the chart is disposed', () => {
    const h = harness();
    h.cleanup();
    h.renderTradeOverlay.mockClear();

    requestChartTradeOverlayRefresh('chart-a', 'geometry');
    requestChartTradeOverlayRefresh('chart-a', 'rebuild');

    expect(h.queueTradeOverlayRelayout).not.toHaveBeenCalled();
    expect(h.renderTradeOverlay).not.toHaveBeenCalled();
    expect(appSubscribers.size).toBe(0);
  });
});
