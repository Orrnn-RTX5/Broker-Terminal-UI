import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestBrokerRuntime } from '../test/brokerRuntime';
import { HistoryApiError, historyClient } from './historyClient';
import { RTX5_API_URL } from '../config/api';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const lastFetchUrl = () => {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  if (!call) throw new Error('Expected fetch to be called');
  return String(call[0]);
};

describe('historyClient v2 history contract calls', () => {
  let restoreBrokerRuntime: () => void;
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
    localStorage.clear();
    restoreBrokerRuntime = installTestBrokerRuntime();
  });

  afterEach(() => {
    restoreBrokerRuntime();
    vi.unstubAllGlobals();
  });

  it('fetches downloader ticks through the supported v2 gateway ticks endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([
      { symbol: 'EURUSD', bid: 1.1, ask: 1.2, time: 1760054400 },
    ]));

    const chunk = await historyClient.getTicksByDate('EUR/USD', '2025-10-10');

    expect(lastFetchUrl()).toBe(
      `${RTX5_API_URL}/api/v2/ticks/EUR%2FUSD?from=1760054400&to=1760140799&limit=10000`
    );
    expect(chunk).toEqual({
      symbol: 'EUR/USD',
      date: '2025-10-10',
      ticks: [{ symbol: 'EURUSD', bid: 1.1, ask: 1.2, timestamp: 1760054400000 }],
      chunkIndex: 0,
      totalChunks: 1,
    });
  });

  it('derives downloader symbols from the supported v2 instruments endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([
      { symbol: 'XAUUSD', enabled: true },
      { symbol: 'EURUSD', enabled: true },
      { symbol: 'DISABLED', enabled: false },
    ]));

    await expect(historyClient.getAvailableData()).resolves.toEqual([
      {
        symbol: 'EURUSD',
        availableDates: [],
        totalTicks: 0,
        firstDate: '',
        lastDate: '',
        downloadedDates: [],
        downloadProgress: 0,
      },
      {
        symbol: 'XAUUSD',
        availableDates: [],
        totalTicks: 0,
        firstDate: '',
        lastDate: '',
        downloadedDates: [],
        downloadProgress: 0,
      },
    ]);
    expect(lastFetchUrl()).toBe(`${RTX5_API_URL}/api/v2/instruments`);
  });

  it('exposes readable candle helpers through the supported v2 gateway candle endpoints', async () => {
    await historyClient.getCandles('EUR/USD', { timeframe: 'M5', limit: 25 });
    expect(lastFetchUrl()).toBe(`${RTX5_API_URL}/api/v2/candles/EUR%2FUSD?timeframe=M5&limit=25`);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{
      time: 1760054400,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      tick_count: 10,
    }]));

    await historyClient.getLatestCandle('EURUSD', 'H1');
    expect(lastFetchUrl()).toBe(`${RTX5_API_URL}/api/v2/candles/EURUSD?timeframe=H1&limit=5`);
  });

  it('quarantines downloader-only metadata that has no S0 history/v2 mapping', async () => {
    await expect(historyClient.verifyData('EURUSD', '2025-10-10')).rejects.toMatchObject({
      statusCode: 501,
    } satisfies Partial<HistoryApiError>);

    await expect(historyClient.getTickCount('EURUSD', '2025-10-10')).rejects.toMatchObject({
      statusCode: 501,
    } satisfies Partial<HistoryApiError>);

    expect(fetch).not.toHaveBeenCalled();
  });
});
