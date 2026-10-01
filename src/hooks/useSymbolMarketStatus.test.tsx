import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSymbolMarketStatus, getCachedSymbolMarketStatus, useSymbolMarketStatus } from './useSymbolMarketStatus';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';
import { useAppStore } from '../store/useAppStore';
import { processIncomingQuotePayload } from '../services/quotePayloadNormalizer';

const getSymbolStatus = vi.hoisted(() => vi.fn());

vi.mock('../api/trade', () => ({
  marketV2Api: {
    getSymbolStatus,
  },
}));

const setVisibility = (visibilityState: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  });
};

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useSymbolMarketStatus polling lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSymbolStatus.mockReset();
    getSymbolStatus.mockImplementation(async (symbol: string) => ({ symbol, status: 'open' }));
    setVisibility('visible');
    useAppStore.getState().setTicks({});
    commitBrokerAccountSessionScope({ authenticated: true, accountId: 'test-account', brokerId: 'Orrnn', serverUrl: 'https://service.orrnn.com' });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('clamps a positive visible poll interval to at least one second', async () => {
    const { unmount } = renderHook(() => useSymbolMarketStatus('POLL-FLOOR', { pollMs: 10 }));
    await flushPromises();

    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('resolves missing schedules from fresh explicit hub permission and expires on feed silence', async () => {
    getSymbolStatus.mockResolvedValue({ symbol: 'EURJPY', message: 'schedule unavailable', trade_open: false });
    const [tick] = processIncomingQuotePayload({ symbol: 'EURJPY', bid: 178, ask: 179, timestamp_ms: Date.now(),
      tradable: true, stale: false, authority: 'rtx5_hub', broker_id: 'Orrnn', source_mismatch: false });
    useAppStore.getState().setTicks({ EURJPY: tick });
    const { result, unmount } = renderHook(() => useSymbolMarketStatus('EURJPY', { pollMs: 0 }));
    await flushPromises();
    expect(result.current.status).toBe('open');
    expect(result.current.isTradeBlocked).toBe(false);
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(result.current.status).toBe('unknown');
    expect(result.current.isTradeBlocked).toBe(true);
    unmount();
  });

  it('does not infer trading permission from moving prices or override a known closed session', async () => {
    const [tick] = processIncomingQuotePayload({ symbol: 'GBPJPY', bid: 208, ask: 209, timestamp_ms: Date.now(),
      tradable: true, stale: false, authority: 'rtx5_hub', broker_id: 'Orrnn', source_mismatch: false });
    useAppStore.getState().setTicks({ GBPJPY: tick });
    getSymbolStatus.mockResolvedValue({ symbol: 'GBPJPY', status: 'closed' });
    const { result, unmount } = renderHook(() => useSymbolMarketStatus('GBPJPY', { pollMs: 0 }));
    await flushPromises();
    expect(result.current.status).toBe('closed');
    expect(result.current.isTradeBlocked).toBe(true);
    unmount();
    getSymbolStatus.mockResolvedValue({ symbol: 'XAGUSD', message: 'schedule unavailable', trade_open: false });
    useAppStore.getState().setTicks({ XAGUSD: { symbol: 'XAGUSD', bid: 60, ask: 61, spread: 1, timestamp: Date.now(), sourceTimestamp: Date.now() } });
    const legacy = renderHook(() => useSymbolMarketStatus('XAGUSD', { pollMs: 0 }));
    await flushPromises();
    expect(legacy.result.current.isTradeBlocked).toBe(true);
    legacy.unmount();
  });

  it('isolates cached and delayed status responses across account changes', async () => {
    let resolve!: (value: unknown) => void;
    getSymbolStatus.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const oldRequest = fetchSymbolMarketStatus('SCOPE-SYMBOL', { force: true });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: 'other-account', brokerId: 'Orrnn', serverUrl: 'https://service.orrnn.com' });
    resolve({ symbol: 'SCOPE-SYMBOL', status: 'closed' });
    expect((await oldRequest).status).toBe('unknown');
    expect(getCachedSymbolMarketStatus('SCOPE-SYMBOL')).toBeNull();
    await fetchSymbolMarketStatus('SCOPE-SYMBOL');
    expect(getSymbolStatus).toHaveBeenCalledTimes(2);
    expect(getCachedSymbolMarketStatus('SCOPE-SYMBOL')?.status).toBe('open');
    vi.advanceTimersByTime(15000);
    expect(getCachedSymbolMarketStatus('SCOPE-SYMBOL')).toBeNull();
  });

  it('does not carry live permission into another account on the same broker', async () => {
    getSymbolStatus.mockResolvedValue({ symbol: 'EURJPY.scope', message: 'schedule unavailable', trade_open: false });
    const payload = { symbol: 'EURJPY.scope', bid: 178, ask: 179, timestamp_ms: Date.now(),
      tradable: true, stale: false, authority: 'rtx5_hub', broker_id: 'Orrnn', source_mismatch: false };
    const [tick] = processIncomingQuotePayload(payload);
    useAppStore.getState().setTicks({ 'EURJPY.SCOPE': tick });
    const { result, unmount } = renderHook(() => useSymbolMarketStatus('EURJPY.scope', { pollMs: 0 }));
    await flushPromises();
    expect(result.current.isTradeBlocked).toBe(false);
    await act(async () => { commitBrokerAccountSessionScope({ authenticated: true, accountId: 'second-account', brokerId: 'Orrnn', serverUrl: 'https://service.orrnn.com' }); });
    await flushPromises();
    expect(result.current.isTradeBlocked).toBe(true);
    await act(async () => { useAppStore.getState().setTicks({ 'EURJPY.SCOPE': processIncomingQuotePayload(payload)[0] }); });
    expect(result.current.isTradeBlocked).toBe(false);
    unmount();
  });

  it('pauses while hidden and refreshes once when the document returns to foreground', async () => {
    setVisibility('hidden');
    const { unmount } = renderHook(() => useSymbolMarketStatus('VISIBILITY-LIFECYCLE', { pollMs: 100 }));
    await flushPromises();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(getSymbolStatus).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(2);

    unmount();
  });
});
