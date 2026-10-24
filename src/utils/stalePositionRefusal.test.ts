// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import englishUi from '../locales/en/ui.json';
import { ApiError } from '../api/client';
import { isConfirmedClosedBySnapshot, isPositionMarkedClosed, useAppStore, type Position } from '../store/useAppStore';
import {
  handleStalePositionRefusal,
  isPositionKnownClosed,
  readStalePositionRefusal,
  refuseSendForClosedPosition,
} from './stalePositionRefusal';

// Plain interpolation so the assertions read the English text the catalog holds.
const tr = (source: string, values?: Record<string, unknown>): string =>
  source.replace(/\{\{(\w+)\}\}/g, (match, key: string) => String(values?.[key] ?? match));

const position = (id: number): Position => ({
  id,
  symbol: 'ETHUSD',
  side: 'SELL',
  volume: 0.01,
  openPrice: 2399.32,
  currentPrice: 2400,
  openTime: '2026-10-22T08:34:55.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0,
});

const closedBody = (extra: Record<string, unknown> = {}) => ({
  error: 'POSITION_ALREADY_CLOSED',
  message: 'Position 12065 is already closed',
  ticket: 12065,
  ...extra,
});

describe('stale position refusals', () => {
  let refresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.getState().setPositions([position(12065), position(12066)]);
    refresh = vi.fn();
  });

  it('turns the exact 409 POSITION_ALREADY_CLOSED body into a plain message, drops the ticket and refreshes once', () => {
    const err = new ApiError(409, 'Position 12065 is already closed', closedBody({
      close_reason: 'sl',
      close_price: '2407.96',
      close_time: '2026-10-22T08:34:59Z',
      deal_ticket: 12067,
    }));

    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe('Position 12065 already closed (SL) at 2407.96');
    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12066]);
    expect(isPositionMarkedClosed(12065)).toBe(true);
    expect(isPositionKnownClosed(12065)).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the price verbatim as the decimal string the backend sends', () => {
    const err = new ApiError(409, 'closed', closedBody({ close_reason: 'tp', close_price: '2407.90' }));
    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe('Position 12065 already closed (TP) at 2407.90');
  });

  it('a 409 with only close_reason shows the reason and no price (close_price and close_time legitimately absent)', () => {
    const err = new ApiError(409, 'Position 12065 is already closed', closedBody({ close_reason: 'sl' }));
    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe('Position 12065 already closed (SL)');
    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12066]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('drops the price and the reason when the 409 carries neither', () => {
    const err = new ApiError(409, 'Position 12065 is already closed', closedBody());
    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe('Position 12065 already closed');
  });

  it('shows the price without a reason when the reason is unknown, and never a raw reason code', () => {
    const unknownReason = new ApiError(409, 'closed', closedBody({ close_reason: 'mystery_value', close_price: '2407.96' }));
    expect(handleStalePositionRefusal(unknownReason, 12065, { refresh, tr })).toBe('Position 12065 already closed at 2407.96');
    const bare = new ApiError(409, 'closed', closedBody({ close_reason: 'mystery_value' }));
    expect(handleStalePositionRefusal(bare, 12065, { refresh, tr })).toBe('Position 12065 already closed');
  });

  it.each([
    ['sl', 'SL'],
    ['tp', 'TP'],
    ['manual', 'closed manually'],
    ['stop_out', 'stop out'],
    ['close_by', 'close by'],
    ['close_all', 'close all'],
    ['admin', 'by the broker'],
  ])('labels close_reason %s as "%s"', (reason, label) => {
    const err = new ApiError(409, 'closed', closedBody({ close_reason: reason, close_price: '1.00' }));
    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe(`Position 12065 already closed (${label}) at 1.00`);
  });

  it('uses the ticket from the 409 body (close-by names the closed leg) and falls back to the requested one', () => {
    const err = new ApiError(409, 'closed', { error: 'POSITION_ALREADY_CLOSED', ticket: 12066, close_reason: 'manual' });
    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe('Position 12066 already closed (closed manually)');
    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12065]);

    const noTicket = new ApiError(409, 'closed', { error: 'POSITION_ALREADY_CLOSED' });
    expect(handleStalePositionRefusal(noTicket, 12065, { refresh, tr })).toBe('Position 12065 already closed');
  });

  it('answers a 404 NOT_FOUND with "no longer open", removes the ticket, refreshes once and does not mark it closed', () => {
    const err = new ApiError(404, 'Position not found', { error: 'NOT_FOUND', message: 'Position not found' });

    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe('Position 12065 is no longer open');
    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12066]);
    expect(isPositionMarkedClosed(12065)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('accepts the code under "code" as well as "error" on a 404', () => {
    const err = new ApiError(404, 'Position not found', { code: 'NOT_FOUND' });
    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBe('Position 12065 is no longer open');
  });

  it.each([
    ['another 409 code', new ApiError(409, 'Invalid stops', { error: 'INVALID_STOPS', message: 'Invalid stops' })],
    ['NOT_FOUND on a non-404 status', new ApiError(400, 'Position not found', { error: 'NOT_FOUND' })],
    ['another 404 code', new ApiError(404, 'Account not found', { error: 'ACCOUNT_NOT_FOUND' })],
    ['a 500 with POSITION_ALREADY_CLOSED', new ApiError(500, 'boom', { error: 'POSITION_ALREADY_CLOSED' })],
    ['a plain Error', new Error('network down')],
    ['a string', 'NOT_FOUND'],
  ])('leaves %s untouched: no message, no store change, no refresh', (_name, err) => {
    expect(readStalePositionRefusal(err)).toBeNull();
    expect(handleStalePositionRefusal(err, 12065, { refresh, tr })).toBeNull();
    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12065, 12066]);
    expect(isPositionMarkedClosed(12065)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pre-send guard refuses only a known-closed ticket; a ticket merely missing from the store is sent', () => {
    expect(isPositionKnownClosed(12065)).toBe(false);
    expect(isPositionKnownClosed(99999)).toBe(false);

    useAppStore.getState().setPositions(useAppStore.getState().positions, { closedTickets: [99999] });
    expect(isPositionKnownClosed(99999)).toBe(true);
    expect(refuseSendForClosedPosition(99999, { refresh, tr })).toBe('Position 99999 already closed');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12065, 12066]);
  });

  it('a confirmed-then-absent close marker is set only by the 409 path, never by the 404 path', () => {
    handleStalePositionRefusal(new ApiError(404, 'x', { error: 'NOT_FOUND' }), 12065, { refresh, tr });
    expect(isConfirmedClosedBySnapshot(12065)).toBe(false);
  });

  it('every English message key the helper renders exists in the catalog', () => {
    const keys = [
      'Position {{ticket}} already closed ({{reason}}) at {{price}}',
      'Position {{ticket}} already closed ({{reason}})',
      'Position {{ticket}} already closed at {{price}}',
      'Position {{ticket}} already closed',
      'Position {{ticket}} is no longer open',
      'SL', 'TP', 'closed manually', 'stop out', 'close by', 'close all', 'by the broker',
    ];
    for (const key of keys) {
      expect((englishUi as Record<string, string>)[key], key).toBe(key);
    }
  });
});
