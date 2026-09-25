import { useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { useMarketDataStore, type Tick as MarketTick } from '../store/useMarketDataStore';
import {
  areCanonicalUpstreamTicksEqual,
  compareCanonicalTickFreshness,
  getCanonicalTickTimestamp,
  upsertFreshestTick,
} from '../utils/liveTickSemantics';
import { onSessionChange } from './brokerSession';
import { applyAccountSpreadMarkup, onAccountSpreadMarkupChange } from './accountSpreadMarkup';
import type { SpreadMarkupQuoteTag } from '../utils/spreadMarkup';
import {
  flushMarketWatchDailyChangeCache,
  rememberCurrentMarketWatchDailyChange,
} from './marketWatchDailyChangeCache';
import {
  flushMarketWatchQuoteCache,
  rememberCurrentMarketWatchQuote,
} from './marketWatchQuoteCache';

// A logged-in account's quote is widened by its group spread markup here, once;
// `rawBid`/`rawAsk` keep the feed sides for raw-bid consumers (chart candles).
export type LiveTick = MarketTick & Partial<AppTick> & SpreadMarkupQuoteTag;

declare global {
  interface Window {
    rtxTickCache: Map<string, LiveTick>;
  }
}

if (typeof window !== 'undefined') {
  if (!window.rtxTickCache) {
    window.rtxTickCache = new Map<string, LiveTick>();
  }
}

const pendingTicks = new Map<string, LiveTick>();
const frozenMarketDataSources = new Map<string, Map<string, string>>();
let rafId: number | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;

const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 2_000;

type TargetRetryState = {
  ticks: Map<string, LiveTick>;
  delayMs: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  due: boolean;
};

const createTargetRetryState = (): TargetRetryState => ({
  ticks: new Map<string, LiveTick>(),
  delayMs: INITIAL_RETRY_DELAY_MS,
  timeoutId: null,
  due: false,
});

const marketRetry = createTargetRetryState();
const appRetry = createTargetRetryState();

const clearDispatcherRuntime = (): void => {
  pendingTicks.clear();
  frozenMarketDataSources.clear();
  if (typeof window !== 'undefined' && rafId !== null && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(rafId);
  }
  if (timeoutId !== null) clearTimeout(timeoutId);
  rafId = null;
  timeoutId = null;
  resetRetry(marketRetry);
  resetRetry(appRetry);
};

const normalizeFreezeKey = (symbol: unknown): string => (
  String(symbol ?? '')
    .trim()
    .toUpperCase()
);

export const isLiveMarketDataFrozen = (symbol: unknown): boolean => {
  const key = normalizeFreezeKey(symbol);
  const sources = key ? frozenMarketDataSources.get(key) : undefined;
  return Boolean(sources && sources.size > 0);
};

export const setLiveMarketDataFrozen = (
  sourceId: string,
  symbol: string,
  frozen: boolean,
): void => {
  const key = normalizeFreezeKey(symbol);
  if (!sourceId || !key) return;

  if (!frozen) {
    const sources = frozenMarketDataSources.get(key);
    if (!sources) return;
    sources.delete(sourceId);
    if (sources.size === 0) {
      frozenMarketDataSources.delete(key);
    }
    return;
  }

  const sources = frozenMarketDataSources.get(key) ?? new Map<string, string>();
  sources.set(sourceId, symbol);
  frozenMarketDataSources.set(key, sources);
};

const scheduleFlush = () => {
  if (rafId !== null || timeoutId !== null) return;

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      flushLiveTicks();
    });
    return;
  }

  timeoutId = setTimeout(() => {
    timeoutId = null;
    flushLiveTicks();
  }, 16);
};

const hasRetryTicks = (): boolean => (
  marketRetry.ticks.size > 0 || appRetry.ticks.size > 0
);

const scheduleRetry = (retry: TargetRetryState) => {
  if (retry.ticks.size === 0 || retry.timeoutId !== null || retry.due) return;
  const delay = retry.delayMs;
  retry.delayMs = Math.min(MAX_RETRY_DELAY_MS, retry.delayMs * 2);
  retry.timeoutId = setTimeout(() => {
    retry.timeoutId = null;
    retry.due = true;
    scheduleFlush();
  }, delay);
};

const resetRetry = (retry: TargetRetryState) => {
  if (retry.timeoutId !== null) clearTimeout(retry.timeoutId);
  retry.ticks.clear();
  retry.delayMs = INITIAL_RETRY_DELAY_MS;
  retry.timeoutId = null;
  retry.due = false;
};

const mergeTickEntries = (
  target: Map<string, LiveTick>,
  entries: readonly (readonly [string, LiveTick])[],
) => {
  entries.forEach(([symbol, tick]) => {
    try {
      upsertFreshestTick(target, symbol, tick);
    } catch (error) {
      console.error(`[LiveTickDispatcher] Invalid tick for ${symbol}:`, error);
    }
  });
};

const takeDeliveryBatch = (
  retry: TargetRetryState,
  liveEntries: readonly (readonly [string, LiveTick])[],
): { ticks: Array<readonly [string, LiveTick]>; isRetry: boolean } => {
  if (retry.ticks.size === 0) {
    return {
      ticks: liveEntries.filter(([symbol]) => !isLiveMarketDataFrozen(symbol)),
      isRetry: false,
    };
  }

  // A target in backoff owns new live ticks until its own retry becomes due.
  mergeTickEntries(retry.ticks, liveEntries);
  if (!retry.due) return { ticks: [], isRetry: false };

  const ticks = Array.from(retry.ticks.entries())
    .filter(([symbol]) => !isLiveMarketDataFrozen(symbol));
  retry.ticks.clear();
  retry.due = false;
  return { ticks, isRetry: true };
};

const retainFailedBatch = (
  retry: TargetRetryState,
  entries: readonly (readonly [string, LiveTick])[],
) => {
  mergeTickEntries(retry.ticks, entries);
  retry.due = false;
  scheduleRetry(retry);
};

export const enqueueLiveTick = (symbol: string, tick: LiveTick): void => {
  if (!symbol) return;
  if (isLiveMarketDataFrozen(symbol)) return;
  // Every quote transport (quote socket, REST seed, catalogue seed, legacy WS,
  // FIX, guest refresh) enters here, so the account markup is applied exactly
  // once and every store consumer sees the same effective bid/ask. The widening
  // is recomputed from the raw sides, so a re-enqueued tick never compounds.
  const fullTick = applyAccountSpreadMarkup(symbol, { ...tick, symbol });
  const cachedTick = typeof window !== 'undefined' && window.rtxTickCache
    ? window.rtxTickCache.get(symbol)
    : undefined;
  if (cachedTick) {
    const freshness = compareCanonicalTickFreshness(cachedTick, fullTick);
    if (freshness < 0) return;
    if (freshness === 0 && areCanonicalUpstreamTicksEqual(cachedTick, fullTick)) return;
  }

  try {
    if (!upsertFreshestTick(pendingTicks, symbol, fullTick)) return;
  } catch (error) {
    console.error(`[LiveTickDispatcher] Invalid tick for ${symbol}:`, error);
    return;
  }

  const dailyChange = fullTick.dailyChange;
  const asOf = getCanonicalTickTimestamp(fullTick);
  if (typeof fullTick.sourceTimestamp === 'number' && Number.isFinite(fullTick.sourceTimestamp)) {
    try {
      // Keep recovery separate from live stores and preserve broker event time;
      // a receipt-time fallback cannot establish when a last quote was priced.
      rememberCurrentMarketWatchQuote(normalizeFreezeKey(symbol), {
        bid: fullTick.bid,
        ask: fullTick.ask,
        asOf: fullTick.sourceTimestamp,
      });
    } catch (error) {
      console.error('[LiveTickDispatcher] Last quote cache write failed:', error);
    }
  }
  if (typeof dailyChange === 'number' && Number.isFinite(dailyChange) && asOf !== null) {
    try {
      // Preserve the broker's exact symbol identity (including punctuation),
      // while making lookup casing deterministic across quote transports.
      rememberCurrentMarketWatchDailyChange(
        normalizeFreezeKey(symbol),
        dailyChange,
        asOf,
        'quote',
      );
    } catch (error) {
      // Persistence is display recovery only; it must never interrupt live delivery.
      console.error('[LiveTickDispatcher] Daily Change cache write failed:', error);
    }
  }
  
  if (typeof window !== 'undefined' && window.rtxTickCache) {
    window.rtxTickCache.set(symbol, fullTick);
    // FIX: Keep only exact broker identities. A punctuation-stripped alias can
    // collide (`0001.HK`/`0001HK`) and let a late tick overwrite another chart.
    window.rtxTickCache.set(symbol.toUpperCase(), fullTick);
  }
  
  scheduleFlush();
};

export const flushLiveTicks = (): void => {
  if (pendingTicks.size === 0 && !hasRetryTicks()) return;

  const ticks = Array.from(pendingTicks.entries()) as Array<readonly [string, LiveTick]>;
  pendingTicks.clear();

  const marketStore = useMarketDataStore.getState();
  const appStore = useAppStore.getState();

  const activeTicks = ticks.filter(([symbol]) => !isLiveMarketDataFrozen(symbol));
  const marketBatch = takeDeliveryBatch(marketRetry, activeTicks);
  const appBatch = takeDeliveryBatch(appRetry, activeTicks);

  if (marketBatch.ticks.length > 0) {
    try {
      marketStore.updateTicksBatch(marketBatch.ticks, { syncAppStore: false });
      if (marketBatch.isRetry) resetRetry(marketRetry);
    } catch (error) {
      console.error('[LiveTickDispatcher] Market store batch failed; retaining it for retry:', error);
      retainFailedBatch(marketRetry, marketBatch.ticks);
    }
  } else if (marketBatch.isRetry) {
    resetRetry(marketRetry);
  }

  if (appBatch.ticks.length > 0) {
    try {
      appStore.setTicksBatch(
        appBatch.ticks.map(([symbol, tick]) => [symbol, tick as AppTick] as const),
      );
      if (appBatch.isRetry) resetRetry(appRetry);
    } catch (error) {
      console.error('[LiveTickDispatcher] App store batch failed; retaining it for retry:', error);
      retainFailedBatch(appRetry, appBatch.ticks);
    }
  } else if (appBatch.isRetry) {
    resetRetry(appRetry);
  }

  scheduleRetry(marketRetry);
  scheduleRetry(appRetry);
};

/** Clear every quote owner at a broker/account ownership boundary. */
export const resetLiveMarketDataSession = (): void => {
  // FIX: Source timestamps are comparable only within one broker session. Old
  // queues/caches would otherwise reject or briefly repaint the new session.
  try {
    flushMarketWatchDailyChangeCache();
  } catch (error) {
    // A storage failure must not prevent the broker/account boundary reset.
    console.error('[LiveTickDispatcher] Daily Change cache flush failed:', error);
  }
  try {
    flushMarketWatchQuoteCache();
  } catch (error) {
    console.error('[LiveTickDispatcher] Last quote cache flush failed:', error);
  }
  clearDispatcherRuntime();
  if (typeof window !== 'undefined') window.rtxTickCache?.clear();
  useMarketDataStore.getState().clearAllData();
  useAppStore.getState().setTicks({});
};

/**
 * Re-publish every cached quote under the current account markup (a new
 * catalogue revision, or markup cleared at logout/account switch). Each tick is
 * rebuilt from its raw sides and delivered as a same-time correction.
 */
export const reapplyAccountSpreadMarkupToCachedTicks = (): void => {
  if (typeof window === 'undefined' || !window.rtxTickCache) return;
  const seen = new Set<LiveTick>();
  const cached: LiveTick[] = [];
  window.rtxTickCache.forEach((tick) => {
    if (!tick || seen.has(tick)) return;
    seen.add(tick);
    cached.push(tick);
  });
  cached.forEach((tick) => {
    if (tick.symbol) enqueueLiveTick(tick.symbol, tick);
  });
};

onAccountSpreadMarkupChange(reapplyAccountSpreadMarkupToCachedTicks);

/** Test-only reset for module-level frame and retry ownership. */
export const resetLiveTickDispatcherForTests = (): void => {
  clearDispatcherRuntime();
};

// Renewing credentials does not change the owner or event-time ordering of
// accepted quotes. Keep the display continuous while sockets reauthenticate.
onSessionChange((reason) => {
  if (reason !== 'token_rotation') resetLiveMarketDataSession();
});

