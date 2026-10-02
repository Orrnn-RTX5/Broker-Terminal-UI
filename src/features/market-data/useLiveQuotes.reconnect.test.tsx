import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import { useLiveQuotes } from './useLiveQuotes';

const apiGet = vi.hoisted(() => vi.fn());
const subscription = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, apiClient: { get: apiGet } }));
vi.mock('../../services/liveTickDispatcher', () => ({ enqueueLiveTick: vi.fn() }));
vi.mock('../../hooks/useQuoteSubscription', () => ({ useQuoteSubscription: subscription }));

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => {
  apiGet.mockReset().mockResolvedValue({ quotes: [] });
  subscription.mockReset().mockReturnValue({ isConnected: true });
  commitBrokerAccountSessionScope({ authenticated: true, accountId: 'account-a', brokerId: 'broker-a', serverUrl: 'https://broker-a.test' });
  useAppStore.setState({ isAuthenticated: true, accountId: 'account-a' });
});
afterEach(() => {
  useAppStore.setState({ isAuthenticated: false, accountId: null });
  commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
});

it('refreshes the authoritative snapshot after reconnect and aborts old requests', async () => {
  const { rerender, unmount } = renderHook(() => useLiveQuotes(['EURUSD']));
  await flush();
  expect(apiGet).toHaveBeenCalledTimes(1);
  const firstSignal = apiGet.mock.calls[0][1].signal as AbortSignal;
  subscription.mockReturnValue({ isConnected: false });
  rerender();
  await flush();
  expect(apiGet).toHaveBeenCalledTimes(1);
  subscription.mockReturnValue({ isConnected: true });
  rerender();
  await flush();
  expect(apiGet).toHaveBeenCalledTimes(2);
  expect(firstSignal.aborted).toBe(true);
  const nextSignal = apiGet.mock.calls[1][1].signal as AbortSignal;
  unmount();
  expect(nextSignal.aborted).toBe(true);
});
