import type { IChartApi } from 'lightweight-charts';
import { getInitialHistoryCount as getChartInitialHistoryCount } from '../../../services/chartHistoryLoader';
import {
  applyBrokerTimeOffsetToCandles,
  mergeBackendCandlePage,
} from '../../../utils/candleHistory';
import type { Candle, Timeframe } from '../../../types/chart';

export const TARGET_BAR_PX = 25;
export const MIN_ADAPTIVE_BARS = 30;
export const MAX_ADAPTIVE_BARS = 200;
export const INITIAL_HISTORY_COUNT = 500;
export const HISTORY_RENDER_IDLE_TIMEOUT_MS = 700;
export const HISTORY_BACKFILL_IDLE_YIELD_TIMEOUT_MS = 120;
export const HISTORY_IDLE_FALLBACK_DELAY_MS = 32;
export const HISTORY_RENDER_INTERACTION_IDLE_MS = 180;
export const HISTORY_VISIBLE_RANGE_SUPPRESSION_MS = 120;
export const REALTIME_SCROLL_THRESHOLD_BARS = 2;
export const LIVE_CHART_UPDATE_INTERVAL_MS = 50;

interface BrowserIdleDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

type BrowserIdleCallback = (deadline: BrowserIdleDeadline) => void;
export type BrowserIdleCallbackHandle = number;

type BrowserWithIdleCallback = Window & typeof globalThis & {
  requestIdleCallback?: (
    callback: BrowserIdleCallback,
    options?: { timeout?: number },
  ) => BrowserIdleCallbackHandle;
  cancelIdleCallback?: (handle: BrowserIdleCallbackHandle) => void;
};

export const requestBrowserIdleCallback = (
  callback: BrowserIdleCallback,
  timeoutMs: number,
): BrowserIdleCallbackHandle => {
  if (typeof window === 'undefined') {
    callback({ didTimeout: true, timeRemaining: () => 0 });
    return 0;
  }

  const browserWindow = window as BrowserWithIdleCallback;
  if (browserWindow.requestIdleCallback) {
    return browserWindow.requestIdleCallback(callback, { timeout: timeoutMs });
  }

  return window.setTimeout(() => {
    callback({ didTimeout: true, timeRemaining: () => 0 });
  }, Math.min(timeoutMs, HISTORY_IDLE_FALLBACK_DELAY_MS));
};

export const cancelBrowserIdleCallback = (handle: BrowserIdleCallbackHandle): void => {
  if (typeof window === 'undefined' || handle === 0) return;

  const browserWindow = window as BrowserWithIdleCallback;
  if (browserWindow.cancelIdleCallback) {
    browserWindow.cancelIdleCallback(handle);
    return;
  }

  window.clearTimeout(handle);
};

export const waitForProgressiveHistoryIdleTurn = (signal: AbortSignal): Promise<void> => (
  new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let settled = false;
    let handle: BrowserIdleCallbackHandle | null = null;
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      if (handle !== null) cancelBrowserIdleCallback(handle);
      resolve();
    };

    handle = requestBrowserIdleCallback(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, HISTORY_BACKFILL_IDLE_YIELD_TIMEOUT_MS);

    if (!settled) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }
  })
);

export const isAbortError = (error: unknown): boolean => (
  typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError'
) || (
  error instanceof Error && error.name === 'AbortError'
);

export const getInitialHistoryCount = (timeframe: Timeframe): number => (
  getChartInitialHistoryCount(timeframe, INITIAL_HISTORY_COUNT)
);

export const shouldBuildVolumeData = (settings: {
  showTickVolumes: boolean;
  showRealVolumes: boolean;
}): boolean => settings.showTickVolumes || settings.showRealVolumes;

export const computeAdaptiveVisibleBars = (
  container: HTMLElement | null,
  chart: IChartApi | null,
  totalBars: number,
  minBarsFloor: number,
): number => {
  const containerWidth = container?.offsetWidth || 1400;
  const axisWidth = chart?.priceScale('right').width() || 60;
  const chartWidth = Math.max(200, containerWidth - axisWidth);
  const adaptive = Math.floor(chartWidth / TARGET_BAR_PX);
  const floor = Math.max(MIN_ADAPTIVE_BARS, minBarsFloor);
  if (totalBars <= 0) return 0;
  return Math.max(floor, Math.min(MAX_ADAPTIVE_BARS, adaptive));
};

export const mergeCandleCollections = (...collections: Array<readonly Candle[]>): Candle[] => (
  collections.reduce<Candle[]>(
    (merged, collection) => mergeBackendCandlePage(merged, collection).candles,
    [],
  )
);

export const applyBrokerTimeOffset = (
  candles: Candle[],
  offsetSeconds: number,
): Candle[] => applyBrokerTimeOffsetToCandles(candles, offsetSeconds);

export const shouldScrollToRealtime = (
  chart: IChartApi | null,
  autoScrollEnabled: boolean,
  chartAutoScroll: boolean,
): boolean => {
  if (!chart || !autoScrollEnabled || !chartAutoScroll) return false;
  const scrollPosition = chart.timeScale().scrollPosition();
  return Number.isFinite(scrollPosition)
    && scrollPosition >= 0
    && scrollPosition <= REALTIME_SCROLL_THRESHOLD_BARS;
};
