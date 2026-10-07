import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRetainPublicChartOnLogin, getChartMarketSourceIdentity } from './chartLoginTransition';

const routing = vi.hoisted(() => ({
  desktop: false,
  configuration: {
    valid: true, brokerId: 'broker-a', apiHost: 'https://market.example',
    apiHostExt: 'https://market.example/ext', wsHost: 'wss://market.example',
    feedBrokerId: 'market-a', publicCandleBridge: false, publicMarketApi: 'gateway-v2',
  },
}));
vi.mock('../config/backendTarget.js', () => ({
  isDesktopBackendTarget: () => routing.desktop,
  getRuntimeBrokerConfiguration: () => routing.configuration,
}));

afterEach(() => { routing.desktop = false; routing.configuration.valid = true; });

describe('public guest chart login presentation', () => {
  const previous = { sessionScope: 'anonymous||broker-a|market', marketSource: 'market-a', symbol: 'XAUUSD.raw', timeframe: 'H4' };
  const next = { ...previous, sessionScope: 'authenticated|200003|broker-a|market' };

  it('retains only the same public chart when its configured market authenticates', () => {
    expect(canRetainPublicChartOnLogin(previous, next)).toBe(true);
    expect(canRetainPublicChartOnLogin(previous, { ...next, symbol: 'XAUUSD.RAW' })).toBe(true);
  });

  it.each([
    { marketSource: 'market-b' }, { marketSource: '' }, { symbol: 'XAUUSD.pro' },
    { symbol: '' }, { timeframe: 'M1' }, { sessionScope: 'anonymous||broker-a|market' },
  ])('ends retention for a changed or invalid selection %j', change => {
    expect(canRetainPublicChartOnLogin(previous, { ...next, ...change })).toBe(false);
  });

  it('never carries an authenticated account chart through logout or another login', () => {
    expect(canRetainPublicChartOnLogin(next, previous)).toBe(false);
    expect(canRetainPublicChartOnLogin(next, { ...next, sessionScope: 'authenticated|200004|broker-a|market' })).toBe(false);
  });

  it('fails closed for desktop routing and missing configuration', () => {
    routing.desktop = true;
    expect(getChartMarketSourceIdentity()).toBe('');
    routing.desktop = false;
    routing.configuration.valid = false;
    expect(getChartMarketSourceIdentity()).toBe('');
  });

  it.each([
    ['brokerId', 'broker-b'], ['apiHost', 'https://other.example'],
    ['apiHostExt', 'https://other.example/ext'], ['wsHost', 'wss://other.example'],
    ['feedBrokerId', 'market-b'], ['publicMarketApi', 'mt5-bridge-v1'],
    ['publicCandleBridge', true],
  ] as const)('includes the %s route in the public source identity', (field, value) => {
    const before = getChartMarketSourceIdentity();
    const original = routing.configuration[field];
    Object.assign(routing.configuration, { [field]: value });
    expect(getChartMarketSourceIdentity()).not.toBe(before);
    Object.assign(routing.configuration, { [field]: original });
  });
});
