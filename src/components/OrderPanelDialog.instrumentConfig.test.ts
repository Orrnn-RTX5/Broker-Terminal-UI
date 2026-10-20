import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';
import {
  registerDailyChangePriceModes,
  resetDailyChangePriceModeRegistryForTests,
} from '../services/dailyChangePriceModeRegistry';
import { getInstrumentConfig } from './OrderPanelDialog';

// TERM-DIGITS-WL: instrument properties come only from broker data
// (registered catalog, catalog row, tick payload). The symbol is a lookup
// key, never a source of digits / pip size / contract size / currency.
describe('getInstrumentConfig (broker data only, no symbol-name table)', () => {
  beforeEach(() => {
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '77',
      brokerId: 'broker-a',
      serverUrl: 'https://broker.example',
    });
    resetDailyChangePriceModeRegistryForTests();
  });

  afterEach(() => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    resetDailyChangePriceModeRegistryForTests();
  });

  it('returns unknown (null) for every property when no broker data exists, whatever the name', () => {
    for (const symbol of ['EURUSD', 'USDJPY', 'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD', 'TESTFIX']) {
      expect(getInstrumentConfig(symbol)).toEqual({ digits: null, priceStep: null, contractSize: null });
    }
  });

  it('honors live tick digits and derives the step from them (10^-digits)', () => {
    const cfg = getInstrumentConfig('USDJPY', 5);
    expect(cfg.digits).toBe(5);
    expect(cfg.priceStep).toBeCloseTo(0.00001, 12);
    // Contract size is never guessed from the name.
    expect(cfg.contractSize).toBeNull();
    expect(getInstrumentConfig('XAUUSD', 3)).toMatchObject({ digits: 3 });
    expect(getInstrumentConfig('BTCUSD', 0)).toMatchObject({ digits: 0, priceStep: 1 });
  });

  it('accepts numeric-string digits from quote payloads', () => {
    expect(getInstrumentConfig('TESTFIX', '4')).toMatchObject({ digits: 4 });
  });

  it('prefers registered catalog digits and tick size over the tick payload', () => {
    registerDailyChangePriceModes([{ symbol: 'TESTFIX', digits: 2, tickSize: 0.05 }]);
    expect(getInstrumentConfig('TESTFIX', 5)).toEqual({ digits: 2, priceStep: 0.05, contractSize: null });
    // Lookup is case/whitespace-insensitive on the broker key.
    expect(getInstrumentConfig(' testfix ', 5)).toMatchObject({ digits: 2, priceStep: 0.05 });
  });

  it('uses the catalog row (digits, tick size, contract size) when the registry has none', () => {
    const cfg = getInstrumentConfig('TESTFIX', 5, { symbol: 'TESTFIX', digits: 3, tickSize: 0.005, contractSize: 250 });
    expect(cfg).toEqual({ digits: 3, priceStep: 0.005, contractSize: 250 });
  });

  it('falls back to tick digits when the catalog row has no digits', () => {
    expect(getInstrumentConfig('TESTFIX', 4, { symbol: 'TESTFIX', contractSize: 1 })).toEqual({
      digits: 4,
      priceStep: 0.0001,
      contractSize: 1,
    });
  });

  it('rejects invalid digits / sizes as unknown instead of substituting a default', () => {
    for (const bad of [NaN, -1, 1.5, 99, '', 'abc', null, undefined, Infinity]) {
      expect(getInstrumentConfig('EURUSD', bad)).toEqual({ digits: null, priceStep: null, contractSize: null });
    }
    expect(getInstrumentConfig('EURUSD', undefined, { symbol: 'EURUSD', contractSize: 0, tickSize: -1 }))
      .toEqual({ digits: null, priceStep: null, contractSize: null });
    expect(getInstrumentConfig('EURUSD', undefined, { symbol: 'EURUSD', contractSize: NaN }).contractSize).toBeNull();
  });

  it('keeps tick size from the catalog even when digits are unknown', () => {
    expect(getInstrumentConfig('TESTFIX', undefined, { symbol: 'TESTFIX', tickSize: 0.25 }))
      .toEqual({ digits: null, priceStep: 0.25, contractSize: null });
  });

  it('source contains no symbol-name heuristics or guessed instrument defaults', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/OrderPanelDialog.tsx'), 'utf8');
    expect(source).not.toMatch(/startsWith\('(BTC|ETH|XAU|XAG)'\)/);
    expect(source).not.toMatch(/includes\('JPY'\)/);
    expect(source).not.toMatch(/contractSize:\s*100000/);
    expect(source).not.toMatch(/currency:\s*sym\.slice/);
    expect(source).not.toMatch(/config\.currency/);
  });
});
