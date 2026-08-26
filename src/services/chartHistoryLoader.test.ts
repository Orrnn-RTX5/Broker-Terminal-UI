import { describe, expect, it, vi } from 'vitest';
import type { FetchCandlesOptions, OHLCData } from './chartDataService';
import {
  createSelectedTimeframeHistoryCoordinator,
  createChartHistoryBackfillDiagnostics,
  fetchOlderHistoryPage,
  getHistoryPageSize,
  getInitialHistoryCount,
  getNextOlderHistoryCursor,
  markHistoryBackfillPageLoaded,
  markHistoryBackfillStarted,
  markHistoryBackfillStopped,
  resolveDeferredVisibleRangeHistoryAction,
  resolveVisibleRangeHistoryAction,
  selectOlderCandlesBeforeCursor,
} from './chartHistoryLoader';
import { mergeBackendCandlePage } from '../utils/candleHistory';

const candle = (time: number): OHLCData => ({
  time,
  open: time,
  high: time + 1,
  low: time - 1,
  close: time,
  volume: 1,
});

describe('chart history loader', () => {
  it('starts exactly one request for the selected timeframe and schedules no delayed fetches', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createSelectedTimeframeHistoryCoordinator();
      const fetchCandles = vi.fn(async () => [candle(60)]);
      const request = coordinator.start({
        symbol: 'XAUUSD',
        timeframe: 'M5',
        count: 500,
      }, fetchCandles);

      await request.result;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(fetchCandles).toHaveBeenCalledTimes(1);
      expect(fetchCandles).toHaveBeenCalledWith({
        symbol: 'XAUUSD',
        timeframe: 'M5',
        count: 500,
        signal: request.signal,
      });
      expect(request.isCurrent()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the previous timeframe request and makes the switched request current', () => {
    const coordinator = createSelectedTimeframeHistoryCoordinator();
    const fetchCandles = vi.fn(async () => []);
    const first = coordinator.start(
      { symbol: 'XAUUSD', timeframe: 'M1', count: 5000 },
      fetchCandles,
    );
    const second = coordinator.start(
      { symbol: 'XAUUSD', timeframe: 'H1', count: 500 },
      fetchCandles,
    );

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(second.fetchOptions.timeframe).toBe('H1');
    expect(coordinator.getActiveSignal()).toBe(second.signal);
    expect(fetchCandles).toHaveBeenCalledTimes(2);
  });

  it('aborts the active request on unmount cleanup', () => {
    const coordinator = createSelectedTimeframeHistoryCoordinator();
    const request = coordinator.start(
      { symbol: 'XAUUSD', timeframe: 'M1', count: 5000 },
      async () => [],
    );

    coordinator.abort();

    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
    expect(coordinator.getActiveSignal()).toBeUndefined();
  });

  it('rejects a stale reset result after a selection switch', async () => {
    const coordinator = createSelectedTimeframeHistoryCoordinator();
    let resolveReset!: (candles: OHLCData[]) => void;
    const resetResult = new Promise<OHLCData[]>(resolve => {
      resolveReset = resolve;
    });
    const resetRequest = coordinator.start(
      { symbol: 'XAUUSD', timeframe: 'M5', count: 500 },
      () => resetResult,
    );

    const switchedRequest = coordinator.start(
      { symbol: 'EURUSD', timeframe: 'H1', count: 500 },
      async () => [candle(3600)],
    );
    resolveReset([candle(300)]);
    await resetRequest.result;

    expect(resetRequest.signal.aborted).toBe(true);
    expect(resetRequest.isCurrent()).toBe(false);
    expect(switchedRequest.isCurrent()).toBe(true);
  });

  it('loads at the visible left edge, defers during interaction, and ignores suppressed ranges', () => {
    expect(resolveVisibleRangeHistoryAction({
      logicalFrom: 49,
      suppressed: false,
      interactionActive: false,
      userInitiated: true,
    })).toBe('load');
    expect(resolveVisibleRangeHistoryAction({
      logicalFrom: 49,
      suppressed: false,
      interactionActive: true,
      userInitiated: true,
    })).toBe('defer');
    expect(resolveVisibleRangeHistoryAction({
      logicalFrom: 49,
      suppressed: true,
      interactionActive: false,
      userInitiated: true,
    })).toBe('none');
    expect(resolveVisibleRangeHistoryAction({
      logicalFrom: 50,
      suppressed: false,
      interactionActive: false,
      userInitiated: true,
    })).toBe('none');

    expect(resolveVisibleRangeHistoryAction({
      logicalFrom: 10,
      suppressed: false,
      interactionActive: false,
      userInitiated: false,
    })).toBe('none');
  });

  it('flushes one deferred left-edge request only when the edge is still eligible', () => {
    const duringDrag = resolveVisibleRangeHistoryAction({
      logicalFrom: 20,
      suppressed: false,
      interactionActive: true,
      userInitiated: true,
    });
    expect(duringDrag).toBe('defer');

    expect(resolveDeferredVisibleRangeHistoryAction({
      pending: duringDrag === 'defer',
      logicalFrom: 20,
      suppressed: false,
      userInitiated: true,
    })).toBe('load');
    expect(resolveDeferredVisibleRangeHistoryAction({
      pending: false,
      logicalFrom: 20,
      suppressed: false,
      userInitiated: true,
    })).toBe('none');
    expect(resolveDeferredVisibleRangeHistoryAction({
      pending: true,
      logicalFrom: 80,
      suppressed: false,
      userInitiated: true,
    })).toBe('none');
    expect(resolveDeferredVisibleRangeHistoryAction({
      pending: true,
      logicalFrom: 20,
      suppressed: true,
      userInitiated: true,
    })).toBe('none');
  });

  it('uses 5000-row older pages for M1 and M5 while preserving default initial counts', () => {
    expect(getHistoryPageSize('M1')).toBe(5000);
    expect(getHistoryPageSize('M5')).toBe(5000);
    expect(getInitialHistoryCount('M1', 500)).toBe(5000);
    expect(getInitialHistoryCount('M5', 500)).toBe(500);
    expect(getHistoryPageSize('H1')).toBe(3000);
    expect(getInitialHistoryCount('H1', 500)).toBe(500);
  });

  it('fetches older pages with a Unix-second to cursor and returns ascending candles', async () => {
    const fetchCandles = vi.fn(async () => [
      candle(180),
      candle(60),
      candle(120),
    ]);

    const result = await fetchOlderHistoryPage({
      symbol: 'GBPUSD',
      timeframe: 'M1',
      olderThanRaw: 240,
      fetchCandles,
    });

    expect(fetchCandles).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'GBPUSD',
      timeframe: 'M1',
      count: 5000,
      to: 239,
    }));
    expect(result.candles.map(item => item.time)).toEqual([60, 120, 180]);
    expect(result.source).toBe('backend');
    expect(result.usedDerivedFallback).toBe(false);
  });

  it('keeps native higher-timeframe older candles when the backend returns them', async () => {
    const fetchCandles = vi.fn(async () => [
      candle(3600),
    ]);

    const result = await fetchOlderHistoryPage({
      symbol: 'XAUUSD',
      timeframe: 'H1',
      olderThanRaw: 7200,
      fetchCandles,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(fetchCandles).toHaveBeenCalledWith(expect.objectContaining({
      timeframe: 'H1',
      to: 7199,
    }));
    expect(result.candles.map(item => item.time)).toEqual([3600]);
    expect(result.source).toBe('backend');
    expect(result.usedDerivedFallback).toBe(false);
  });

  it('derives higher-timeframe older candles from M1 when the native backend page is empty', async () => {
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      if (options.timeframe === 'H1') return [];
      return Array.from({ length: 60 }, (_, index) => candle(3600 + index * 60))
        .sort((left, right) => right.time - left.time);
    });

    const result = await fetchOlderHistoryPage({
      symbol: 'GBPUSD',
      timeframe: 'H1',
      olderThanRaw: 7200,
      fetchCandles,
    });

    expect(fetchCandles).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'GBPUSD',
      timeframe: 'H1',
      to: 7199,
    }));
    expect(fetchCandles).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'GBPUSD',
      timeframe: 'M1',
      count: 5000,
      to: 7199,
    }));
    expect(result.source).toBe('derived-m1');
    expect(result.usedDerivedFallback).toBe(true);
    expect(result.candles.map(item => item.time)).toEqual([3600]);
  });

  it('returns empty history only after native and M1 fallback pages are empty', async () => {
    const fetchCandles = vi.fn(async () => []);

    const result = await fetchOlderHistoryPage({
      symbol: 'US30',
      timeframe: 'H1',
      olderThanRaw: 7200,
      fetchCandles,
    });

    expect(fetchCandles).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'US30',
      timeframe: 'H1',
      to: 7199,
    }));
    expect(fetchCandles).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'US30',
      timeframe: 'M1',
      count: 5000,
      to: 7199,
    }));
    expect(result.candles).toEqual([]);
    expect(result.source).toBe('backend');
    expect(result.usedDerivedFallback).toBe(false);
  });

  it('passes the idle-yield callback to derived M1 fallback pages', async () => {
    const mayStart = 1777593600;
    const juneStart = 1780272000;
    const candles = Array.from({ length: 44_640 }, (_, index) => candle(mayStart + index * 60));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      if (options.timeframe === 'MN') return [];

      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 5000;
      return candles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });
    const yieldBetweenPages = vi.fn(async () => undefined);

    const result = await fetchOlderHistoryPage({
      symbol: 'GBPUSD',
      timeframe: 'MN',
      olderThanRaw: juneStart,
      fetchCandles,
      yieldBetweenPages,
    });

    expect(result.source).toBe('derived-m1');
    expect(result.candles.map(item => item.time)).toEqual([mayStart]);
    expect(yieldBetweenPages).toHaveBeenCalled();
  });

  it('paginates a full MyProp-style May M1 month in 9 backend pages', async () => {
    const mayStart = 1777593600;
    const mayEnd = 1780271940;
    const candles = Array.from({ length: 44_640 }, (_, index) => candle(mayStart + index * 60));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const from = options.from ?? 0;
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 5000;
      return candles
        .filter(item => item.time >= from && item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });

    let merged: OHLCData[] = [];
    let cursor = mayEnd + 60;
    let pages = 0;

    while (true) {
      const page = await fetchOlderHistoryPage({
        symbol: 'GBPUSD',
        timeframe: 'M1',
        olderThanRaw: cursor,
        fetchCandles,
      });
      const olderCandles = selectOlderCandlesBeforeCursor(page.candles, cursor);
      if (olderCandles.length === 0) break;

      const mergeResult = mergeBackendCandlePage(merged, olderCandles);
      merged = mergeResult.candles;
      pages += 1;

      const nextCursor = getNextOlderHistoryCursor(olderCandles);
      if (nextCursor === null || nextCursor >= cursor) break;
      cursor = nextCursor;
    }

    expect(pages).toBe(9);
    expect(merged).toHaveLength(44_640);
    expect(merged[0].time).toBe(mayStart);
    expect(merged[merged.length - 1].time).toBe(mayEnd);
  });

  it('tracks backfill diagnostics through loaded pages and beginning of history', () => {
    let diagnostics = createChartHistoryBackfillDiagnostics(300);

    diagnostics = markHistoryBackfillStarted(diagnostics, 300);
    diagnostics = markHistoryBackfillPageLoaded(diagnostics, 5000, 120);
    diagnostics = markHistoryBackfillPageLoaded(diagnostics, 4000, 60);
    diagnostics = markHistoryBackfillStopped(diagnostics, 'empty-page', true);

    expect(diagnostics).toEqual({
      loadingOlder: false,
      pagesLoaded: 2,
      candlesLoaded: 9000,
      oldestTime: 60,
      hasReachedBeginning: true,
      lastError: null,
      lastStopReason: 'empty-page',
    });
  });

  it('does not start a stale fetch when the request signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchCandles = vi.fn();

    const result = await fetchOlderHistoryPage({
      symbol: 'XAUUSD',
      timeframe: 'M1',
      olderThanRaw: 1780272000,
      signal: controller.signal,
      fetchCandles,
    });

    expect(fetchCandles).not.toHaveBeenCalled();
    expect(result.candles).toEqual([]);
    expect(result.attempts).toBe(0);
  });
});
