import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKET_WATCH_SYMBOLS,
  getDefaultMarketWatchSymbols,
  getMarketWatchDisplayErrors,
  getMarketWatchSymbolLabel,
  isStaleQuoteErrorMessage,
  resolveMarketWatchSymbolInput,
  searchMarketWatchSymbols,
  shouldUseWatchlistAsMarketWatchSource,
} from './marketWatchSource';

describe('Market Watch symbol source', () => {
  it('uses the five requested symbols in the product-defined order', () => {
    expect(DEFAULT_MARKET_WATCH_SYMBOLS).toEqual([
      'XAUUSD',
      'BTCUSD',
      'EURUSD',
      'GBPUSD',
      'USDJPY',
    ]);
    expect(getDefaultMarketWatchSymbols()).toEqual(DEFAULT_MARKET_WATCH_SYMBOLS);
  });

  it('keeps SOLUSD available for user search without restoring it as a default', () => {
    const symbolUniverse = ['BTCUSD', 'SOLUSD', 'EURUSD'];

    expect(getDefaultMarketWatchSymbols(symbolUniverse)).not.toContain('SOLUSD');
    expect(searchMarketWatchSymbols(symbolUniverse, 'sol')).toEqual(['SOLUSD']);
    expect(resolveMarketWatchSymbolInput(symbolUniverse, 'solusd')).toBe('SOLUSD');
  });

  it('presents either broker identifier as EURUSD without changing its identity', () => {
    const euroUsdDefaults = getDefaultMarketWatchSymbols(['EUROUSD']);
    const eurUsdDefaults = getDefaultMarketWatchSymbols(['EURUSD']);

    expect(euroUsdDefaults).toContain('EUROUSD');
    expect(eurUsdDefaults).toContain('EURUSD');
    expect(getMarketWatchSymbolLabel('EUROUSD', ['EUROUSD'])).toBe('EURUSD');
    expect(getMarketWatchSymbolLabel('EURUSD')).toBe('EURUSD');
    expect(getMarketWatchSymbolLabel('eurusd', ['EURUSD'])).toBe('EURUSD');
  });

  it('searches the complete universe case-insensitively without changing the defaults', () => {
    const defaults = getDefaultMarketWatchSymbols();
    const results = searchMarketWatchSymbols(
      ['BTCUSD', 'eurusd', 'ETHUSD', 'EURJPY', 'ETHUSD'],
      'eth',
    );

    expect(results).toEqual(['ETHUSD']);
    expect(searchMarketWatchSymbols(['EURUSD', 'EURJPY'], 'euro')).toEqual([]);
    expect(getDefaultMarketWatchSymbols()).toEqual(defaults);
  });

  it('searches the canonical EURUSD label while accepting the legacy alias as direct input', () => {
    const symbols = ['EURUSD', 'EURJPY', 'BTCUSD'];

    expect(searchMarketWatchSymbols(symbols, 'EURUSD')).toEqual(['EURUSD']);
    expect(searchMarketWatchSymbols(symbols, 'EUROUSD')).toEqual([]);
    expect(searchMarketWatchSymbols(symbols, 'euro')).toEqual([]);
    expect(resolveMarketWatchSymbolInput(symbols, 'eurusd')).toBe('EURUSD');
    expect(resolveMarketWatchSymbolInput(symbols, 'eurousd')).toBe('EURUSD');
    expect(resolveMarketWatchSymbolInput(symbols, 'euro')).toBeUndefined();
    expect(resolveMarketWatchSymbolInput(['EURJPY', 'BTCUSD'], 'EUROUSD')).toBeUndefined();
    expect(getMarketWatchSymbolLabel('EURUSD', symbols)).toBe('EURUSD');
  });

  it('keeps exact broker identity precedence while deduplicating the shared display label', () => {
    const symbols = ['EURUSD', 'EUROUSD', 'EURJPY'];

    expect(searchMarketWatchSymbols(symbols, 'euro')).toEqual(['EUROUSD']);
    expect(searchMarketWatchSymbols(symbols, 'us')).toEqual(['EURUSD']);
    expect(searchMarketWatchSymbols(symbols, 'EUROUSD')).toEqual(['EUROUSD']);
    expect(searchMarketWatchSymbols(symbols, 'EURUSD')).toEqual(['EURUSD']);
    expect(resolveMarketWatchSymbolInput(symbols, 'EUROUSD')).toBe('EUROUSD');
    expect(resolveMarketWatchSymbolInput(symbols, 'EURUSD')).toBe('EURUSD');
    expect(getMarketWatchSymbolLabel('EURUSD', symbols)).toBe('EURUSD');
    expect(getMarketWatchSymbolLabel('EUROUSD', symbols)).toBe('EURUSD');
  });

  it('recognizes quote-stale failures and preserves them for the Market Watch error area', () => {
    expect(isStaleQuoteErrorMessage('Quote is stale for 0001.HK')).toBe(true);
    expect(isStaleQuoteErrorMessage('No fresh quote is available for 2382.HK')).toBe(true);
    expect(getMarketWatchDisplayErrors('Quote is stale for 0001.HK')).toEqual([
      'Quote is stale for 0001.HK',
    ]);
  });

  it('preserves concurrent failures in source order and safely removes exact duplicates', () => {
    expect(getMarketWatchDisplayErrors(
      'Quote is stale for 0001.HK',
      'Failed to load symbols',
      'Failed to load watchlist',
      new Error('Failed to load symbols'),
      '  Failed to load watchlist  ',
      null,
    )).toEqual([
      'Quote is stale for 0001.HK',
      'Failed to load symbols',
      'Failed to load watchlist',
    ]);
    expect(getMarketWatchDisplayErrors(null, 'Failed to load symbols')).toEqual(['Failed to load symbols']);
    expect(isStaleQuoteErrorMessage('Quote service is unavailable')).toBe(false);
  });

  it('does not let a built-in default watchlist limit the Market Watch rows', () => {
    expect(shouldUseWatchlistAsMarketWatchSource({
      activeWatchlistId: 'majors',
      activeWatchlistIsDefault: true,
    })).toBe(false);
  });

  it('keeps all available symbols when the watchlist metadata is missing', () => {
    expect(shouldUseWatchlistAsMarketWatchSource({
      activeWatchlistId: 'majors',
      activeWatchlistIsDefault: undefined,
    })).toBe(false);
  });

  it('allows custom watchlists to drive the visible Market Watch rows', () => {
    expect(shouldUseWatchlistAsMarketWatchSource({
      activeWatchlistId: 'watchlist-1',
      activeWatchlistIsDefault: false,
    })).toBe(true);
  });

});
