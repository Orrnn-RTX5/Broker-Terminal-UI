import { describe, expect, it, vi } from 'vitest';
import type { FetchCandlesOptions, OHLCData } from './chartDataService';
import {
  createChartHistoryBackfillDiagnostics,
  fetchOlderHistoryPage,
  getHistoryPageSize,
  getInitialHistoryCount,
  getNextOlderHistoryCursor,
  markHistoryBackfillPageLoaded,
  markHistoryBackfillStarted,
  markHistoryBackfillStopped,
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
