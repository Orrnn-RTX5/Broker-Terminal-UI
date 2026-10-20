import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commitBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';
import {
  getCurrentDailyChangePriceModeScopeKey,
  readRegisteredDailyChangePriceMode,
  readRegisteredSymbolPriceSpec,
  registerDailyChangePriceModes,
  resetDailyChangePriceModeRegistryForTests,
  resolveDailyChangePriceMode,
  resolveDailyChangeDisplayDigits,
} from './dailyChangePriceModeRegistry';
import { mergeAccountCatalogWithPublic } from '../utils/accountSymbolUniverse';

interface CatalogRow {
  symbol: string;
  brokerSpecification?: Readonly<Record<string, unknown>>;
}

describe('daily change price-mode registry', () => {
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

  it('registers exact catalog modes for only the committed scope', () => {
    const capturedScope = getCurrentDailyChangePriceModeScopeKey();
    expect(registerDailyChangePriceModes([
      { symbol: 'future.last', brokerSpecification: { chart_mode: 1 } },
      { symbol: 'fx.bid', brokerSpecification: { chartMode: 'SYMBOL_CHART_MODE_BID' } },
      { symbol: 'nested.last', brokerSpecification: { specification: { chart_mode: 'last' } } },
    ], capturedScope)).toBe(true);

    expect(readRegisteredDailyChangePriceMode('FUTURE.LAST')).toBe('last');
    expect(readRegisteredDailyChangePriceMode('fx.bid')).toBe('bid');
    expect(readRegisteredDailyChangePriceMode('nested.last')).toBe('last');

    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '2002',
      brokerId: 'broker-b',
      serverUrl: 'https://broker-b.test',
    });
    expect(readRegisteredDailyChangePriceMode('FUTURE.LAST')).toBeUndefined();
    expect(registerDailyChangePriceModes([
      { symbol: 'future.last', brokerSpecification: { chart_mode: 1 } },
    ], capturedScope)).toBe(false);
  });

  it('uses broker precision by exact symbol and clears it at a broker boundary', () => {
    registerDailyChangePriceModes([{ symbol: 'EURUSD.r', brokerSpecification: { digits: 6 } }]);
    expect(resolveDailyChangeDisplayDigits('eurusd.r', 3)).toBe(6);
    expect(resolveDailyChangeDisplayDigits('EURUSD', 4)).toBe(4);
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '1001', brokerId: 'broker-b', serverUrl: 'https://broker-b.test' });
    expect(resolveDailyChangeDisplayDigits('EURUSD.r', 3)).toBe(3);
  });

  it('lets raw mode win and blocks registry fallback for an explicit unknown raw mode', () => {
    registerDailyChangePriceModes([
      { symbol: 'future.last', brokerSpecification: { chart_mode: 1 } },
      { symbol: 'future.bid', brokerSpecification: { chart_mode: 0 } },
    ]);

    expect(resolveDailyChangePriceMode({}, 'FUTURE.LAST')).toBe('last');
    expect(resolveDailyChangePriceMode({ chart_mode: 0 }, 'FUTURE.LAST')).toBe('bid');
    expect(resolveDailyChangePriceMode({ chart_mode: 'future-mode' }, 'FUTURE.LAST')).toBeUndefined();
    expect(resolveDailyChangePriceMode({}, 'FUTURE.LAST', { chart_mode: 0 })).toBe('bid');
    expect(resolveDailyChangePriceMode({}, 'FUTURE.BID', { chart_mode: 1 })).toBe('last');
    expect(resolveDailyChangePriceMode(
      { chart_mode: 1 },
      'FUTURE.LAST',
      { chart_mode: 0 },
    )).toBe('last');
    expect(resolveDailyChangePriceMode(
      { chart_mode: 'future-mode' },
      'FUTURE.LAST',
      { chart_mode: 0 },
    )).toBeUndefined();
    expect(resolveDailyChangePriceMode(
      {},
      'FUTURE.LAST',
      { chart_mode: 'future-mode' },
      [{ chart_mode: 1 }],
    )).toBeUndefined();
  });

  it('retains public Last mode when the authorized account row omits chart mode', () => {
    const accountUniverse = mergeAccountCatalogWithPublic<CatalogRow>(
      [{
        symbol: 'future.last',
        brokerSpecification: {
          trading_enabled: true,
          specification: { trade_mode: 'full' },
        },
      }],
      [{
        symbol: 'FUTURE.LAST',
        brokerSpecification: {
          specification: { chart_mode: 1, digits: 2 },
        },
      }, {
        symbol: 'PUBLIC.ONLY',
        brokerSpecification: { chart_mode: 1 },
      }],
    );

    expect(accountUniverse.map((row) => row.symbol)).toEqual(['FUTURE.LAST']);
    expect(registerDailyChangePriceModes(accountUniverse)).toBe(true);
    expect(readRegisteredDailyChangePriceMode('FUTURE.LAST')).toBe('last');
    expect(readRegisteredDailyChangePriceMode('PUBLIC.ONLY')).toBeUndefined();
    expect(accountUniverse[0]?.brokerSpecification?.specification).toEqual({
      chart_mode: 1,
      digits: 2,
      trade_mode: 'full',
    });
  });

  it('keeps an explicit account Bid mode authoritative over public Last mode', () => {
    const accountUniverse = mergeAccountCatalogWithPublic<CatalogRow>(
      [{
        symbol: 'future.bid',
        brokerSpecification: {
          specification: { chartMode: 'SYMBOL_CHART_MODE_BID' },
        },
      }],
      [{
        symbol: 'FUTURE.BID',
        brokerSpecification: {
          chart_mode: 'SYMBOL_CHART_MODE_LAST',
          specification: { digits: 2 },
        },
      }],
    );

    expect(registerDailyChangePriceModes(accountUniverse)).toBe(true);
    expect(readRegisteredDailyChangePriceMode('FUTURE.BID')).toBe('bid');
    expect(accountUniverse[0]?.brokerSpecification).not.toHaveProperty('chart_mode');
    expect(accountUniverse[0]?.brokerSpecification?.specification).toEqual({
      digits: 2,
      chartMode: 'SYMBOL_CHART_MODE_BID',
    });
  });

  it('rejects an enriched account catalog captured under a stale scope', () => {
    const capturedScope = getCurrentDailyChangePriceModeScopeKey();
    const accountUniverse = mergeAccountCatalogWithPublic<CatalogRow>(
      [{ symbol: 'future.last', brokerSpecification: { trading_enabled: true } }],
      [{ symbol: 'future.last', brokerSpecification: { chart_mode: 1 } }],
    );

    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '2002',
      brokerId: 'broker-b',
      serverUrl: 'https://broker-b.test',
    });

    expect(registerDailyChangePriceModes(accountUniverse, capturedScope)).toBe(false);
    expect(readRegisteredDailyChangePriceMode('FUTURE.LAST')).toBeUndefined();
  });

  it('exposes broker digits and top-level tick size by exact symbol', () => {
    const rows: Array<Record<string, unknown>> = [{ symbol: 'ALPHA.x', digits: 3, tickSize: 0.005 }];
    expect(registerDailyChangePriceModes(rows)).toBe(true);
    expect(readRegisteredSymbolPriceSpec('ALPHA.x')).toEqual({ digits: 3, tickSize: 0.005 });
    expect(readRegisteredSymbolPriceSpec('alpha.X')).toEqual({ digits: 3, tickSize: 0.005 });
  });

  it('reads tick_size from a brokerSpecification-only row', () => {
    const rows: Array<Record<string, unknown>> = [
      { symbol: 'ALPHA.x', brokerSpecification: { digits: 3, tick_size: 0.005 } },
    ];
    expect(registerDailyChangePriceModes(rows)).toBe(true);
    expect(readRegisteredSymbolPriceSpec('ALPHA.x')).toEqual({ digits: 3, tickSize: 0.005 });
  });

  it('returns nulls for unknown symbols and after a broker scope change', () => {
    const rows: Array<Record<string, unknown>> = [{ symbol: 'ALPHA.x', digits: 3, tickSize: 0.005 }];
    registerDailyChangePriceModes(rows);
    expect(readRegisteredSymbolPriceSpec('TESTFIX')).toEqual({ digits: null, tickSize: null });
    expect(readRegisteredSymbolPriceSpec('')).toEqual({ digits: null, tickSize: null });

    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '2002',
      brokerId: 'broker-b',
      serverUrl: 'https://broker-b.test',
    });
    expect(readRegisteredSymbolPriceSpec('ALPHA.x')).toEqual({ digits: null, tickSize: null });
  });

  it('refuses metadata ownership when anonymous broker identity is empty', () => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    const emptyScope = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());

    expect(emptyScope).toBe('anonymous|||');
    expect(registerDailyChangePriceModes([
      { symbol: 'future.last', brokerSpecification: { chart_mode: 1 } },
    ], emptyScope)).toBe(false);
    expect(readRegisteredDailyChangePriceMode('FUTURE.LAST')).toBeUndefined();
  });
});
