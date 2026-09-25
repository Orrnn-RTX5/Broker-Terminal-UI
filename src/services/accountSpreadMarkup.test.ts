// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  aggregateMultipleTimeframes: vi.fn(),
  aggregateSymbols: vi.fn(),
}));
vi.mock('./aggregationWorkerManager', () => ({
  cancelPendingAggregations: vi.fn(),
  getWorkerManager: () => workerMocks,
}));
vi.mock('./marketWatchDailyChangeCache', () => ({
  flushMarketWatchDailyChangeCache: vi.fn(),
  rememberCurrentMarketWatchDailyChange: vi.fn(),
}));

import {
  enqueueLiveTick,
  flushLiveTicks,
  resetLiveTickDispatcherForTests,
} from './liveTickDispatcher';
import {
  applyAccountSpreadMarkup,
  clearAccountSpreadMarkups,
  getAccountSpreadMarkup,
  resetAccountSpreadMarkupForTests,
  setAccountSpreadMarkups,
} from './accountSpreadMarkup';
import { emitSessionChange } from './brokerSession';
import { buildSpreadMarkupMap } from '../utils/spreadMarkup';
import { useAppStore } from '../store/useAppStore';
import { useMarketDataStore } from '../store/useMarketDataStore';

const TIMESTAMP = 1_788_176_700_000;

const eurusdMarkup = (points: number) => buildSpreadMarkupMap([
  { symbol: 'EURUSD', spreadMarkup: points, tickSize: 0.00001, digits: 5 },
]);

const rawTick = (bid = 1.1, ask = 1.10012, timestamp = TIMESTAMP) => ({
  symbol: 'EURUSD',
  bid,
  ask,
  spread: Number((ask - bid).toFixed(5)),
  timestamp,
  sourceTimestamp: timestamp,
});

const flush = () => {
  flushLiveTicks();
};

const signIn = (accountId = '1001') => {
  useAppStore.setState({ isAuthenticated: true, accountId });
};

describe('account spread markup at the live-tick funnel', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    resetLiveTickDispatcherForTests();
    resetAccountSpreadMarkupForTests();
    window.rtxTickCache = new Map();
    useMarketDataStore.getState().clearAllData();
    useAppStore.setState({ ticks: {}, tickLookup: {}, isAuthenticated: false, accountId: null });
  });

  afterEach(() => {
    resetLiveTickDispatcherForTests();
    resetAccountSpreadMarkupForTests();
    useAppStore.setState({ isAuthenticated: false, accountId: null });
    vi.unstubAllGlobals();
  });

  it('leaves guest quotes raw', () => {
    enqueueLiveTick('EURUSD', rawTick());
    flush();
    const tick = useAppStore.getState().ticks.EURUSD as any;
    expect(tick.bid).toBe(1.1);
    expect(tick.ask).toBe(1.10012);
    expect(tick.rawBid).toBeUndefined();
  });

  it('ignores markup published for an account that is not the signed-in one', () => {
    setAccountSpreadMarkups('1001', eurusdMarkup(5));
    expect(getAccountSpreadMarkup('EURUSD')).toBeUndefined();

    signIn('2002');
    setAccountSpreadMarkups('1001', eurusdMarkup(5));
    expect(getAccountSpreadMarkup('EURUSD')).toBeUndefined();
  });

  it('widens the signed-in account quote once for both stores and the tick cache', () => {
    signIn();
    setAccountSpreadMarkups('1001', eurusdMarkup(5));

    enqueueLiveTick('EURUSD', rawTick());
    flush();

    const appTick = useAppStore.getState().ticks.EURUSD as any;
    const marketTick = useMarketDataStore.getState().symbolData.EURUSD?.currentTick as any;
    const cached = window.rtxTickCache.get('EURUSD') as any;
    for (const tick of [appTick, marketTick, cached]) {
      expect(tick.bid).toBe(1.09995);
      expect(tick.ask).toBe(1.10017);
      expect(tick.spread).toBe(0.00022);
      expect(tick.rawBid).toBe(1.1);
      expect(tick.rawAsk).toBe(1.10012);
    }

    // A widened quote travelling through the funnel again is not widened twice.
    expect(applyAccountSpreadMarkup('EURUSD', cached)).toEqual(cached);
  });

  it('re-widens cached quotes when a catalogue refetch changes the markup', () => {
    signIn();
    setAccountSpreadMarkups('1001', eurusdMarkup(5));
    enqueueLiveTick('EURUSD', rawTick());
    flush();

    setAccountSpreadMarkups('1001', eurusdMarkup(10));
    flush();

    const tick = useAppStore.getState().ticks.EURUSD as any;
    expect(tick.bid).toBe(1.0999);
    expect(tick.ask).toBe(1.10022);
    expect(tick.rawBid).toBe(1.1);
  });

  it('restores raw quotes and stops widening on logout', () => {
    signIn();
    setAccountSpreadMarkups('1001', eurusdMarkup(5));
    enqueueLiveTick('EURUSD', rawTick());
    flush();

    useAppStore.setState({ isAuthenticated: false });
    expect(getAccountSpreadMarkup('EURUSD')).toBeUndefined();
    flush();
    expect(useAppStore.getState().ticks.EURUSD?.bid).toBe(1.1);

    enqueueLiveTick('EURUSD', rawTick(1.2, 1.20012, TIMESTAMP + 1_000));
    flush();
    const tick = useAppStore.getState().ticks.EURUSD as any;
    expect(tick.bid).toBe(1.2);
    expect(tick.ask).toBe(1.20012);
    expect(tick.rawBid).toBeUndefined();
  });

  it('clears the markup on account switch and broker session changes', () => {
    signIn('1001');
    setAccountSpreadMarkups('1001', eurusdMarkup(5));
    useAppStore.setState({ accountId: '2002' });
    expect(getAccountSpreadMarkup('EURUSD')).toBeUndefined();

    setAccountSpreadMarkups('2002', eurusdMarkup(3));
    expect(getAccountSpreadMarkup('EURUSD')?.points).toBe(3);
    emitSessionChange('token_rotation');
    expect(getAccountSpreadMarkup('EURUSD')?.points).toBe(3);
    emitSessionChange('account_change');
    expect(getAccountSpreadMarkup('EURUSD')).toBeUndefined();

    setAccountSpreadMarkups('2002', eurusdMarkup(3));
    clearAccountSpreadMarkups();
    expect(getAccountSpreadMarkup('EURUSD')).toBeUndefined();
  });
});
