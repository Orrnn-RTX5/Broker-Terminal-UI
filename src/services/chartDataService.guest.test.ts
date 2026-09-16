import { afterEach, expect, it, vi } from 'vitest';
import { ChartDataService } from './chartDataService';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); });

it('fetches and refreshes guest candles without WebSocket auth and cancels pending work on close', async () => {
  localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candles: [{ time: 1789479000, open: 1, high: 2, low: 1, close: 2, volume: 10 }] })));
  // Each response body must be independently readable on subsequent polls.
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ candles: [{ time: 1789479000, open: 1, high: 2, low: 1, close: 2, volume: 10 }] })));
  vi.stubGlobal('fetch', fetchMock);
  const socket = vi.fn(); vi.stubGlobal('WebSocket', socket);
  const service = new ChartDataService();
  const onCandle = vi.fn();
  const stream = service.subscribeCandles({ symbol: 'XAUUSD', timeframe: 'M1', onCandle });
  await vi.advanceTimersByTimeAsync(0);
  expect(onCandle).toHaveBeenCalledWith(expect.objectContaining({ close: 2 }));
  expect(socket).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v2/candles/XAUUSD'), expect.objectContaining({ credentials: 'omit', headers: undefined }));
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  stream.close();
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(6000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
