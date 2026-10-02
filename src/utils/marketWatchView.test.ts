// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tick } from '../store/useAppStore';
import { resetBrokerServerClock } from '../services/brokerServerClock';
import {
  DEFAULT_MARKET_WATCH_COLUMNS,
  DEFAULT_MARKET_WATCH_OPTIONS,
  MARKET_WATCH_COLUMNS_STORAGE_KEY,
  MARKET_WATCH_OPTIONS_STORAGE_KEY,
  MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY,
  MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY,
  deleteMarketWatchSavedSet,
  escapeMarketWatchCsvCell,
  escapeMarketWatchTsvCell,
  formatMarketWatchTime,
  loadMarketWatchColumns,
  loadMarketWatchOptions,
  loadMarketWatchSavedSets,
  normalizeMarketWatchColumns,
  normalizeMarketWatchOptions,
  saveMarketWatchColumns,
  saveMarketWatchOptions,
  saveMarketWatchSavedSet,
  sortMarketWatchSymbols,
  type MarketWatchSortMetadata,
} from './marketWatchView';

describe('marketWatchView storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns independent defaults for absent or malformed storage', () => {
    expect(loadMarketWatchColumns()).toEqual(DEFAULT_MARKET_WATCH_COLUMNS);
    expect(loadMarketWatchOptions()).toEqual(DEFAULT_MARKET_WATCH_OPTIONS);
    expect(DEFAULT_MARKET_WATCH_OPTIONS.autoRemoveExpired).toBe(false);
    expect(loadMarketWatchSavedSets()).toEqual({});

    localStorage.setItem(MARKET_WATCH_COLUMNS_STORAGE_KEY, '{not json');
    localStorage.setItem(MARKET_WATCH_OPTIONS_STORAGE_KEY, '{not json');
    localStorage.setItem(MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY, '{not json');

    const columns = loadMarketWatchColumns();
    expect(columns).toEqual(DEFAULT_MARKET_WATCH_COLUMNS);
    columns.push('time');
    expect(loadMarketWatchColumns()).toEqual(DEFAULT_MARKET_WATCH_COLUMNS);
    expect(loadMarketWatchOptions()).toEqual(DEFAULT_MARKET_WATCH_OPTIONS);
    expect(loadMarketWatchSavedSets()).toEqual({});

    localStorage.setItem(MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY, JSON.stringify(['not', 'a', 'record']));
    expect(loadMarketWatchSavedSets()).toEqual({});
  });

  it('filters unsupported columns, removes duplicates, and always restores Symbol, Bid, and Ask', () => {
    expect(normalizeMarketWatchColumns(['ask', 'volume', 'ask', 'unsupported'])).toEqual([
      'symbol',
      'bid',
      'ask',
      'volume',
    ]);
    expect(normalizeMarketWatchColumns([])).toEqual(['symbol', 'bid', 'ask']);
    expect(normalizeMarketWatchColumns({ symbol: true })).toEqual(DEFAULT_MARKET_WATCH_COLUMNS);

    saveMarketWatchColumns(['time', 'ask']);
    expect(JSON.parse(localStorage.getItem(MARKET_WATCH_COLUMNS_STORAGE_KEY) ?? 'null')).toEqual([
      'symbol',
      'bid',
      'ask',
      'time',
    ]);
  });

  it.each([['dailyChangePrice'], ['dailyChange'], ['dailyChangePrice', 'dailyChange']] as const)('persists daily columns independently: %j', (...columns) => {
    saveMarketWatchColumns(['symbol', 'bid', 'ask', ...columns]);
    expect(loadMarketWatchColumns()).toEqual(['symbol', 'bid', 'ask', ...columns]);
  });

  it('accepts only boolean option overrides and persists the normalized contract', () => {
    const normalized = normalizeMarketWatchOptions({
      useSystemColors: false,
      showMilliseconds: 'true',
      autoRemoveExpired: false,
      autoArrange: true,
      showGrid: 0,
    });

    expect(normalized).toEqual({
      useSystemColors: false,
      showMilliseconds: DEFAULT_MARKET_WATCH_OPTIONS.showMilliseconds,
      autoRemoveExpired: false,
      autoArrange: true,
      showGrid: DEFAULT_MARKET_WATCH_OPTIONS.showGrid,
    });

    saveMarketWatchOptions(normalized);
    expect(loadMarketWatchOptions()).toEqual(normalized);
  });

  it('loads legacy symbol arrays with companion columns, saves compatible shapes, and deletes both entries', () => {
    localStorage.setItem(MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY, JSON.stringify({
      Legacy: [' eurusd ', 'EURUSD', 'gbpusd', ''],
      Embedded: {
        symbols: [' xauusd '],
        columns: ['time'],
      },
    }));
    localStorage.setItem(MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY, JSON.stringify({
      Legacy: ['ask', 'volume', 'unsupported'],
      Embedded: ['source'],
    }));

    expect(loadMarketWatchSavedSets()).toEqual({
      Legacy: {
        symbols: ['EURUSD', 'GBPUSD'],
        columns: ['symbol', 'bid', 'ask', 'volume'],
      },
      Embedded: {
        symbols: ['XAUUSD'],
        columns: ['symbol', 'bid', 'ask', 'time'],
      },
    });

    const saved = saveMarketWatchSavedSet(' Metals ', [' xagusd ', 'XAUUSD', 'xagusd'], ['ask', 'dailyChange']);
    expect(saved.Metals).toEqual({
      symbols: ['XAGUSD', 'XAUUSD'],
      columns: ['symbol', 'bid', 'ask', 'dailyChange'],
    });

    const legacyPayload = JSON.parse(localStorage.getItem(MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY) ?? 'null');
    const columnPayload = JSON.parse(localStorage.getItem(MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY) ?? 'null');
    expect(legacyPayload.Metals).toEqual(['XAGUSD', 'XAUUSD']);
    expect(Array.isArray(legacyPayload.Legacy)).toBe(true);
    expect(columnPayload.Metals).toEqual(['symbol', 'bid', 'ask', 'dailyChange']);

    const remaining = deleteMarketWatchSavedSet('Legacy');
    expect(remaining).not.toHaveProperty('Legacy');
    expect(JSON.parse(localStorage.getItem(MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY) ?? 'null')).not.toHaveProperty('Legacy');
    expect(JSON.parse(localStorage.getItem(MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY) ?? 'null')).not.toHaveProperty('Legacy');
  });
});

describe('sortMarketWatchSymbols', () => {
  it('sorts signed price changes numerically, keeps equal rows stable and leaves missing values last', () => {
    const rows = ['Z', 'missing', 'A', 'negative', 'zero'];
    const amounts: Record<string, number> = { Z: 25, A: 25, negative: -2.5, zero: 0 };
    const read = (symbol: string) => ({ dailyChangePrice: amounts[symbol] });
    expect(sortMarketWatchSymbols(rows, 'change-asc', read, new Map())).toEqual(['negative', 'zero', 'Z', 'A', 'missing']);
    expect(sortMarketWatchSymbols(rows, 'change-desc', read, new Map())).toEqual(['Z', 'A', 'zero', 'negative', 'missing']);
  });

  const emptyMetadata = new Map<string, MarketWatchSortMetadata>();
  const ticks: Record<string, Pick<Tick, 'dailyChange' | 'volume'> | undefined> = {
    ALPHA: { dailyChange: 2, volume: 10 },
    BRAVO: { dailyChange: 2, volume: 50 },
    CHARLIE: { dailyChange: -3 },
    ECHO: { dailyChange: 5, volume: 5 },
  };
  const getTick = (symbol: string) => ticks[symbol];

  it('does not mutate the source and applies deterministic symbol and no-sort ordering', () => {
    const symbols = ['CHARLIE', 'ALPHA', 'BRAVO'];

    expect(sortMarketWatchSymbols(symbols, null, getTick, emptyMetadata)).toEqual(symbols);
    expect(sortMarketWatchSymbols(symbols, 'symbol', getTick, emptyMetadata)).toEqual([
      'ALPHA',
      'BRAVO',
      'CHARLIE',
    ]);
    expect(symbols).toEqual(['CHARLIE', 'ALPHA', 'BRAVO']);
  });

  it('sorts gainers, losers, and volume with tied symbols stable and missing metrics last', () => {
    const symbols = ['MISSING', 'BRAVO', 'CHARLIE', 'ECHO', 'ALPHA'];

    expect(sortMarketWatchSymbols(symbols, 'gainers', getTick, emptyMetadata)).toEqual([
      'ECHO',
      'BRAVO',
      'ALPHA',
      'CHARLIE',
      'MISSING',
    ]);
    expect(sortMarketWatchSymbols(symbols, 'losers', getTick, emptyMetadata)).toEqual([
      'CHARLIE',
      'BRAVO',
      'ALPHA',
      'ECHO',
      'MISSING',
    ]);
    expect(sortMarketWatchSymbols(symbols, 'volume', getTick, emptyMetadata)).toEqual([
      'BRAVO',
      'ALPHA',
      'ECHO',
      'MISSING',
      'CHARLIE',
    ]);
  });

  it('sorts industry and sector metadata alphabetically and places missing metadata last', () => {
    const symbols = ['ZULU', 'ALPHA', 'MIKE', 'BRAVO'];
    const metadata = new Map<string, MarketWatchSortMetadata>([
      ['ZULU', { industry: 'Technology', sector: 'Beta' }],
      ['ALPHA', { industry: 'Technology', sector: 'Alpha' }],
      ['MIKE', { industry: 'Finance', sector: 'Beta' }],
    ]);

    expect(sortMarketWatchSymbols(symbols, 'industry', () => undefined, metadata)).toEqual([
      'MIKE',
      'ALPHA',
      'ZULU',
      'BRAVO',
    ]);
    expect(sortMarketWatchSymbols(symbols, 'sector', () => undefined, metadata)).toEqual([
      'ALPHA',
      'MIKE',
      'ZULU',
      'BRAVO',
    ]);
  });
});

describe('marketWatchView formatting', () => {
  beforeEach(() => resetBrokerServerClock());

  it('formats equivalent seconds and milliseconds timestamps in broker-server time', () => {
    const wholeSecond = Date.UTC(2026, 4, 6, 7, 8, 9, 0);

    expect(formatMarketWatchTime(wholeSecond / 1_000, false)).toBe('07:08:09');
    expect(formatMarketWatchTime(wholeSecond, false)).toBe('07:08:09');
    expect(formatMarketWatchTime(wholeSecond + 42, true)).toBe('07:08:09.042');
    expect(formatMarketWatchTime(wholeSecond / 1_000, true)).toBe('07:08:09.000');
    expect(formatMarketWatchTime(0, true)).toBe('-');
    expect(formatMarketWatchTime('not-a-time', false)).toBe('-');
  });

  it('escapes commas, quotes, CR/LF, nullish values, and ordinary CSV cells', () => {
    expect(escapeMarketWatchCsvCell('EURUSD')).toBe('EURUSD');
    expect(escapeMarketWatchCsvCell(null)).toBe('');
    expect(escapeMarketWatchCsvCell('Bid,Ask')).toBe('"Bid,Ask"');
    expect(escapeMarketWatchCsvCell('He said "buy"')).toBe('"He said ""buy"""');
    expect(escapeMarketWatchCsvCell('line 1\r\nline 2')).toBe('"line 1\r\nline 2"');
    expect(escapeMarketWatchCsvCell('"A,B"\nnext')).toBe('"""A,B""\nnext"');
  });

  it('neutralizes spreadsheet formulas before applying CSV quoting', () => {
    expect(escapeMarketWatchCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeMarketWatchCsvCell('-')).toBe('-');
    expect(escapeMarketWatchCsvCell('  +SUM(A1:A2)')).toBe("'  +SUM(A1:A2)");
    expect(escapeMarketWatchCsvCell('\t-42')).toBe("'\t-42");
    expect(escapeMarketWatchCsvCell('@malicious')).toBe("'@malicious");
    expect(escapeMarketWatchCsvCell(' =1,2')).toBe("\"' =1,2\"");
    expect(escapeMarketWatchCsvCell('safe =1')).toBe('safe =1');
  });

  it('neutralizes TSV formulas and prevents embedded delimiters from creating rows or columns', () => {
    expect(escapeMarketWatchTsvCell('EURUSD')).toBe('EURUSD');
    expect(escapeMarketWatchTsvCell(null)).toBe('');
    expect(escapeMarketWatchTsvCell('=1+1')).toBe("'=1+1");
    expect(escapeMarketWatchTsvCell('-')).toBe('-');
    expect(escapeMarketWatchTsvCell(' \t+SUM(A1:A2)')).toBe("'  +SUM(A1:A2)");
    expect(escapeMarketWatchTsvCell('Broker\tFeed\r\nPrimary')).toBe('Broker Feed Primary');
    expect(escapeMarketWatchTsvCell('safe @value')).toBe('safe @value');
  });
});
