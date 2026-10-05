import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginPositionDiagnostics } from './positionDiagnostics';
import { getQuoteDiagnosticDump } from '../../services/quoteDiagnostics';
import { normalizePosition, reconcilePositionStreamBatch } from '../../services/positionStream';

const original = () => normalizePosition({ ticket: 991, symbol: 'BTCUSD', volume: 0.01, side: 'buy', price_open: 100, price_current: 101, profit: 1, price_time_msc: '1800000000000', state_version: '9007199254740993' });
let start = 0;
const clearQuoteDiagnostics = () => { start = getQuoteDiagnosticDump().controls.length; };
const records = () => getQuoteDiagnosticDump().controls.slice(start).filter(row => row.kind === 'position');

describe('position timing evidence', () => {
  beforeEach(() => { clearQuoteDiagnostics(); window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true; });
  afterEach(() => { delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; clearQuoteDiagnostics(); });

  it('is inert when disabled and never mutates position data', () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = false;
    const before = [Object.freeze(original())], rows = [Object.freeze({ ticket: 991, price_current: 102 })];
    expect(beginPositionDiagnostics(rows, before, 10)).toBeUndefined();
    expect(records()).toEqual([]);
    expect(before[0].currentPrice).toBe(101);
  });

  it('preserves exact versions and source time while omitting account/ticket identity', () => {
    const before = [original()];
    const raw = { ticket: 991, account_login: 123456, broker_id: 'broker', token: 'private', update_kind: 'pnl', state_version: '9007199254740993', price_time_msc: '1800000000123', price_current: 102, profit: 2 };
    const applied = beginPositionDiagnostics([raw], before, 10);
    const result = reconcilePositionStreamBatch(before, { mode: 'delta', positions: [raw] });
    applied?.(result.positions);
    expect(records()).toHaveLength(2);
    expect(records()[0]).toMatchObject({ phase: 'position-received', receiptMonoMs: 10, symbol: 'BTCUSD', positionVersion: '9007199254740993', sourcePriceTimeMs: '1800000000123', backendPrice: 102, backendProfit: 2 });
    expect(records()[1]).toMatchObject({ phase: 'position-applied', accepted: true, positionVersion: '9007199254740993', sourcePriceTimeMs: '1800000000123', backendPrice: 102, backendProfit: 2, positionCount: 1 });
    expect(JSON.stringify(records())).not.toMatch(/ticket|account_login|123456|private|token|broker_id/);
    expect(records()[1].ingestMonoMs).toBeGreaterThanOrEqual(records()[0].ingestMonoMs as number);
  });

  it.each([
    { name: 'older state version', state_version: '9007199254740992', price_time_msc: '1800000000123' },
    { name: 'newer unconfirmed P&L version', state_version: '9007199254740994', price_time_msc: '1800000000123' },
    { name: 'older price time', state_version: '9007199254740993', price_time_msc: '1799999999999' },
  ])('does not label $name as applied', (test) => {
    const before = [original()], raw = { ticket: 991, update_kind: 'pnl', ...test, price_current: 102, profit: 2 };
    const applied = beginPositionDiagnostics([raw], before, 10);
    const result = reconcilePositionStreamBatch(before, { mode: 'delta', positions: [raw] });
    applied?.(result.positions);
    expect(records().map(row => row.phase)).toEqual(['position-received']);
    expect(result.positions[0].currentPrice).toBe(101);
  });

  it('does not report an exact duplicate or unknown price-only row as newly applied', () => {
    const before = [original()];
    const raw = { ticket: 991, update_kind: 'pnl', state_version: '9007199254740993', price_time_msc: '1800000000000', price_current: 101, profit: 1 };
    const applied = beginPositionDiagnostics([raw], before, 10);
    applied?.(reconcilePositionStreamBatch(before, { mode: 'delta', positions: [raw] }).positions);
    expect(records().map(row => row.phase)).toEqual(['position-received']);
    clearQuoteDiagnostics();
    const unknown = { ...raw, ticket: 992, symbol: 'BTCUSD' };
    beginPositionDiagnostics([unknown], before, 10)?.(reconcilePositionStreamBatch(before, { mode: 'delta', positions: [unknown] }).positions);
    expect(records().map(row => row.phase)).toEqual(['position-received']);
  });

  it('only correlates the final retained price when one batch repeats a position', () => {
    const before = [original()];
    const base = { ticket: 991, update_kind: 'pnl', state_version: '9007199254740993', price_time_msc: '1800000000123' };
    const rows = [{ ...base, price_current: 102, profit: 2 }, { ...base, price_current: 103, profit: 3 }];
    const applied = beginPositionDiagnostics(rows, before, 10);
    applied?.(reconcilePositionStreamBatch(before, { mode: 'delta', positions: rows }).positions);
    const accepted = records().filter(row => row.phase === 'position-applied');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ backendPrice: 103, backendProfit: 3 });
  });
});
