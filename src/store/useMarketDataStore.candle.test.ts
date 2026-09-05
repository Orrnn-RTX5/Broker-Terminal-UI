// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  aggregateMultipleTimeframes: vi.fn(),
}));

vi.mock('../services/aggregationWorkerManager', () => ({
  getWorkerManager: () => workerMocks,
}));

import {
  useMarketDataStore,
  type CandleUpdate,
  type OHLCV,
} from './useMarketDataStore';

const BASE_TIME_SECONDS = 1_700_000_000;
const BASE_SOURCE_TIME_MS = 1_700_000_100_000;

const serverCandle = (overrides: Partial<CandleUpdate> = {}): CandleUpdate => ({
  symbol: 'XAUUSD.raw',
  timeframe: 'M1',
  open: 100,
  high: 120,
  low: 80,
  close: 110,
  volume: 10,
  time: BASE_TIME_SECONDS,
  source: 'server',
  sourceTimestamp: BASE_SOURCE_TIME_MS,
  ...overrides,
});

const workerRow = (overrides: Partial<OHLCV> = {}): OHLCV => ({
  timestamp: BASE_TIME_SECONDS * 1000,
  open: 100,
  high: 150,
  low: 70,
  close: 130,
  volume: 20,
  ...overrides,
});

describe('MarketDataStore authoritative candle updates', () => {
  beforeEach(() => {
    workerMocks.aggregateMultipleTimeframes.mockReset();
    useMarketDataStore.getState().clearAllData();
  });

  it('stores exact valid backend OHLC and allows a newer correction to narrow wrong wicks', () => {
    useMarketDataStore.getState().updateCandle(serverCandle());
    useMarketDataStore.getState().updateCandle(serverCandle({
      open: 102,
      high: 112,
      low: 95,
      close: 105,
      volume: 11,
      sourceTimestamp: BASE_SOURCE_TIME_MS + 1,
    }));

    expect(useMarketDataStore.getState().symbolData['XAUUSD.RAW'].ohlcv1m).toEqual([{
      timestamp: BASE_TIME_SECONDS * 1000,
      open: 102,
      high: 112,
      low: 95,
      close: 105,
      volume: 11,
      source: 'server',
      sourceTimestamp: BASE_SOURCE_TIME_MS + 1,
    }]);
  });

  it('rejects invalid backend OHLC instead of repairing or widening it', () => {
    useMarketDataStore.getState().updateCandle(serverCandle());
    const accepted = useMarketDataStore.getState().symbolData['XAUUSD.RAW'].ohlcv1m[0];

    useMarketDataStore.getState().updateCandle(serverCandle({
      open: 100,
      high: 99,
      low: 98,
      close: 101,
      sourceTimestamp: BASE_SOURCE_TIME_MS + 1,
    }));

    expect(useMarketDataStore.getState().symbolData['XAUUSD.RAW'].ohlcv1m).toEqual([accepted]);
  });

  it('rejects stale or unversioned frames after a versioned server row', () => {
    useMarketDataStore.getState().updateCandle(serverCandle());
    useMarketDataStore.getState().updateCandle(serverCandle({
      high: 111,
      low: 90,
      sourceTimestamp: BASE_SOURCE_TIME_MS - 1,
    }));
    useMarketDataStore.getState().updateCandle(serverCandle({
      high: 109,
      low: 91,
      sourceTimestamp: undefined,
    }));

    expect(useMarketDataStore.getState().symbolData['XAUUSD.RAW'].ohlcv1m[0]).toMatchObject({
      high: 120,
      low: 80,
      sourceTimestamp: BASE_SOURCE_TIME_MS,
    });
  });

  it('replaces an older bucket in place while preserving and sorting every outside bucket', () => {
    useMarketDataStore.getState().updateCandle(serverCandle({
      time: BASE_TIME_SECONDS + 120,
      open: 120,
      high: 125,
      low: 118,
      close: 124,
    }));
    useMarketDataStore.getState().updateCandle(serverCandle({
      time: BASE_TIME_SECONDS - 60,
      open: 90,
      high: 95,
      low: 88,
      close: 94,
    }));
    useMarketDataStore.getState().updateCandle(serverCandle());
    useMarketDataStore.getState().updateCandle(serverCandle({
      high: 115,
      low: 85,
      sourceTimestamp: BASE_SOURCE_TIME_MS + 1,
    }));

    const rows = useMarketDataStore.getState().symbolData['XAUUSD.RAW'].ohlcv1m;
    expect(rows.map((row) => row.timestamp)).toEqual([
      (BASE_TIME_SECONDS - 60) * 1000,
      BASE_TIME_SECONDS * 1000,
      (BASE_TIME_SECONDS + 120) * 1000,
    ]);
    expect(rows.map((row) => row.close)).toEqual([94, 110, 124]);
    expect(rows[1]).toMatchObject({ high: 115, low: 85 });
  });

  it('keeps punctuation-bearing broker contracts isolated without creating a base alias', () => {
    useMarketDataStore.getState().updateCandle(serverCandle({ symbol: 'xauusd.raw' }));
    useMarketDataStore.getState().updateCandle(serverCandle({
      symbol: 'XAUUSD.pro',
      close: 210,
      high: 220,
      low: 180,
      open: 200,
    }));
    useMarketDataStore.getState().updateCandle(serverCandle({
      symbol: 'US500-F',
      open: 5000,
      high: 5010,
      low: 4990,
      close: 5005,
    }));

    const symbols = useMarketDataStore.getState().symbolData;
    expect(Object.keys(symbols).sort()).toEqual(['US500-F', 'XAUUSD.PRO', 'XAUUSD.RAW']);
    expect(symbols.XAUUSD).toBeUndefined();
    expect(symbols['XAUUSD.RAW'].ohlcv1m[0].close).toBe(110);
    expect(symbols['XAUUSD.PRO'].ohlcv1m[0].close).toBe(210);
  });

  it('does not let a delayed local worker result replace an authoritative server bucket', () => {
    let workerCallback: ((results: Record<string, OHLCV[]>) => void) | undefined;
    workerMocks.aggregateMultipleTimeframes.mockImplementation((
      _ticks: unknown,
      _timeframes: unknown,
      callback: (results: Record<string, OHLCV[]>) => void,
    ) => {
      workerCallback = callback;
    });

    useMarketDataStore.getState().updateTick('XAUUSD.RAW', {
      symbol: 'XAUUSD.RAW',
      bid: 100,
      ask: 101,
      spread: 1,
      timestamp: BASE_TIME_SECONDS * 1000,
      sourceTimestamp: BASE_TIME_SECONDS * 1000,
      volume: 1,
    }, { syncAppStore: false });
    useMarketDataStore.getState().updateCandle(serverCandle({ high: 110, low: 90 }));

    workerCallback?.({
      '1m': [workerRow()],
      '5m': [],
      '15m': [],
      '1h': [],
    });

    expect(useMarketDataStore.getState().symbolData['XAUUSD.RAW'].ohlcv1m).toHaveLength(1);
    expect(useMarketDataStore.getState().symbolData['XAUUSD.RAW'].ohlcv1m[0]).toMatchObject({
      high: 110,
      low: 90,
      close: 110,
      source: 'server',
    });
  });
});
