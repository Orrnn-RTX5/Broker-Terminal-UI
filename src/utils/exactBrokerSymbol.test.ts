import { describe, expect, it } from 'vitest';

import {
  normalizeExactBrokerSymbol,
  parseExactTickChannelSymbol,
  resolveExactBrokerSymbolValue,
} from './exactBrokerSymbol';

describe('exact broker symbol identity', () => {
  it('normalizes only surrounding whitespace and case', () => {
    expect(normalizeExactBrokerSymbol('  xauusd.raw  ')).toBe('XAUUSD.RAW');
    expect(normalizeExactBrokerSymbol('btc-usd#pro')).toBe('BTC-USD#PRO');
  });

  it('reads the complete punctuated symbol from the tick channel', () => {
    expect(parseExactTickChannelSymbol('ticks.XAUUSD.raw')).toBe('XAUUSD.RAW');
    expect(parseExactTickChannelSymbol('ticks.btc-usd#pro')).toBe('BTC-USD#PRO');
    expect(parseExactTickChannelSymbol('quotes.XAUUSD.raw')).toBe('');
  });

  it('does not alias distinct broker contracts when resolving a map', () => {
    const values = {
      XAUUSD: { bid: 1 },
      'XAUUSD.raw': { bid: 2 },
      'XAUUSD-pro': { bid: 3 },
    };

    expect(resolveExactBrokerSymbolValue(values, ' xauusd.raw ')).toEqual({ bid: 2 });
    expect(resolveExactBrokerSymbolValue(values, 'XAUUSD-PRO')).toEqual({ bid: 3 });
    expect(resolveExactBrokerSymbolValue({ 'XAUUSD.raw': values['XAUUSD.raw'] }, 'XAUUSD')).toBeUndefined();
  });
});
