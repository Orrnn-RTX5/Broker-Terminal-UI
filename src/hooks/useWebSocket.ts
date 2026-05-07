/**
 * WebSocket Hook
 * React hook that wraps the enhanced WebSocket service with auto-connect,
 * cleanup, and integration with Zustand store for global connection state
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
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

  // WebSocket service instance (singleton)
  const wsService = useRef(getEnhancedWebSocketService(url));
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Derived state
  const isConnected = connectionState === 'connected';

  // Integrate enhanced service with Zustand store
  useEffect(() => {
    const ws = wsService.current;

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
  }, [setConnectionState, updateMetrics]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      wsService.current.connect();
    }

    // Cleanup on unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      // Note: Don't disconnect the singleton on unmount
      // Other components might still be using it
    };
  }, [autoConnect]);

  // Subscribe to channel if provided
  useEffect(() => {
    if (!channel) return;

    const unsubscribe = wsService.current.subscribe(channel, (message) => {
      setData(message as T);
      updateLastMessageTime(Date.now());
    });

    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [channel, updateLastMessageTime]);

  // Actions
  const sendMessage = useCallback((message: WebSocketMessage) => {
    wsService.current.sendMessage(message);
  }, []);

  const subscribe = useCallback((subscribeChannel: string, callback: (data: unknown) => void) => {
    return wsService.current.subscribe(subscribeChannel, callback);
  }, []);

  const subscribeSymbols = useCallback((symbols: string[], callback: (data: unknown) => void) => {
    return wsService.current.subscribeSymbols(symbols, callback);
  }, []);

  const reconnect = useCallback(() => {
    wsService.current.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsService.current.disconnect();
  }, []);

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
