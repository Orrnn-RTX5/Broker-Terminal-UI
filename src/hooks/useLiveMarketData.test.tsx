import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../store/useAppStore';
import {
  getLiveQuoteRestBatches,
  LIVE_QUOTES_REST_BATCH_SIZE,
  LIVE_QUOTES_REST_POLL_INTERVAL_MS,
  normalizeInstrumentEnabled,
  useMarketInstruments,
  useLiveQuotes,
} from './useLiveMarketData';

const apiGet = vi.hoisted(() => vi.fn());
const apiPut = vi.hoisted(() => vi.fn());
const enqueueLiveTick = vi.hoisted(() => vi.fn());
const useQuoteSubscriptionMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public data?: unknown
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    ApiError,
    apiClient: {
      get: apiGet,
      put: apiPut,
    },
  };
});

vi.mock('../services/liveTickDispatcher', () => ({
  enqueueLiveTick,
}));

vi.mock('./useQuoteSubscription', () => ({
  useQuoteSubscription: useQuoteSubscriptionMock,
}));

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useLiveQuotes REST fallback batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    apiPut.mockReset();
    enqueueLiveTick.mockReset();
    useQuoteSubscriptionMock.mockReset();
    apiGet.mockResolvedValue({ quotes: [] });
    useQuoteSubscriptionMock.mockReturnValue({ isConnected: true });
    useAppStore.setState({ isAuthenticated: true, ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    useAppStore.setState({ isAuthenticated: false, ticks: {}, tickLookup: {} });
    vi.useRealTimers();
  });

  it('splits quote symbols into bounded REST batches', () => {
    const symbols = Array.from({ length: LIVE_QUOTES_REST_BATCH_SIZE * 2 + 5 }, (_, index) => `S${index}`);

    const batches = getLiveQuoteRestBatches(symbols);

    expect(batches.map((batch) => batch.length)).toEqual([
      LIVE_QUOTES_REST_BATCH_SIZE,
      LIVE_QUOTES_REST_BATCH_SIZE,
      5,
    ]);
    expect(batches.flat()).toEqual(symbols);
  });

  it('polls one REST batch per interval while leaving websocket demand on all symbols', async () => {
    const symbols = Array.from({ length: LIVE_QUOTES_REST_BATCH_SIZE + 3 }, (_, index) => `S${index}`);

    const { unmount } = renderHook(() => useLiveQuotes(symbols));
    await flushPromises();

    expect(useQuoteSubscriptionMock).toHaveBeenCalledWith(symbols, 'live-quotes');
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet.mock.calls[0][1]?.params?.symbols.split(',')).toEqual(
      symbols.slice(0, LIVE_QUOTES_REST_BATCH_SIZE)
    );

    await act(async () => {
      vi.advanceTimersByTime(LIVE_QUOTES_REST_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet.mock.calls[1][1]?.params?.symbols.split(',')).toEqual(
      symbols.slice(LIVE_QUOTES_REST_BATCH_SIZE)
    );

    unmount();
  });
});

describe('useMarketInstruments normalization', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    enqueueLiveTick.mockReset();
    useQuoteSubscriptionMock.mockReset();
    useAppStore.setState({ isAuthenticated: true, ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    useAppStore.setState({ isAuthenticated: false, ticks: {}, tickLookup: {} });
  });

  it('normalizes enabled and status fields without treating missing flags as disabled', () => {
    expect(normalizeInstrumentEnabled({ trading_enabled: 'false' })).toBe(false);
    expect(normalizeInstrumentEnabled({ tradingEnabled: 'enabled' })).toBe(true);
    expect(normalizeInstrumentEnabled({ is_enabled: 0 })).toBe(false);
    expect(normalizeInstrumentEnabled({ status: 'ACTIVE' })).toBe(true);
    expect(normalizeInstrumentEnabled({ status: 'disabled' })).toBe(false);
    expect(normalizeInstrumentEnabled({ symbol: 'EURUSD' })).toBeUndefined();
  });

  it('filters explicitly disabled instruments and enqueues REST bid/ask snapshots', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [
        { symbol: 'EURUSD', bid: '1.10101', ask: '1.10123', trading_enabled: true, digits: 5 },
        { symbol: 'GBPUSD', bid: 1.26789, ask: 1.26801 },
        { symbol: 'XAUUSD', bid: 2345.1, ask: 2345.6, status: 'disabled' },
      ],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['EURUSD', 'GBPUSD']);
    expect(result.current.disabledSymbols).toEqual(['XAUUSD']);
    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick).toHaveBeenCalledWith('EURUSD', expect.objectContaining({
      symbol: 'EURUSD',
      bid: 1.10101,
      ask: 1.10123,
      spread: expect.any(Number),
      digits: 5,
    }));
    expect(enqueueLiveTick).toHaveBeenCalledWith('GBPUSD', expect.objectContaining({
      symbol: 'GBPUSD',
      bid: 1.26789,
      ask: 1.26801,
    }));

    unmount();
  });
});
