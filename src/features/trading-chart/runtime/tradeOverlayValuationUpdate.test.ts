import { describe, expect, it } from 'vitest';
import type { Position } from '../../../store/useAppStore';
import { isTradeOverlayValuationUpdate } from './tradeOverlayValuationUpdate';

const position = (patch: Record<string, unknown> = {}) => ({ id: 1, symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  openPrice: 100, currentPrice: 101, openTime: '2026-10-06T12:00:00Z', sl: 90, tp: 120,
  unrealizedPnL: 1, swap: 0, commission: 0, ...patch }) as Position;
describe('exact valuation-only overlay classification', () => {
  it('allows scalar valuation/evidence changes without modifying either financial input', () => {
    const previous = Object.freeze([Object.freeze(position())]);
    const next = Object.freeze([Object.freeze(position({ currentPrice: 102, profit: 2, unrealizedPnL: 2,
      state_version: '9007199254740993', price_time_msc: '1791280000000', hasBackendProfit: true }))]);
    expect(isTradeOverlayValuationUpdate(next, previous)).toBe(true);
    expect(previous[0].currentPrice).toBe(101); expect(next[0].currentPrice).toBe(102);
  });
  it.each(['id', 'symbol', 'side', 'volume', 'openPrice', 'openTime', 'sl', 'tp', 'chartEntryPrice',
    'chartEntryTime', 'closeCommandState', 'closeClientOrderId', 'protection_version', 'unknownNewField'])('keeps %s changes synchronous', key => {
    expect(isTradeOverlayValuationUpdate([position({ [key]: 'changed' })], [position()])).toBe(false);
  });
  it('allows scalar display margin changes but keeps structural and nested margin updates synchronous', () => {
    const previous = [position({ margin: 100 })];
    expect(isTradeOverlayValuationUpdate([position({ margin: 101 })], previous)).toBe(true);
    expect(isTradeOverlayValuationUpdate([position({ margin: 101, volume: 0.02 })], previous)).toBe(false);
    expect(isTradeOverlayValuationUpdate([position({ margin: { amount: 101 } })], previous)).toBe(false);
  });
  it('keeps removals, additions, reorder, unknown field deletion and nested valuations synchronous', () => {
    expect(isTradeOverlayValuationUpdate([], [position()])).toBe(false);
    expect(isTradeOverlayValuationUpdate([position(), position({ id: 2 })], [position()])).toBe(false);
    expect(isTradeOverlayValuationUpdate([position({ id: 2 }), position()], [position(), position({ id: 2 })])).toBe(false);
    expect(isTradeOverlayValuationUpdate([position()], [position({ unknownNewField: undefined })])).toBe(false);
    expect(isTradeOverlayValuationUpdate([position({ profit: { value: 3 } })], [position()])).toBe(false);
  });
});
