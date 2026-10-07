import { afterEach, beforeEach, expect, it } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { normalizePosition } from './positionStream';
import { copyPositionDeliveryEvidence, readPositionDeliveryEvidence } from './positionDeliveryEvidence';
import { commitBrokerAccountSessionScope, emitSessionChange } from './brokerSession';
import { replaceToolboxPositions } from '../hooks/toolboxTradePositions';
import { beginPositionDiagnostics } from '../app/trading/positionDiagnostics';
import { getQuoteDiagnosticDump } from './quoteDiagnostics';

const row = (id = 997, price = 101, time = '1800000000000') => normalizePosition({ ticket: id, symbol: 'BTCUSD', side: 'buy', volume: 0.01, price_open: 100, price_current: price, profit: 0.01, state_version: '9007199254740993', price_time_msc: time });
beforeEach(() => {
  window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
  emitSessionChange('account_change');
  useAppStore.setState({ positions: [] });
});
afterEach(() => { delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; delete window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__; });

it('associates final store objects before subscribers and keeps separate same-symbol positions', () => {
  const seen: unknown[] = [];
  const off = useAppStore.subscribe(s => { if (s.positions.length) seen.push(readPositionDeliveryEvidence(s.positions[0])); });
  useAppStore.getState().setPositions([row(), row(998)]);
  off();
  const [a, b] = useAppStore.getState().positions.map(readPositionDeliveryEvidence);
  expect(seen[0]).toBe(a);
  expect(a?.positionDeliveryId).toBeTypeOf('number');
  expect(b?.positionDeliveryId).not.toBe(a?.positionDeliveryId);
  expect(Object.keys(useAppStore.getState().positions[0])).not.toContain('positionDeliveryId');
});

it('preserves exact repeats and rejected versions through real merging and toolbox row retention', () => {
  useAppStore.getState().setPositions([row()]);
  const initial = useAppStore.getState().positions[0], first = readPositionDeliveryEvidence(initial);
  const display = replaceToolboxPositions([], [initial]);
  expect(readPositionDeliveryEvidence(display[0])).toBe(first);
  useAppStore.getState().setPositions([row()]);
  expect(readPositionDeliveryEvidence(useAppStore.getState().positions[0])).toBe(first);
  expect(replaceToolboxPositions(display, useAppStore.getState().positions)[0]).toBe(display[0]);
  useAppStore.getState().setPositions([{ ...row(997, 99), state_version: '9007199254740992', state_version_text: '9007199254740992' }]);
  expect(readPositionDeliveryEvidence(useAppStore.getState().positions[0])).toBe(first);
  useAppStore.getState().setPositions([row(997, 102, '1800000000123')]);
  const next = useAppStore.getState().positions[0];
  expect(readPositionDeliveryEvidence(next)?.positionDeliveryId).not.toBe(first?.positionDeliveryId);
  expect(readPositionDeliveryEvidence(initial)).toBe(first);
  expect(readPositionDeliveryEvidence(copyPositionDeliveryEvidence(next, { ...next }))).toBe(readPositionDeliveryEvidence(next));
});

it('REST-retained state has an ID but no fabricated WS received/applied receipt event', () => {
  const start = getQuoteDiagnosticDump().controls.at(-1)?.sequence ?? 0;
  useAppStore.getState().setPositions([row()]);
  expect(readPositionDeliveryEvidence(useAppStore.getState().positions[0])).toBeDefined();
  expect(getQuoteDiagnosticDump().controls.filter(e => e.sequence > start && e.phase === 'position-applied')).toEqual([]);
});

it('binds a WS callback to its exact first store commit before reentrant subscribers replace it', () => {
  const incoming = row(), before = useAppStore.getState().positions;
  const finish = beginPositionDiagnostics([incoming], before, performance.now());
  let firstId: number | undefined;
  let nested = false;
  const off = useAppStore.subscribe(s => {
    if (nested || !s.positions.length) return;
    nested = true;
    firstId = readPositionDeliveryEvidence(s.positions[0])?.positionDeliveryId;
    useAppStore.getState().setPositions([row(997, 102, '1800000000001')]);
  });
  useAppStore.getState().setPositions([incoming]);
  off();
  finish?.(useAppStore.getState().positions);
  finish?.dispose();
  const applied = getQuoteDiagnosticDump().controls.filter(e => e.phase === 'position-applied').at(-1);
  expect(applied?.positionDeliveryId).toBe(firstId);
  expect(applied?.backendPrice).toBe(101);
  expect(readPositionDeliveryEvidence(useAppStore.getState().positions[0])?.positionDeliveryId).not.toBe(firstId);
});

it.each([
  { volume: 0.02, volume_lots: 0.02, quantity: 0.02 }, { side: 'SELL' as const }, { openPrice: 99, open_price: 99, price_open: 99 },
  { contractSize: 100 }, { profit_currency: 'EUR' }, { hasBackendProfit: false },
])('never labels a changed REST snapshot as the preceding WS delivery: %j', (change) => {
  useAppStore.getState().setPositions([row()]);
  const initial = useAppStore.getState().positions[0];
  const previous = readPositionDeliveryEvidence(initial);
  useAppStore.getState().setPositions([{ ...initial, ...change }]);
  const next = useAppStore.getState().positions[0];
  expect(next).toMatchObject(change);
  expect(readPositionDeliveryEvidence(next)?.positionDeliveryId).not.toBe(previous?.positionDeliveryId);
});

it('fails closed for exact-ID receipt linkage when commit observer capacity is exhausted', () => {
  const before = useAppStore.getState().positions, incoming = row();
  const captures = Array.from({ length: 17 }, () => beginPositionDiagnostics([incoming], before, performance.now()));
  useAppStore.getState().setPositions([incoming]);
  captures[16]?.(useAppStore.getState().positions);
  expect(getQuoteDiagnosticDump().controls.filter(e => e.phase === 'position-applied').at(-1)?.positionDeliveryId).toBeUndefined();
  captures.forEach(capture => capture?.dispose());
});

it('invalidates old snapshots and in-flight capture on broker/account or auth rotation', () => {
  useAppStore.getState().setPositions([row()]);
  const old = useAppStore.getState().positions[0];
  const capture = beginPositionDiagnostics([row(997, 102)], [old], performance.now());
  const start = getQuoteDiagnosticDump().controls.at(-1)?.sequence ?? 0;
  emitSessionChange('token_rotation');
  useAppStore.getState().setPositions([row(997, 102)]);
  capture?.(useAppStore.getState().positions);
  expect(readPositionDeliveryEvidence(old)).toBeUndefined();
  expect(getQuoteDiagnosticDump().controls.filter(e => e.sequence > start && e.phase === 'position-applied')).toEqual([]);
  const next = useAppStore.getState().positions[0];
  commitBrokerAccountSessionScope({ authenticated: true, accountId: 999, brokerId: 'fixture-broker', serverUrl: 'https://fixture.invalid' });
  expect(readPositionDeliveryEvidence(next)).toBeUndefined();
});

it('is inert when disabled, selects configured symbols and never adds fields to frozen input', () => {
  window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = false;
  const input = Object.freeze(row());
  useAppStore.getState().setPositions([input]);
  expect(readPositionDeliveryEvidence(useAppStore.getState().positions[0])).toBeUndefined();
  window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
  window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__ = ['EURUSD'];
  useAppStore.getState().setPositions([row(997, 102)]);
  expect(readPositionDeliveryEvidence(useAppStore.getState().positions[0])).toBeUndefined();
  expect(Object.keys(input)).not.toContain('positionSessionGeneration');
});
