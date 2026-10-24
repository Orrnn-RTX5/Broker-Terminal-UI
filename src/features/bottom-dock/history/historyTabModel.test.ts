import { describe, expect, it } from 'vitest';
import type { Trade } from '../../../store/useAppStore';
import {
  DEFAULT_HISTORY_COLUMNS,
  HISTORY_COLUMN_DEFS,
  resolveHistoryRowStatus,
} from './historyTabModel';

const makeTrade = (status?: string): Trade => ({
  id: 1,
  symbol: 'EURUSD',
  type: 'buy_limit',
  side: 'BUY',
  volume: 0.1,
  openPrice: 1.08,
  closePrice: 1.08,
  openTime: '2026-10-24T00:00:00Z',
  profit: 0,
  commission: 0,
  swap: 0,
  status,
});

describe('historyTabModel', () => {
  it('enables the status column by default and exposes it in HISTORY_COLUMN_DEFS', () => {
    expect(DEFAULT_HISTORY_COLUMNS.status).toBe(true);
    expect(HISTORY_COLUMN_DEFS.some((col) => col.key === 'status' && col.label === 'Status')).toBe(true);
  });

  it('normalizes order and deal statuses into canonical history status values', () => {
    expect(resolveHistoryRowStatus(makeTrade('triggered'))).toBe('FILLED');
    expect(resolveHistoryRowStatus(makeTrade('filled'))).toBe('FILLED');
    expect(resolveHistoryRowStatus(makeTrade('closed'))).toBe('FILLED');
    expect(resolveHistoryRowStatus(makeTrade(undefined))).toBe('FILLED');
    expect(resolveHistoryRowStatus(makeTrade('cancelled'))).toBe('CANCELLED');
    expect(resolveHistoryRowStatus(makeTrade('canceled'))).toBe('CANCELLED');
    expect(resolveHistoryRowStatus(makeTrade('expired'))).toBe('EXPIRED');
    expect(resolveHistoryRowStatus(makeTrade('rejected'))).toBe('REJECTED');
    expect(resolveHistoryRowStatus(makeTrade('pending'))).toBe('PENDING');
  });
});
