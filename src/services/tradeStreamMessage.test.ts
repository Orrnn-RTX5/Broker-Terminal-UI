import { describe, expect, it } from 'vitest';
import { isTradeSubscriptionControlFrame } from './tradeStreamMessage';

describe('trade history stream admission', () => {
  it.each([
    { type: 'subscribed', channel: 'orders.200001' },
    { type: 'unsubscribed', channel: 'deals.200001' },
    { action: 'subscribed', channel: 'deals.200001' },
    { type: ' SUBSCRIBED ', channel: 'orders.200001', data: null },
  ])('does not invalidate history for a bare subscription confirmation: %j', frame => {
    expect(isTradeSubscriptionControlFrame(frame)).toBe(true);
  });

  it.each([
    { type: 'snapshot', channel: 'orders.200001', data: [] },
    { type: 'channel_message', channel: 'deals.200001', data: { deals: [] } },
    { type: 'update', channel: 'orders.200001', order: { ticket: 12 } },
    { type: 'deal_created', channel: 'deals.200001', deal: { ticket: 34 } },
    { type: 'broker_specific_change', channel: 'orders.200001' },
    { channel: 'deals.200001' },
    { type: 'subscribed', channel: 'orders.200001', data: { orders: [] } },
    { type: 'subscribed', channel: 'deals.200001', payload: [] },
    { action: 'subscribed', channel: 'deals.200001', deals: [] },
    { type: 'update', action: 'subscribed', channel: 'orders.200001' },
  ])('preserves snapshots, changes, unknown events and attached initial data: %j', frame => {
    expect(isTradeSubscriptionControlFrame(frame)).toBe(false);
  });
});
