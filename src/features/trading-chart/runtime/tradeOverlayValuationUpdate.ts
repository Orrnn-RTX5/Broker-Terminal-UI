import type { Position } from '../../../store/useAppStore';

// Only these scalar valuations may wait for the next presentation frame. Every
// other changed/added/removed field takes the synchronous lifecycle path.
const valuationKeys = new Set([
  'currentPrice', 'current_price', 'price_current', 'priceCurrent', 'price',
  'unrealizedPnL', 'unrealized_pl', 'profit', 'swap', 'commission',
  'hasBackendProfit', 'hasBackendCurrentPrice', 'pnl_available',
  'state_version', 'state_version_text', 'price_time_msc', 'time_update',
]);

export function isTradeOverlayValuationUpdate(next: readonly Position[], previous: readonly Position[]): boolean {
  if (next.length !== previous.length) return false;
  for (let i = 0; i < next.length; i++) {
    const row = next[i], old = previous[i];
    if (!row || !old || typeof row !== 'object' || typeof old !== 'object') return false;
    if (row === old) continue;
    const a = row as unknown as Record<string | symbol, unknown>;
    const b = old as unknown as Record<string | symbol, unknown>;
    const keys = new Set([...Reflect.ownKeys(a), ...Reflect.ownKeys(b)]);
    for (const key of keys) {
      if (Object.is(a[key], b[key]) && Object.hasOwn(a, key) === Object.hasOwn(b, key)) continue;
      if (typeof key !== 'string' || !valuationKeys.has(key)) return false;
      // Unexpected nested payloads are not ordinary valuation evidence.
      if ([a[key], b[key]].some(value => value !== null
        && !['undefined', 'number', 'string', 'boolean'].includes(typeof value))) return false;
    }
  }
  return true;
}
