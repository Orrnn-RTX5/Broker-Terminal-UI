import { describe, expect, it } from 'vitest';
import { resolveOptionalPositionTime, resolvePositionOpenTime } from './tradePositionTime';

describe('trade position time normalization', () => {
  it('uses MT5 open-time aliases from refreshed positions', () => {
    expect(resolvePositionOpenTime({ time_open: 1760000000 })).toBe('2025-10-09T08:53:20.000Z');
    expect(resolvePositionOpenTime({ time_create_msc: 1760000065000 })).toBe('2025-10-09T08:54:25.000Z');
    expect(resolvePositionOpenTime({ time: '1760000120' })).toBe('2025-10-09T08:55:20.000Z');
  });

  it('keeps distinct trade open times distinct after refresh', () => {
    const first = resolvePositionOpenTime({ ticket: 101, time_open: 1760000000 });
    const second = resolvePositionOpenTime({ ticket: 102, time_open: 1760000180 });

    expect(first).toBe('2025-10-09T08:53:20.000Z');
    expect(second).toBe('2025-10-09T08:56:20.000Z');
    expect(first).not.toBe(second);
  });

  it('uses click-time fallback only when backend has no usable open time', () => {
    expect(resolvePositionOpenTime(
      { ticket: 103, time_open: 0, time: null },
      '2026-06-17T08:01:15.000Z',
    )).toBe('2026-06-17T08:01:15.000Z');
  });

  it('normalizes optional chart entry time', () => {
    expect(resolveOptionalPositionTime('2026-06-17T08:02:30.000Z')).toBe('2026-06-17T08:02:30.000Z');
    expect(resolveOptionalPositionTime('')).toBeUndefined();
  });
});
