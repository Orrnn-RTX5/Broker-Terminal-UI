/**
 * The app-store key a symbol's quote is stored under: the single resolution rule
 * behind resolveTickFromLookup (store/useAppStore.ts) and the SL/TP feed-activity
 * stamp (store/quoteFeedActivity.ts). Both must agree on the key, so the rule
 * lives here and nowhere else.
 *
 * Exact match first (normalized, then raw). Otherwise the tick lookup is used only
 * when it names the same contract (normalized lookup key or tick symbol equals the
 * requested symbol). No base-symbol fallback: XAUUSD never resolves to XAUUSD.RAW.
 */
const normalizeKey = (symbol: string | undefined | null): string => String(symbol || '').trim().toUpperCase();

export const resolveTickStoreKey = (
  ticks: Record<string, { symbol?: string } | undefined>,
  tickLookup: Record<string, string>,
  symbol: string,
): string | undefined => {
  const rawSymbol = symbol || '';
  const normalizedSymbol = normalizeKey(rawSymbol);
  if (!normalizedSymbol) return undefined;

  if (ticks[normalizedSymbol]) return normalizedSymbol;
  if (ticks[rawSymbol]) return rawSymbol;

  const lookupKey = tickLookup[normalizedSymbol];
  const lookupTick = lookupKey ? ticks[lookupKey] : undefined;
  if (!lookupTick || !lookupKey) return undefined;
  return normalizeKey(lookupKey) === normalizedSymbol
    || normalizeKey(lookupTick.symbol) === normalizedSymbol
    ? lookupKey
    : undefined;
};
