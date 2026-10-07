import { onCommittedBrokerAccountSessionScopeChange, onSessionChange } from './brokerSession';
import { quoteDiagnosticsEnabled, quoteDiagnosticSymbolSelected } from './quoteDiagnostics';

type Row = { id?: unknown; symbol?: unknown; state_version_text?: unknown; state_version?: unknown; price_time_msc?: unknown; price_current?: unknown; current_price?: unknown; currentPrice?: unknown; profit?: unknown; unrealized_pl?: unknown; unrealizedPnL?: unknown };
export type PositionDeliveryEvidence = Readonly<{
  positionDeliveryId: number;
  positionSessionGeneration: number;
  ingestMonoMs: number;
  symbol: string;
}>;
let generation = 1;
let delivery = 0;
let evidence = new WeakMap<object, PositionDeliveryEvidence>();
let committed = new WeakSet<PositionDeliveryEvidence>();
const pending = new Set<{ before: readonly Row[]; apply: (rows: readonly Row[]) => void }>();
const reset = () => { generation++; evidence = new WeakMap(); committed = new WeakSet(); pending.clear(); };
onCommittedBrokerAccountSessionScopeChange(reset);
onSessionChange(reset);

export const positionDiagnosticGeneration = (): number => generation;
// Any changed retained property is conservatively a new snapshot. Volume,
// entry/type/contract/currency and availability flags can change display P/L
// without changing backend price/profit/version. Never reuse a previous WS ID
// merely because a small financial tuple compares equal.
const same = (a: Row, b: Row) => {
  const normalized = (row: Row) => {
    const value = row as Record<string, unknown>;
    return { ...value,
      state_version_text: value.state_version_text ?? value.state_version,
      price_sl: value.price_sl ?? value.sl,
      price_tp: value.price_tp ?? value.tp,
      hasBackendCurrentPrice: value.hasBackendCurrentPrice !== false,
      pnl_available: value.pnl_available !== false,
    } as Record<string, unknown>;
  };
  const left = normalized(a), right = normalized(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  // Store merging may materialize optional properties as undefined. That is
  // not a new value; every actual field value still participates.
  return [...keys].every(key => Object.is(left[key], right[key]));
};

/** Called inside the store's final accepted-state update, before subscribers run.
 * No incoming packet, ticket or account identifier becomes public metadata. */
export function rememberRetainedPositionDeliveries(before: readonly Row[], after: readonly Row[]): void {
  if (!quoteDiagnosticsEnabled()) return;
  try {
    const previous = new Map(before.map(row => [row.id, row]));
    for (const row of after) {
      const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
      if (!symbol || !quoteDiagnosticSymbolSelected(symbol)) continue;
      const old = previous.get(row.id);
      const retained = old && same(old, row) ? readPositionDeliveryEvidence(old) : undefined;
      // Unchanged state first encountered after enabling diagnostics has no
      // observed delivery. Do not manufacture one from an unrelated render.
      if (old && same(old, row)) {
        if (retained) evidence.set(row, retained);
        continue;
      }
      evidence.set(row, Object.freeze({ positionDeliveryId: ++delivery, positionSessionGeneration: generation, ingestMonoMs: performance.now(), symbol }));
    }
    for (const observer of [...pending]) {
      if (observer.before !== before) continue;
      pending.delete(observer);
      observer.apply(after);
    }
  } catch { /* Evidence cannot change financial state. */ }
}

/** Capture this exact store transition before reentrant subscribers can replace
 * it. The owning stream call disposes this one-shot in finally, including skips. */
export function observePositionDeliveryCommit(before: readonly Row[], apply: (rows: readonly Row[]) => void): () => void {
  if (!quoteDiagnosticsEnabled() || pending.size >= 16) return () => undefined;
  const observer = { before, apply };
  pending.add(observer);
  return () => { pending.delete(observer); };
}

export function readPositionDeliveryEvidence(row: object): PositionDeliveryEvidence | undefined {
  if (!quoteDiagnosticsEnabled()) return undefined;
  const value = evidence.get(row);
  return value?.positionSessionGeneration === generation ? value : undefined;
}

export function markPositionDeliveryCommitted(value: PositionDeliveryEvidence): boolean {
  const first = !committed.has(value);
  committed.add(value);
  return first;
}

/** Explicitly called only by the retained-row normalization/display path. */
export function copyPositionDeliveryEvidence<T extends object>(source: object, target: T): T {
  const value = readPositionDeliveryEvidence(source);
  if (value) evidence.set(target, value);
  return target;
}
