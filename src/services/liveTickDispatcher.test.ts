// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  aggregateSymbols: vi.fn(),
}));
const dailyChangeCacheMocks = vi.hoisted(() => ({
  flushMarketWatchDailyChangeCache: vi.fn(),
  rememberCurrentMarketWatchDailyChange: vi.fn(),
}));
const quoteCacheMocks = vi.hoisted(() => ({
  flushMarketWatchQuoteCache: vi.fn(),
  rememberCurrentMarketWatchQuote: vi.fn(),
}));
vi.mock('./aggregationWorkerManager', () => ({
  cancelPendingAggregations: vi.fn(),
  getWorkerManager: () => workerMocks,
}));
vi.mock('./marketWatchDailyChangeCache', () => dailyChangeCacheMocks);
vi.mock('./marketWatchQuoteCache', () => quoteCacheMocks);

import {
  enqueueLiveTick,
  flushLiveTicks,
  isLiveMarketDataFrozen,
  reapplyAccountSpreadMarkupToCachedTicks,
  resetLiveMarketDataSession,
  resetLiveTickDispatcherForTests,
  setLiveMarketDataFrozen,
  type LiveTick,
} from './liveTickDispatcher';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';
import { getMarketWatchDisplayMetadata, useMarketWatchDisplayMetadataStore, resolveMarketWatchDisplayMetadata } from '../store/useMarketWatchDisplayMetadataStore';
import { processIncomingQuotePayload } from './quotePayloadNormalizer';
import { commitBrokerAccountSessionScope } from './brokerSession';

const originalMarketBatch = useMarketDataStore.getState().updateTicksBatch;
const originalAppBatch = useAppStore.getState().setTicksBatch;

const tick = (symbol: string, bid: number, timestamp = 1_788_176_700_000): LiveTick => ({
  symbol,
  bid,
  ask: bid + 0.0002,
  spread: 0.0002,
  timestamp,
  sourceTimestamp: timestamp,
  volume: 1,
});

describe('liveTickDispatcher market data freeze', () => {
  beforeEach(() => {
    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'test-broker',
      serverUrl: 'https://broker.test',
    });
    resetLiveTickDispatcherForTests();
    workerMocks.aggregateSymbols.mockReset();
    dailyChangeCacheMocks.flushMarketWatchDailyChangeCache.mockReset();
    dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange.mockReset();
    quoteCacheMocks.flushMarketWatchQuoteCache.mockReset();
    quoteCacheMocks.rememberCurrentMarketWatchQuote.mockReset();
    window.rtxTickCache = new Map();
    useMarketDataStore.setState({ updateTicksBatch: originalMarketBatch });
    useAppStore.setState({ setTicksBatch: originalAppBatch });
    useMarketDataStore.getState().clearAllData();
    useAppStore.setState({ ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    resetLiveTickDispatcherForTests();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    useMarketDataStore.setState({ updateTicksBatch: originalMarketBatch });
    useAppStore.setState({ setTicksBatch: originalAppBatch });
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('batches shared daily values from an authoritative snapshot and sparse ticks without changing quote sides', () => {
    const at = 1_788_176_700_000;
    const revision = useMarketWatchDisplayMetadataStore.getState().revision;
    const publish = (raw: unknown) => processIncomingQuotePayload(raw).forEach(value => enqueueLiveTick(value.symbol, value));
    publish({ symbol: 'FUTURE.r', bid: 100, ask: 101, last: 2025, previous_close: 2000,
      chart_mode: 'last', provider: 'exchange', session_id: 'session-a', time: at });
    publish({ symbol: 'FUTURE.r', bid: 101, ask: 102, last: 2030, time: at + 1 });
    publish({ symbol: 'FUTURE.r', last: 2035, time: at + 2 });
    expect(useMarketWatchDisplayMetadataStore.getState().revision).toBe(revision);
    flushLiveTicks();
    expect(useMarketWatchDisplayMetadataStore.getState().revision).toBe(revision + 1);
    expect(getMarketWatchDisplayMetadata('FUTURE.r')?.daily).toMatchObject({ price: 2035, change: 35, percent: expect.closeTo(1.75, 12), sessionId: 'session-a' });
    expect(useAppStore.getState().ticks['FUTURE.R']).toMatchObject({ bid: 101, ask: 102 });
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).toHaveBeenLastCalledWith('FUTURE.R', expect.closeTo(1.75, 12), at + 2, 'quote', undefined, 35);
    publish({ symbol: 'FUTURE.r', last: 2005, previous_close: 2000, time: at - 1 });
    flushLiveTicks();
    expect(getMarketWatchDisplayMetadata('FUTURE.r')?.daily?.percent).toBeCloseTo(1.75, 12);
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'other', serverUrl: 'https://other.test' });
    expect(getMarketWatchDisplayMetadata('FUTURE.r')).toBeUndefined();
  });

  it('does not expose a guessed Bid calculation when chart mode is unavailable', () => {
    const value = processIncomingQuotePayload({ symbol: 'UNKNOWN', bid: 105, ask: 106, previous_close: 100, time: 1_788_176_700_000 })[0];
    enqueueLiveTick(value.symbol, value);
    flushLiveTicks();
    const display = resolveMarketWatchDisplayMetadata(useAppStore.getState().ticks.UNKNOWN, getMarketWatchDisplayMetadata('UNKNOWN'));
    expect(display.dailyChange).toBeUndefined();
    expect(display.dailyChangePrice).toBeUndefined();
    expect(display.daily?.issue).toBe('price-mode-unavailable');
  });

  it('uses raw Bid snapshots and sparse Bid updates with the session reference', () => {
    const at = 1_788_176_700_000;
    const publish = (raw: unknown) => processIncomingQuotePayload(raw).forEach(value => enqueueLiveTick(value.symbol, value));
    publish({ symbol: 'FX.r', bid: 105, ask: 106, last: 200, previous_close: 100,
      chart_mode: 'bid', session_id: 'session-a', time: at });
    publish({ symbol: 'FX.r', bid: 110, ask: 111, time: at + 1 });
    flushLiveTicks();
    expect(getMarketWatchDisplayMetadata('FX.r')?.daily).toMatchObject({ price: 110, change: 10, percent: 10 });
    publish({ symbol: 'FX.r', session_id: 'session-b', previous_close: 110, time: at + 2 });
    flushLiveTicks();
    expect(getMarketWatchDisplayMetadata('FX.r')?.daily?.price).toBeUndefined();
    expect(getMarketWatchDisplayMetadata('FX.r')?.daily?.change).toBeUndefined();
    publish({ symbol: 'FX.r', bid: 115, ask: 116, time: at + 3 });
    flushLiveTicks();
    expect(getMarketWatchDisplayMetadata('FX.r')?.daily).toMatchObject({ price: 115, change: 5, percent: expect.closeTo(5 / 110 * 100, 12) });
  });

  it('keeps the last cached tick while a symbol is frozen', () => {
    window.rtxTickCache.set('GBPUSD', tick('GBPUSD', 1.3349));

    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    enqueueLiveTick('GBPUSD', tick('GBPUSD', 1.3355));

    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(true);
    expect(window.rtxTickCache.get('GBPUSD')?.bid).toBe(1.3349);
  });

  it('freezes only the exact broker symbol identity', () => {
    setLiveMarketDataFrozen('test-chart-a', 'EURUSD.r', true);
    enqueueLiveTick('EURUSD.r', tick('EURUSD.r', 1.125));
    enqueueLiveTick('EURUSD', tick('EURUSD', 1.126));

    expect(isLiveMarketDataFrozen('EURUSD.r')).toBe(true);
    expect(isLiveMarketDataFrozen('EURUSD')).toBe(false);
    expect(window.rtxTickCache.get('EURUSD.r')).toBeUndefined();
    expect(window.rtxTickCache.get('EURUSD')?.bid).toBe(1.126);
  });

  it('does not write punctuation-stripped aliases into the live tick cache', () => {
    enqueueLiveTick('EURUSD.r', tick('EURUSD.r', 1.125));

    expect(window.rtxTickCache.get('EURUSD.r')?.bid).toBe(1.125);
    expect(window.rtxTickCache.get('EURUSD.R')?.bid).toBe(1.125);
    expect(window.rtxTickCache.has('EURUSDR')).toBe(false);
  });

  it('keeps a symbol frozen until every source releases it', () => {
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    setLiveMarketDataFrozen('test-chart-b', 'GBPUSD', true);

    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', false);
    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(true);

    setLiveMarketDataFrozen('test-chart-b', 'GBPUSD', false);
    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(false);
  });

  it('accepts ticks again after the symbol is unfrozen', () => {
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', false);

    enqueueLiveTick('GBPUSD', tick('GBPUSD', 1.3351));

    expect(window.rtxTickCache.get('GBPUSD')?.bid).toBe(1.3351);
  });

  it('remembers an accepted authoritative Daily Change, including zero, under the exact symbol', () => {
    const timestamp = 1_788_176_700_123;

    enqueueLiveTick('eurusd.r', {
      ...tick('ignored', 1.125, timestamp),
      dailyChange: 0,
    });

    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).toHaveBeenCalledOnce();
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).toHaveBeenCalledWith(
      'EURUSD.R',
      0,
      timestamp,
      'quote',
    );
  });

  it('retains a full-tick Daily Change when a fresher sparse tick coalesces in the same frame', () => {
    const fullQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 0);
    const sparseQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 1);

    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, fullQuoteTime),
      dailyChange: 1.25,
    });
    enqueueLiveTick('XAUUSD', tick('XAUUSD', 2_501, sparseQuoteTime));
    flushLiveTicks();

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_501,
      sourceTimestamp: sparseQuoteTime,
      dailyChange: 1.25,
    });
    expect(window.rtxTickCache.get('XAUUSD')).toMatchObject({
      bid: 2_501,
      dailyChange: 1.25,
    });
  });

  it('prefers a same-frame authoritative Daily Change over prior store metadata', () => {
    const priorTime = Date.UTC(2026, 8, 28, 9, 59, 59);
    const fullQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 0);
    const sparseQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 1);
    useAppStore.getState().setTick('XAUUSD', {
      ...tick('XAUUSD', 2_499, priorTime),
      dailyChange: -9,
    });

    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, fullQuoteTime),
      dailyChange: 1.25,
    });
    enqueueLiveTick('XAUUSD', tick('XAUUSD', 2_501, sparseQuoteTime));
    flushLiveTicks();

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_501,
      sourceTimestamp: sparseQuoteTime,
      dailyChange: 1.25,
    });
  });

  it('does not carry a coalesced Daily Change across the UTC quote-day rollover', () => {
    const previousDayTime = Date.UTC(2026, 8, 28, 23, 59, 59);
    const nextDayTime = Date.UTC(2026, 8, 29, 0, 0, 1);

    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, previousDayTime),
      dailyChange: 1.25,
    });
    enqueueLiveTick('XAUUSD', tick('XAUUSD', 2_501, nextDayTime));
    flushLiveTicks();

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_501,
      sourceTimestamp: nextDayTime,
    });
    expect(useAppStore.getState().ticks.XAUUSD.dailyChange).toBeUndefined();
    expect(window.rtxTickCache.get('XAUUSD')?.dailyChange).toBeUndefined();
  });

  it('retains the freshest authoritative percentage before a same-frame sparse tick', () => {
    const firstFullTime = Date.UTC(2026, 8, 28, 10, 0, 0);
    const latestFullTime = Date.UTC(2026, 8, 28, 10, 0, 1);
    const sparseQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 2);

    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, firstFullTime),
      dailyChange: 1.25,
    });
    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_501, latestFullTime),
      dailyChange: 1.5,
    });
    enqueueLiveTick('XAUUSD', tick('XAUUSD', 2_502, sparseQuoteTime));
    flushLiveTicks();

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_502,
      sourceTimestamp: sparseQuoteTime,
      dailyChange: 1.5,
    });
  });

  it('merges a delayed same-day full-tick percentage without regressing the pending quote', () => {
    const fullQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 0);
    const sparseQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 2);

    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_502, sparseQuoteTime),
      lp: 'current-lp',
      volume: 22,
    });
    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, fullQuoteTime),
      lp: 'stale-lp',
      volume: 10,
      dailyChange: 1.25,
    });
    flushLiveTicks();

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_502,
      sourceTimestamp: sparseQuoteTime,
      lp: 'current-lp',
      volume: 22,
      dailyChange: 1.25,
      dailyChangeSourceTimestamp: fullQuoteTime,
    });
    expect(window.rtxTickCache.get('XAUUSD')).toMatchObject({
      bid: 2_502,
      sourceTimestamp: sparseQuoteTime,
      dailyChange: 1.25,
      dailyChangeSourceTimestamp: fullQuoteTime,
    });
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).toHaveBeenCalledWith(
      'XAUUSD',
      1.25,
      fullQuoteTime,
      'quote',
    );
  });

  it('merges a delayed same-day exchange Last without regressing the pending quote', () => {
    const fullQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 0);
    const sparseQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 2);

    enqueueLiveTick('FUTURE.LAST', {
      ...tick('FUTURE.LAST', 122, sparseQuoteTime),
      lp: 'current-lp',
    });
    enqueueLiveTick('FUTURE.LAST', {
      ...tick('FUTURE.LAST', 120, fullQuoteTime),
      last: 121.5,
      lp: 'stale-lp',
    });
    flushLiveTicks();

    expect(useAppStore.getState().ticks['FUTURE.LAST']).toMatchObject({
      bid: 122,
      sourceTimestamp: sparseQuoteTime,
      lp: 'current-lp',
      last: 121.5,
      lastSourceTimestamp: fullQuoteTime,
    });
    expect(window.rtxTickCache.get('FUTURE.LAST')).toMatchObject({
      bid: 122,
      sourceTimestamp: sparseQuoteTime,
      last: 121.5,
      lastSourceTimestamp: fullQuoteTime,
    });
  });

  it('rejects delayed percentage metadata from an earlier UTC quote day', () => {
    const previousDayTime = Date.UTC(2026, 8, 28, 23, 59, 59);
    const nextDayTime = Date.UTC(2026, 8, 29, 0, 0, 1);

    enqueueLiveTick('XAUUSD', tick('XAUUSD', 2_501, nextDayTime));
    dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange.mockClear();
    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, previousDayTime),
      dailyChange: 1.25,
    });
    flushLiveTicks();

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_501,
      sourceTimestamp: nextDayTime,
    });
    expect(useAppStore.getState().ticks.XAUUSD.dailyChange).toBeUndefined();
    expect(window.rtxTickCache.get('XAUUSD')?.dailyChange).toBeUndefined();
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).not.toHaveBeenCalled();
  });

  it('keeps the latest finite percentage authority across reverse dispatcher arrivals', () => {
    const oldestFullTime = Date.UTC(2026, 8, 28, 10, 0, 0);
    const firstFullTime = Date.UTC(2026, 8, 28, 10, 0, 1);
    const latestFullTime = Date.UTC(2026, 8, 28, 10, 0, 2);
    const sparseQuoteTime = Date.UTC(2026, 8, 28, 10, 0, 3);

    enqueueLiveTick('XAUUSD', tick('XAUUSD', 2_503, sparseQuoteTime));
    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_501, firstFullTime),
      dailyChange: 1.25,
    });
    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_502, latestFullTime),
      dailyChange: 1.5,
    });
    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, oldestFullTime),
      dailyChange: 9,
    });
    flushLiveTicks();

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_503,
      sourceTimestamp: sparseQuoteTime,
      dailyChange: 1.5,
      dailyChangeSourceTimestamp: latestFullTime,
    });
    expect(window.rtxTickCache.get('XAUUSD')).toMatchObject({
      bid: 2_503,
      dailyChange: 1.5,
      dailyChangeSourceTimestamp: latestFullTime,
    });
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).toHaveBeenLastCalledWith(
      'XAUUSD',
      1.5,
      latestFullTime,
      'quote',
    );
  });

  it('does not persist Daily Change when only local receipt time is available', () => {
    enqueueLiveTick('EURUSD', {
      ...tick('EURUSD', 1.125),
      sourceTimestamp: undefined,
      timestamp: Date.now(),
      dailyChange: 0.25,
    });

    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).not.toHaveBeenCalled();
    expect(window.rtxTickCache.get('EURUSD')?.dailyChange).toBe(0.25);
  });

  it('remembers the accepted quote with original source time without using local receipt time', () => {
    const sourceTimestamp = 1_788_176_700_123;
    enqueueLiveTick('eurusd.r', {
      ...tick('ignored', 1.125, sourceTimestamp),
      timestamp: sourceTimestamp + 60_000,
    });
    expect(quoteCacheMocks.rememberCurrentMarketWatchQuote).toHaveBeenCalledWith('EURUSD.R', {
      bid: 1.125,
      ask: 1.1252,
      asOf: sourceTimestamp,
    });
    quoteCacheMocks.rememberCurrentMarketWatchQuote.mockClear();
    enqueueLiveTick('GBPUSD', {
      ...tick('GBPUSD', 1.33, sourceTimestamp),
      sourceTimestamp: undefined,
    });
    expect(quoteCacheMocks.rememberCurrentMarketWatchQuote).not.toHaveBeenCalled();
    expect(window.rtxTickCache.get('GBPUSD')?.bid).toBe(1.33);
  });

  it('keeps a brand-new Last-only symbol out of every executable quote owner', () => {
    const sourceTimestamp = 1_788_176_700_123;
    const marketSpy = vi.spyOn(useMarketDataStore.getState(), 'updateTicksBatch');
    const appSpy = vi.spyOn(useAppStore.getState(), 'setTicksBatch');

    enqueueLiveTick('FUTURE.LAST', {
      symbol: 'FUTURE.LAST',
      bid: 0,
      ask: 0,
      spread: 0,
      last: 120,
      dailyChange: 50,
      timestamp: sourceTimestamp,
      sourceTimestamp,
    });

    expect(window.rtxTickCache.has('FUTURE.LAST')).toBe(false);
    expect(quoteCacheMocks.rememberCurrentMarketWatchQuote).not.toHaveBeenCalled();
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).toHaveBeenCalledWith(
      'FUTURE.LAST',
      50,
      sourceTimestamp,
      'quote',
    );

    flushLiveTicks();

    expect(marketSpy).not.toHaveBeenCalled();
    expect(appSpy).not.toHaveBeenCalled();
    expect(useMarketDataStore.getState().symbolData['FUTURE.LAST']).toBeUndefined();
    expect(useAppStore.getState().ticks['FUTURE.LAST']).toBeUndefined();
    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toMatchObject({
      last: 120,
      dailyChange: 50,
    });
  });

  it('updates display metadata without replacing executable sides or quote directions', () => {
    const currentTimestamp = 1_788_176_700_123;
    useAppStore.getState().setTick('FUTURE.LAST', {
      symbol: 'FUTURE.LAST',
      bid: 109,
      ask: 110,
      spread: 1,
      timestamp: currentTimestamp - 1,
      sourceTimestamp: currentTimestamp - 1,
    });
    useAppStore.getState().setTick('FUTURE.LAST', {
      symbol: 'FUTURE.LAST',
      bid: 110,
      ask: 111,
      spread: 1,
      timestamp: currentTimestamp,
      sourceTimestamp: currentTimestamp,
    });
    const executableBefore = useAppStore.getState().ticks['FUTURE.LAST'];
    const appSpy = vi.spyOn(useAppStore.getState(), 'setTicksBatch');

    enqueueLiveTick('FUTURE.LAST', {
      symbol: 'FUTURE.LAST',
      bid: 0,
      ask: 0,
      spread: 0,
      last: 120,
      dailyChange: 20,
      timestamp: currentTimestamp + 1,
      sourceTimestamp: currentTimestamp + 1,
    });
    flushLiveTicks();

    expect(appSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().ticks['FUTURE.LAST']).toBe(executableBefore);
    expect(useAppStore.getState().ticks['FUTURE.LAST']).toMatchObject({
      bid: 110,
      ask: 111,
      bidDirection: 'up',
      askDirection: 'up',
    });
    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toMatchObject({
      last: 120,
      dailyChange: 20,
    });
  });

  it('backfills delayed same-day Last-only metadata without replacing the executable quote', () => {
    const currentTimestamp = 1_788_176_700_123;
    useAppStore.getState().setTick('FUTURE.LAST', tick('FUTURE.LAST', 110, currentTimestamp));
    const executableBefore = useAppStore.getState().ticks['FUTURE.LAST'];
    dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange.mockClear();

    enqueueLiveTick('FUTURE.LAST', {
      symbol: 'FUTURE.LAST',
      bid: 0,
      ask: 0,
      spread: 0,
      last: 100,
      dailyChange: -10,
      timestamp: currentTimestamp - 1,
      sourceTimestamp: currentTimestamp - 1,
    });

    expect(useAppStore.getState().ticks['FUTURE.LAST']).toBe(executableBefore);
    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toMatchObject({
      last: 100,
      dailyChange: -10,
      sourceTimestamp: currentTimestamp - 1,
    });
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).toHaveBeenCalledWith(
      'FUTURE.LAST',
      -10,
      currentTimestamp - 1,
      'quote',
    );
  });

  it('rejects delayed Last-only metadata from an earlier UTC quote day', () => {
    const currentTimestamp = Date.UTC(2026, 8, 29, 1, 0);
    const priorDayTimestamp = Date.UTC(2026, 8, 28, 20, 0);
    useAppStore.getState().setTick('FUTURE.LAST', tick('FUTURE.LAST', 110, currentTimestamp));
    dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange.mockClear();

    enqueueLiveTick('FUTURE.LAST', {
      symbol: 'FUTURE.LAST',
      bid: 0,
      ask: 0,
      spread: 0,
      last: 100,
      dailyChange: -10,
      timestamp: priorDayTimestamp,
      sourceTimestamp: priorDayTimestamp,
    });

    expect(getMarketWatchDisplayMetadata('FUTURE.LAST')).toBeUndefined();
    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).not.toHaveBeenCalled();
  });

  it('does not persist rejected, duplicate, or frozen quote events', () => {
    const accepted = tick('EURUSD', 1.17);
    enqueueLiveTick('EURUSD', accepted);
    quoteCacheMocks.rememberCurrentMarketWatchQuote.mockClear();
    enqueueLiveTick('EURUSD', accepted);
    enqueueLiveTick('EURUSD', tick('EURUSD', 1.16, accepted.timestamp - 1));
    setLiveMarketDataFrozen('test', 'GBPUSD', true);
    enqueueLiveTick('GBPUSD', tick('GBPUSD', 1.33));
    expect(quoteCacheMocks.rememberCurrentMarketWatchQuote).not.toHaveBeenCalled();
  });

  it('keeps live delivery and session reset working when quote persistence fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    quoteCacheMocks.rememberCurrentMarketWatchQuote.mockImplementation(() => {
      throw new Error('write failed');
    });
    enqueueLiveTick('EURUSD', tick('EURUSD', 1.17));
    expect(window.rtxTickCache.get('EURUSD')?.bid).toBe(1.17);
    quoteCacheMocks.flushMarketWatchQuoteCache.mockImplementation(() => {
      expect(window.rtxTickCache.size).toBe(1);
      throw new Error('flush failed');
    });
    expect(() => resetLiveMarketDataSession()).not.toThrow();
    expect(quoteCacheMocks.flushMarketWatchQuoteCache).toHaveBeenCalledOnce();
    expect(window.rtxTickCache.size).toBe(0);
  });

  it('does not remember Daily Change from rejected, duplicate, or non-finite ticks', () => {
    const timestamp = 1_788_176_700_000;
    const accepted = {
      ...tick('XAUUSD', 4_431, timestamp),
      dailyChange: -0.42,
    };
    enqueueLiveTick('XAUUSD', accepted);
    dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange.mockClear();

    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 4_400, timestamp - 1),
      dailyChange: 99,
    });
    enqueueLiveTick('XAUUSD', accepted);
    enqueueLiveTick('GBPUSD', {
      ...tick('GBPUSD', 1.33, timestamp + 1),
      dailyChange: Number.NaN,
    });

    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).not.toHaveBeenCalled();
  });

  it('does not promote a retained Daily Change to a sparse carrier timestamp during reapply', () => {
    const dailyTime = Date.UTC(2026, 8, 28, 10, 0);
    const sparseTime = dailyTime + 1_000;
    enqueueLiveTick('XAUUSD', {
      ...tick('XAUUSD', 2_500, dailyTime),
      dailyChange: 1.25,
    });
    enqueueLiveTick('XAUUSD', tick('XAUUSD', 2_501, sparseTime));
    expect(window.rtxTickCache.get('XAUUSD')).toMatchObject({
      sourceTimestamp: sparseTime,
      dailyChange: 1.25,
      dailyChangeSourceTimestamp: dailyTime,
    });

    dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange.mockClear();
    reapplyAccountSpreadMarkupToCachedTicks();

    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).not.toHaveBeenCalled();
  });

  it('does not cache an equal-time Last-only percentage when the App tick wins display authority', () => {
    const timestamp = Date.UTC(2026, 8, 28, 10, 0);
    useAppStore.getState().setTick('FUTURE.LAST', {
      ...tick('FUTURE.LAST', 110, timestamp),
      dailyChange: 10,
      dailyChangeSourceTimestamp: timestamp,
    });
    dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange.mockClear();

    enqueueLiveTick('FUTURE.LAST', {
      symbol: 'FUTURE.LAST',
      bid: 0,
      ask: 0,
      spread: 0,
      last: 120,
      dailyChange: 20,
      timestamp,
      sourceTimestamp: timestamp,
    });

    expect(dailyChangeCacheMocks.rememberCurrentMarketWatchDailyChange).not.toHaveBeenCalled();
  });

  it('flushes pending Daily Change persistence before clearing session quote state', () => {
    window.rtxTickCache.set('XAUUSD', tick('XAUUSD', 4_431));
    let cacheSizeDuringFlush = -1;
    dailyChangeCacheMocks.flushMarketWatchDailyChangeCache.mockImplementation(() => {
      cacheSizeDuringFlush = window.rtxTickCache.size;
      return true;
    });

    resetLiveMarketDataSession();

    expect(cacheSizeDuringFlush).toBe(1);
    expect(window.rtxTickCache.size).toBe(0);
  });

  it('keeps the freshest in-frame tick and preserves a reentrant tick for one next frame', () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const baseTimestamp = 1_788_176_700_000;
    let reentered = false;
    const unsubscribe = useMarketDataStore.subscribe(() => {
      if (reentered) return;
      reentered = true;
      enqueueLiveTick('EURUSD', tick('EURUSD', 1.2, baseTimestamp + 2));
    });

    enqueueLiveTick('EURUSD', tick('EURUSD', 1.1, baseTimestamp + 1));
    enqueueLiveTick('EURUSD', tick('EURUSD', 9.9, baseTimestamp));
    expect(requestFrame).toHaveBeenCalledTimes(1);
    frames.shift()?.(0);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().ticks.EURUSD.bid).toBe(1.1);

    frames.shift()?.(16);
    expect(useMarketDataStore.getState().symbolData.EURUSD.currentTick?.bid).toBe(1.2);
    expect(useAppStore.getState().ticks.EURUSD.bid).toBe(1.2);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it.each(['market', 'app'] as const)('retries only the failed %s store with backoff', (target) => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const marketAction = originalMarketBatch;
    const appAction = originalAppBatch;
    const marketSpy = vi.spyOn(useMarketDataStore.getState(), 'updateTicksBatch');
    const appSpy = vi.spyOn(useAppStore.getState(), 'setTicksBatch');
    if (target === 'market') {
      marketSpy.mockImplementationOnce(() => { throw new Error('market batch failure'); });
      marketSpy.mockImplementation(marketAction);
    } else {
      appSpy.mockImplementationOnce(() => { throw new Error('app batch failure'); });
      appSpy.mockImplementation(appAction);
    }

    enqueueLiveTick('USDJPY', tick('USDJPY', 150));
    frames.shift()?.(0);
    expect(target === 'market' ? appSpy : marketSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(frames).toHaveLength(1);
    frames.shift()?.(16);

    expect(marketSpy).toHaveBeenCalledTimes(target === 'market' ? 2 : 1);
    expect(appSpy).toHaveBeenCalledTimes(target === 'app' ? 2 : 1);
    expect(useMarketDataStore.getState().symbolData.USDJPY.currentTick?.bid).toBe(150);
    expect(useAppStore.getState().ticks.USDJPY.bid).toBe(150);
  });

  it('keeps Market and App retry schedules independent', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runFrame = (time: number) => frames.shift()?.(time);

    let marketAttempts = 0;
    const marketSpy = vi.spyOn(useMarketDataStore.getState(), 'updateTicksBatch')
      .mockImplementation((entries, options) => {
        if (++marketAttempts <= 2) throw new Error('market failure');
        return originalMarketBatch(entries, options);
      });
    let appAttempts = 0;
    const appSpy = vi.spyOn(useAppStore.getState(), 'setTicksBatch')
      .mockImplementation((entries) => {
        if (++appAttempts === 3) throw new Error('app failure');
        return originalAppBatch(entries);
      });

    const at = 1_788_176_700_000;
    enqueueLiveTick('USDJPY', tick('USDJPY', 150, at));
    runFrame(0); // Market fails; App succeeds.
    vi.advanceTimersByTime(50);
    enqueueLiveTick('USDJPY', tick('USDJPY', 151, at + 1));
    runFrame(50); // Market waits; healthy App gets only the fresh live batch.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([1, 2]);

    vi.advanceTimersByTime(50);
    runFrame(100); // Market's 100 ms retry fails and starts its own 200 ms wait.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([2, 2]);
    vi.advanceTimersByTime(50);
    enqueueLiveTick('USDJPY', tick('USDJPY', 152, at + 2));
    runFrame(150); // Market still waits; App now fails for the first time.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([2, 3]);

    vi.advanceTimersByTime(99);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    runFrame(250); // App owns a fresh 100 ms retry, not Market's 200 ms delay.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([2, 4]);
    expect(useAppStore.getState().ticks.USDJPY.bid).toBe(152);

    vi.advanceTimersByTime(49);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    runFrame(300); // Market's 200 ms retry; App must not replay an old batch.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([3, 4]);
    expect(useMarketDataStore.getState().symbolData.USDJPY.currentTick?.bid).toBe(152);
  });
});
