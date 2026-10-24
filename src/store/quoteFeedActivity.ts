/**
 * Quote feed activity: the local time a live feed message last proved that the
 * quote stored under a store key is still being published.
 *
 * Stamped by the dispatcher (services/liveTickDispatcher.ts ingestLiveTick) only
 * when a two-sided feed quote is accepted into the store, or is an identical
 * replay of the stored quote. Never for last-only, invalid, out-of-order,
 * frozen or markup re-apply messages, so a stale stored price cannot look fresh.
 *
 * Keyed by the EXACT store key string that the dispatcher writes into
 * `ticks[key]` and that the reader resolves (store/tickStoreKey.ts). Case-exact
 * (trimmed if non-empty, no `.toUpperCase()`) and no base-symbol alias: a push
 * for "xauusd" or "XAUUSD.RAW" never freshens the plain "XAUUSD" key.
 *
 * A key that was never stamped is not fresh (the server decides).
 */
const activityByStoreKey = new Map<string, number>();

const normalizeActivityKey = (storeKey: string): string => String(storeKey ?? '').trim();

export const markQuoteFeedActivity = (storeKey: string, nowMs: number): void => {
  const key = normalizeActivityKey(storeKey);
  if (key) activityByStoreKey.set(key, nowMs);
};

/** Last local time a live feed message proved this store key is alive, or undefined when never stamped. */
export const getQuoteFeedActivityMs = (storeKey: string): number | undefined => (
  activityByStoreKey.get(normalizeActivityKey(storeKey))
);

/** Forget every feed stamp (session reset, and test isolation). */
export const clearQuoteFeedActivity = (): void => {
  activityByStoreKey.clear();
};
