import { describe, expect, it } from 'vitest';
import { normalizePositions } from './positionRuntime';

describe('normalizePositions', () => {
  it('normalizes broker aliases without inventing a ticket', () => {
    const positions = normalizePositions({
      positions: [
        { symbol: 'IGNORED', price_open: 1.1 },
        {
          position_ticket: '73',
          symbol: 'EURUSD.r',
          side: 'short',
          volume_lots: '0.25',
          price_open: '1.0842',
          price_current: '1.0837',
          price_sl: '1.09',
          price_tp: '1.08',
          unrealized_pl: '12.5',
          time_create: 1_700_000_000,
        },
      ],
    });

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      id: 73,
      symbol: 'EURUSD.r',
      side: 'SELL',
      volume: 0.25,
      openPrice: 1.0842,
      currentPrice: 1.0837,
      sl: 1.09,
      tp: 1.08,
      unrealizedPnL: 12.5,
      hasBackendProfit: true,
      hasBackendCurrentPrice: true,
    });
  });

  it('preserves explicit backend-unavailable state', () => {
    const [position] = normalizePositions([{
      ticket: 9,
      symbol: 'BTCUSD',
      side: 'buy',
      volume: 0.1,
      open_price: 50_000,
      current_price: 50_100,
      profit: 10,
      pnl_available: false,
      open_time: '2026-09-01T10:00:00Z',
    }]);

    expect(position.hasBackendProfit).toBe(false);
    expect(position.hasBackendCurrentPrice).toBe(false);
    expect(position.pnl_available).toBe(false);
  });
});
