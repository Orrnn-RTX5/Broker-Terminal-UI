import { useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { useMarketDataStore, type Tick as MarketTick } from '../store/useMarketDataStore';

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

export const enqueueLiveTick = (symbol: string, tick: LiveTick): void => {
  if (!symbol) return;
  if (isLiveMarketDataFrozen(symbol)) return;
  const fullTick = { ...tick, symbol };
  pendingTicks.set(symbol, fullTick);
  
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
  if (pendingTicks.size === 0) return;

  const ticks = Array.from(pendingTicks.entries());
  pendingTicks.clear();

  const marketStore = useMarketDataStore.getState();
  const appStore = useAppStore.getState();

  ticks.forEach(([symbol, tick]) => {
    if (isLiveMarketDataFrozen(symbol)) return;
    marketStore.updateTick(symbol, tick, { syncAppStore: false });
    appStore.setTick(symbol, tick as AppTick);
  });
};

