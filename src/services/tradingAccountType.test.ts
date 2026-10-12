import { describe, expect, it } from 'vitest';
import { resolveTradingAccountType } from './tradingAccountType';

describe('resolveTradingAccountType', () => {
  it.each([
    [{ account_type: 'Demo' }, 'demo'],
    [{ accountType: 'REAL' }, 'real'],
    [{ account_kind: 'contest' }, 'contest'],
    [{ accountKind: 'live-standard' }, 'real'],
    [{ mode: 'demo' }, 'demo'],
    [{ account: { type: 'demo account' } }, 'demo'],
    [{ user: { account: { account_type: 'competition' } } }, 'contest'],
    [{ data: { user: { account: { account_type: 'tournament' } } } }, 'contest'],
    [{ is_demo: true }, 'demo'],
    [{ isDemo: false }, 'real'],
    [{ is_contest: true, is_demo: false }, 'contest'],
    [{ isContest: true, isDemo: true }, 'contest'],
    [{ group: 'demo\\USD' }, 'demo'],
    [{ group: 'orrnn/demo-std' }, 'demo'],
    [{ group: 'demo-broker/real-std' }, 'real'],
    [{ group: 'contest-broker/demo-std' }, 'demo'],
    [{ group: 'demo-broker\\real-std\\USD' }, 'real'],
    [{ account_group: 'Broker-x/real/standard' }, 'real'],
    [{ user: { Group: 'demo\\contest\\USD' } }, 'contest'],
    [{ account_trade_mode: 0 }, 'demo'],
    [{ accountTradeMode: 1 }, 'contest'],
    [{ ACCOUNT_TRADE_MODE: 2 }, 'real'],
    [{ account_trade_mode: '1' }, 'contest'],
    [{ account_trade_mode: 'ACCOUNT_TRADE_MODE_REAL' }, 'real'],
  ])('uses the account metadata in %j', (payload, expected) => {
    expect(resolveTradingAccountType(payload)).toBe(expected);
  });

  it('uses explicit type before contradictory flags or account groups', () => {
    expect(resolveTradingAccountType({
      is_demo: true, group: 'demo', user: { account_type: 'real' },
    })).toBe('real');
    expect(resolveTradingAccountType({
      account_type: 'contest', is_demo: false, group: 'real',
    })).toBe('contest');
  });

  it('does not mistake not-demo for Real when a contest group is present', () => {
    expect(resolveTradingAccountType({ is_demo: false, group: 'contest\\USD' })).toBe('contest');
  });

  it('uses the more specific contest group within a demo environment', () => {
    expect(resolveTradingAccountType({ is_demo: true, group: 'demo/contest/USD' })).toBe('contest');
    expect(resolveTradingAccountType({ is_demo: true, group: 'demo/standard/USD' })).toBe('demo');
  });

  it('tries later sources when earlier metadata has no account classification', () => {
    expect(resolveTradingAccountType({ account_type: 'standard' }, { accountType: 'demo' })).toBe('demo');
    expect(resolveTradingAccountType({ account_type: 'real' }, { accountType: 'demo' })).toBe('real');
  });

  it.each([
    undefined, null, [], 'demo', 0,
    { name: 'Demo Owner', server: 'Broker-Live', broker_name: 'Contest Broker', isLive: true },
    { name: 'Live Owner', server: 'Broker-Demo', isLive: false },
    { account_type: 'standard', group: 'premium' },
    { account_type: 'micro', group: 'cent' },
    { account_type: 'democracy', group: 'delivery' },
    { account_type: 'unreal', group: 'contestant' },
    { is_demo: 'false', is_contest: 'true' },
    { is_demo: 1, is_contest: 0 },
    { is_contest: false },
    { account_type: 0, type: 1, kind: 2, mode: 0 },
    { trade_mode: 0, account: { trade_mode: 1 }, symbol: { trade_mode: 2 } },
    { account_trade_mode: 4 },
  ])('keeps unrelated or absent metadata unknown: %j', (payload) => {
    expect(resolveTradingAccountType(payload)).toBeUndefined();
  });
});
