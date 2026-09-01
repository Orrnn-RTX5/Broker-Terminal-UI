import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onSessionChange } from '../services/brokerSession';
import { useAppStore } from '../store/useAppStore';
import { useQuoteSubscription } from './useQuoteSubscription';

const managerMock = vi.hoisted(() => ({
  setDemand: vi.fn(),
  removeDemand: vi.fn(),
  isConnected: vi.fn(() => false),
}));

const brokerSessionMock = vi.hoisted(() => ({
  token: null as string | null,
  hasFeedToken: false,
  serverUrl: '',
  listener: null as null | ((reason: 'token_rotation' | 'login' | 'logout' | 'broker_url_change' | 'account_change') => void),
  unsubscribe: vi.fn(),
}));

vi.mock('../services/quoteSocketManager', () => ({
  getQuoteSocketManager: vi.fn(() => managerMock),
}));

vi.mock('../services/brokerSession', () => ({
  getAccessToken: vi.fn(() => brokerSessionMock.token),
  getServerUrl: vi.fn(() => brokerSessionMock.serverUrl),
  hasFeedBrokerToken: vi.fn(() => brokerSessionMock.hasFeedToken),
  onSessionChange: vi.fn((cb) => {
    brokerSessionMock.listener = cb;
    return brokerSessionMock.unsubscribe;
  }),
  // config/api.ts (imported transitively) calls these at module load time.
  buildBrokerWsFeedUri: vi.fn(() => 'wss://broker.example/ws/feed'),
  buildBrokerWsV2Uri: vi.fn(() => 'wss://broker.example/ws/v2'),
}));

describe('useQuoteSubscription', () => {
  beforeEach(() => {
    managerMock.setDemand.mockClear();
    managerMock.removeDemand.mockClear();
    managerMock.isConnected.mockClear();
    brokerSessionMock.token = null;
    brokerSessionMock.hasFeedToken = false;
    brokerSessionMock.serverUrl = '';
    brokerSessionMock.listener = null;
    brokerSessionMock.unsubscribe.mockClear();
    vi.mocked(onSessionChange).mockClear();
    useAppStore.setState({ isAuthenticated: false, authToken: null });
  });

  it('installs neither session listener nor quote demand while disabled', () => {
    brokerSessionMock.token = 'access-token';
    brokerSessionMock.serverUrl = 'http://broker.example';

    const { unmount } = renderHook(() => (
      useQuoteSubscription(['eurusd'], 'chart:hidden', { enabled: false })
    ));

    expect(onSessionChange).not.toHaveBeenCalled();
    expect(managerMock.setDemand).not.toHaveBeenCalled();
    expect(managerMock.removeDemand).not.toHaveBeenCalled();

    unmount();

    expect(brokerSessionMock.unsubscribe).not.toHaveBeenCalled();
    expect(managerMock.removeDemand).not.toHaveBeenCalled();
  });

  it('acquires and releases the listener and demand across enabled transitions', () => {
    brokerSessionMock.token = 'access-token';
    brokerSessionMock.serverUrl = 'http://broker.example';

    const { rerender, unmount } = renderHook(
      ({ enabled }) => useQuoteSubscription(['xauusd'], 'chart:toggle', { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(onSessionChange).not.toHaveBeenCalled();
    expect(managerMock.setDemand).not.toHaveBeenCalled();

    rerender({ enabled: true });

    expect(onSessionChange).toHaveBeenCalledTimes(1);
    expect(managerMock.setDemand).toHaveBeenCalledTimes(1);
    expect(managerMock.setDemand).toHaveBeenLastCalledWith('chart:toggle', ['XAUUSD']);

    rerender({ enabled: false });

    expect(brokerSessionMock.unsubscribe).toHaveBeenCalledTimes(1);
    expect(managerMock.removeDemand).toHaveBeenCalledTimes(1);
    expect(managerMock.removeDemand).toHaveBeenLastCalledWith('chart:toggle');

    rerender({ enabled: true });

    expect(onSessionChange).toHaveBeenCalledTimes(2);
    expect(managerMock.setDemand).toHaveBeenCalledTimes(2);

    unmount();

    expect(brokerSessionMock.unsubscribe).toHaveBeenCalledTimes(2);
    expect(managerMock.removeDemand).toHaveBeenCalledTimes(2);
  });

  it('registers quote demand when a stored broker session is ready', () => {
    brokerSessionMock.token = 'access-token';
    brokerSessionMock.serverUrl = 'http://broker.example';

    const { unmount } = renderHook(() => useQuoteSubscription(['eurusd', 'EURUSD'], 'chart:1'));

    expect(managerMock.setDemand).toHaveBeenCalledWith('chart:1', ['EURUSD']);

    unmount();
  });

  it('keeps public quote demand active across a broker session change', () => {
    const { unmount } = renderHook(() => useQuoteSubscription(['xauusd'], 'chart:2'));

    expect(managerMock.setDemand).toHaveBeenCalledWith('chart:2', ['XAUUSD']);
    managerMock.setDemand.mockClear();
    managerMock.removeDemand.mockClear();

    brokerSessionMock.token = 'access-token';
    brokerSessionMock.serverUrl = 'http://broker.example';
    act(() => {
      brokerSessionMock.listener?.('login');
    });

    expect(managerMock.setDemand).toHaveBeenCalledWith('chart:2', ['XAUUSD']);

    unmount();
  });

  it('registers quote demand when only a broker feed token is ready', () => {
    brokerSessionMock.hasFeedToken = true;
    brokerSessionMock.serverUrl = 'http://broker.example';

    const { unmount } = renderHook(() => useQuoteSubscription(['btcusd'], 'watchlist'));

    expect(managerMock.setDemand).toHaveBeenCalledWith('watchlist', ['BTCUSD']);

    unmount();
  });

  it('removes quote demand when the stored broker session is no longer ready', () => {
    brokerSessionMock.token = 'access-token';
    brokerSessionMock.serverUrl = 'http://broker.example';

    const { unmount } = renderHook(() => useQuoteSubscription(['gbpusd'], 'chart:3'));
    managerMock.removeDemand.mockClear();

    brokerSessionMock.token = null;
    act(() => {
      brokerSessionMock.listener?.('logout');
    });

    expect(managerMock.removeDemand).toHaveBeenCalledWith('chart:3');

    unmount();
  });
});
