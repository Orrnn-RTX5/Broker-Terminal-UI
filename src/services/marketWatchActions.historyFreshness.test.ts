import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import {
  ACK_HISTORY_FALLBACK_MS,
  bindDefaultHistoryFreshnessOwner,
  createHistoryFreshnessOwner,
} from '../app/trading/tradeHistoryFreshness';
import { executeQuickBuy } from './marketWatchActions';

vi.mock('./brokerSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./brokerSession')>()),
  getAccessToken: vi.fn(() => 'token-1'),
}));

vi.mock('../api/trade', () => ({
  watchlistV2Api: {},
}));

vi.mock('./api', () => ({
  ordersApi: {
    placeMarketOrder: vi.fn(async () => ({ ticket: 7 })),
  },
}));

describe('quick buy history refresh', () => {
  let refresh: Mock<(login: number) => Promise<void>>;
  let unbind: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ accountId: '200036' });
    refresh = vi.fn((_login: number) => Promise.resolve());
    unbind = bindDefaultHistoryFreshnessOwner(createHistoryFreshnessOwner(refresh, () => true));
  });

  afterEach(() => {
    unbind();
    vi.useRealTimers();
  });

  it('refetches History at the market ACK and once more after the fallback delay', async () => {
    const result = await executeQuickBuy('ETHUSD', 0.01);
    expect(result.success).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith(200036);

    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
