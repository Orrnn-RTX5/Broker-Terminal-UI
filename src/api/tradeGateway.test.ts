import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import {
  normalizeAccount,
  normalizeDeal,
  normalizePosition,
  tradeGatewayApi,
} from './tradeGateway';

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
    expect(tradeGatewayApi.getWsUrl()).toBe('wss://backend.orrnn.com/ws/v2');
    expect(tradeGatewayApi.getHistoryUrl('EUR/USD', 'M5', 100)).toBe(
      'https://backend.orrnn.com/history/candles/EUR%2FUSD?tf=M5&count=100'
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
      volume_lots: '0.3' as any,
      open_price: '1.0825' as any,
      current_price: '1.0811' as any,
      sl: null,
      tp: '1.0750' as any,
      storage: '-0.25' as any,
      commission: '-1.5' as any,
      profit: '42.75' as any,
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
      volume: '0.1' as any,
      price: '2333.45' as any,
      profit: '18.25' as any,
      commission: '-0.7' as any,
      swap: '-0.1' as any,
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
