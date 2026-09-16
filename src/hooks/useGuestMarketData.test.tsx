import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGuestMarketData } from './useGuestMarketData';

const mocks = vi.hoisted(() => ({ load: vi.fn(), tick: vi.fn() }));
vi.mock('../services/publicMarket', () => ({ loadPublicQuotes: mocks.load }));
vi.mock('../services/liveTickDispatcher', () => ({ enqueueLiveTick: mocks.tick }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('refreshes public quotes with upstream time and stops immediately when authentication begins', async () => {
  vi.useFakeTimers();
  mocks.load.mockResolvedValue([{ symbol: 'XAUUSD', bid: 4200, ask: 4201, time: 1789479000 }]);
  const view = renderHook(({ enabled }) => useGuestMarketData(enabled), { initialProps: { enabled: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(mocks.tick).toHaveBeenCalledWith('XAUUSD', expect.objectContaining({ timestamp: 1789479000000, sourceTimestamp: 1789479000000 }));
  const signal = mocks.load.mock.calls[0][0] as AbortSignal;
  view.rerender({ enabled: false });
  expect(signal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
