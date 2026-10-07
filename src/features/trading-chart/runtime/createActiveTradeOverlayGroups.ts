import type { RefObject } from 'react';
import type { ActiveTradeSnapshot, OverlayNodeData, TradeLevelOverride, TradeLevelRole } from './tradeRuntimeContracts';

export type ActiveTradeOverlayGroupPlan = { key: string; signature: string; create: () => void };
type Group = { signature: string; nodes: HTMLElement[]; data: OverlayNodeData[]; updaters: Array<() => void> };

export function createActiveTradeOverlayRenderPlans(options: {
  sortedTrades: readonly ActiveTradeSnapshot[];
  liveKeys: ReadonlyMap<string, ActiveTradeSnapshot>;
  retainedKeys: ReadonlySet<string>;
  presentationSignature: string;
  resolveLevels: (trade: ActiveTradeSnapshot) => TradeLevelOverride;
  nextOffset: (role: TradeLevelRole, price: number) => number;
}) {
  return options.sortedTrades.map(trade => {
    const isLiveActiveTrade = options.liveKeys.has(trade.key);
    const isVisuallyRetainedTrade = options.retainedKeys.has(trade.key);
    const showTradeControls = isLiveActiveTrade || isVisuallyRetainedTrade;
    const levels = showTradeControls ? options.resolveLevels(trade) : { sl: 0, tp: 0 };
    const entryStackIndex = options.nextOffset('ENTRY', trade.entryPrice);
    const slStackIndex = levels.sl > 0 ? options.nextOffset('SL', levels.sl) : 0;
    const tpStackIndex = levels.tp > 0 ? options.nextOffset('TP', levels.tp) : 0;
    const signature = JSON.stringify([
      options.presentationSignature, trade.key, trade.symbol, trade.side, trade.volume,
      trade.entryPrice, trade.entryTime, trade.entryExecutionTime, levels.sl, levels.tp,
      isLiveActiveTrade, isVisuallyRetainedTrade,
      showTradeControls ? 0 : entryStackIndex,
      showTradeControls ? 0 : slStackIndex,
      showTradeControls ? 0 : tpStackIndex,
    ]);
    return { trade, levels, isLiveActiveTrade, isVisuallyRetainedTrade, showTradeControls,
      entryStackIndex, slStackIndex, tpStackIndex, signature };
  });
}

/** Own complete DOM creation slices, including nodes without a tradeKey attribute. */
export function createActiveTradeOverlayGroups(options: {
  nodes: RefObject<HTMLElement[]>;
  data: RefObject<OverlayNodeData[]>;
  updaters: RefObject<Array<() => void>>;
}) {
  const groups = new Map<string, Group>();
  let disposed = false;
  let publishedNodes = options.nodes.current;
  let publishedData = options.data.current;
  let publishedUpdaters = options.updaters.current;
  const rememberPublication = () => {
    publishedNodes = options.nodes.current;
    publishedData = options.data.current;
    publishedUpdaters = options.updaters.current;
  };
  const detach = (group: Group) => { for (const node of group.nodes) node.remove(); };
  const publish = (ordered: readonly Group[]) => {
    options.nodes.current = ordered.flatMap(group => group.nodes);
    options.data.current = ordered.flatMap(group => group.data);
    options.updaters.current = ordered.flatMap(group => group.updaters);
    rememberPublication();
  };
  const orderOwnedNodes = (nodes: readonly HTMLElement[]) => {
    const owned = new Set<Node>(nodes);
    const parents = new Map<Node, HTMLElement[]>();
    for (const node of nodes) {
      const parent = node.parentNode;
      if (!parent) continue;
      const list = parents.get(parent) ?? [];
      list.push(node);
      parents.set(parent, list);
    }
    for (const [parent, ordered] of parents) {
      let anchor: HTMLElement | null = null;
      for (let index = ordered.length - 1; index >= 0; index--) {
        const node = ordered[index];
        let next: ChildNode | null = node.nextSibling;
        // History/canvas/unrelated controls retain their own ownership/order.
        while (next && !owned.has(next)) next = next.nextSibling;
        if (next !== anchor) parent.insertBefore(node, anchor);
        anchor = node;
      }
    }
  };
  return {
    reconcile(plans: readonly ActiveTradeOverlayGroupPlan[], force = false) {
      if (disposed) return;
      if (new Set(plans.map(plan => plan.key)).size !== plans.length) throw new Error('Duplicate active overlay group key');
      const externalReset = options.nodes.current !== publishedNodes || options.data.current !== publishedData
        || options.updaters.current !== publishedUpdaters;
      const signatures = new Map(plans.map(plan => [plan.key, plan.signature]));
      for (const [key, group] of groups) {
        if (force || externalReset || signatures.get(key) !== group.signature || group.nodes.some(node => !node.isConnected)) {
          detach(group);
          groups.delete(key);
        }
      }
      publish(plans.flatMap(plan => {
        const group = groups.get(plan.key);
        return group ? [group] : [];
      }));
      try {
        for (const plan of plans) {
          if (groups.has(plan.key)) continue;
          const nodeStart = options.nodes.current.length;
          const dataStart = options.data.current.length;
          const updaterStart = options.updaters.current.length;
          try {
            plan.create();
            const group: Group = {
              signature: plan.signature,
              nodes: options.nodes.current.slice(nodeStart),
              data: options.data.current.slice(dataStart),
              updaters: options.updaters.current.slice(updaterStart),
            };
            if (group.nodes.length !== group.data.length) throw new Error('Active overlay node metadata mismatch');
            groups.set(plan.key, group);
          } catch (error) {
            options.nodes.current.slice(nodeStart).forEach(node => node.remove());
            options.nodes.current.length = nodeStart;
            options.data.current.length = dataStart;
            options.updaters.current.length = updaterStart;
            throw error;
          }
        }
        const ordered = plans.map(plan => groups.get(plan.key)!);
        orderOwnedNodes(ordered.flatMap(group => group.nodes));
        publish(ordered);
      } finally { rememberPublication(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      groups.forEach(detach);
      groups.clear();
      // Late old-owner disposal must not replace a new owner's published refs.
      if (options.nodes.current === publishedNodes) options.nodes.current = [];
      if (options.data.current === publishedData) options.data.current = [];
      if (options.updaters.current === publishedUpdaters) options.updaters.current = [];
    },
  };
}
