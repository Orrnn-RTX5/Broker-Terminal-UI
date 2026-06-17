import { describe, expect, it } from 'vitest';

import {
  buildChartEligibleSymbolNames,
  getInstrumentSymbolName,
  getUniqueSymbolNames,
  normalizeSymbolName,
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

  it('keeps active feed symbols chart-eligible even when they are absent from instruments', () => {
    const instrumentSymbols = ['BTCUSD', 'GBPUSD', 'XAUUSD'];
    const activeFeedSymbols = ['USDJPY', 'NZDJPY', 'BTCUSD'];

    expect(buildChartEligibleSymbolNames(instrumentSymbols, activeFeedSymbols)).toEqual([
      'BTCUSD',
      'GBPUSD',
      'XAUUSD',
      'USDJPY',
      'NZDJPY',
    ]);
    expect(getUniqueSymbolNames(instrumentSymbols)).not.toContain('NZDJPY');
  });
});
