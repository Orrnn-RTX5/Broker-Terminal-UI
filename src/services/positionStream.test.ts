import { describe, expect, it } from 'vitest';
import {
  normalizePosition,
  POSITION_CLOSED_EVENTS,
  readPositionStreamBatch,
  readPositionStreamEvent,
  reconcilePositionStreamBatch,
} from './positionStream';

const gold = { ticket: 20165, symbol: 'XAUUSD', side: 'buy', volume: 0.01, price_open: 4291.06, price_current: 4329.06, profit: 38, price_sl: 4200, price_tp: 4400, time_create: '2026-09-15T12:52:28Z' };
const bitcoin = { ticket: 20166, symbol: 'BTCUSD', side: 'sell', volume: 0.02, price_open: 110000, price_current: 109900, profit: 2, time_create: '2026-09-15T12:53:28Z' };
const initial = () => [gold, bitcoin].map(normalizePosition);

describe('account position stream reconciliation', () => {
  it('uses exact bigint version text to reject stale closes and accept a newer close', () => {
    const current = [normalizePosition({ ...gold, state_version: 9007199254740992, state_version_text: '9007199254740993' })];
    const stale = reconcilePositionStreamBatch(current, { mode: 'delta', positions: [{ ticket: gold.ticket, closed: true, state_version: 9007199254740992, state_version_text: '9007199254740992' }] });
    expect(stale.positions).toHaveLength(1);
    expect(stale.closedTickets).toEqual([]);
    const advanced = reconcilePositionStreamBatch(current, { mode: 'delta', positions: [{ ticket: gold.ticket, state_version: '9007199254740995', price_sl: 4100 }] });
    expect(advanced.positions[0]).toMatchObject({ state_version: '9007199254740995', state_version_text: '9007199254740995' });
    expect(reconcilePositionStreamBatch(advanced.positions, { mode: 'delta', positions: [{ ticket: gold.ticket, closed: true, state_version_text: '9007199254740994' }] }).closedTickets).toEqual([]);
    const closed = reconcilePositionStreamBatch(current, { mode: 'delta', positions: [{ ticket: gold.ticket, closed: true, state_version: 9007199254740994, state_version_text: '9007199254740994' }] });
    expect(closed.positions).toEqual([]);
    expect(closed.closedTickets).toEqual([gold.ticket]);
  });
  it('marks prior volume profit unavailable until the new structural version receives its own price', () => {
    const old = normalizePosition({ ...gold, state_version: '12', profit: 38 });
    const changed = reconcilePositionStreamBatch([old], { mode: 'delta', positions: [{ ticket: gold.ticket, state_version: '13', update_kind: 'snapshot', volume: 0.005, price_sl: null, price_tp: null, pnl_available: false }] });
    expect(changed.positions[0]).toMatchObject({ volume: 0.005, sl: 0, tp: 0, hasBackendProfit: false });
    const priced = reconcilePositionStreamBatch(changed.positions, { mode: 'delta', positions: [{ ticket: gold.ticket, state_version: '13', update_kind: 'pnl', profit: 19, price_current: 4329, price_time_msc: 2000 }] });
    expect(priced.positions[0]).toMatchObject({ profit: 19, pnl_available: true, hasBackendProfit: true });
    const duplicate = reconcilePositionStreamBatch(priced.positions, { mode: 'delta', positions: [{ ticket: gold.ticket, state_version: '13', update_kind: 'snapshot', volume: 0.005, pnl_available: false }] });
    expect(duplicate.positions[0]).toMatchObject({ profit: 19, pnl_available: true, hasBackendProfit: true });
  });
  it('applies ordered display profit without changing protection or creating unknown tickets', () => {
    const current = [normalizePosition({ ...gold, state_version: '12', price_time_msc: 1000 })];
    const apply = (rows: any[]) => reconcilePositionStreamBatch(current, { mode: 'delta', positions: rows });
    const result = apply([{ ticket: gold.ticket, state_version: '12', update_kind: 'pnl', price_time_msc: 2000, profit: 9, volume: 99, price_sl: 0 }]);
    expect(result.positions[0]).toMatchObject({ profit: 9, volume: 0.01, sl: 4200 });
    const stale = reconcilePositionStreamBatch(result.positions, { mode: 'delta', positions: [{ ticket: gold.ticket, state_version: '12', update_kind: 'pnl', price_time_msc: 1500, profit: 1 }] });
    expect(stale.positions[0].profit).toBe(9);
    expect(apply([{ ...bitcoin, update_kind: 'pnl', state_version: '12' }])).toMatchObject({ positions: current, needsRevalidation: true });
    expect(apply([{ ticket: gold.ticket, update_kind: 'pnl', state_version: '13', profit: 40 }])).toMatchObject({ positions: current, needsRevalidation: true });
  });
  it.each([
    ['gateway v2', (rows: any[]) => ({ channel: 'positions.200001', data: { type: 'position_update', data: rows } })],
    ['legacy envelope', (rows: any[]) => ({ type: 'channel_message', channel: 'positions.200001', data: { type: 'position_update', data: rows } })],
    ['manager P&L', (rows: any[]) => ({ channel: 'positions.200001', data: { type: 'pnl_update', symbol: rows[0].symbol, positions: rows } })],
    ['unmarked array', (rows: any[]) => ({ channel: 'positions.200001', data: rows })],
  ])('keeps every ticket during alternating XAUUSD/BTCUSD updates: %s', (_label, wrap) => {
    let current = initial();
    for (let index = 0; index < 20; index++) {
      const row = index % 2 === 0 ? gold : bitcoin;
      const batch = readPositionStreamBatch(wrap([{ ...row, profit: index }]))!;
      expect(batch.mode).toBe('delta');
      const result = reconcilePositionStreamBatch(current, batch);
      current = result.positions;
      expect(current.map((position) => position.id)).toEqual([gold.ticket, bitcoin.ticket]);
      expect(current.find((position) => position.id === row.ticket)?.unrealizedPnL).toBe(index);
      expect(result.needsRevalidation).toBe(false);
    }
  });

  it('patches sparse prices/profit without erasing identity, entry, protection or chart fields', () => {
    const current = initial();
    current[0].chartEntryPrice = 4291;
    const batch = readPositionStreamBatch({ data: { type: 'pnl_update', symbol: 'XAUUSD', positions: [{ ticket: gold.ticket, price_current: 4330, profit: 0 }] } })!;
    const result = reconcilePositionStreamBatch(current, batch);
    expect(result.positions[0]).toMatchObject({
      id: gold.ticket, symbol: 'XAUUSD', volume: 0.01, side: 'BUY',
      openPrice: 4291.06, price_open: 4291.06, chartEntryPrice: 4291,
      openTime: '2026-09-15T12:52:28.000Z', sl: 4200, tp: 4400,
      currentPrice: 4330, price_current: 4330, profit: 0, unrealizedPnL: 0,
    });
    expect(result.positions[1]).toBe(current[1]);
  });

  it('adds complete new trades and revalidates unknown sparse tickets without blank rows', () => {
    const result = reconcilePositionStreamBatch(initial(), {
      mode: 'delta', positions: [{ ...gold, ticket: 20167 }, { ticket: 20168, profit: 12 }],
    });
    expect(result.positions.map((position) => position.id)).toEqual([20165, 20166, 20167]);
    expect(result.needsRevalidation).toBe(true);
  });

  it('only removes absent tickets for an explicitly complete snapshot', () => {
    const batch = readPositionStreamBatch({ data: { type: 'positions_snapshot', positions: [bitcoin] } })!;
    expect(reconcilePositionStreamBatch(initial(), batch).positions.map((position) => position.id)).toEqual([20166]);
    const delta = readPositionStreamBatch({ data: { type: 'pnl_update', snapshot: true, positions: [bitcoin] } })!;
    expect(reconcilePositionStreamBatch(initial(), delta).positions).toHaveLength(2);
  });

  it('revalidates empty snapshots but still applies explicit closes, including the last ticket', () => {
    expect(reconcilePositionStreamBatch(initial(), { mode: 'snapshot', positions: [] })).toEqual({ positions: initial(), needsRevalidation: true, closedTickets: [] });
    const firstClose = reconcilePositionStreamBatch(initial(), { mode: 'delta', positions: [{ ticket: gold.ticket, status: 'closed' }] });
    expect(firstClose.positions.map((position) => position.id)).toEqual([bitcoin.ticket]);
    expect(reconcilePositionStreamBatch(firstClose.positions, { mode: 'delta', positions: [{ ticket: bitcoin.ticket, volume: 0 }] })).toEqual({ positions: [], needsRevalidation: false, closedTickets: [bitcoin.ticket] });
  });

  it('reads nested close events without mistaking partial closes for full closes', () => {
    const message = { type: 'channel_message', channel: 'positions.200001', data: { type: 'position_closed', data: { ticket: gold.ticket } } };
    expect(readPositionStreamEvent(message)).toEqual({ event: 'position_closed', position: { ticket: gold.ticket } });
    expect(POSITION_CLOSED_EVENTS.has(readPositionStreamEvent(message).event)).toBe(true);
    expect(POSITION_CLOSED_EVENTS.has('position_partial_close')).toBe(false);
  });

  it('retains more than 50 trades across symbol updates', () => {
    const current = Array.from({ length: 120 }, (_, index) => normalizePosition({ ...gold, ticket: index + 1, symbol: index % 2 ? 'BTCUSD' : 'XAUUSD' }));
    const result = reconcilePositionStreamBatch(current, { mode: 'delta', positions: [{ ticket: 1, price_current: 4330 }] });
    expect(result.positions).toHaveLength(120);
  });
});
