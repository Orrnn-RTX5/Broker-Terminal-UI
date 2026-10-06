import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryTradeOverlayGroups, createHistoryTradeOverlayRenderPlans } from './createHistoryTradeOverlayGroups';
import type { ClosedTradeSnapshot, OverlayNodeData } from './tradeRuntimeContracts';

const trade: ClosedTradeSnapshot = { key: 'trade:1', symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  entryPrice: 100, entryTime: 1000, entryExecutionTime: 1001, exitPrice: 110, exitTime: 1060,
  exitExecutionTime: 1062, profit: 0.1, source: 'app-history' };
const presentation = { presentationSignature: 'account/context/theme/digits/version', showLines: true,
  showArrows: true, lineOpacity: 0.5, resolveLineColor: (item: ClosedTradeSnapshot) => (item.profit ?? 0) >= 0 ? 'green' : 'red' };
const descriptors = (trades = [trade], overrides: Partial<typeof presentation> = {}) =>
  createHistoryTradeOverlayRenderPlans({ trades, ...presentation, ...overrides });

afterEach(() => document.body.replaceChildren());

describe('closed history capture fingerprints', () => {
  it.each([
    { symbol: 'ETHUSD' }, { side: 'SELL' as const }, { volume: 0.02 }, { entryPrice: 100.0000001 },
    { exitPrice: 110.0000001 }, { entryTime: 999 }, { exitTime: 1080 }, { entryExecutionTime: 1002 },
    { exitExecutionTime: 1063 }, { profit: -1 }, { source: 'mt5-history' as const },
  ])('invalidates corrected snapshot values %j', delta => {
    expect(descriptors([{ ...trade, ...delta }])[0].signature).not.toBe(descriptors()[0].signature);
  });

  it('includes actual resolved color, theme/context and history display settings', () => {
    const original = descriptors()[0].signature;
    for (const change of [{ presentationSignature: 'new-context' }, { showLines: false }, { showArrows: false },
      { lineOpacity: 0.6 }, { resolveLineColor: () => 'blue' }]) {
      expect(descriptors([trade], change)[0].signature).not.toBe(original);
    }
    expect(descriptors([trade], { showLines: false, showArrows: false })).toEqual([]);
    expect(descriptors([{ ...trade, side: 'SELL' }])[0].exitSide).toBe('BUY');
  });

  it('preserves the model order rather than sorting optimistic and authoritative history independently', () => {
    const trades = [{ ...trade, key: 'trade:9' }, { ...trade, key: 'trade:2' }, trade];
    expect(descriptors(trades).map(plan => plan.trade.key)).toEqual(['trade:9', 'trade:2', 'trade:1']);
  });
});

describe('closed history DOM ownership', () => {
  function fixture() {
    const overlay = document.createElement('div'), interactions = document.createElement('div');
    document.body.append(overlay, interactions);
    const nodes = { current: [] as HTMLElement[] }, data = { current: [] as OverlayNodeData[] };
    const groups = createHistoryTradeOverlayGroups({ nodes, data });
    const create = vi.fn((item: ClosedTradeSnapshot) => {
      for (let index = 0; index < 5; index++) {
        const node = document.createElement('div'); node.dataset.key = item.key;
        (index < 3 ? overlay : interactions).append(node);
        nodes.current.push(node); data.current.push({ kind: index === 0 ? 'segment' : 'marker', price: item.exitPrice });
      }
    });
    const render = (trades: ClosedTradeSnapshot[], force = false, overrides: Partial<typeof presentation> = {}) => {
      groups.reconcile(descriptors(trades, overrides).map(plan => ({ key: plan.trade.key, signature: plan.signature,
        create: () => create(plan.trade) })), force);
    };
    return { groups, nodes, data, create, render };
  }

  it('retains 500 histories through one pending, corrected confirmation and failed removal', () => {
    const f = fixture();
    const history = Array.from({ length: 500 }, (_, index) => ({ ...trade, key: `trade:${index + 1}` }));
    f.render(history);
    const original = [...f.nodes.current];
    const pending = { ...trade, key: 'trade:501' };
    f.render([...history, pending]);
    const pendingNodes = f.nodes.current.slice(original.length);
    expect(f.create).toHaveBeenCalledTimes(501);
    f.render([...history, { ...pending, exitPrice: 111, exitExecutionTime: 1064, source: 'mt5-history' }]);
    expect(f.create).toHaveBeenCalledTimes(502);
    expect(f.nodes.current.slice(0, original.length)).toEqual(original);
    expect(pendingNodes.every(node => !node.isConnected)).toBe(true);
    f.render(history); // Failed optimistic close or authoritative deletion.
    expect(f.nodes.current).toEqual(original); expect(f.data.current).toHaveLength(2500);
    expect(f.create).toHaveBeenCalledTimes(502);
    f.groups.dispose(); expect(original.every(node => !node.isConnected)).toBe(true);
  });

  it('keeps identical close observations but honors explicit full force and external layer reset', () => {
    const f = fixture(); f.render([trade]); const original = f.nodes.current[0];
    f.render([{ ...trade }]); expect(f.create).toHaveBeenCalledTimes(1);
    f.render([trade], true); expect(f.create).toHaveBeenCalledTimes(2); expect(original.isConnected).toBe(false);
    f.nodes.current.forEach(node => node.remove()); f.nodes.current = []; f.data.current = [];
    f.render([trade]); expect(f.create).toHaveBeenCalledTimes(3); expect(f.nodes.current).toHaveLength(5);
  });

  it('removes settings-hidden groups and rejects stale disposal/reconciliation after replacement ownership', () => {
    const f = fixture(); f.render([trade]);
    f.render([trade], false, { showLines: false, showArrows: false }); expect(f.nodes.current).toHaveLength(0);
    f.render([trade]); const replacementNodes: HTMLElement[] = [], replacementData: OverlayNodeData[] = [];
    f.nodes.current = replacementNodes; f.data.current = replacementData;
    f.groups.dispose(); f.groups.dispose(); f.render([trade]);
    expect(f.nodes.current).toBe(replacementNodes); expect(f.data.current).toBe(replacementData);
  });
});
