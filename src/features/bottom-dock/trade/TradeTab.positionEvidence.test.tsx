import { act, cleanup, render } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TradeTab } from './TradeTab';
import { useAppStore } from '../../../store/useAppStore';
import { normalizePosition, reconcilePositionStreamBatch } from '../../../services/positionStream';
import { replaceToolboxPositions } from '../../../hooks/toolboxTradePositions';
import { beginPositionDiagnostics } from '../../../app/trading/positionDiagnostics';
import { getQuoteDiagnosticDump } from '../../../services/quoteDiagnostics';
import { emitSessionChange } from '../../../services/brokerSession';

vi.mock('../../../hooks/useUiTranslation', () => ({ useUiTranslation: () => (s: string, v?: Record<string, unknown>) => String(s ?? '').replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(v?.[key] ?? '')) }));
const props = { account: null, onClosePosition: vi.fn(), onModifyPosition: vi.fn(), formatMoney: (v: number | null | undefined) => String(v ?? '-'), loading: false, error: null };
let first = 0;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
const advanceFrame = () => { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach(callback => callback(performance.now()))); };
const events = () => getQuoteDiagnosticDump().controls.filter(e => typeof e.sequence === 'number' && e.sequence > first && e.kind === 'position');
function MountedTrade() {
  const positions = useAppStore(s => s.positions);
  const normalized = useMemo(() => replaceToolboxPositions([], positions), [positions]);
  return <TradeTab {...props} positions={normalized} />;
}
beforeEach(() => {
  frames = new Map();
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
  localStorage.clear();
  useAppStore.setState({ positions: [], accountId: '123', authToken: 'fixture-only' });
  first = Number(getQuoteDiagnosticDump().controls.at(-1)?.sequence ?? 0);
});
afterEach(() => { cleanup(); delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; vi.restoreAllMocks(); });

it('joins the actual retained backend row to mounted sub-cent display without equating their profit values', () => {
  const view = render(<MountedTrade />);
  const raw = { ticket: 997, symbol: 'BTCUSD', volume: 0.01, side: 'buy', price_open: 83574.78, price_current: 83559.53, profit: -0.15, state_version: '9007199254740993', price_time_msc: '1800000000123' };
  act(() => {
    const before = useAppStore.getState().positions;
    const applied = beginPositionDiagnostics([raw], before, performance.now());
    useAppStore.getState().setPositions(reconcilePositionStreamBatch(before, { mode: 'delta', positions: [raw] }).positions);
    applied?.(useAppStore.getState().positions);
  });
  const applied = events().find(e => e.phase === 'position-applied');
  expect(applied?.backendProfit).toBe(-0.15);
  expect(view.container.querySelector('td[title^="Profit: "]')?.textContent).toBe('-0.1525');
  const dom = events().find(e => e.phase === 'position-dom-commit');
  expect(dom).toBeDefined();
  expect(dom?.positionDeliveryId).toBe(applied?.positionDeliveryId);
  expect(dom?.positionSessionGeneration).toBe(applied?.positionSessionGeneration);
  expect(dom?.displayedProfit).toBeCloseTo(-0.1525, 8);
  expect(dom?.displayedPrice).toBe(83559.53);
  advanceFrame(); advanceFrame();
  expect(events().find(e => e.phase === 'position-render-opportunity')?.positionDeliveryId).toBe(applied?.positionDeliveryId);
  expect(useAppStore.getState().positions[0].profit).toBe(-0.15);
  expect(normalizePosition(raw).profit).toBe(-0.15);
});

const put = (price: number, time: string) => act(() => useAppStore.getState().setPositions([normalizePosition({ ticket: 997, symbol: 'BTCUSD', volume: 0.01, side: 'buy', price_open: 100, price_current: price, profit: (price - 100) * .01, state_version: '1', price_time_msc: time })]));

it('cancels a superseded row frame and never supplies a WS receipt for REST-only rows', () => {
  render(<MountedTrade />);
  put(101, '1800000000000');
  const a = events().find(e => e.phase === 'position-dom-commit');
  advanceFrame();
  put(102, '1800000000001');
  const b = events().filter(e => e.phase === 'position-dom-commit').at(-1);
  expect(b?.positionDeliveryId).not.toBe(a?.positionDeliveryId);
  advanceFrame(); advanceFrame();
  const frames = events().filter(e => e.phase === 'position-render-opportunity');
  expect(frames.map(e => e.positionDeliveryId)).toEqual([b?.positionDeliveryId]);
  expect(frames[0].receiptMonoMs).toBeUndefined();
  expect(events().filter(e => e.phase === 'position-applied')).toEqual([]);
});

it('does not emit a frame for a closed/unmounted or old-session row', () => {
  const view = render(<MountedTrade />);
  put(101, '1800000000000');
  advanceFrame();
  act(() => emitSessionChange('token_rotation'));
  advanceFrame();
  expect(events().filter(e => e.phase === 'position-render-opportunity')).toEqual([]);
  put(102, '1800000000001');
  advanceFrame();
  view.unmount();
  advanceFrame();
  expect(events().filter(e => e.phase === 'position-render-opportunity')).toEqual([]);
});

it('cancels the frame when the actual trade row closes and labels remount as a redraw', () => {
  let view = render(<MountedTrade />);
  put(101, '1800000000000');
  const initial = events().find(e => e.phase === 'position-dom-commit');
  expect(initial?.reason).toBe('first-retained-commit');
  view.unmount();
  view = render(<MountedTrade />);
  const redraw = events().filter(e => e.phase === 'position-dom-commit').at(-1);
  expect(redraw?.positionDeliveryId).toBe(initial?.positionDeliveryId);
  expect(redraw?.reason).toBe('retained-row-redraw');
  advanceFrame();
  act(() => useAppStore.getState().setPositions([], { removedTickets: [997] }));
  expect(view.container.querySelector('.rtx-trade-row')).toBeNull();
  advanceFrame();
  expect(events().filter(e => e.phase === 'position-render-opportunity')).toEqual([]);
});

it('keeps exact repeats out of new DOM evidence without forcing rendering for metadata', () => {
  render(<MountedTrade />);
  put(101, '1800000000000');
  const before = events().filter(e => e.phase === 'position-dom-commit');
  put(101, '1800000000000');
  expect(events().filter(e => e.phase === 'position-dom-commit')).toEqual(before);
});

it('does not alter displayed values or add DOM metadata when capture is disabled', () => {
  window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = false;
  const view = render(<MountedTrade />);
  put(101, '1800000000000');
  expect(view.container.querySelector('.rtx-trade-row')?.hasAttribute('data-position-delivery')).toBe(false);
  expect(view.container.querySelector('td[title^="Profit: "]')?.textContent).toBe('0.0100');
  advanceFrame(); advanceFrame();
  expect(events()).toEqual([]);
});

it('identifies two real committed same-symbol rows without exporting private row keys', () => {
  const view = render(<MountedTrade />);
  put(101, '1800000000000');
  act(() => {
    const current = useAppStore.getState().positions[0];
    const second = { ...current, id: 998, ticket: 998 };
    useAppStore.getState().setPositions([current, second]);
  });
  const nodes = [...view.container.querySelectorAll<HTMLTableRowElement>('.rtx-trade-row')];
  expect(nodes).toHaveLength(2);
  expect(new Set(nodes.map(node => node.dataset.positionDelivery)).size).toBe(2);
  const commits = events().filter(e => e.phase === 'position-dom-commit');
  expect(new Set(commits.map(e => e.positionDeliveryId)).size).toBe(2);
  expect(JSON.stringify(commits)).not.toMatch(/ticket|account_login|fixture-only/);
});

