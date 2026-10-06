import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTradeOverlayRuntimeSubscriptions } from './bindTradeOverlayRuntimeSubscriptions';
import type { ActiveTradeSnapshot } from './tradeRuntimeContracts';
import { getTradeOverlayRedrawDecision } from '../../../services/tradeOverlayHistory';

const store = vi.hoisted(() => ({ state: {} as any, listener: undefined as any, scope: 1, closed: new Set<unknown>() }));
vi.mock('../../../store/useAppStore', () => ({ getPositionCloseScope: () => store.scope,
  isPositionMarkedClosed: (id: unknown) => store.closed.has(id),
  useAppStore: { getState: () => store.state, subscribe: (listener: any) => {
    store.listener = listener; return () => { store.listener = undefined; };
  } } }));
vi.mock('../../../store/useChartSettingsStore', () => ({ useChartSettingsStore: { subscribe: () => () => {} } }));
vi.mock('../../../store/useChartObjectStateStore', () => ({ getChartObjectState: () => ({ tradesHidden: false }),
  useChartObjectStateStore: { subscribe: () => () => {} } }));

type Options = Parameters<typeof bindTradeOverlayRuntimeSubscriptions>[0];
const ref = <T>(current: T) => ({ current });
const position = (patch: Record<string, unknown> = {}) => ({ id: 1, symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  openPrice: 100, openTime: '2026-10-06T12:00:00Z', currentPrice: 101, unrealizedPnL: 1, sl: 0, tp: 0, ...patch });
const trade: ActiveTradeSnapshot = { key: 'trade:1', symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  entryPrice: 100, entryTime: 1000, entryExecutionTime: 1000, currentPrice: 101, currentTime: 1060, sl: 0, tp: 0 };
let frames: Map<number, FrameRequestCallback>, frameSequence: number, dispose: (() => void) | undefined;
const emit = (patch: Record<string, unknown>) => { const previous = store.state; store.state = { ...previous, ...patch }; store.listener?.(store.state, previous); };
const event = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const flush = () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(cb => cb(performance.now())); };
function fixture() {
  const render = vi.fn(), relayout = vi.fn(), buildClosed = vi.fn((value: ActiveTradeSnapshot) => ({ ...value,
    exitPrice: value.currentPrice, exitTime: value.currentTime, exitExecutionTime: value.currentTime, source: 'app-history' }));
  const options = {
    activeTradeSnapshotsRef: ref(new Map([[trade.key, { ...trade }]])),
    chartRef: ref({ timeScale: () => ({ subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() }) }),
    drawingRuntimeContextRef: ref({ contextId: 'chart-one', accountScope: 'demo:1', symbol: 'BTCUSD', timeframe: 'M1' }),
    clearFrozenEntryTime: vi.fn(), clearStableActiveMarkerTime: vi.fn(), clearTradeLevelRuntimeState: vi.fn(() => false),
    clearTradeLevelRuntimeStateByKey: vi.fn(() => false), clearTradeOverlayLayer: vi.fn(), clearTradeOverlayVisualRuntime: vi.fn(),
    closeSuppressedTradeKeysRef: ref(new Map()), crossCloseGuessedTradeKeysRef: ref(new Set()), frozenEntryPricesRef: ref(new Map()),
    isActiveRef: ref(true), optimisticClosedTradeSnapshotsRef: ref(new Map()), pendingClosedTradeSnapshotsRef: ref(new Map()),
    pendingMissingActiveTradesRef: ref(new Map()), persistTradeLevelOverrides: vi.fn(), queueTradeOverlayRelayout: relayout,
    renderTradeOverlay: render, resolveSymbolTick: (ticks: Record<string, unknown>) => ticks.BTCUSD, scheduleHistoryRefresh: vi.fn(),
    getLiveTrailTime: () => 1120, getLiveTrailPrice: (_side: unknown, fallback: number) => fallback,
    pickPositiveNumber: (...values: unknown[]) => values.map(Number).find(v => Number.isFinite(v) && v > 0) ?? 0,
    buildImmediateClosedTrade: buildClosed, buildClosedTradeFromEventSnapshot: vi.fn(), symbol: 'BTCUSD',
    tradeLevelCrossCloseCandidatesRef: ref(new Map()), tradeLevelCrossRefreshPendingRef: ref(new Set()),
  } as unknown as Options;
  dispose = bindTradeOverlayRuntimeSubscriptions(options); render.mockClear();
  return { options, render, relayout, buildClosed };
}
beforeEach(() => {
  vi.useFakeTimers(); frames = new Map(); frameSequence = 0; store.scope = 1; store.closed.clear();
  store.state = { accountId: '1', positions: [position()], trades: [], ticks: {} };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = ++frameSequence; frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { dispose?.(); dispose = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bounded overlay presentation scheduling', () => {
  it('coalesces 50 valuations into one model pass but captures every current price synchronously', () => {
    const f = fixture();
    for (let i = 0; i < 50; i++) {
      emit({ positions: [position({ currentPrice: 102 + i, unrealizedPnL: 2 + i })] });
      expect(f.options.activeTradeSnapshotsRef.current.get('trade:1')).toMatchObject({ currentPrice: 102 + i, currentTime: 1120 });
      expect(store.state.positions[0].currentPrice).toBe(102 + i);
    }
    expect(frames.size).toBe(1); expect(f.render).not.toHaveBeenCalled();
    flush(); expect(f.render).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
  });
  it.each([{ positions: [] }, { positions: [position({ sl: 95 })] }, { positions: [position({ id: 2 })] }, { trades: [{ id: 2 }] }])('processes structural transitions synchronously and cancels the redundant frame: %j', patch => {
    const f = fixture(); emit({ positions: [position({ currentPrice: 105 })] });
    emit(patch); expect(f.render).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    expect(f.options.activeTradeSnapshotsRef.current.get('trade:1')?.currentPrice).toBe(105);
    flush(); expect(f.render).toHaveBeenCalledTimes(1);
  });
  it('coalesces margin valuations while keeping structural store changes immediate without a refresh event', () => {
    const f = fixture();
    for (let margin = 100; margin < 125; margin++) emit({ positions: [position({ margin })] });
    expect(store.state.positions[0].margin).toBe(124);
    expect(f.render).not.toHaveBeenCalled(); expect(frames.size).toBe(1);
    flush(); expect(f.render).toHaveBeenCalledTimes(1);
    emit({ positions: [position({ margin: 124, sl: 95 })] });
    expect(f.render).toHaveBeenCalledTimes(2); expect(frames.size).toBe(0);
  });
  it('honors an explicit refresh with unchanged store state and no pending valuation frame', () => {
    const f = fixture(), previous = store.state;
    event('rtx:refresh-trade-overlay');
    expect(store.state).toBe(previous); expect(f.render).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
  it.each(['other-symbol', 'zero-volume', 'marked-closed'])('does not overwrite retained valuation evidence from a %s row with the same ticket', reason => {
    const f = fixture();
    const patch = reason === 'other-symbol' ? { symbol: 'BTCUSD.r' } : reason === 'zero-volume' ? { volume: 0 } : {};
    if (reason === 'marked-closed') store.closed.add(1);
    emit({ positions: [position({ ...patch, currentPrice: 150 })] });
    emit({ positions: [position({ ...patch, currentPrice: 200 })] });
    expect(f.options.activeTradeSnapshotsRef.current.get('trade:1')?.currentPrice).toBe(101);
  });
  it.each(['rtx:flush-trade-overlay', 'rtx:refresh-trade-overlay'])('flushes the latest valuation for %s without a later duplicate frame', name => {
    const f = fixture(); emit({ positions: [position({ currentPrice: 110 })] });
    event(name); expect(f.render).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    flush(); expect(f.render).toHaveBeenCalledTimes(1);
  });
  it('renders a structural fill immediately without forcing a second rebuild for its subsequent notification', () => {
    const f = fixture();
    emit({ positions: [position(), position({ id: 2 })] });
    expect(f.render).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    event('rtx:new-trade-placed');
    expect(f.render).toHaveBeenCalledTimes(1); expect(frames.size).toBe(1);
    flush(); expect(f.render).toHaveBeenCalledTimes(2);
    const options = f.render.mock.calls[1][0];
    // The real renderer's decision must retain already rendered markers when
    // the structural signature is unchanged after the synchronous store pass.
    expect(getTradeOverlayRedrawDecision({ lastActiveSignature: 'trade:1|trade:2', nextActiveSignature: 'trade:1|trade:2',
      lastHistorySignature: 'history', nextHistorySignature: 'history',
      forceActive: typeof options === 'boolean' ? options : options?.forceActive,
      forceHistory: typeof options === 'boolean' ? options : options?.forceHistory,
    })).toEqual({ activeChanged: false, historyChanged: false });
  });
  it('coalesces notification-only refreshes into one normal model pass and shares the valuation frame', () => {
    const f = fixture();
    for (let i = 0; i < 25; i++) event('rtx:new-trade-placed');
    expect(f.render).not.toHaveBeenCalled(); expect(frames.size).toBe(1);
    flush(); expect(f.render).toHaveBeenCalledExactlyOnceWith();
    emit({ positions: [position({ currentPrice: 110 })] }); event('rtx:new-trade-placed');
    expect(f.options.activeTradeSnapshotsRef.current.get('trade:1')?.currentPrice).toBe(110);
    expect(frames.size).toBe(1); flush(); expect(f.render).toHaveBeenCalledTimes(2);
  });
  it('preempts a queued new-trade refresh with immediate close suppression and preserves its snapshot', () => {
    const f = fixture(); event('rtx:new-trade-placed');
    event('rtx:trade-overlay-close-state', { status: 'pending', ticketIds: [1] });
    expect(f.options.closeSuppressedTradeKeysRef.current.has('trade:1')).toBe(true);
    expect(f.options.pendingClosedTradeSnapshotsRef.current.get('trade:1')).toMatchObject({ currentPrice: 101 });
    expect(f.render).toHaveBeenLastCalledWith({ forceActive: true });
    expect(frames.size).toBe(0); const calls = f.render.mock.calls.length;
    flush(); expect(f.render).toHaveBeenCalledTimes(calls);
  });
  it.each(['account', 'logout', 'chart', 'context', 'dispose'])('does not run or requeue a new-trade notification after %s', reason => {
    const f = fixture(); event('rtx:new-trade-placed'); expect(frames.size).toBe(1);
    if (reason === 'account') store.state.accountId = '2';
    else if (reason === 'logout') store.scope++;
    else if (reason === 'chart') f.options.chartRef.current = null;
    else if (reason === 'context') f.options.drawingRuntimeContextRef.current.contextId = 'chart-two';
    else { dispose?.(); dispose = undefined; }
    flush(); event('rtx:new-trade-placed'); expect(frames.size).toBe(0);
    expect(f.render).not.toHaveBeenCalled();
  });
  it('captures the latest valuation for close even if flushing removes its active overlay', () => {
    const f = fixture(); emit({ positions: [position({ currentPrice: 110 })] });
    f.render.mockImplementationOnce(() => f.options.activeTradeSnapshotsRef.current.clear());
    event('rtx:trade-overlay-close-state', { status: 'pending', ticketIds: [1] });
    expect(f.buildClosed).toHaveBeenCalledWith(expect.objectContaining({ currentPrice: 110, currentTime: 1120 }), undefined);
    expect(f.options.pendingClosedTradeSnapshotsRef.current.get('trade:1')?.currentPrice).toBe(110);
    expect(f.options.closeSuppressedTradeKeysRef.current.has('trade:1')).toBe(true);
    expect(frames.size).toBe(0); expect(f.render).toHaveBeenLastCalledWith({ forceActive: true });
  });
  it('keeps failed and confirmed close events synchronous', () => {
    const f = fixture(); event('rtx:trade-overlay-close-state', { status: 'pending', ticketIds: [1] });
    event('rtx:trade-overlay-close-state', { status: 'failed', ticketIds: [1] });
    expect(f.options.closeSuppressedTradeKeysRef.current.has('trade:1')).toBe(false);
    event('rtx:trade-overlay-close-state', { status: 'confirmed', ticketIds: [1] });
    expect(f.options.clearFrozenEntryTime).toHaveBeenCalledWith('trade:1');
    expect(f.render).toHaveBeenLastCalledWith({ forceActive: true });
  });
  it('reconciles history for close transitions but preserves explicit full overlay refresh', () => {
    const f = fixture();
    for (const status of ['pending', 'confirmed', 'failed']) {
      event('rtx:trade-overlay-close-state', { status, ticketIds: [1] });
      expect(f.render).toHaveBeenLastCalledWith({ forceActive: true });
    }
    event('rtx:flush-trade-overlay');
    expect(f.render).toHaveBeenLastCalledWith(true);
    expect(getTradeOverlayRedrawDecision({ lastActiveSignature: 'active', nextActiveSignature: 'active',
      lastHistorySignature: 'history', nextHistorySignature: 'history', forceActive: true, forceHistory: true,
    })).toEqual({ activeChanged: true, historyChanged: true });
  });
  it('bounds burst refresh requests to one 500ms timer without postponing it and cancels on disposal', () => {
    const f = fixture();
    for (let i = 0; i < 25; i++) event('rtx:force-refresh-positions');
    vi.advanceTimersByTime(400); event('rtx:force-refresh-positions');
    vi.advanceTimersByTime(100); expect(f.render).toHaveBeenCalledTimes(1);
    event('rtx:force-refresh-positions'); emit({ positions: [position({ currentPrice: 102 })] });
    dispose?.(); dispose = undefined; flush(); vi.advanceTimersByTime(1000);
    expect(f.render).toHaveBeenCalledTimes(1); expect(store.listener).toBeUndefined();
  });
  it.each(['account', 'scope', 'chart', 'context'])('never executes queued work for a changed %s owner', owner => {
    const f = fixture(); event('rtx:force-refresh-positions'); emit({ positions: [position({ currentPrice: 102 })] });
    if (owner === 'account') store.state.accountId = '2';
    else if (owner === 'scope') store.scope++;
    else if (owner === 'chart') f.options.chartRef.current = null;
    else f.options.drawingRuntimeContextRef.current.contextId = 'chart-two';
    flush(); vi.advanceTimersByTime(1000); event('rtx:new-trade-placed');
    event('rtx:trade-overlay-close-state', { status: 'pending', ticketIds: [1] });
    expect(f.render).not.toHaveBeenCalled(); expect(f.buildClosed).not.toHaveBeenCalled();
  });
  it('continues ordinary quote-driven relayout without changing the financial tick', () => {
    const f = fixture(), tick = Object.freeze({ bid: 102, ask: 103, provider_timestamp: 1791280000000 });
    emit({ ticks: { BTCUSD: tick } }); expect(f.relayout).toHaveBeenCalledOnce();
    expect(store.state.ticks.BTCUSD).toBe(tick); expect(f.render).not.toHaveBeenCalled();
  });
});
