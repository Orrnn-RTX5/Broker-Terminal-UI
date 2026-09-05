// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEnhancedWebSocketServiceMock = vi.hoisted(() => vi.fn());
const releaseEnhancedWebSocketServiceMock = vi.hoisted(() => vi.fn());

vi.mock('../services/websocket-enhanced', () => ({
  getEnhancedWebSocketService: getEnhancedWebSocketServiceMock,
  releaseEnhancedWebSocketService: releaseEnhancedWebSocketServiceMock,
}));

import { useWebSocket } from './useWebSocket';
import { useWebSocketStore, type ConnectionState } from '../store/useWebSocketStore';

type StateListener = (state: ConnectionState) => void;
type MetricsListener = (metrics: {
  messagesSent: number;
  messagesReceived: number;
  reconnectAttempts: number;
  lastLatency: number;
  averageLatency: number;
  uptime: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
}) => void;
type ChannelListener = (message: unknown) => void;

const createServiceHarness = () => {
  const stateListeners = new Set<StateListener>();
  const metricsListeners = new Set<MetricsListener>();
  const channelListeners = new Map<string, Set<ChannelListener>>();

  const service = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    forceReconnect: vi.fn(),
    sendMessage: vi.fn(),
    subscribeSymbols: vi.fn(() => vi.fn()),
    onStateChange: vi.fn((listener: StateListener) => {
      stateListeners.add(listener);
      return vi.fn(() => stateListeners.delete(listener));
    }),
    onMetricsChange: vi.fn((listener: MetricsListener) => {
      metricsListeners.add(listener);
      return vi.fn(() => metricsListeners.delete(listener));
    }),
    subscribe: vi.fn((channel: string, listener: ChannelListener) => {
      const listeners = channelListeners.get(channel) ?? new Set<ChannelListener>();
      listeners.add(listener);
      channelListeners.set(channel, listeners);
      return vi.fn(() => {
        listeners.delete(listener);
        if (listeners.size === 0) channelListeners.delete(channel);
      });
    }),
  };

  return {
    service,
    activeStateListeners: () => stateListeners.size,
    activeMetricsListeners: () => metricsListeners.size,
    activeChannelListeners: (channel: string) => channelListeners.get(channel)?.size ?? 0,
    emitState: (state: ConnectionState) => stateListeners.forEach((listener) => listener(state)),
    emitChannel: (channel: string, message: unknown) => {
      channelListeners.get(channel)?.forEach((listener) => listener(message));
    },
  };
};

const emptyMetrics = {
  messagesSent: 0,
  messagesReceived: 0,
  reconnectAttempts: 0,
  lastLatency: 0,
  averageLatency: 0,
  uptime: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
};

describe('useWebSocket URL-keyed service contract', () => {
  beforeEach(() => {
    getEnhancedWebSocketServiceMock.mockReset();
    releaseEnhancedWebSocketServiceMock.mockReset();
    useWebSocketStore.setState({
      connectionState: 'disconnected',
      legacyConnectionState: 'disconnected',
      fixConnectionState: 'disconnected',
      isStale: false,
      lastMessageTime: null,
      legacyMetrics: { ...emptyMetrics },
      fixMetrics: { ...emptyMetrics },
    });
  });

  it('rebinds state, metrics, and channel ownership when the URL changes', () => {
    const channel = 'ticks.XAUUSD';
    const firstUrl = 'wss://one.example.test/ws/v2';
    const secondUrl = 'wss://two.example.test/ws/v2';
    const first = createServiceHarness();
    const second = createServiceHarness();
    const services = new Map<string, ReturnType<typeof createServiceHarness>['service']>([
      [firstUrl, first.service],
      [secondUrl, second.service],
    ]);
    getEnhancedWebSocketServiceMock.mockImplementation((url: string) => services.get(url));

    const { result, rerender, unmount } = renderHook(
      ({ url }) => useWebSocket<{ owner: string }>({ url, channel, autoConnect: true }),
      { initialProps: { url: firstUrl } },
    );

    expect(getEnhancedWebSocketServiceMock).toHaveBeenCalledWith(firstUrl);
    expect(first.service.connect).toHaveBeenCalledOnce();
    expect(first.activeStateListeners()).toBe(1);
    expect(first.activeMetricsListeners()).toBe(1);
    expect(first.activeChannelListeners(channel)).toBe(1);

    act(() => {
      first.emitState('connected');
      first.emitChannel(channel, { owner: 'first' });
    });
    expect(result.current.connectionState).toBe('connected');
    expect(result.current.data).toEqual({ owner: 'first' });

    rerender({ url: secondUrl });

    expect(getEnhancedWebSocketServiceMock).toHaveBeenCalledWith(secondUrl);
    expect(first.activeStateListeners()).toBe(0);
    expect(first.activeMetricsListeners()).toBe(0);
    expect(first.activeChannelListeners(channel)).toBe(0);
    expect(first.service.disconnect).not.toHaveBeenCalled();
    expect(second.service.connect).toHaveBeenCalledOnce();
    expect(second.activeStateListeners()).toBe(1);
    expect(second.activeMetricsListeners()).toBe(1);
    expect(second.activeChannelListeners(channel)).toBe(1);

    act(() => {
      first.emitState('error');
      first.emitChannel(channel, { owner: 'detached-first' });
    });
    expect(result.current.connectionState).toBe('connected');
    expect(result.current.data).toEqual({ owner: 'first' });

    act(() => {
      second.emitState('reconnecting');
      second.emitChannel(channel, { owner: 'second' });
    });
    expect(result.current.connectionState).toBe('reconnecting');
    expect(result.current.data).toEqual({ owner: 'second' });

    unmount();
    expect(second.activeStateListeners()).toBe(0);
    expect(second.activeMetricsListeners()).toBe(0);
    expect(second.activeChannelListeners(channel)).toBe(0);
    expect(second.service.disconnect).not.toHaveBeenCalled();
    expect(releaseEnhancedWebSocketServiceMock).toHaveBeenCalledWith(first.service);
    expect(releaseEnhancedWebSocketServiceMock).toHaveBeenCalledWith(second.service);
  });

  it('keeps a stable channel subscribed when autoConnect toggles', () => {
    const url = 'wss://one.example.test/ws/v2';
    const channel = 'ticks.XAUUSD';
    const harness = createServiceHarness();
    getEnhancedWebSocketServiceMock.mockReturnValue(harness.service);

    const { rerender, unmount } = renderHook(
      ({ autoConnect }) => useWebSocket({ url, channel, autoConnect }),
      { initialProps: { autoConnect: true } },
    );
    expect(harness.activeChannelListeners(channel)).toBe(1);

    rerender({ autoConnect: false });
    expect(harness.activeChannelListeners(channel)).toBe(1);

    rerender({ autoConnect: true });
    expect(harness.activeChannelListeners(channel)).toBe(1);

    unmount();
    expect(harness.activeChannelListeners(channel)).toBe(0);
    expect(releaseEnhancedWebSocketServiceMock).toHaveBeenCalledOnce();
  });

  it('uses the memoized URL-keyed service for a forced reconnect', () => {
    const source = readFileSync('src/hooks/useWebSocket.ts', 'utf8');
    const reconnectStart = source.indexOf('const reconnect = useCallback');
    const reconnectEnd = source.indexOf('const disconnect = useCallback', reconnectStart);
    const reconnect = source.slice(reconnectStart, reconnectEnd);

    expect(source).toContain('useMemo(() => getEnhancedWebSocketService(url), [url])');
    expect(reconnect).toContain('wsService.forceReconnect()');
    expect(reconnect).not.toContain('wsService.current');
  });
});
