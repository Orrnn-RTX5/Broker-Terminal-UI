import { useAppStore } from '../store/useAppStore';
import { resolveTickStoreKey } from '../store/tickStoreKey';
import { getQuoteFeedActivityMs } from '../store/quoteFeedActivity';
import { readQuoteMaxAgeMs, resolveFreshValidationQuote } from '../utils/tradeLevelDrag';

/**
 * The quote used to validate SL/TP LOCALLY on every trade surface (chart drag,
 * level-bar remove, Modify Position, hedge order). It is the tick Market Watch
 * rows display: the app-store tick under the key that resolveTickStoreKey
 * resolves for the symbol (same rule as useTick). Not the position's backend
 * currentPrice, not the market-data copy.
 *
 * Freshness is the feed-activity stamp of THAT store key (quoteFeedActivity.ts),
 * stamped only by accepted two-sided feed quotes and identical replays. A key
 * that was never stamped, a two-sided quote with no stamp, a one-sided quote,
 * and a stamp older than QUOTE_MAX_AGE_MS all return null.
 *
 * Null means "not validated here": the caller sends the request and the server
 * decides (server-final). Nothing is refused locally on a null result.
 */
export const readTradeValidationQuote = (
  symbol: string,
  nowMs: number = Date.now(),
): { bid: number; ask: number } | null => {
  const state = useAppStore.getState();
  const ticks = state.ticks ?? {};
  const key = resolveTickStoreKey(ticks, state.tickLookup ?? {}, symbol);
  if (key === undefined) return null;
  return resolveFreshValidationQuote(ticks[key], nowMs, readQuoteMaxAgeMs(), getQuoteFeedActivityMs(key));
};
