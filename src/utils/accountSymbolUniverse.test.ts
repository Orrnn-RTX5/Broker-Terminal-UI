import { describe, expect, it } from 'vitest';
import {
  buildOrderTicketSymbolOptions,
  filterSymbolsExactlyInUniverse,
  isAccountSymbolUniverseActive,
  mergeAccountCatalogWithPublic,
  pruneSymbolsToUniverse,
  resolveChartEligibleSymbolNames,
  resolveTradeEligibleSymbolNames,
  selectAccountDefaultMarketWatchSymbols,
} from './accountSymbolUniverse';

describe('isAccountSymbolUniverseActive', () => {
  it('uses the account universe only for an authenticated loading/loaded catalogue', () => {
    expect(isAccountSymbolUniverseActive(true, 'loading')).toBe(true);
    expect(isAccountSymbolUniverseActive(true, 'loaded')).toBe(true);
    expect(isAccountSymbolUniverseActive(true, 'failed')).toBe(false);
    expect(isAccountSymbolUniverseActive(true, 'none')).toBe(false);
    expect(isAccountSymbolUniverseActive(true, undefined)).toBe(false);
    expect(isAccountSymbolUniverseActive(false, 'loaded')).toBe(false);
    expect(isAccountSymbolUniverseActive(false, 'loading')).toBe(false);
  });
});

describe('mergeAccountCatalogWithPublic', () => {
  it('keeps backend account order and never adds public-only symbols', () => {
    const merged = mergeAccountCatalogWithPublic(
      [{ symbol: 'xauusd' }, { symbol: 'EURUSD' }, { symbol: 'XAUUSD' }],
      [{ symbol: 'EURUSD' }, { symbol: 'BTCUSD' }, { symbol: 'XAUUSD' }],
    );
    expect(merged.map((item) => item.symbol)).toEqual(['XAUUSD', 'EURUSD']);
  });

  it('fills fields the account row omits from the public catalogue, account values win', () => {
    type Row = { symbol: string; bid?: number; digits?: number; tradingEnabled?: boolean; description?: string };
    const merged = mergeAccountCatalogWithPublic<Row>(
      [{ symbol: 'EURUSD', tradingEnabled: false, digits: 4, bid: undefined }],
      [{ symbol: 'EURUSD', bid: 1.1, digits: 5, description: 'Euro vs US Dollar' }],
    );
    expect(merged).toEqual([{
      symbol: 'EURUSD', bid: 1.1, digits: 4, tradingEnabled: false, description: 'Euro vs US Dollar',
    }]);
  });

  it('returns an empty universe for an empty account catalogue', () => {
    expect(mergeAccountCatalogWithPublic([], [{ symbol: 'EURUSD' }])).toEqual([]);
  });
});

describe('pruneSymbolsToUniverse', () => {
  it('drops symbols outside the account catalogue and keeps input order', () => {
    expect(pruneSymbolsToUniverse(['BTCUSD', 'eurusd', 'US30', 'XAUUSD', 'EURUSD'], ['XAUUSD', 'EURUSD']))
      .toEqual(['EURUSD', 'XAUUSD']);
  });

  it('resolves legacy aliases onto the account symbol and never matches suffixes loosely', () => {
    expect(pruneSymbolsToUniverse(['EUROUSD'], ['EURUSD'])).toEqual(['EURUSD']);
    expect(pruneSymbolsToUniverse(['EURUSD'], ['EURUSD.R'])).toEqual([]);
  });

  it('yields no rows while the universe is empty (catalogue loading)', () => {
    expect(pruneSymbolsToUniverse(['EURUSD'], [])).toEqual([]);
  });
});

describe('filterSymbolsExactlyInUniverse', () => {
  it('filters exactly without rewriting stored names', () => {
    expect(filterSymbolsExactlyInUniverse(['eurusd', 'BTCUSD'], [{ symbol: 'EURUSD' }])).toEqual(['eurusd']);
  });
});

describe('selectAccountDefaultMarketWatchSymbols', () => {
  it('shows a small account catalogue in full, in backend order', () => {
    const catalog = [{ symbol: 'US30' }, { symbol: 'GBPUSD' }, { symbol: 'XAUUSD' }, { symbol: 'EURUSD' }];
    expect(selectAccountDefaultMarketWatchSymbols(catalog)).toEqual(['US30', 'GBPUSD', 'XAUUSD', 'EURUSD']);
  });

  it('returns the complete catalogue above 50 symbols, in backend order and category mix', () => {
    const catalog = [
      { symbol: 'GBPUSD', category: 'forex' },
      ...Array.from({ length: 60 }, (_, index) => ({
        symbol: `PAIR${index}`,
        category: index % 2 === 0 ? 'crypto' : 'forex',
      })),
      { symbol: 'EURUSD.R', category: 'forex' },
      { symbol: '0001.HK', category: 'stocks' },
    ];
    expect(catalog.length).toBeGreaterThan(50);

    expect(selectAccountDefaultMarketWatchSymbols(catalog)).toEqual(catalog.map((item) => item.symbol));
  });

  it('de-duplicates repeated symbols while keeping first-seen backend order', () => {
    const catalog = [
      { symbol: 'GBPUSD' },
      ...Array.from({ length: 55 }, (_, index) => ({ symbol: `PAIR${index}` })),
      { symbol: 'eurusd' },
      { symbol: 'EURUSD' },
      { symbol: '0001.HK' },
    ];
    const selected = selectAccountDefaultMarketWatchSymbols(catalog);

    expect(selected).toHaveLength(58);
    expect(selected[0]).toBe('GBPUSD');
    expect(selected.slice(-2)).toEqual(['EURUSD', '0001.HK']);
    expect(new Set(selected).size).toBe(selected.length);
  });

  it('ignores metadata sources and the legacy limit argument', () => {
    const catalog = Array.from({ length: 60 }, (_, index) => ({
      symbol: `SYM${index}`,
      category: index % 2 === 0 ? 'forex' : 'crypto',
    }));
    const metadata = catalog.map((item, index) => ({ ...item, bid: index }));

    expect(selectAccountDefaultMarketWatchSymbols(catalog, metadata, 2))
      .toEqual(catalog.map((item) => item.symbol));
  });

  it('returns an empty selection for an empty catalogue', () => {
    expect(selectAccountDefaultMarketWatchSymbols([])).toEqual([]);
    expect(selectAccountDefaultMarketWatchSymbols([], [], 0)).toEqual([]);
  });
});

describe('resolveChartEligibleSymbolNames', () => {
  const base = {
    accountSymbols: ['XAUUSD', 'EURUSD'],
    authorizedSymbols: ['XAUUSD'],
    publicSymbols: ['BTCUSD', 'EURUSD', 'XAUUSD'],
    activeFeedSymbols: ['ETHUSD'],
  };

  it('never unions public or feed symbols for a logged-in account', () => {
    expect(resolveChartEligibleSymbolNames({ ...base, accountUniverseActive: true })).toEqual(['XAUUSD', 'EURUSD']);
  });

  it('is empty while the account catalogue loads', () => {
    expect(resolveChartEligibleSymbolNames({ ...base, accountSymbols: [], accountUniverseActive: true })).toEqual([]);
  });

  it('keeps the public/feed union for guests and the failure fallback', () => {
    expect(resolveChartEligibleSymbolNames({ ...base, accountUniverseActive: false }))
      .toEqual(['XAUUSD', 'BTCUSD', 'EURUSD', 'ETHUSD']);
    expect(resolveChartEligibleSymbolNames({
      ...base, accountUniverseActive: false, authorizedSymbols: [], publicSymbols: [],
    })).toEqual(['ETHUSD']);
  });
});

describe('resolveTradeEligibleSymbolNames', () => {
  it('requires a current feed', () => {
    expect(resolveTradeEligibleSymbolNames({
      isAuthenticated: true, feedCurrent: false, authorizedSymbols: ['EURUSD'], activeFeedSymbols: ['EURUSD'],
    })).toEqual([]);
  });

  it('intersects authorized symbols with the live feed', () => {
    expect(resolveTradeEligibleSymbolNames({
      isAuthenticated: true, feedCurrent: true, authorizedSymbols: ['EURUSD', 'XAUUSD'], activeFeedSymbols: ['XAUUSD', 'BTCUSD'],
    })).toEqual(['XAUUSD']);
  });

  it('never falls back to unauthorized feed symbols for an authenticated account', () => {
    expect(resolveTradeEligibleSymbolNames({
      isAuthenticated: true, feedCurrent: true, authorizedSymbols: [], activeFeedSymbols: ['BTCUSD'],
    })).toEqual([]);
    expect(resolveTradeEligibleSymbolNames({
      isAuthenticated: true, feedCurrent: true, authorizedSymbols: ['EURUSD'], activeFeedSymbols: ['BTCUSD'],
    })).toEqual([]);
  });

  it('keeps the feed fallback for guests', () => {
    expect(resolveTradeEligibleSymbolNames({
      isAuthenticated: false, feedCurrent: true, authorizedSymbols: [], activeFeedSymbols: ['BTCUSD'],
    })).toEqual(['BTCUSD']);
  });
});

describe('buildOrderTicketSymbolOptions', () => {
  it('offers only account symbols, not every quote in the tick store', () => {
    expect(buildOrderTicketSymbolOptions({
      accountSymbols: ['XAUUSD', 'EURUSD'],
      tickSymbols: ['BTCUSD', 'EURUSD', 'XAUUSD'],
      currentSymbol: 'EURUSD',
    })).toEqual([
      { symbol: 'XAUUSD', disabled: false },
      { symbol: 'EURUSD', disabled: false },
    ]);
  });

  it('keeps a non-tradable current symbol visible but disabled', () => {
    expect(buildOrderTicketSymbolOptions({
      accountSymbols: ['EURUSD'],
      tickSymbols: [],
      currentSymbol: 'btcusd',
    })).toEqual([
      { symbol: 'BTCUSD', disabled: true },
      { symbol: 'EURUSD', disabled: false },
    ]);
  });

  it('falls back to tick keys for callers without an account catalogue', () => {
    expect(buildOrderTicketSymbolOptions({ tickSymbols: ['EURUSD', 'BTCUSD'], currentSymbol: 'EURUSD' }))
      .toEqual([{ symbol: 'EURUSD', disabled: false }, { symbol: 'BTCUSD', disabled: false }]);
    expect(buildOrderTicketSymbolOptions({ tickSymbols: [], currentSymbol: 'EURUSD' }))
      .toEqual([{ symbol: 'EURUSD', disabled: false }]);
  });
});
