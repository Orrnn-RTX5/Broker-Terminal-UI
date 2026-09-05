/**
 * WebSocket Hook
 * React hook that wraps the enhanced WebSocket service with auto-connect,
 * cleanup, and integration with Zustand store for global connection state
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getEnhancedWebSocketService,
  releaseEnhancedWebSocketService,
} from '../services/websocket-enhanced';
import { useWebSocketStore } from '../store/useWebSocketStore';
import { MARKET_WS_URL } from '../config/api';
import type { WebSocketMessage, ConnectionState, ConnectionMetrics } from '../services/websocket-enhanced';

export interface UseWebSocketOptions {
  url?: string;
  autoConnect?: boolean;
  channel?: string;
}

export interface UseWebSocketReturn<T = unknown> {
  // Connection state
  isConnected: boolean;
  connectionState: ConnectionState;
  isStale: boolean;

  // Metrics
  latency: number;
  reconnectCount: number;
  metrics: ConnectionMetrics;

  // Data
  data: T | null;

  // Actions
  sendMessage: (message: WebSocketMessage) => void;
  subscribe: (channel: string, callback: (data: unknown) => void) => () => void;
  subscribeSymbols: (symbols: string[], callback: (data: unknown) => void) => () => void;
  reconnect: () => void;
  disconnect: () => void;
}

export function useWebSocket<T = unknown>(
  options: UseWebSocketOptions | string = {}
): UseWebSocketReturn<T> {
  // Normalize options (support both string channel and options object)
  const opts: UseWebSocketOptions = typeof options === 'string'
    ? { channel: options, autoConnect: true }
    : { autoConnect: true, ...options };

  const { url = MARKET_WS_URL, autoConnect = true, channel } = opts;

  // Local state
  const [data, setData] = useState<T | null>(null);

  // Zustand store state
  const connectionState = useWebSocketStore((state) => state.legacyConnectionState);
  const isStale = useWebSocketStore((state) => state.isStale);
  const metrics = useWebSocketStore((state) => state.legacyMetrics);
  const setConnectionState = useWebSocketStore((state) => state.setConnectionState);
  const updateMetrics = useWebSocketStore((state) => state.updateMetrics);
  const updateLastMessageTime = useWebSocketStore((state) => state.updateLastMessageTime);

  // FIX: Bind every effect to the URL-keyed service so broker URL changes also
  // rebind connection state, metrics, and channel ownership.
  const wsService = useMemo(() => getEnhancedWebSocketService(url), [url]);

  // Derived state
  const isConnected = connectionState === 'connected';

  // Integrate enhanced service with Zustand store
  useEffect(() => {
    const ws = wsService;

    // Subscribe to state changes
    const unsubscribeState = ws.onStateChange((state) => {
      setConnectionState(state, 'legacy_mt5');
    });

    // Subscribe to metrics changes
    const unsubscribeMetrics = ws.onMetricsChange((newMetrics) => {
      updateMetrics(newMetrics, 'legacy_mt5');
    });

    return () => {
      unsubscribeState();
      unsubscribeMetrics();
    };
  }, [setConnectionState, updateMetrics, wsService]);

  useEffect(() => {
    // FIX: Release an abandoned URL-keyed transport after every consumer has
    // detached. This prevents an old broker socket from reconnecting on later
    // session events and repainting the current account's stores.
    return () => releaseEnhancedWebSocketService(wsService);
  }, [wsService]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      wsService.connect();
    }
  }, [autoConnect, wsService]);

  // Subscribe to channel if provided
  useEffect(() => {
    if (!channel) return;

    const unsubscribe = wsService.subscribe(channel, (message) => {
      setData(message as T);
      updateLastMessageTime(Date.now());
    });

    return () => {
      // FIX: Each effect owns its exact subscription. Toggling autoConnect must
      // never tear down a stable channel or unsubscribe another render's owner.
      unsubscribe();
    };
  }, [channel, updateLastMessageTime, wsService]);

  // Actions
  const sendMessage = useCallback((message: WebSocketMessage) => {
    wsService.sendMessage(message);
  }, [wsService]);

  const subscribe = useCallback((subscribeChannel: string, callback: (data: unknown) => void) => {
    return wsService.subscribe(subscribeChannel, callback);
  }, [wsService]);

  const subscribeSymbols = useCallback((symbols: string[], callback: (data: unknown) => void) => {
    return wsService.subscribeSymbols(symbols, callback);
  }, [wsService]);

  const reconnect = useCallback(() => {
    wsService.forceReconnect();
  }, [wsService]);

  const disconnect = useCallback(() => {
    wsService.disconnect();
  }, [wsService]);

  return {
    // Connection state
    isConnected,
    connectionState: connectionState as any,
    isStale,

    // Metrics
    latency: metrics.lastLatency,
    reconnectCount: metrics.reconnectAttempts,
    metrics,

    // Data
    data,

    // Actions
    sendMessage,
    subscribe,
    subscribeSymbols,
    reconnect,
    disconnect,
  };
}
