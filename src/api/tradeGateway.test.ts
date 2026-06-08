import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { RTX5_API_URL, WS_URL } from '../config/api';
import {
  getStoredAccountLogin,
  normalizeAccount,
  normalizeClosedPosition,
  normalizeDeal,
  normalizeOrder,
  normalizePosition,
  tradeGatewayApi,
} from './tradeGateway';

// Build a base64url JWT-shaped string (no padding, url-safe chars) for tests.
const makeJwt = (payload: Record<string, unknown>): string => {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${body}.sig`;
};

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('trade gateway normalization', () => {
  afterEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('uses the shared v2 REST and websocket authority helpers', () => {
    expect(tradeGatewayApi.getWsUrl()).toBe(`${WS_URL}`);
    expect(tradeGatewayApi.getHistoryUrl('EUR/USD', 'M5', 100)).toBe(
      `${RTX5_API_URL}/api/v2/candles/EUR%2FUSD?timeframe=M5&limit=100`
    );
  });

  it('normalizes account margin aliases into the app account shape', () => {
    expect(normalizeAccount({
      balance: '10000.50',
      equity: undefined,
      margin_used: '250',
      free_margin: '9750.5',
      unrealized_pl: '-12.75',
      marginLevel: '4000',
      currency: 'USD',
      leverage: '500',
    })).toEqual({
      balance: 10000.5,
      equity: 10000.5,
      margin: 250,
      freeMargin: 9750.5,
      unrealizedPL: -12.75,
      marginLevel: 4000,
      currency: 'USD',
      leverage: 500,
    });
  });

  it('normalizes position aliases, side values, and unix timestamps', () => {
    expect(normalizePosition({
      position_id: 445566,
      symbol: 'EURUSD',
      action: '1',
      volume_lots: '0.3' as unknown as number,
      open_price: '1.0825' as unknown as number,
      current_price: '1.0811' as unknown as number,
      sl: null,
      tp: '1.0750' as unknown as number,
      storage: '-0.25' as unknown as number,
      commission: '-1.5' as unknown as number,
      profit: '42.75' as unknown as number,
      time_ms: 1760000000000,
    })).toMatchObject({
      id: 445566,
      symbol: 'EURUSD',
      side: 'SELL',
      volume: 0.3,
      openPrice: 1.0825,
      currentPrice: 1.0811,
      openTime: new Date(1760000000000).toISOString(),
      sl: 0,
      tp: 1.075,
      swap: -0.25,
      commission: -1.5,
      unrealizedPnL: 42.75,
    });
  });

  it('normalizes deal identifiers, entry/action fields, and seconds timestamps', () => {
    expect(normalizeDeal({
      deal: 778899,
      position_ticket: 445566,
      symbol: 'XAUUSD',
      action: 'deal_buy',
      entry: 'entry_out',
      volume: '0.1' as unknown as number,
      price: '2333.45' as unknown as number,
      profit: '18.25' as unknown as number,
      commission: '-0.7' as unknown as number,
      swap: '-0.1' as unknown as number,
      time: 1760000000,
    })).toMatchObject({
      id: 778899,
      symbol: 'XAUUSD',
      type: 'entry_out',
      side: 'BUY',
      volume: 0.1,
      openPrice: 2333.45,
      closePrice: 2333.45,
      openTime: new Date(1760000000 * 1000).toISOString(),
      closeTime: new Date(1760000000 * 1000).toISOString(),
      profit: 18.25,
      commission: -0.7,
      swap: -0.1,
    });
  });

  it('normalizes closed position opened time from gateway time_open', () => {
    expect(normalizeClosedPosition({
      position_id: 445566,
      symbol: 'EURUSD',
      action: 'sell',
      volume_lots: 0.3,
      price_open: 1.0825,
      price_close: 1.0811,
      profit: 42.75,
      time_open: 1760000100,
      time_close: 1760003700,
    })).toMatchObject({
      id: 445566,
      symbol: 'EURUSD',
      side: 'SELL',
      volume: 0.3,
      openPrice: 1.0825,
      closePrice: 1.0811,
      openTime: new Date(1760000100 * 1000).toISOString(),
      closeTime: new Date(1760003700 * 1000).toISOString(),
      profit: 42.75,
    });
  });

  it('falls back to legacy closed position opened timestamps when time_open is absent', () => {
    expect(normalizeClosedPosition({
      ticket: 778899,
      symbol: 'XAUUSD',
      side: 'buy',
      price_open: 2333.45,
      price_close: 2341.7,
      time_create: 1760000200,
      time_close: 1760003800,
    })).toMatchObject({
      id: 778899,
      symbol: 'XAUUSD',
      side: 'BUY',
      openTime: new Date(1760000200 * 1000).toISOString(),
      closeTime: new Date(1760003800 * 1000).toISOString(),
    });
  });

  it('normalizes order openPrice from price_open when price is absent', () => {
    expect(normalizeOrder({
      ticket: 991122,
      symbol: 'EURUSD',
      type: 'buy_limit',
      side: 'buy',
      volume: 0.2,
      price_open: 1.08765,
      time_create: 1760000000,
    })).toMatchObject({
      id: 991122,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.2,
      openPrice: 1.08765,
      closePrice: 1.08765,
      openTime: new Date(1760000000 * 1000).toISOString(),
    });
  });

  it('extracts open positions from common wrapped response shapes', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ data: [{ ticket: 101, symbol: 'EURUSD', action: 'buy' }] })
      .mockResolvedValueOnce({ items: [{ ticket: 102, symbol: 'GBPUSD', action: 'sell' }] })
      .mockResolvedValueOnce({ results: [{ ticket: 103, symbol: 'USDJPY', action: 'buy' }] })
      .mockResolvedValueOnce({ data: { positions: [{ ticket: 104, symbol: 'XAUUSD', action: 'sell' }] } });

    await expect(tradeGatewayApi.getPositions(123456)).resolves.toMatchObject([
      { id: 101, symbol: 'EURUSD', side: 'BUY' },
    ]);
    await expect(tradeGatewayApi.getPositions(123456)).resolves.toMatchObject([
      { id: 102, symbol: 'GBPUSD', side: 'SELL' },
    ]);
    await expect(tradeGatewayApi.getPositions(123456)).resolves.toMatchObject([
      { id: 103, symbol: 'USDJPY', side: 'BUY' },
    ]);
    await expect(tradeGatewayApi.getPositions(123456)).resolves.toMatchObject([
      { id: 104, symbol: 'XAUUSD', side: 'SELL' },
    ]);
  });

  it('extracts trade history arrays when deals and orders are wrapped', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ data: { deals: [{ deal: 201, symbol: 'EURUSD', action: 'deal_buy' }] } })
      .mockResolvedValueOnce({ data: { items: [{ ticket: 301, symbol: 'GBPUSD', type: 'sell_limit' }] } })
      .mockResolvedValueOnce({ results: [{ position_id: 401, symbol: 'USDJPY', action: 'sell' }] });

    await expect(tradeGatewayApi.getDeals(123456)).resolves.toMatchObject([
      { id: 201, symbol: 'EURUSD', side: 'BUY' },
    ]);
    await expect(tradeGatewayApi.getOrders(123456)).resolves.toMatchObject([
      { id: 301, symbol: 'GBPUSD', side: 'SELL' },
    ]);
    await expect(tradeGatewayApi.getClosedPositions(123456)).resolves.toMatchObject([
      { id: 401, symbol: 'USDJPY', side: 'SELL' },
    ]);
  });
});

describe('getStoredAccountLogin (fe-10 — safe JWT decode)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('prefers explicit saved login over the token claim', () => {
    localStorage.setItem('rtx_saved_username', '900111');
    localStorage.setItem('auth_token', makeJwt({ account_login: 900999 }));
    expect(getStoredAccountLogin()).toBe(900111);
  });

  it('reads the account_login claim from a base64url token without padding', () => {
    localStorage.setItem('auth_token', makeJwt({ account_login: 900222 }));
    expect(getStoredAccountLogin()).toBe(900222);
  });

  it('falls back to the login claim when account_login is absent', () => {
    localStorage.setItem('auth_token', makeJwt({ login: 900333 }));
    expect(getStoredAccountLogin()).toBe(900333);
  });

  it('returns null for a malformed token instead of throwing', () => {
    localStorage.setItem('auth_token', 'not.a-valid-jwt');
    expect(() => getStoredAccountLogin()).not.toThrow();
    expect(getStoredAccountLogin()).toBeNull();
  });

  it('returns null when the token has no usable login claim', () => {
    localStorage.setItem('auth_token', makeJwt({ sub: 'user-1' }));
    expect(getStoredAccountLogin()).toBeNull();
  });
});
