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
let rafId: number | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;

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
    marketStore.updateTick(symbol, tick, { syncAppStore: false });
    appStore.setTick(symbol, tick as AppTick);
  });
};

