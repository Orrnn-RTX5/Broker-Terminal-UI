import { describe, expect, it } from 'vitest';
import {
  createPendingLifecycleDeduper,
  parsePendingOrderLifecycleFrame,
} from './pendingOrderStream';

describe('pendingOrderStream', () => {
  it('parses triggered/filled, limit_activated, expired, and rejected frames', () => {
    const filled = parsePendingOrderLifecycleFrame('orders.200001', {
      ticket: 1042,
      symbol: 'EURUSD',
      order_type: 'buy_limit',
      volume: 0.1,
      fill_price: 1.0845,
      status: 'triggered',
      state_version: 3,
    });
    expect(filled).toEqual({
      dedupeKey: '200001:1042:triggered:3',
      login: '200001',
      ticket: '1042',
      symbol: 'EURUSD',
      side: 'BUY',
      orderType: 'BUY LIMIT',
      volume: 0.1,
      price: 1.0845,
      status: 'triggered',
    });

    const limitActivated = parsePendingOrderLifecycleFrame('rtx5.pending_orders.200001', {
      ticket: 1043,
      symbol: 'GBPUSD',
      order_type: 'sell_stop_limit',
      volume: 0.2,
      price_limit: 1.265,
      status: 'limit_activated',
    });
    expect(limitActivated?.status).toBe('limit_activated');
    expect(limitActivated?.side).toBe('SELL');

    const expired = parsePendingOrderLifecycleFrame('orders.200001', {
      ticket: 1044,
      symbol: 'USDJPY',
      status: 'expired',
    });
    expect(expired?.status).toBe('expired');

    const rejected = parsePendingOrderLifecycleFrame('orders.200001', {
      ticket: 1045,
      symbol: 'XAUUSD',
      status: 'rejected',
      error_code: 'INSUFFICIENT_MARGIN',
    });
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.reason).toBe('INSUFFICIENT_MARGIN');
  });

  it('deduplicates repeated lifecycle frames for the same (login, ticket, status)', () => {
    const deduper = createPendingLifecycleDeduper();
    expect(deduper.shouldEmit('200001:1042:triggered:3')).toBe(true);
    expect(deduper.shouldEmit('200001:1042:triggered:3')).toBe(false);
    expect(deduper.shouldEmit('200001:1042:triggered:4')).toBe(false);
    expect(deduper.shouldEmit('200001:1043:triggered:1')).toBe(true);
  });
});
