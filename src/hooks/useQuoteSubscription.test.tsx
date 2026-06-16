import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    return vi.fn();
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
    useAppStore.setState({ isAuthenticated: false, authToken: null });
  });

  it('registers quote demand when a stored broker session is ready', () => {
    brokerSessionMock.token = 'access-token';
    brokerSessionMock.serverUrl = 'http://broker.example';

    const { unmount } = renderHook(() => useQuoteSubscription(['eurusd', 'EURUSD'], 'chart:1'));

    expect(managerMock.setDemand).toHaveBeenCalledWith('chart:1', ['EURUSD']);

    unmount();
  });

  it('registers quote demand after a broker session change makes storage ready', () => {
    const { unmount } = renderHook(() => useQuoteSubscription(['xauusd'], 'chart:2'));

    expect(managerMock.removeDemand).toHaveBeenCalledWith('chart:2');
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
