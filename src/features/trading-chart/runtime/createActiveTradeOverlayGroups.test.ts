import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActiveTradeOverlayGroups, createActiveTradeOverlayRenderPlans } from './createActiveTradeOverlayGroups';
import type { ActiveTradeSnapshot, OverlayNodeData } from './tradeRuntimeContracts';

function fixture() {
  const host = document.createElement('div');
  const overlay = document.createElement('div');
  host.append(overlay);
  document.body.append(host);
  const refs = { nodes: { current: [] as HTMLElement[] }, data: { current: [] as OverlayNodeData[] },
    updaters: { current: [] as Array<() => void> } };
  const groups = createActiveTradeOverlayGroups(refs);
  const creators = new Map<string, ReturnType<typeof vi.fn>>();
  const plan = (key: string, signature = key, updater = () => {}) => {
    const create = vi.fn(() => {
      for (const parent of [host, overlay]) {
        const node = document.createElement('button');
        node.dataset.owner = key;
        parent.append(node);
        refs.nodes.current.push(node);
        refs.data.current.push({ kind: 'price-badge', price: Number(key) });
      }
      refs.updaters.current.push(updater);
    });
    creators.set(key, create);
    return { key, signature, create };
  };
  return { host, overlay, refs, groups, plan, creators };
}

afterEach(() => document.body.replaceChildren());

describe('active overlay group ownership', () => {
  it('creates 50 appended groups once, retaining complete node and updater slices', () => {
    const f = fixture();
    const plans = Array.from({ length: 50 }, (_, index) => f.plan(String(index)));
    f.groups.reconcile(plans.slice(0, 1));
    const original = [...f.refs.nodes.current];
    for (let count = 2; count <= 50; count++) f.groups.reconcile(plans.slice(0, count));
    expect(plans.reduce((sum, plan) => sum + plan.create.mock.calls.length, 0)).toBe(50);
    expect(f.refs.nodes.current.slice(0, 2)).toEqual(original);
    expect(f.refs.nodes.current).toHaveLength(100);
    expect(f.refs.data.current).toHaveLength(100);
    expect(f.refs.updaters.current).toHaveLength(50);
    f.refs.nodes.current.forEach((node, index) => expect(Number(node.dataset.owner)).toBe(f.refs.data.current[index].price));
    const survivors = f.refs.nodes.current.filter(node => Number(node.dataset.owner) % 2 === 1);
    f.groups.reconcile(plans.filter((_, index) => index % 2 === 1));
    expect(f.refs.nodes.current).toEqual(survivors);
    expect(f.refs.updaters.current).toHaveLength(25);
    f.groups.reconcile(plans);
    expect(survivors.every(node => f.refs.nodes.current.includes(node))).toBe(true);
    expect(plans.reduce((sum, plan) => sum + plan.create.mock.calls.length, 0)).toBe(75);
    expect(f.refs.updaters.current).toHaveLength(50);
  });

  it('replaces only changed captures, removes all parents, and retains live updater ownership', () => {
    const f = fixture();
    let live = 1;
    const observed: number[] = [];
    const a = f.plan('1', 'original', () => observed.push(live));
    const b = f.plan('2');
    f.groups.reconcile([a, b]);
    const aNodes = f.refs.nodes.current.slice(0, 2);
    const bNodes = f.refs.nodes.current.slice(2);
    live = 9;
    f.groups.reconcile([a, b]);
    f.refs.updaters.current[0]();
    expect(observed).toEqual([9]);
    f.groups.reconcile([f.plan('1', 'changed'), b]);
    expect(aNodes.every(node => !node.isConnected)).toBe(true);
    expect(f.refs.nodes.current.slice(2)).toEqual(bNodes);
    expect(b.create).toHaveBeenCalledTimes(1);
    f.groups.reconcile([b]);
    expect(f.refs.nodes.current).toEqual(bNodes);
    expect(f.refs.updaters.current).toHaveLength(1);
  });

  it('inserts and reorders groups across hosts without moving unrelated nodes relative to each other', () => {
    const f = fixture();
    const history = document.createElement('div'), canvas = document.createElement('canvas');
    f.host.append(history, canvas);
    const a = f.plan('1'), b = f.plan('2'), c = f.plan('3');
    f.groups.reconcile([a, c]);
    f.groups.reconcile([a, b, c]);
    f.groups.reconcile([c, a, b]);
    for (const parent of [f.host, f.overlay]) {
      expect([...parent.children].filter(node => node.hasAttribute('data-owner')).map(node => (node as HTMLElement).dataset.owner))
        .toEqual(['3', '1', '2']);
    }
    expect([...f.host.children].filter(node => node === history || node === canvas)).toEqual([history, canvas]);
    for (const plan of [a, b, c]) expect(plan.create).toHaveBeenCalledTimes(1);
  });

  it('rebuilds after explicit layer clear or detached nodes even with unchanged signatures', () => {
    const f = fixture(), a = f.plan('1');
    f.groups.reconcile([a]);
    const old = [...f.refs.nodes.current];
    old.forEach(node => node.remove());
    f.refs.nodes.current = []; f.refs.data.current = []; f.refs.updaters.current = [];
    f.groups.reconcile([a]);
    expect(a.create).toHaveBeenCalledTimes(2);
    expect(f.refs.nodes.current.every(node => node.isConnected && !old.includes(node))).toBe(true);
    f.refs.nodes.current[0].remove();
    f.groups.reconcile([a]);
    expect(a.create).toHaveBeenCalledTimes(3);
    expect(f.refs.nodes.current).toHaveLength(2);
  });

  it('force rebuilds and empty settings dispose without touching replacement owner arrays', () => {
    const f = fixture(), a = f.plan('1');
    f.groups.reconcile([a]);
    const initial = [...f.refs.nodes.current];
    f.groups.reconcile([a], true);
    expect(a.create).toHaveBeenCalledTimes(2);
    expect(initial.every(node => !node.isConnected)).toBe(true);
    f.groups.reconcile([]);
    expect(f.refs.updaters.current).toEqual([]);
    f.groups.reconcile([a]);
    const replacement = fixture();
    replacement.groups.reconcile([replacement.plan('9')]);
    f.refs.nodes.current = replacement.refs.nodes.current;
    f.refs.data.current = replacement.refs.data.current;
    f.refs.updaters.current = replacement.refs.updaters.current;
    f.groups.dispose(); f.groups.dispose();
    f.groups.reconcile([a]);
    expect(f.refs.nodes.current).toBe(replacement.refs.nodes.current);
    expect(replacement.refs.nodes.current.every(node => node.isConnected)).toBe(true);
  });

  it('rejects duplicate identities before mutation and recovers partial creation without leaks', () => {
    const f = fixture(), a = f.plan('1'), b = f.plan('2');
    expect(() => f.groups.reconcile([a, a])).toThrow('Duplicate');
    expect(a.create).not.toHaveBeenCalled();
    let fail = true;
    const unstable = { ...b, create: () => { b.create(); if (fail) throw new Error('creation failure'); } };
    expect(() => f.groups.reconcile([a, unstable])).toThrow('creation failure');
    expect(f.refs.nodes.current).toHaveLength(2);
    expect(f.refs.data.current).toHaveLength(2);
    expect(f.refs.updaters.current).toHaveLength(1);
    expect(f.host.querySelectorAll('[data-owner="2"]')).toHaveLength(0);
    fail = false;
    f.groups.reconcile([a, unstable]);
    expect(a.create).toHaveBeenCalledTimes(1);
    expect(f.refs.nodes.current).toHaveLength(4);
  });
});

const trade: ActiveTradeSnapshot = { key: 'trade:1', symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  entryPrice: 100, entryTime: 1, entryExecutionTime: 2, currentPrice: 110, currentTime: 3 };
function descriptors(overrides: Partial<Parameters<typeof createActiveTradeOverlayRenderPlans>[0]> = {}) {
  return createActiveTradeOverlayRenderPlans({ sortedTrades: [trade], liveKeys: new Map([[trade.key, trade]]),
    retainedKeys: new Set(), presentationSignature: 'scope/theme/currency', resolveLevels: () => ({ sl: 90, tp: 120 }),
    nextOffset: () => 0, ...overrides });
}

describe('active group capture fingerprints', () => {
  it.each([
    { symbol: 'ETHUSD' }, { side: 'SELL' as const }, { volume: 0.02 }, { entryPrice: 100.0000001 },
    { entryTime: 4 }, { entryExecutionTime: 5 },
  ])('invalidates changed structural trade values %j', delta => {
    expect(descriptors({ sortedTrades: [{ ...trade, ...delta }] })[0].signature).not.toBe(descriptors()[0].signature);
  });

  it('invalidates levels, membership and context but permits current valuation updates', () => {
    const signature = descriptors()[0].signature;
    for (const levels of [{ sl: 91, tp: 120 }, { sl: 90, tp: 121 }]) {
      expect(descriptors({ resolveLevels: () => levels })[0].signature).not.toBe(signature);
    }
    expect(descriptors({ liveKeys: new Map(), retainedKeys: new Set([trade.key]) })[0].signature).not.toBe(signature);
    expect(descriptors({ presentationSignature: 'changed account/theme/currency' })[0].signature).not.toBe(signature);
    expect(descriptors({ sortedTrades: [{ ...trade, currentPrice: 130, currentTime: 9 }] })[0].signature).toBe(signature);
  });

  it('reserves every prior level for shared annotations without invalidating zero-offset live controls', () => {
    let index = 0;
    const nextOffset = vi.fn(() => index++);
    const second = { ...trade, key: 'trade:2', entryPrice: 101 };
    const result = descriptors({ sortedTrades: [trade, second], liveKeys: new Map([[trade.key, trade], [second.key, second]]), nextOffset });
    expect(nextOffset.mock.calls).toEqual([['ENTRY', 100], ['SL', 90], ['TP', 120], ['ENTRY', 101], ['SL', 90], ['TP', 120]]);
    expect(nextOffset()).toBe(6); // Shared annotation follows the entire active model.
    expect(result[0].signature).toBe(descriptors()[0].signature);
    expect(descriptors({ liveKeys: new Map(), nextOffset: () => 2 })[0].signature)
      .not.toBe(descriptors({ liveKeys: new Map(), nextOffset: () => 3 })[0].signature);
  });
});
