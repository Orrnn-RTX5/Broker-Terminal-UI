import { describe, expect, it } from 'vitest';
import { reconcilePositionStreamBatch } from './positionStream';

const current = [
  { id: 12063, symbol: 'ETHUSD', side: 'BUY', volume: 0.01, state_version: '1' },
  { id: 12065, symbol: 'ETHUSD', side: 'SELL', volume: 0.01, state_version: '2' },
];

const row = (ticket: number, extra: Record<string, unknown> = {}) => ({
  ticket,
  symbol: 'ETHUSD',
  side: 'sell',
  volume: 0.01,
  price_open: 2399.32,
  state_version: '2',
  account_login: 200036,
  ...extra,
});

describe('stream snapshot batches merge', () => {
  it('upserts the rows a stream snapshot carries and keeps the tickets it omits', () => {
    const result = reconcilePositionStreamBatch(current, {
      mode: 'snapshot',
      positions: [row(12065, { price_sl: 2408.11 })],
    });

    expect(result.positions.map(({ id }) => id).sort((a, b) => a - b)).toEqual([12063, 12065]);
    expect(result.closedTickets).toEqual([]);
  });

  it('removes a ticket only on its explicit close record, even inside a snapshot batch', () => {
    const result = reconcilePositionStreamBatch(current, {
      mode: 'snapshot',
      positions: [row(12065, { status: 'closed', action: 'closed', update_kind: 'snapshot' })],
    });

    expect(result.positions.map(({ id }) => id)).toEqual([12063]);
    expect(result.closedTickets).toEqual([12065]);
  });
});
