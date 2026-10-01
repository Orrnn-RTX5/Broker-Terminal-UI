import { describe, expect, it } from 'vitest';
import { isCurrentQuoteTradingStatus, readQuoteTradingStatus } from './quoteTradingStatus';

describe('explicit broker quote trading permission', () => {
  const now = Date.now();
  const status = { tradable: true, authority: 'rtx5_hub', brokerId: 'orrnn', stale: false, sourceMismatch: false, receivedAt: now, sessionScope: 'test-scope' };
  it('requires explicit permission rather than a price or arbitrary authority', () => {
    expect(readQuoteTradingStatus({ bid: 100, ask: 101 })).toBeUndefined();
    expect(readQuoteTradingStatus({ tradable: 'closed' })).toBeUndefined();
    expect(isCurrentQuoteTradingStatus(status, 'Orrnn', now, now, now)).toBe(true);
    expect(isCurrentQuoteTradingStatus({ ...status, authority: '' }, 'Orrnn', now, now, now)).toBe(false);
  });
  it('rejects stale, wrong-source, wrong-broker, expired, and timestamp-free evidence', () => {
    for (const patch of [{ stale: true }, { sourceMismatch: true }, { brokerId: 'another' }, { receivedAt: now - 10000 }]) {
      expect(isCurrentQuoteTradingStatus({ ...status, ...patch }, 'Orrnn', now, now, now)).toBe(false);
    }
    expect(isCurrentQuoteTradingStatus(status, 'Orrnn', undefined, now, now)).toBe(false);
    expect(isCurrentQuoteTradingStatus(status, 'Orrnn', now - 10000, now, now)).toBe(false);
  });
});
