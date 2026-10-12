// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tick } from '../store/useAppStore';
import { QUOTE_TRADING_STATUS_TTL_MS } from '../utils/quoteTradingStatus';
import { useLiveSymbolTradingStatus } from './useLiveSymbolTradingStatus';

const mocks = vi.hoisted(() => ({
  state: { ticks: {} as Record<string, Tick> },
  subscribers: new Set<(next: { ticks: Record<string, Tick> }, previous: { ticks: Record<string, Tick> }) => void>(),
  scope: 'account-a',
  brokerId: 'broker-a',
  dispatch: vi.fn(),
}));

// Count calls at the dispatch boundary, including React's otherwise invisible
// no-op updates. Returning the same value inside an updater is still a call.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [state, setState] = actual.useState(initial);
      return [state, (next: unknown) => {
        mocks.dispatch(next);
        setState(next);
      }];
    },
  };
});
vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => mocks.state,
    subscribe: (listener: (next: typeof mocks.state, previous: typeof mocks.state) => void) => {
      mocks.subscribers.add(listener);
      return () => { mocks.subscribers.delete(listener); };
    },
  },
}));
vi.mock('../services/brokerSession', () => ({
  getCommittedBrokerAccountSessionScope: () => ({ brokerId: mocks.brokerId }),
  getCommittedBrokerAccountSessionScopeKey: () => mocks.scope,
}));
vi.mock('../services/brokerServerClock', () => ({ getBrokerServerNowMs: (now: number) => now }));

const quote = (symbol: string, tradable = true, sourceTimestamp = Date.now()): Tick => ({
  symbol, bid: 1.1, ask: 1.2, spread: 0.1, timestamp: Date.now(), sourceTimestamp,
  tradingStatus: {
    tradable, authority: 'rtx5_hub', brokerId: mocks.brokerId, stale: false,
    sourceMismatch: false, receivedAt: Date.now(), sessionScope: mocks.scope,
  },
});
const publish = (ticks: Record<string, Tick>) => {
  const previous = mocks.state;
  mocks.state = { ticks };
  mocks.subscribers.forEach(listener => listener(mocks.state, previous));
};

describe('live quote trading permission publication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    mocks.state = { ticks: {} };
    mocks.scope = 'account-a';
    mocks.brokerId = 'broker-a';
    mocks.subscribers.clear();
    mocks.dispatch.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not dispatch or reschedule expiry for account packets and unrelated symbols', () => {
    mocks.state = { ticks: { EURUSD: quote('EURUSD') } };
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const { result, unmount } = renderHook(() => useLiveSymbolTradingStatus('EURUSD', mocks.scope));
    expect(result.current).toBe(true);
    mocks.dispatch.mockClear();
    timer.mockClear();

    act(() => {
      for (let index = 0; index < 100; index++) {
        publish(mocks.state.ticks);
        publish({ ...mocks.state.ticks, GBPUSD: quote('GBPUSD') });
      }
    });

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
    unmount();
  });

  it('renews fresh quote expiry without dispatching unchanged permission, then expires it', () => {
    mocks.state = { ticks: { EURUSD: quote('EURUSD') } };
    const { result, unmount } = renderHook(() => useLiveSymbolTradingStatus('EURUSD', mocks.scope));
    mocks.dispatch.mockClear();
    for (let index = 0; index < 20; index++) {
      act(() => {
        vi.advanceTimersByTime(100);
        publish({ EURUSD: quote('EURUSD') });
      });
    }
    expect(mocks.dispatch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(QUOTE_TRADING_STATUS_TTL_MS - 1));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    unmount();
  });

  it('expires by source age even when permission was just received', () => {
    mocks.state = { ticks: { EURUSD: quote('EURUSD', true, Date.now() - QUOTE_TRADING_STATUS_TTL_MS + 500) } };
    const { result, unmount } = renderHook(() => useLiveSymbolTradingStatus('EURUSD', mocks.scope));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBeNull();
    unmount();
  });

  it('publishes permission changes and quote removal immediately', () => {
    mocks.state = { ticks: { EURUSD: quote('EURUSD') } };
    const { result, unmount } = renderHook(() => useLiveSymbolTradingStatus('EURUSD', mocks.scope));
    mocks.dispatch.mockClear();
    act(() => publish({ EURUSD: quote('EURUSD', false) }));
    expect(result.current).toBe(false);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    act(() => publish({}));
    expect(result.current).toBeNull();
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('switches symbol and session ownership without reusing an old permission', () => {
    mocks.state = { ticks: { EURUSD: quote('EURUSD'), GBPUSD: quote('GBPUSD', false) } };
    const { result, rerender, unmount } = renderHook(
      ({ symbol, scope }) => useLiveSymbolTradingStatus(symbol, scope),
      { initialProps: { symbol: 'EURUSD', scope: mocks.scope } },
    );
    rerender({ symbol: 'GBPUSD', scope: mocks.scope });
    expect(result.current).toBe(false);
    mocks.scope = 'account-b';
    rerender({ symbol: 'GBPUSD', scope: mocks.scope });
    expect(result.current).toBeNull();
    act(() => publish({ GBPUSD: quote('GBPUSD') }));
    expect(result.current).toBe(true);
    unmount();
  });

  it('cancels expiry and rejects retained callbacks after cleanup', () => {
    mocks.state = { ticks: { EURUSD: quote('EURUSD') } };
    const { unmount } = renderHook(() => useLiveSymbolTradingStatus('EURUSD', mocks.scope));
    const callback = [...mocks.subscribers][0];
    unmount();
    mocks.dispatch.mockClear();
    expect(mocks.subscribers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      callback({ ticks: {} }, mocks.state);
      vi.advanceTimersByTime(QUOTE_TRADING_STATUS_TTL_MS);
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
