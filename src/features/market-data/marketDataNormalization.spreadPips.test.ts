import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import {
  registerDailyChangePriceModes,
  resetDailyChangePriceModeRegistryForTests,
} from '../../services/dailyChangePriceModeRegistry';
import { getSpreadPips, normalizeOrderBook } from './marketDataNormalization';
import { applySpreadMarkupToOrderBook } from './useLiveOrderBook';

describe('order book spread pips come from broker digits only (TERM-DIGITS-WL)', () => {
  beforeEach(() => {
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '1001',
      brokerId: 'broker-a',
      serverUrl: 'https://broker-a.test',
    });
    resetDailyChangePriceModeRegistryForTests();
  });

  afterEach(() => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    resetDailyChangePriceModeRegistryForTests();
  });

  it('returns null instead of guessing a pip factor from a familiar symbol name', () => {
    for (const symbol of ['USDJPY', 'XAUUSD', 'BTCUSD', 'EURUSD']) {
      expect(getSpreadPips(symbol, 0.02)).toBeNull();
    }
    const book = normalizeOrderBook({
      symbol: 'USDJPY',
      bids: [[150.1, 1]],
      asks: [[150.12, 1]],
    });
    expect(book?.spread).toBeCloseTo(0.02, 10);
    expect(book?.spreadPips).toBeNull();
  });

  it('uses registered catalog digits first, then caller-provided instrument digits', () => {
    expect(registerDailyChangePriceModes([{ symbol: 'USDJPY', digits: 3 }])).toBe(true);
    // Catalog 3 digits wins over the caller's 5; shared pip rule: 3 -> 0.01.
    expect(getSpreadPips('usdjpy', 0.02, 5)).toBeCloseTo(2, 10);
    expect(getSpreadPips('UNREGISTERED', 0.0002, 5)).toBeCloseTo(2, 10);
    expect(getSpreadPips('UNREGISTERED', 2, 0)).toBe(2);
    const book = normalizeOrderBook({ symbol: 'USDJPY', bids: [[150.1, 1]], asks: [[150.12, 1]] });
    expect(book?.spreadPips).toBeCloseTo(2, 10);
  });

  it('derives widened depth spread pips from the markup entry digits', () => {
    const map = new Map([['EURUSD', { points: 5, tickSize: 0.00001, digits: 5 }]]);
    const widened = applySpreadMarkupToOrderBook({
      symbol: 'EURUSD',
      bids: [{ price: 1.1, volume: 1, total: 1 }],
      asks: [{ price: 1.10012, volume: 1, total: 1 }],
      spread: 0.00012,
      spreadPips: null,
      timestamp: 1,
    }, map);
    expect(widened?.spread).toBe(0.00022);
    expect(widened?.spreadPips).toBeCloseTo(2.2, 10);
  });
});
