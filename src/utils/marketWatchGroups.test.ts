import { describe, expect, it } from 'vitest';

import {
  buildMarketWatchSymbolGroups,
  resolveMarketWatchSymbolGroup,
  selectDefaultMarketWatchSymbols,
} from './marketWatchGroups';

describe('Market Watch symbol groups', () => {
  it('uses broker categories and keeps MetaTrader group ordering', () => {
    const symbols = ['AAPL', 'NAS100', 'DE40', 'XAUUSD', 'EURUSD'];
    const groups = buildMarketWatchSymbolGroups(symbols, [
      { symbol: 'AAPL', category: 'Stocks.US' },
      { symbol: 'NAS100', category: 'Nasdaq' },
      { symbol: 'DE40', category: 'Indices.Cash' },
      { symbol: 'XAUUSD', category: 'Metals' },
      { symbol: 'EURUSD', category: 'Forex.Majors' },
    ]);

    expect(groups.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'forex', label: 'Forex' },
      { key: 'metals', label: 'Metals' },
      { key: 'indexes', label: 'Indexes' },
      { key: 'nasdaq', label: 'Nasdaq' },
      { key: 'stocks', label: 'Stocks' },
    ]);
  });

  it('infers a useful group when the broker omits category metadata', () => {
    expect(resolveMarketWatchSymbolGroup('EURUSD.r')).toEqual({ key: 'forex', label: 'Forex' });
    expect(resolveMarketWatchSymbolGroup('EUROUSD')).toEqual({ key: 'forex', label: 'Forex' });
    expect(resolveMarketWatchSymbolGroup('XAUUSD')).toEqual({ key: 'metals', label: 'Metals' });
    expect(resolveMarketWatchSymbolGroup('USTEC')).toEqual({ key: 'nasdaq', label: 'Nasdaq' });
    expect(resolveMarketWatchSymbolGroup('US30')).toEqual({ key: 'indexes', label: 'Indexes' });
    expect(resolveMarketWatchSymbolGroup('US2000')).toEqual({ key: 'indexes', label: 'Indexes' });
    expect(resolveMarketWatchSymbolGroup('US400')).toEqual({ key: 'indexes', label: 'Indexes' });
    expect(resolveMarketWatchSymbolGroup('BTCUSD')).toEqual({ key: 'crypto', label: 'Crypto' });
    expect(resolveMarketWatchSymbolGroup('BTCAUD')).toEqual({ key: 'crypto', label: 'Crypto' });
    expect(resolveMarketWatchSymbolGroup('ETHJPY')).toEqual({ key: 'crypto', label: 'Crypto' });
    expect(resolveMarketWatchSymbolGroup('USOIL')).toEqual({ key: 'commodities', label: 'Commodities' });
    expect(resolveMarketWatchSymbolGroup('0001.HK')).toEqual({ key: 'stocks', label: 'Stocks' });
  });

  it('reports visible and total counts without truncating group symbols', () => {
    const forexSymbols = Array.from({ length: 40 }, (_, index) => `EUR${String(index).padStart(3, '0')}`);
    const groups = buildMarketWatchSymbolGroups(
      forexSymbols,
      forexSymbols.map((symbol) => ({ symbol, category: 'Forex' })),
      forexSymbols.slice(0, 3),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'forex',
      label: 'Forex',
      visibleCount: 3,
    });
    expect(groups[0].symbols).toHaveLength(40);
  });

  it('preserves broker-specific top-level groups', () => {
    const [group] = buildMarketWatchSymbolGroups(
      ['FUT-SEP'],
      [{ symbol: 'FUT-SEP', category: 'Futures.CME' }],
    );

    expect(group).toEqual({
      key: 'futures',
      label: 'Futures',
      symbols: ['FUT-SEP'],
      visibleCount: 0,
    });
  });

  it('keeps the three requested core symbols first and adds representatives from eligible remaining groups', () => {
    const defaults = selectDefaultMarketWatchSymbols([
      { symbol: 'GBPUSD', category: 'Forex', bid: 1.27, ask: 1.28 },
      { symbol: 'EURUSD', category: 'Forex', bid: 1.08, ask: 1.09 },
      { symbol: 'BTCUSD', category: 'Crypto', bid: 108000, ask: 108010 },
      { symbol: 'XAUUSD', category: 'Metals', bid: 2500, ask: 2501 },
      { symbol: 'GER40', category: 'Indexes', bid: 19000, ask: 19002 },
      { symbol: 'US30', category: 'Indexes', bid: 43000, ask: 43002 },
      { symbol: 'NAS100', category: 'Nasdaq', bid: 21000, ask: 21002 },
      { symbol: 'USTEC', category: 'Nasdaq', bid: 22000, ask: 22002 },
      { symbol: 'NATGAS', category: 'Commodities', bid: 3, ask: 3.1 },
      { symbol: 'USOIL', category: 'Commodities', bid: 78, ask: 78.1 },
      { symbol: 'AAPL', category: 'Stocks.US', bid: 230, ask: 231 },
      { symbol: 'BRK.A', category: 'Stocks.US', bid: 700000, ask: 700010 },
      { symbol: 'BOND10', category: 'Bonds.Government', bid: 120, ask: 121 },
      { symbol: 'BOND30', category: 'Bonds.Government', bid: 140, ask: 141 },
      { symbol: 'MISC', category: 'Other', bid: 999999, ask: 1000000 },
    ]);

    expect(defaults).toEqual([
      'XAUUSD',
      'BTCUSD',
      'EURUSD',
      'US30',
      'USTEC',
      'USOIL',
      'BRK.A',
      'BOND30',
    ]);
  });

  it('treats core symbols as fallback order only: non-catalog defaults never render', () => {
    const sources = [
      { symbol: 'XAUUSD', category: 'Metals', bid: 2500, ask: 2501 },
      { symbol: 'BTCUSD', category: 'Crypto', bid: 108000, ask: 108010 },
      { symbol: 'EURUSD', category: 'Forex', bid: 1.08, ask: 1.09 },
    ];

    // Eligible catalog omits BTCUSD: catalog members keep the declared
    // fallback order while the non-catalog default never renders.
    expect(
      selectDefaultMarketWatchSymbols(sources, sources, ['XAUUSD', 'EURUSD']),
    ).toEqual(['XAUUSD', 'EURUSD']);

    // Full catalog: every core symbol renders in the declared fallback order.
    expect(
      selectDefaultMarketWatchSymbols(
        sources,
        sources,
        [{ symbol: 'XAUUSD' }, { symbol: 'BTCUSD' }, { symbol: 'EURUSD' }],
      ),
    ).toEqual(['XAUUSD', 'BTCUSD', 'EURUSD']);

    // Empty eligible catalog: nothing renders.
    expect(selectDefaultMarketWatchSymbols(sources, sources, [])).toEqual([]);
  });

  it('uses broker metadata, resolves the legacy EURUSD identity, and falls back alphabetically when prices are absent', () => {
    const defaults = selectDefaultMarketWatchSymbols(
      ['XAUUSD', 'BTCUSD', 'EUROUSD', 'GBPUSD', 'LOW', 'HIGH'],
      [
        { symbol: 'LOW', category: 'Stocks' },
        { symbol: 'HIGH', category: 'Stocks' },
      ],
    );

    expect(defaults).toEqual([
      'XAUUSD',
      'BTCUSD',
      'EUROUSD',
      'HIGH',
    ]);
    expect(selectDefaultMarketWatchSymbols(['GBPUSD', 'GBPUSD.r'])).toEqual([]);
    expect(selectDefaultMarketWatchSymbols([])).toEqual([]);
  });
});
