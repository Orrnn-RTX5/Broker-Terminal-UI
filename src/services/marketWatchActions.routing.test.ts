import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuickBuy, executeQuickSell, subscribeToSymbol } from './marketWatchActions';

const state = vi.hoisted(() => ({ accountId: '', token: null as string | null, place: vi.fn(), add: vi.fn() }));
vi.mock('./api', () => ({ ordersApi: { placeMarketOrder: state.place } }));
vi.mock('../api/trade', () => ({ watchlistV2Api: { add: state.add } }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => ({ accountId: state.accountId }) } }));
vi.mock('./brokerSession', () => ({ getAccessToken: () => state.token }));

beforeEach(() => {
  state.accountId = ''; state.token = null;
  state.place.mockReset().mockResolvedValue({ ticket: 123 });
  state.add.mockReset().mockResolvedValue({ symbol: 'EURUSD' });
});
afterEach(() => vi.restoreAllMocks());

describe('Market Watch actions use the supported broker trading clients', () => {
  it.each([executeQuickBuy, executeQuickSell])('never fabricates a default account without a bound login', async action => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await action('EURUSD')).toMatchObject({ success: false, error: expect.stringContaining('Log in') });
    expect(state.place).not.toHaveBeenCalled();
  });
  it.each([['buy', executeQuickBuy], ['sell', executeQuickSell]] as const)('places %s through the existing broker order lifecycle with the active account', async (side, action) => {
    state.accountId = '200003'; state.token = 'bound-token';
    expect(await action('EURUSD', 0.02)).toEqual({ success: true, orderId: '123' });
    expect(state.place).toHaveBeenCalledWith({ symbol: 'EURUSD', side, volume: 0.02, account_login: 200003 });
  });
  it('adds a symbol with the existing v2 watchlist client only after login', async () => {
    expect(await subscribeToSymbol('EURUSD')).toBe(false);
    expect(state.add).not.toHaveBeenCalled();
    state.token = 'bound-token';
    expect(await subscribeToSymbol('EURUSD')).toBe(true);
    expect(state.add).toHaveBeenCalledWith('EURUSD');
  });
});
