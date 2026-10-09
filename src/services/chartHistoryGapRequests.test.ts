import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchCandlesOptions, OHLCData } from '../types/chartData';
import { emitSessionChange } from './brokerSession';
import {
  captureHistoryGapRequestScope,
  createHistoryGapRequestCoordinator,
  EMPTY_HISTORY_GAP_TTL_MS,
  historyGapRequests,
} from './chartHistoryGapRequests';

const candle: OHLCData = { time: 120, open: 100, high: 101, low: 99, close: 100, volume: 1 };
const request: FetchCandlesOptions = { symbol: 'BTCUSD.r', timeframe: 'M1', from: 120, to: 180, count: 2 };
const createHarness = () => {
  const coordinator = createHistoryGapRequestCoordinator();
  const scope = coordinator.captureScope('broker-a/account-a');
  const fetchCandles = vi.fn<(options: FetchCandlesOptions) => Promise<OHLCData[]>>().mockResolvedValue([]);
  const options = { scope, boundaryOffsetSeconds: 0, timeframeSeconds: 60, request, fetchCandles };
  return { coordinator, scope, fetchCandles, options };
};
const deferred = () => {
  let resolve!: (rows: OHLCData[]) => void;
  const promise = new Promise<OHLCData[]>(done => { resolve = done; });
  return { promise, resolve };
};

afterEach(() => { historyGapRequests.invalidate(); vi.restoreAllMocks(); });

describe('shared background gap requests', () => {
  it('memoizes successful empty intervals for 30 seconds, then lets broker corrections retry', async () => {
    const h = createHarness();
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    expect(await h.coordinator.fetch(h.options)).toEqual([]);
    now += EMPTY_HISTORY_GAP_TTL_MS - 1;
    expect(await h.coordinator.fetch(h.options)).toEqual([]);
    expect(h.fetchCandles).toHaveBeenCalledOnce();
    now += 1;
    h.fetchCandles.mockResolvedValue([candle]);
    expect(await h.coordinator.fetch(h.options)).toEqual([candle]);
    expect(h.fetchCandles).toHaveBeenCalledTimes(2);
  });

  it('never memoizes errors or pages containing actual candles', async () => {
    const h = createHarness();
    h.fetchCandles.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([candle]);
    await expect(h.coordinator.fetch(h.options)).rejects.toThrow('offline');
    expect(await h.coordinator.fetch(h.options)).toEqual([candle]);
    expect(await h.coordinator.fetch(h.options)).toEqual([candle]);
    expect(h.fetchCandles).toHaveBeenCalledTimes(3);
  });

  it('keys empty responses by session, exact symbol, timeframe, interval, count and boundary contract', async () => {
    const h = createHarness();
    const variants = [
      h.options,
      { ...h.options, scope: h.coordinator.captureScope('broker-a/account-b') },
      { ...h.options, scope: h.coordinator.captureScope('broker-b/account-a') },
      { ...h.options, request: { ...request, symbol: 'BTCUSDr' } },
      { ...h.options, request: { ...request, timeframe: 'M5' } },
      { ...h.options, request: { ...request, from: 60 } },
      { ...h.options, request: { ...request, to: 240 } },
      { ...h.options, request: { ...request, count: 4 } },
      { ...h.options, boundaryOffsetSeconds: 3600 },
      { ...h.options, timeframeSeconds: 300 },
    ];
    for (const options of variants) await h.coordinator.fetch(options);
    expect(h.fetchCandles).toHaveBeenCalledTimes(variants.length);
    for (const options of variants) await h.coordinator.fetch(options);
    expect(h.fetchCandles).toHaveBeenCalledTimes(variants.length);
  });

  it('shares transport while one chart can abort without canceling another chart', async () => {
    const h = createHarness();
    const response = deferred();
    h.fetchCandles.mockReturnValue(response.promise);
    const first = new AbortController();
    const second = new AbortController();
    const firstResult = h.coordinator.fetch({ ...h.options, request: { ...request, signal: first.signal } });
    const firstRejected = expect(firstResult).rejects.toMatchObject({ name: 'AbortError' });
    const secondResult = h.coordinator.fetch({ ...h.options, request: { ...request, signal: second.signal } });
    await Promise.resolve();
    expect(h.fetchCandles).toHaveBeenCalledOnce();
    first.abort();
    await firstRejected;
    expect(h.fetchCandles.mock.calls[0][0].signal?.aborted).toBe(false);
    response.resolve([candle]);
    expect(await secondResult).toEqual([candle]);
  });

  it('immediately reacquires a fresh request after the last shared owner cancels', async () => {
    const h = createHarness();
    const abandoned = deferred();
    h.fetchCandles.mockReturnValueOnce(abandoned.promise).mockResolvedValue([candle]);
    const owner = new AbortController();
    const result = h.coordinator.fetch({ ...h.options, request: { ...request, signal: owner.signal } });
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    const transportSignal = h.fetchCandles.mock.calls[0][0].signal;
    owner.abort();
    // Reacquire before the canceled transport settles or its finally runs.
    const replacement = h.coordinator.fetch(h.options);
    expect(transportSignal?.aborted).toBe(true);
    await rejection;
    expect(await replacement).toEqual([candle]);
    expect(h.fetchCandles).toHaveBeenCalledTimes(2);
    abandoned.resolve([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(await h.coordinator.fetch(h.options)).toEqual([candle]);
    expect(h.fetchCandles).toHaveBeenCalledTimes(3);
  });

  it('invalidates old scopes, pending owners and empty results before a new account begins', async () => {
    const h = createHarness();
    await h.coordinator.fetch(h.options);
    const response = deferred();
    h.fetchCandles.mockReturnValueOnce(response.promise);
    const pending = h.coordinator.fetch({ ...h.options, request: { ...request, to: 240 } });
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    h.coordinator.invalidate();
    await rejection;
    await expect(h.coordinator.fetch(h.options)).rejects.toMatchObject({ name: 'AbortError' });
    response.resolve([]);
    const next = { ...h.options, scope: h.coordinator.captureScope('broker-a/account-a') };
    await h.coordinator.fetch(next);
    expect(h.fetchCandles).toHaveBeenCalledTimes(3);
  });

  it('separates endpoint scopes and invalidates on account changes while preserving token rotation', async () => {
    const fetchCandles = vi.fn(async () => [] as OHLCData[]);
    const options = {
      scope: captureHistoryGapRequestScope('https://broker-a/api/v2'),
      boundaryOffsetSeconds: 0, timeframeSeconds: 60, request, fetchCandles,
    };
    await historyGapRequests.fetch(options);
    emitSessionChange('token_rotation');
    await historyGapRequests.fetch(options);
    expect(fetchCandles).toHaveBeenCalledOnce();
    await historyGapRequests.fetch({ ...options, scope: captureHistoryGapRequestScope('https://broker-b/api/v2') });
    expect(fetchCandles).toHaveBeenCalledTimes(2);
    emitSessionChange('account_change');
    await expect(historyGapRequests.fetch(options)).rejects.toMatchObject({ name: 'AbortError' });
    await historyGapRequests.fetch({ ...options, scope: captureHistoryGapRequestScope('https://broker-a/api/v2') });
    expect(fetchCandles).toHaveBeenCalledTimes(3);
  });
});
