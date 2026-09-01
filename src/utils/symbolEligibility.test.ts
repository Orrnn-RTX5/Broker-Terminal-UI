import { describe, expect, it } from 'vitest';

import {
  buildChartEligibleSymbolNames,
  buildTradeEligibleSymbolNames,
  getInstrumentSymbolName,
  getUniqueSymbolNames,
  normalizeSymbolName,
  pickPreferredChartSymbol,
  resolveAuthorizedChartSymbol,
} from './symbolEligibility';

describe('symbol eligibility helpers', () => {
  it('normalizes symbols from strings and instrument records', () => {
    expect(normalizeSymbolName(' usdjpy ')).toBe('USDJPY');
    expect(getInstrumentSymbolName({ symbol: 'xauusd' })).toBe('XAUUSD');
    expect(getInstrumentSymbolName({ name: 'gbpusd' })).toBe('GBPUSD');
    expect(getInstrumentSymbolName({ id: 'btcusd' })).toBe('BTCUSD');
  });

  it('deduplicates symbol names while preserving first-seen order', () => {
    expect(getUniqueSymbolNames(['btcusd', 'BTCUSD', { symbol: 'usdjpy' }])).toEqual([
      'BTCUSD',
      'USDJPY',
    ]);
  });

  it('uses the account and live-feed catalogs for charts but their intersection for trading', () => {
    const instrumentSymbols = ['BTCUSD', 'GBPUSD', 'XAUUSD'];
    const activeFeedSymbols = ['USDJPY', 'NZDJPY', 'BTCUSD'];

    expect(buildChartEligibleSymbolNames(instrumentSymbols, activeFeedSymbols)).toEqual([
      'BTCUSD',
      'GBPUSD',
      'XAUUSD',
      'USDJPY',
      'NZDJPY',
    ]);
    expect(buildTradeEligibleSymbolNames(instrumentSymbols, activeFeedSymbols)).toEqual(['BTCUSD']);
  });

  it('migrates a persisted EUROUSD chart selection to authorized EURUSD without requiring an active feed', () => {
    const authorizedSymbols = ['BTCUSD', 'EURUSD', 'ETHUSD'];

    expect(resolveAuthorizedChartSymbol('ETHUSD', authorizedSymbols)).toBe('ETHUSD');
    expect(resolveAuthorizedChartSymbol('EUROUSD', authorizedSymbols)).toBe('EURUSD');
    expect(resolveAuthorizedChartSymbol('USDJPY', authorizedSymbols)).toBe('');
  });

  it('gives a real authorized EUROUSD symbol precedence over the EURUSD display alias', () => {
    expect(resolveAuthorizedChartSymbol('EUROUSD', ['EURUSD', 'EUROUSD'])).toBe('EUROUSD');
  });

  it('keeps a requested chart symbol when the live feed has not settled', () => {
    expect(pickPreferredChartSymbol(['EURUSD', 'BTCUSD', 'XAUUSD'], [], 'EURUSD')).toBe('EURUSD');
  });

  it('opens BTCUSD instead of a stale saved EURUSD chart when only crypto is live', () => {
    expect(pickPreferredChartSymbol(
      ['EURUSD', 'XAUUSD', 'BTCUSD', 'ETHUSD'],
      ['BTCUSD', 'ETHUSD', 'SOLUSD'],
      'EURUSD',
    )).toBe('BTCUSD');
  });

  it('keeps the requested symbol when that symbol is currently live', () => {
    expect(pickPreferredChartSymbol(
      ['EURUSD', 'BTCUSD', 'ETHUSD'],
      ['BTCUSD', 'ETHUSD'],
      'ETHUSD',
    )).toBe('ETHUSD');
  });
});
