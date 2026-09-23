import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { RTX5_API_URL, WS_URL } from '../config/api';
import {
  collapseDealHistory,
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
    expect(tradeGatewayApi.getHistoryUrl('EUR/USD', '5m', 10_000)).toBe(
      `${RTX5_API_URL}/api/v2/candles/EUR%2FUSD?timeframe=M5&limit=5000`
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
      // Wire payloads can carry numeric strings; normalizeAccount must coerce them.
    } as unknown as Parameters<typeof normalizeAccount>[0])).toMatchObject({
      balance: 10000.5,
      equity: 0,
      hasBackendBalance: true,
      hasBackendEquity: false,
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
      hasBackendProfit: true,
      profit: 42.75,
    });
  });

  it('does not treat omitted position profit as a backend zero', () => {
    expect(normalizePosition({
      ticket: 993,
      symbol: 'EURUSD',
      action: 0,
      volume: 0.01,
      price_open: 1.1,
      price_current: 1.1,
    })).toMatchObject({
      hasBackendProfit: false,
      profit: undefined,
    });
  });

  it('normalizes refreshed position MT5 open-time aliases', () => {
    expect(normalizePosition({
      ticket: 991,
      symbol: 'BTCUSD',
      action: 0,
      volume: 0.01,
      price_open: 65316.89,
      price_current: 65304.89,
      time_open: 1760000180,
    })).toMatchObject({
      id: 991,
      symbol: 'BTCUSD',
      side: 'BUY',
      openTime: new Date(1760000180 * 1000).toISOString(),
    });

    expect(normalizePosition({
      ticket: 992,
      symbol: 'BTCUSD',
      action: 0,
      volume: 0.01,
      price_open: 65320.12,
      price_current: 65304.89,
      time_create_msc: 1760000245000,
    })).toMatchObject({
      id: 992,
      openTime: new Date(1760000245000).toISOString(),
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
      positionId: 445566,
      dealTicket: 778899,
      entry: 'entry_out',
    });
  });

  it('collapses paired MT5 entry deals into one closed history trade', () => {
    const openTime = new Date(1760000000 * 1000).toISOString();
    const closeTime = new Date(1760003600 * 1000).toISOString();
    const deals = [
      normalizeDeal({
        deal: 1001,
        position_ticket: 5001,
        symbol: 'GBPUSD',
        action: 'deal_buy',
        entry: 'entry_in',
        volume: 0.01,
        price: 1.33981,
        time: 1760000000,
      }),
      normalizeDeal({
        deal: 1002,
        position_ticket: 5001,
        symbol: 'GBPUSD',
        action: 'deal_sell',
        entry: 'entry_out',
        volume: 0.01,
        price: 1.34008,
        profit: 2.7,
        commission: -0.12,
        swap: -0.01,
        time: 1760003600,
      }),
    ];

    expect(collapseDealHistory(deals)).toEqual([
      expect.objectContaining({
        id: 5001,
        symbol: 'GBPUSD',
        type: 'closed',
        status: 'closed',
        side: 'BUY',
        volume: 0.01,
        openPrice: 1.33981,
        closePrice: 1.34008,
        openTime,
        closeTime,
        profit: 2.7,
        commission: -0.12,
        swap: -0.01,
      }),
    ]);
  });

  it('collapses paired MT5 enum entry deals into one closed history trade', () => {
    const deals = [
      normalizeDeal({
        deal: 1011,
        position_ticket: 5011,
        symbol: 'GBPUSD',
        action: 0,
        entry: 0,
        volume: 0.01,
        price: 1.34149,
        time: 1760000000,
      }),
      normalizeDeal({
        deal: 1012,
        position_ticket: 5011,
        symbol: 'GBPUSD',
        action: 1,
        entry: 1,
        volume: 0.01,
        price: 1.34324,
        profit: 1.75,
        time: 1760000300,
      }),
    ];

    expect(collapseDealHistory(deals)).toEqual([
      expect.objectContaining({
        id: 5011,
        symbol: 'GBPUSD',
        type: 'closed',
        status: 'closed',
        side: 'BUY',
        openPrice: 1.34149,
        closePrice: 1.34324,
        profit: 1.75,
        historySource: 'deal',
      }),
    ]);
  });

  it('collapses paired MT5 entry deals grouped by position_id and position aliases', () => {
    const deals = [
      normalizeDeal({
        deal: 1101,
        position_id: 6001,
        symbol: 'EURUSD',
        action: 'deal_buy',
        entry: 'entry_in',
        volume: 0.02,
        price: 1.0875,
        time: 1760000000,
      }),
      normalizeDeal({
        deal: 1102,
        position: 6001,
        symbol: 'EURUSD',
        action: 'deal_sell',
        entry: 'entry_out',
        volume: 0.02,
        price: 1.089,
        profit: 3,
        time: 1760003600,
      }),
    ];

    expect(collapseDealHistory(deals)).toEqual([
      expect.objectContaining({
        id: 6001,
        symbol: 'EURUSD',
        type: 'closed',
        status: 'closed',
        openPrice: 1.0875,
        closePrice: 1.089,
        profit: 3,
      }),
    ]);
  });

  it('pairs live-shaped unkeyed deals one-to-one with the most recent compatible opening', () => {
    const deals = [
      normalizeDeal({
        ticket: 1304,
        order_ticket: null,
        account_login: 200001,
        symbol: 'GBPUSD',
        action: 'sell',
        entry: 'entry_out',
        volume: 0.01,
        price: 1.3412,
        profit: 1.4,
        time: 1788134580,
      }),
      normalizeDeal({
        ticket: 1303,
        order_ticket: 9303,
        account_login: 200001,
        symbol: 'GBPUSD',
        action: 'sell',
        entry: 'entry_out',
        volume: 0.01,
        price: 1.341,
        profit: 1.1,
        time: 1788134520,
      }),
      normalizeDeal({
        ticket: 1302,
        order_ticket: 9302,
        account_login: 200001,
        symbol: 'GBPUSD',
        action: 'buy',
        entry: 'entry_in',
        volume: 0.01,
        price: 1.3398,
        time: 1788134460,
      }),
      normalizeDeal({
        ticket: 1301,
        order_ticket: 9301,
        account_login: 200001,
        symbol: 'GBPUSD',
        action: 'buy',
        entry: 'entry_in',
        volume: 0.01,
        price: 1.3395,
        time: 1788134400,
      }),
    ];

    expect(collapseDealHistory(deals)).toEqual([
      expect.objectContaining({
        id: 1302,
        type: 'closed',
        status: 'closed',
        openPrice: 1.3398,
        closePrice: 1.341,
        profit: 1.1,
      }),
      expect.objectContaining({
        id: 1301,
        type: 'closed',
        status: 'closed',
        openPrice: 1.3395,
        closePrice: 1.3412,
        profit: 1.4,
      }),
    ]);
  });

  it('requires symbol, opposite action, sufficient volume, and chronology for unkeyed pairing', () => {
    const deals = [
      normalizeDeal({
        ticket: 1316,
        symbol: 'GBPUSD',
        action: 'buy',
        entry: 'entry_in',
        volume: 0.02,
        price: 1.3404,
        time: 1788134700,
      }),
      normalizeDeal({
        ticket: 1315,
        symbol: 'GBPUSD',
        action: 'sell',
        entry: 'entry_out',
        volume: 0.02,
        price: 1.3402,
        profit: 2,
        time: 1788134640,
      }),
      normalizeDeal({
        ticket: 1314,
        symbol: 'GBPUSD',
        action: 'buy',
        entry: 'entry_in',
        volume: 0.01,
        price: 1.3399,
        time: 1788134580,
      }),
      normalizeDeal({
        ticket: 1313,
        symbol: 'GBPUSD',
        action: 'sell',
        entry: 'entry_in',
        volume: 0.02,
        price: 1.3398,
        time: 1788134520,
      }),
      normalizeDeal({
        ticket: 1312,
        symbol: 'EURUSD',
        action: 'buy',
        entry: 'entry_in',
        volume: 0.02,
        price: 1.087,
        time: 1788134460,
      }),
      normalizeDeal({
        ticket: 1311,
        symbol: 'GBPUSD',
        action: 'buy',
        entry: 'entry_in',
        volume: 0.02,
        price: 1.3395,
        time: 1788134400,
      }),
    ];

    expect(collapseDealHistory(deals)).toEqual([
      expect.objectContaining({
        id: 1311,
        openPrice: 1.3395,
        closePrice: 1.3402,
        volume: 0.02,
        status: 'closed',
      }),
    ]);
  });

  it('keeps entry_out-only MT5 deals visible as standalone closed history', () => {
    const deals = [
      normalizeDeal({
        deal: 1201,
        position_ticket: 7001,
        symbol: 'USDJPY',
        action: 'deal_sell',
        entry: 'entry_out',
        volume: 0.03,
        price: 156.25,
        profit: 8.5,
        time: 1760003600,
      }),
    ];

    expect(collapseDealHistory(deals)).toEqual([
      expect.objectContaining({
        id: 1201,
        symbol: 'USDJPY',
        type: 'entry_out',
        status: 'closed',
        side: 'SELL',
        closePrice: 156.25,
        profit: 8.5,
      }),
    ]);
  });

  it('omits an unmatched entry_in but keeps an unmatched unkeyed entry_out', () => {
    const deals = [
      normalizeDeal({
        ticket: 1401,
        order_ticket: 9401,
        symbol: 'EURUSD',
        action: 'buy',
        entry: 'entry_in',
        volume: 0.01,
        price: 1.087,
        time: 1788134400,
      }),
      normalizeDeal({
        ticket: 1402,
        order_ticket: null,
        symbol: 'USDJPY',
        action: 'sell',
        entry: 'entry_out',
        volume: 0.01,
        price: 156.25,
        profit: 0.8,
        time: 1788134460,
      }),
    ];

    expect(collapseDealHistory(deals)).toEqual([
      expect.objectContaining({
        id: 1402,
        type: 'entry_out',
        status: 'closed',
        profit: 0.8,
      }),
    ]);
  });

  it('returns collapsed deal history rows from getOrderHistory instead of raw entry rows', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ positions: [] })
      .mockResolvedValueOnce({
        deals: [
          {
            deal: 2001,
            position_ticket: 9001,
            symbol: 'XAUUSD',
            action: 'deal_buy',
            entry: 'entry_in',
            volume: 0.01,
            price: 4320.35,
            time: 1760000000,
          },
          {
            deal: 2002,
            position_ticket: 9001,
            symbol: 'XAUUSD',
            action: 'deal_sell',
            entry: 'entry_out',
            volume: 0.01,
            price: 4326.10,
            profit: 5.75,
            time: 1760000300,
          },
        ],
      });

    await expect(tradeGatewayApi.getOrderHistory(123456)).resolves.toMatchObject([
      {
        id: 9001,
        symbol: 'XAUUSD',
        type: 'closed',
        status: 'closed',
        openPrice: 4320.35,
        closePrice: 4326.10,
        profit: 5.75,
      },
    ]);
  });

  it('builds history from a bare live-shaped deals array without using order_ticket as identity', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ticket: 2101,
          order_ticket: 9101,
          account_login: 200001,
          symbol: 'XAUUSD',
          action: 'buy',
          entry: 'entry_in',
          volume: 0.01,
          price: 4320.35,
          time: 1788134400,
        },
        {
          ticket: 2102,
          order_ticket: null,
          account_login: 200001,
          symbol: 'XAUUSD',
          action: 'sell',
          entry: 'entry_out',
          volume: 0.01,
          price: 4326.1,
          profit: 5.75,
          time: 1788134700,
        },
      ]);

    await expect(tradeGatewayApi.getOrderHistory(200001)).resolves.toMatchObject([
      {
        id: 2101,
        symbol: 'XAUUSD',
        type: 'closed',
        status: 'closed',
        openPrice: 4320.35,
        closePrice: 4326.1,
        profit: 5.75,
      },
    ]);
  });

  it('surfaces a deals request failure instead of reporting an empty history', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Deals unavailable'));

    await expect(tradeGatewayApi.getOrderHistory(200001)).rejects.toThrow('Deals unavailable');
  });

  it('returns only closed trades in history and excludes opening deals and orders', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ positions: [] })
      .mockResolvedValueOnce({
        deals: [
          {
            deal: 3001,
            position_ticket: 9101,
            symbol: 'GBPUSD',
            action: 'deal_buy',
            entry: 'entry_in',
            volume: 0.01,
            price: 1.33981,
            time: 1760000000,
          },
          {
            deal: 3002,
            position_ticket: 9102,
            symbol: 'EURUSD',
            action: 'deal_sell',
            entry: 'entry_in',
            volume: 0.02,
            price: 1.0900,
            time: 1760000100,
          },
          {
            deal: 3003,
            position_ticket: 9102,
            symbol: 'EURUSD',
            action: 'deal_buy',
            entry: 'entry_out',
            volume: 0.02,
            price: 1.0880,
            profit: 4,
            time: 1760000200,
          },
        ],
      })
      .mockResolvedValueOnce({
        orders: [
          {
            ticket: 4001,
            symbol: 'GBPUSD',
            type: 'buy',
            side: 'buy',
            volume: 0.01,
            price_open: 1.33981,
            time_create: 1760000000,
          },
        ],
      });

    const history = await tradeGatewayApi.getOrderHistory(123456);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: 9102,
      symbol: 'EURUSD',
      type: 'closed',
      status: 'closed',
      side: 'SELL',
      openPrice: 1.09,
      closePrice: 1.088,
      profit: 4,
    });
    expect(vi.mocked(apiClient.get)).not.toHaveBeenCalledWith(
      '/orders/123456',
      expect.anything(),
    );
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
      closeTime: new Date(1760000000 * 1000).toISOString(),
    });
  });

  it('preserves sparse backend account metrics and accepts an explicit zero balance', () => {
    const previous = normalizeAccount({ balance: 100, equity: 102, used_margin: 10, free_margin: 92 });
    expect(normalizeAccount({ balance: 0 }, previous)).toMatchObject({
      balance: 0,
      hasBackendBalance: true,
      equity: 102,
      hasBackendEquity: true,
      margin: 10,
      freeMargin: 92,
    });
    const unavailable = normalizeAccount({ balance: 100 });
    expect(unavailable).toMatchObject({ equity: 0, hasBackendEquity: false });
    // Re-applying the same sparse packet must not resurrect the absent metric.
    expect(normalizeAccount({ balance: 100 }, unavailable)).toMatchObject({
      equity: 0,
      hasBackendEquity: false,
    });
  });

  it.each([
    ['missing', {}, false],
    ['zero', { profit: 0, price_current: 0 }, true],
    ['numeric strings', { profit: '-1.25', price_current: '82000.5' }, true],
    ['invalid', { profit: false, price_current: '' }, false],
    ['unavailable snapshot', { profit: 3, price_current: 82000, pnl_available: false }, false],
    ['previous placeholders', { profit: 0, price_current: 0, hasBackendProfit: false, hasBackendCurrentPrice: false }, false],
  ])('keeps %s position display provenance through repeated normalization', (_name, display, available) => {
    const raw = { ticket: 41, symbol: 'BTCUSD', price_open: 81000, state_version: '9007199254740993123', ...display };
    const first = normalizePosition(raw as Parameters<typeof normalizePosition>[0]);
    const second = normalizePosition(first as unknown as Parameters<typeof normalizePosition>[0]); // re-normalizing app-shaped output is intentional
    for (const result of [first, second]) {
      expect(result).toMatchObject({
        id: 41,
        state_version: raw.state_version,
        hasBackendProfit: available,
        hasBackendCurrentPrice: available,
      });
      if (!available) expect(result).toMatchObject({ currentPrice: 0, unrealizedPnL: 0 });
    }
  });

  it('tracks position profit and current price availability independently', () => {
    expect(normalizePosition({ ticket: 42, profit: 0 })).toMatchObject({
      hasBackendProfit: true,
      hasBackendCurrentPrice: false,
    });
    expect(normalizePosition({ ticket: 42, price_current: 82000 })).toMatchObject({
      hasBackendProfit: false,
      hasBackendCurrentPrice: true,
    });
  });

  it('normalizes order time_setup and time_done as Unix seconds', () => {
    expect(normalizeOrder({
      ticket: 991123,
      symbol: 'EURUSD',
      type: 'buy_limit',
      side: 'buy',
      volume: 0.2,
      price_open: 1.08765,
      time_create: 1759999900,
      time_setup: 1760000000,
      time_done: 1760003600,
    })).toMatchObject({
      id: 991123,
      openTime: new Date(1760000000 * 1000).toISOString(),
      closeTime: new Date(1760003600 * 1000).toISOString(),
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
