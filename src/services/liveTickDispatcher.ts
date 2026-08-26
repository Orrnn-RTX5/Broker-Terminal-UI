import { useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { useMarketDataStore, type Tick as MarketTick } from '../store/useMarketDataStore';
import {
  areCanonicalUpstreamTicksEqual,
  compareCanonicalTickFreshness,
  upsertFreshestTick,
} from '../utils/liveTickSemantics';

export type LiveTick = MarketTick & Partial<AppTick>;

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

const normalizeFreezeKey = (symbol: unknown): string => (
  String(symbol ?? '')
    .trim()
    .split('.')[0]
    .replace(/[^a-zA-Z0-9]/g, '')
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
  const fullTick = { ...tick, symbol };
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
  
  if (typeof window !== 'undefined' && window.rtxTickCache) {
    window.rtxTickCache.set(symbol, fullTick);
    // Cache by uppercase and normalized keys for robust fuzzy lookup matching
    const normKey = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    window.rtxTickCache.set(normKey, fullTick);
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

/** Test-only reset for module-level frame and retry ownership. */
export const resetLiveTickDispatcherForTests = (): void => {
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

