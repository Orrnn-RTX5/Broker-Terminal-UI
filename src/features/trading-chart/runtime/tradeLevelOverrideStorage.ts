import {
  TRADE_LEVEL_OVERRIDES_STORAGE_KEY,
  TRADE_LEVEL_OVERRIDE_TTL_MS,
} from '../presentation/tradeOverlayPresentation';
import type { TradeLevelOverride } from './tradeRuntimeContracts';

/** Read only ticket-owned cache entries; the older alias-based cache is unsafe. */
export const readStoredTradeLevelOverrides = (
  storage: Pick<Storage, 'getItem'>,
  now = Date.now(),
): Map<string, TradeLevelOverride> => {
  const levels = new Map<string, TradeLevelOverride>();
  try {
    const raw = storage.getItem(TRADE_LEVEL_OVERRIDES_STORAGE_KEY);
    if (!raw) return levels;
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return levels;
    for (const row of rows) {
      const key = typeof row?.key === 'string' ? row.key : '';
      const savedAt = Number(row?.savedAt ?? 0);
      if (!key.startsWith('trade:') || !Number.isFinite(savedAt) || now - savedAt > TRADE_LEVEL_OVERRIDE_TTL_MS) continue;
      const sl = Number(row?.sl) || 0;
      const tp = Number(row?.tp) || 0;
      if (sl > 0 || tp > 0) levels.set(key, { sl, tp });
    }
  } catch {
    // Optimistic UI state is optional; malformed or unavailable storage is ignored.
  }
  return levels;
};
