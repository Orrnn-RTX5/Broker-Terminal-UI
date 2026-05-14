import { useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { useMarketDataStore, type Tick as MarketTick } from '../store/useMarketDataStore';

export type LiveTick = MarketTick & Partial<AppTick>;

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
  pendingTicks.set(symbol, { ...tick, symbol });
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
