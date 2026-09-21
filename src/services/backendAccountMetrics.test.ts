import { describe, expect, it } from 'vitest';
import { extractBackendAccountRecord, getBackendAccountUpdateKeys, isBackendAccountForLogin, mergeBackendAccountSnapshot, normalizeBackendAccount } from './backendAccountMetrics';

describe('backend account metrics', () => {
  it('retains newer WS fields while a slower initial REST snapshot supplies currency and omitted values', () => {
    const packet = { equity: 2001, free_margin: null };
    const current = normalizeBackendAccount(packet);
    const combined = mergeBackendAccountSnapshot({ balance: 1900, equity: 1999, used_margin: 50,
      free_margin: 1949, currency: 'INR', leverage: 500 }, current, getBackendAccountUpdateKeys(packet));
    expect(combined).toMatchObject({ balance: 1900, equity: 2001, margin: 50,
      hasBackendFreeMargin: false, currency: 'INR', leverage: 500 });
  });
  it('unwraps the actual metrics publication and displays every supplied number without calculation', () => {
    const account = normalizeBackendAccount({ channel: 'metrics.200001', data: {
      type: 'metrics_update', publication_token: '12', data: {
        login: 200001, balance: 1000, equity: 1073.17, used_margin: 92.36,
        free_margin: 980.81, margin_level: 1161.94, floating_pnl: 61.2, credit: 9,
      },
    } });
    expect(account).toMatchObject({ balance: 1000, equity: 1073.17, margin: 92.36,
      freeMargin: 980.81, marginLevel: 1161.94, unrealizedPL: 61.2, credit: 9,
      hasBackendBalance: true, hasBackendEquity: true, hasBackendMargin: true,
      hasBackendFreeMargin: true, hasBackendMarginLevel: true, hasBackendUnrealizedPL: true });
  });

  it('preserves omitted backend metrics in sparse updates and accepts explicit zero and negative values', () => {
    const initial = normalizeBackendAccount({ balance: 1000, equity: 950, used_margin: 200,
      free_margin: 750, margin_level: 475, floating_pnl: -50 });
    expect(normalizeBackendAccount({ data: { account: { equity: 0, free_margin: -200, floating_pnl: 0 } } }, initial))
      .toMatchObject({ balance: 1000, equity: 0, margin: 200, freeMargin: -200,
        marginLevel: 475, unrealizedPL: 0, hasBackendEquity: true, hasBackendUnrealizedPL: true });
    expect(normalizeBackendAccount({ balance: 0 }, initial)).toMatchObject({ balance: 0, hasBackendBalance: true });
  });

  it('never derives equity, margin, free margin, level or profit from another field', () => {
    const account = normalizeBackendAccount({ balance: 1000 });
    expect(account).toMatchObject({ hasBackendBalance: true, hasBackendEquity: false,
      hasBackendMargin: false, hasBackendFreeMargin: false, hasBackendMarginLevel: false,
      hasBackendUnrealizedPL: false });
    expect(normalizeBackendAccount(account)).toEqual(account);
  });

  it('marks explicit missing/invalid backend metrics unavailable rather than inventing zero', () => {
    const previous = normalizeBackendAccount({ equity: 101, margin_level: 20, used_margin: 5 });
    expect(normalizeBackendAccount({ equity: null, margin_level: 'NaN', used_margin: false }, previous))
      .toMatchObject({ hasBackendEquity: false, hasBackendMarginLevel: false, hasBackendMargin: false });
  });

  it('accepts Money amounts and legacy names without rounding', () => {
    expect(normalizeBackendAccount({ data: JSON.stringify({ account: {
      balance: { amount: '1,000.0123', currency: 'USD' }, margin_used: '25.0123',
      margin_free: '974.9999', profit: '-0.0001',
    } }) })).toMatchObject({ balance: 1000.0123, margin: 25.0123, freeMargin: 974.9999, unrealizedPL: -0.0001 });
  });

  it('does not treat channel acknowledgements or another login as account data', () => {
    expect(extractBackendAccountRecord({ type: 'subscribed', channel: 'metrics.200001' })).toBeNull();
    expect(isBackendAccountForLogin({ data: { data: { login: 200002, equity: 99 } } }, 200001)).toBe(false);
    expect(isBackendAccountForLogin({ data: { data: { login: 200001, equity: 99 } } }, 200001)).toBe(true);
    expect(isBackendAccountForLogin({ data: { broker_id: 'Other', equity: 99 } }, 200001, 'Nexa')).toBe(false);
  });
});
