import { useAppStore } from '../store/useAppStore';
import {
  EMPTY_SPREAD_MARKUP_MAP,
  applySpreadMarkupFromMap,
  areSpreadMarkupMapsEqual,
  normalizeSpreadMarkupSymbol,
  type SpreadMarkupEntry,
  type SpreadMarkupMap,
  type SpreadMarkupQuoteTag,
} from '../utils/spreadMarkup';
import { onSessionChange } from './brokerSession';

/**
 * Owner of the logged-in account's per-symbol spread markup. The map is set
 * from the authenticated instrument catalogue and is cleared whenever the
 * account/session ownership changes, so it never applies to guest mode or to
 * another account.
 */

type Listener = () => void;

let activeOwner: string | null = null;
let activeMap: SpreadMarkupMap = EMPTY_SPREAD_MARKUP_MAP;
const listeners = new Set<Listener>();

const notify = (): void => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('[AccountSpreadMarkup] listener failed:', error);
    }
  });
};

const commit = (owner: string | null, map: SpreadMarkupMap): void => {
  const changed = !areSpreadMarkupMapsEqual(activeMap, map);
  activeOwner = map.size > 0 ? owner : null;
  activeMap = map.size > 0 ? map : EMPTY_SPREAD_MARKUP_MAP;
  if (changed) notify();
};

const isCurrentAuthenticatedOwner = (owner: string): boolean => {
  const state = useAppStore.getState?.();
  return Boolean(owner && state?.isAuthenticated && state.accountId === owner);
};

/** Publish the markup of `accountId`'s catalogue. Ignored for a stale owner. */
export const setAccountSpreadMarkups = (accountId: string, map: SpreadMarkupMap): void => {
  if (!isCurrentAuthenticatedOwner(accountId)) return;
  commit(accountId, map);
};

export const clearAccountSpreadMarkups = (): void => {
  commit(null, EMPTY_SPREAD_MARKUP_MAP);
};

export const getAccountSpreadMarkupMap = (): SpreadMarkupMap => activeMap;

export const getAccountSpreadMarkup = (symbol: unknown): SpreadMarkupEntry | undefined =>
  activeMap.size > 0 ? activeMap.get(normalizeSpreadMarkupSymbol(symbol)) : undefined;

/**
 * Widen a raw account quote once. Without markup (guests) a raw quote passes
 * through untouched and a previously widened one is restored to its raw sides.
 */
export const applyAccountSpreadMarkup = <T extends { bid?: unknown; ask?: unknown; spread?: unknown } & SpreadMarkupQuoteTag>(
  symbol: unknown,
  quote: T,
): T => {
  if (
    activeMap.size === 0
    && (!quote || (quote.rawBid === undefined && quote.rawAsk === undefined && quote.spreadMarkup === undefined))
  ) {
    return quote;
  }
  return applySpreadMarkupFromMap(symbol, quote, activeMap);
};

export const onAccountSpreadMarkupChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test-only reset. */
export const resetAccountSpreadMarkupForTests = (): void => {
  activeOwner = null;
  activeMap = EMPTY_SPREAD_MARKUP_MAP;
};

// Ownership boundaries: logout, account switch, or a broker/session change.
if (typeof useAppStore?.subscribe === 'function') {
  useAppStore.subscribe((state, previous) => {
    if (activeMap.size === 0) return;
    if (
      !state.isAuthenticated
      || state.accountId !== previous.accountId
      || state.accountId !== activeOwner
    ) {
      clearAccountSpreadMarkups();
    }
  });
}

onSessionChange((reason) => {
  if (reason !== 'token_rotation') clearAccountSpreadMarkups();
});
