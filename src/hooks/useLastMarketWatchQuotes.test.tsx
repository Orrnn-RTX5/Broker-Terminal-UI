import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readMarketWatchQuotes,
  rememberMarketWatchQuote,
  resetMarketWatchQuoteCacheForTests,
} from '../services/marketWatchQuoteCache';
import { useAppStore } from '../store/useAppStore';
import {
  LAST_MARKET_WATCH_PRICE_MAX_CONCURRENCY,
  resolveLastMarketWatchPrice,
  useLastMarketWatchQuotes,
} from './useLastMarketWatchQuotes';

const apiGet = vi.hoisted(() => vi.fn());
const broker = vi.hoisted(() => ({ serverUrl: 'https://broker-a.test' }));
vi.mock('../services/brokerSession', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/brokerSession')>();
  return { ...actual, getServerUrl: () => broker.serverUrl };
});
vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, get: apiGet } };
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
};

describe('Market Watch last historical price', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue([]);
    resetMarketWatchQuoteCacheForTests();
    broker.serverUrl = 'https://broker-a.test';
    useAppStore.setState({ authToken: null, refreshToken: null });
  });
  afterEach(() => {
    cleanup();
    resetMarketWatchQuoteCacheForTests();
  });

  it('selects the newest real pair, normalizes source time, and preserves exact symbol identity', () => {
    const asOf = Date.now() - 86_400_000;
    expect(resolveLastMarketWatchPrice([
      { symbol: 'EURUSD.R', bid: 1.1, ask: 1.2, time_ms: asOf },
      { symbol: 'EURUSD.R', bid: 1, ask: 1.1, time: Math.floor((asOf - 1000) / 1000) },
      { symbol: 'EURUSD', bid: 9, ask: 10, time_ms: asOf + 1000 },
      { symbol: 'EURUSD.R', bid: 0, ask: 2, time_ms: asOf + 2000 },
    ], ' eurusd.r ', 'quote')).toEqual({ kind: 'quote', bid: 1.1, ask: 1.2, asOf });
  });

  it('rejects unknown age, future, ancient, one-sided, and mismatched history', () => {
    const now = Date.now();
    for (const row of [
      { bid: 1, ask: 2 },
      { bid: 1, ask: 2, time: now + 1000 },
      { bid: 1, ask: 2, time: now - 15 * 86_400_000 },
      { bid: 1, time: now - 1000 },
      { bid: Number.NaN, ask: 2, time: now - 1000 },
    ]) expect(resolveLastMarketWatchPrice([row], 'XAUUSD', 'quote', now)).toBeUndefined();
    expect(resolveLastMarketWatchPrice({ symbol: 'XAUUSD.R', ticks: [{ bid: 1, ask: 2, time: now - 1000 }] }, 'XAUUSD', 'quote', now)).toBeUndefined();
    expect(resolveLastMarketWatchPrice({ timeframe: 'D1', candles: [{ close: 10, time: now - 120_000 }] }, 'XAUUSD', 'close', now)).toBeUndefined();
  });

  it('reads the final recorded minute without inventing an ask or using a forming minute', () => {
    const now = Date.now();
    expect(resolveLastMarketWatchPrice({ symbol: 'XAUUSD', timeframe: 'M1', candles: [
      { close: 4378.535, time: now - 86_400_000, isClosed: false },
      { close: 4400, time: now - 30_000 },
    ] }, 'XAUUSD', 'close', now)).toEqual({ kind: 'close', close: 4378.535, asOf: now - 86_400_000 });
  });

  it('hydrates cached closing quotes immediately without publishing live ticks', () => {
    const quote = { bid: 4378.5, ask: 4378.7, asOf: Date.now() - 86_400_000 };
    rememberMarketWatchQuote('scope-a', 'XAUUSD', quote);
    apiGet.mockImplementation(() => new Promise(() => undefined));
    const existingTicks = useAppStore.getState().ticks;
    const { result } = renderHook(() => useLastMarketWatchQuotes({
      enabled: true, scopeKey: 'scope-a', symbols: [' xauusd ', 'XAUUSD'], candleSymbols: ['XAUUSD'],
    }));
    expect(result.current.get('XAUUSD')).toEqual({ kind: 'quote', ...quote });
    expect(useAppStore.getState().ticks).toBe(existingTicks);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('loads genuine backend closing bid/ask and persists the original timestamp', async () => {
    const quote = { symbol: 'XAUUSD', bid: 4378.5, ask: 4378.7, time: Date.now() - 86_400_000 };
    apiGet.mockResolvedValue([quote]);
    const { result } = renderHook(() => useLastMarketWatchQuotes({
      enabled: true, scopeKey: 'scope-a', symbols: ['XAUUSD'], candleSymbols: ['XAUUSD'],
    }));
    await waitFor(() => expect(result.current.get('XAUUSD')?.kind).toBe('quote'));
    expect(readMarketWatchQuotes('scope-a', ['XAUUSD']).XAUUSD).toEqual({ bid: quote.bid, ask: quote.ask, asOf: quote.time });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('uses a labeled close when the broker has no tick history, leaving global quotes unchanged', async () => {
    const asOf = Date.now() - 86_400_000;
    const existingTicks = useAppStore.getState().ticks;
    apiGet.mockResolvedValueOnce([]).mockResolvedValueOnce({ candles: [{ time: asOf, close: 4378.535 }] });
    const { result } = renderHook(() => useLastMarketWatchQuotes({
      enabled: true, scopeKey: 'scope-a', symbols: ['XAUUSD'], candleSymbols: ['XAUUSD'],
    }));
    await waitFor(() => expect(result.current.get('XAUUSD')).toEqual({ kind: 'close', close: 4378.535, asOf }));
    expect(useAppStore.getState().ticks).toBe(existingTicks);
    expect(readMarketWatchQuotes('scope-a', ['XAUUSD'])).toEqual({});
    expect(apiGet.mock.calls.map(call => call[0])).toEqual(['/ticks/XAUUSD', '/candles/XAUUSD']);
  });

  it('retains a newer saved pair when tick history is older', async () => {
    const asOf = Date.now() - 120_000;
    rememberMarketWatchQuote('scope-a', 'XAUUSD', { bid: 100, ask: 101, asOf });
    apiGet.mockResolvedValue([{ bid: 90, ask: 91, time: asOf - 60_000 }]);
    const { result } = renderHook(() => useLastMarketWatchQuotes({
      enabled: true, scopeKey: 'scope-a', symbols: ['XAUUSD'], candleSymbols: ['XAUUSD'],
    }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.get('XAUUSD')).toEqual({ kind: 'quote', bid: 100, ask: 101, asOf });
  });

  it('never requests candles for crypto or symbols not eligible for close fallback', async () => {
    const { result } = renderHook(() => useLastMarketWatchQuotes({
      enabled: true, scopeKey: 'scope-a', symbols: ['BTCUSD'], candleSymbols: [],
    }));
    await act(async () => { await Promise.resolve(); });
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(result.current.size).toBe(0);
  });

  it('keeps recovered closes when neighboring rows change and hides a close if no longer eligible', async () => {
    const asOf = Date.now() - 86_400_000;
    apiGet.mockImplementation((path: string) => Promise.resolve(path.startsWith('/ticks/')
      ? [] : { candles: [{ time: asOf, close: 100 }] }));
    const { result, rerender } = renderHook(({ symbols, candleSymbols }) => useLastMarketWatchQuotes({
      enabled: true, scopeKey: 'scope-a', symbols, candleSymbols,
    }), { initialProps: { symbols: ['XAUUSD', 'EURUSD'], candleSymbols: ['XAUUSD', 'EURUSD'] } });
    await waitFor(() => expect(result.current.size).toBe(2));
    const calls = apiGet.mock.calls.length;
    rerender({ symbols: ['XAUUSD'], candleSymbols: ['XAUUSD'] });
    expect(result.current.get('XAUUSD')).toEqual({ kind: 'close', close: 100, asOf });
    expect(result.current.has('EURUSD')).toBe(false);
    expect(apiGet).toHaveBeenCalledTimes(calls);
    rerender({ symbols: ['XAUUSD'], candleSymbols: [] });
    expect(result.current.has('XAUUSD')).toBe(false);
    await act(async () => { await Promise.resolve(); });
  });

  it('reloads a returning symbol from the backend without refetching its remaining neighbor', async () => {
    const asOf = Date.now() - 180_000;
    let goldClose = { time: asOf, close: 100 };
    const euroClose = { time: asOf, close: 1.15 };
    apiGet.mockImplementation((path: string) => Promise.resolve(path.startsWith('/ticks/')
      ? [] : { candles: [path === '/candles/XAUUSD' ? goldClose : euroClose] }));
    const { result, rerender } = renderHook(({ symbols }) => useLastMarketWatchQuotes({
      enabled: true, scopeKey: 'scope-a', symbols, candleSymbols: symbols,
    }), { initialProps: { symbols: ['XAUUSD', 'EURUSD'] } });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(apiGet).toHaveBeenCalledTimes(4);

    rerender({ symbols: ['EURUSD'] });
    expect(result.current.has('XAUUSD')).toBe(false);
    expect(result.current.get('EURUSD')).toEqual({ kind: 'close', close: 1.15, asOf });
    expect(apiGet).toHaveBeenCalledTimes(4);

    goldClose = { time: asOf + 60_000, close: 110 };
    rerender({ symbols: ['XAUUSD', 'EURUSD'] });
    await waitFor(() => expect(result.current.get('XAUUSD')).toEqual({
      kind: 'close', close: 110, asOf: asOf + 60_000,
    }));
    expect(result.current.get('EURUSD')).toEqual({ kind: 'close', close: 1.15, asOf });
    expect(apiGet.mock.calls.slice(4).map(call => call[0])).toEqual([
      '/ticks/XAUUSD', '/candles/XAUUSD',
    ]);
  });

  it.each(['empty', 'disabled'] as const)('reloads backend history after %s fallback demand resumes', async (idleMode) => {
    const asOf = Date.now() - 180_000;
    let backendClose = { time: asOf, close: 100 };
    apiGet.mockImplementation((path: string) => Promise.resolve(path.startsWith('/ticks/')
      ? [] : { candles: [backendClose] }));
    const { result, rerender } = renderHook(({ enabled, symbols }) => useLastMarketWatchQuotes({
      enabled, scopeKey: 'scope-a', symbols, candleSymbols: symbols,
    }), { initialProps: { enabled: true, symbols: ['XAUUSD'] } });
    await waitFor(() => expect(result.current.get('XAUUSD')).toEqual({ kind: 'close', close: 100, asOf }));
    expect(apiGet).toHaveBeenCalledTimes(2);

    rerender(idleMode === 'empty'
      ? { enabled: true, symbols: [] }
      : { enabled: false, symbols: ['XAUUSD'] });
    expect(result.current.size).toBe(0);
    expect(apiGet).toHaveBeenCalledTimes(2);

    backendClose = { time: asOf + 60_000, close: 120 };
    rerender({ enabled: true, symbols: ['XAUUSD'] });
    await waitFor(() => expect(result.current.get('XAUUSD')).toEqual({
      kind: 'close', close: 120, asOf: asOf + 60_000,
    }));
    expect(apiGet.mock.calls.map(call => call[0])).toEqual([
      '/ticks/XAUUSD', '/candles/XAUUSD', '/ticks/XAUUSD', '/candles/XAUUSD',
    ]);
  });

  it('cancels broker A requests and discards results when switching to broker B', async () => {
    const pending = deferred<unknown>();
    const asOf = Date.now() - 120_000;
    rememberMarketWatchQuote('scope-a', 'XAUUSD', { bid: 100, ask: 101, asOf });
    apiGet.mockImplementationOnce(() => pending.promise).mockImplementation(() => new Promise(() => undefined));
    const { result, rerender } = renderHook(({ scopeKey }) => useLastMarketWatchQuotes({
      enabled: true, scopeKey, symbols: ['XAUUSD'], candleSymbols: ['XAUUSD'],
    }), { initialProps: { scopeKey: 'scope-a' } });
    const oldOptions = apiGet.mock.calls[0][1];
    broker.serverUrl = 'https://broker-b.test';
    rerender({ scopeKey: 'scope-b' });
    expect(oldOptions.signal.aborted).toBe(true);
    expect(oldOptions.baseUrl).toBe('https://broker-a.test/api/v2');
    expect(apiGet.mock.calls[1][1].baseUrl).toBe('https://broker-b.test/api/v2');
    expect(result.current.size).toBe(0);
    await act(async () => {
      pending.resolve([{ bid: 200, ask: 201, time: asOf + 1000 }]);
      await pending.promise;
    });
    expect(result.current.size).toBe(0);
    expect(readMarketWatchQuotes('scope-b', ['XAUUSD'])).toEqual({});
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('bounds history concurrency and makes no requests when disabled', async () => {
    const pending = deferred<unknown>();
    apiGet.mockImplementation(() => pending.promise);
    const { rerender } = renderHook(({ enabled }) => useLastMarketWatchQuotes({
      enabled, scopeKey: 'scope-a', symbols: ['A', 'B', 'C', 'D', 'E', 'F'], candleSymbols: [],
    }), { initialProps: { enabled: false } });
    expect(apiGet).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(apiGet).toHaveBeenCalledTimes(LAST_MARKET_WATCH_PRICE_MAX_CONCURRENCY);
  });
});
