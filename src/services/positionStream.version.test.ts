import { describe, expect, it } from 'vitest';
import { mergePositionRecord, normalizePosition, reconcilePositionStreamBatch } from './positionStream';

const row = { ticket: 10, symbol: 'EURUSD', side: 'buy', volume: 1, profit: 3, state_version: '9007199254740993' };

describe('position state version fence', () => {
  it('does not resurrect a closed position from a delayed complete valuation', () => {
    const result = reconcilePositionStreamBatch([], { mode: 'delta', positions: [{ ...row, display_only: true }] });
    expect(result.positions).toEqual([]);
    expect(result.needsRevalidation).toBe(true);
  });

  it('applies display-only updates to an already-known position', () => {
    const existing = normalizePosition(row);
    const result = reconcilePositionStreamBatch([existing], { mode: 'delta', positions: [{ ...row, display_only: true, profit: 0 }] });
    expect(result.positions[0].profit).toBe(0);
    expect(result.needsRevalidation).toBe(false);
    expect(mergePositionRecord({ ticket: 10, state_version: undefined, profit: 5 }, existing).state_version).toBe(row.state_version);
  });

  it.each(['delta', 'snapshot'] as const)('retains newer financial state in a delayed %s', (mode) => {
    const existing = normalizePosition(row);
    const result = reconcilePositionStreamBatch([existing], {
      mode, positions: [{ ...row, volume: 2, profit: 900, state_version: '9007199254740992' }],
    });
    expect(result.positions).toEqual([existing]);
    expect(result.positions[0]).toBe(existing);
  });

  it('ignores older explicit closes but accepts a newer close', () => {
    const existing = normalizePosition(row);
    const close = { ticket: 10, status: 'closed', state_version: '9007199254740992' };
    expect(reconcilePositionStreamBatch([existing], { mode: 'delta', positions: [close] }).positions).toEqual([existing]);
    expect(reconcilePositionStreamBatch([existing], {
      mode: 'delta', positions: [{ ...close, state_version: '9007199254740994' }],
    }).positions).toEqual([]);
  });

  it('compares digit lengths and supports same-version display refreshes', () => {
    const existing = normalizePosition({ ...row, state_version: '10' });
    expect(mergePositionRecord({ ticket: 10, state_version: '9', profit: 999 }, existing)).toBe(existing);
    expect(mergePositionRecord({ ticket: 10, state_version: '00010', profit: 0 }, existing).profit).toBe(0);
    expect(mergePositionRecord({ ticket: 10, profit: 5 }, existing).state_version).toBe('10');
  });
});
