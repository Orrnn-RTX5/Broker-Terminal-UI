// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  ALERT_TERMINAL_RETENTION_LIMIT,
  ALERT_TERMINAL_RETENTION_MS,
  retainAlerts,
  type Alert,
  type AlertStatus,
} from './useAlertStore';

const alert = (id: string, status: AlertStatus, createdAt: number): Alert => ({
  id,
  symbol: 'EURUSD',
  condition: 'price_above',
  price: 1,
  status,
  expiration: status === 'expired' ? createdAt : null,
  notifyMethod: 'sound',
  createdAt,
  triggeredAt: status === 'triggered' ? createdAt : undefined,
  enabled: status === 'active',
});

describe('alert retention', () => {
  it('preserves live user alerts while pruning old terminal history', () => {
    const now = Date.parse('2026-08-26T00:00:00Z');
    const active = alert('active', 'active', now - ALERT_TERMINAL_RETENTION_MS * 2);
    const disabled = alert('disabled', 'disabled', now - ALERT_TERMINAL_RETENTION_MS * 2);
    const oldTriggered = alert('old-triggered', 'triggered', now - ALERT_TERMINAL_RETENTION_MS - 1);

    expect(retainAlerts([active, disabled, oldTriggered], now).map(item => item.id)).toEqual([
      'active',
      'disabled',
    ]);
  });

  it('caps only triggered and expired history', () => {
    const now = Date.parse('2026-08-26T00:00:00Z');
    const terminal = Array.from(
      { length: ALERT_TERMINAL_RETENTION_LIMIT + 5 },
      (_, index) => alert(`triggered-${index}`, 'triggered', now - index),
    );

    const retained = retainAlerts(terminal, now);
    expect(retained).toHaveLength(ALERT_TERMINAL_RETENTION_LIMIT);
    expect(retained[0].id).toBe('triggered-0');
    expect(retained.at(-1)?.id).toBe(`triggered-${ALERT_TERMINAL_RETENTION_LIMIT - 1}`);
  });
});
