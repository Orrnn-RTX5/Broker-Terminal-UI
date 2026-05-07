/**
 * Connection Health Hook
 * Tracks WebSocket connection state and health metrics
 */

import { useState, useEffect, useRef } from 'react';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'offline' | 'stale';

export interface ConnectionMetrics {
  messagesReceived: number;
  reconnectAttempts: number;
  latency: number;
  uptime: number;
  serverUrl: string;
}

export interface ConnectionHealth {
  state: ConnectionState;
  lastMessageTime: number | null;
  lastUpdateAge: number; // seconds since last message
  metrics: ConnectionMetrics;
  isStale: boolean; // no message > 60s
  reconnect: () => void;
}

interface UseConnectionHealthOptions {
  wsRef: React.RefObject<WebSocket | null>;
  staleThresholdMs?: number; // default 60000 (60s)
  reconnectCallback?: () => void;
}

export function useConnectionHealth({
  wsRef,
  staleThresholdMs = 60000,
  reconnectCallback,
}: UseConnectionHealthOptions): ConnectionHealth {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [lastMessageTime, setLastMessageTime] = useState<number | null>(null);
  const [lastUpdateAge, setLastUpdateAge] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const [metrics, setMetrics] = useState<ConnectionMetrics>({
    messagesReceived: 0,
    reconnectAttempts: 0,
    latency: 0,
    uptime: 0,
    serverUrl: '',
  });

  const messageCountRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const connectTimeRef = useRef<number | null>(null);
  const pingStartTimeRef = useRef<number | null>(null);

  // Monitor WebSocket connection state
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) {
      setState('disconnected');
      return;
    }

    // Extract server URL
    setMetrics(prev => ({
      ...prev,
      serverUrl: ws.url,
    }));

    // Check initial state
    const updateStateFromReadyState = () => {
      const ws = wsRef.current;
      if (!ws) {
        setState('disconnected');
        return;
      }

      switch (ws.readyState) {
        case WebSocket.CONNECTING:
          setState('connecting');
          break;
        case WebSocket.OPEN:
          setState('connected');
          if (connectTimeRef.current === null) {
            connectTimeRef.current = Date.now();
          }
          break;
        case WebSocket.CLOSING:
        case WebSocket.CLOSED:
          setState('disconnected');
          connectTimeRef.current = null;
          break;
      }
    };

    // Initial state check
    updateStateFromReadyState();

    // Listen to WebSocket events
    const handleOpen = () => {
      console.log('[ConnectionHealth] WebSocket opened');
      setState('connected');
      connectTimeRef.current = Date.now();
      setMetrics(prev => ({
        ...prev,
        reconnectAttempts: reconnectAttemptsRef.current,
      }));
    };

    const handleMessage = () => {
      const now = Date.now();
      setLastMessageTime(now);
      messageCountRef.current++;
      setMetrics(prev => ({
        ...prev,
        messagesReceived: messageCountRef.current,
      }));

      // Calculate latency if we sent a ping
      if (pingStartTimeRef.current) {
        const latency = now - pingStartTimeRef.current;
        setMetrics(prev => ({
          ...prev,
          latency,
        }));
        pingStartTimeRef.current = null;
      }
    };

    const handleClose = (event: CloseEvent) => {
      console.log('[ConnectionHealth] WebSocket closed', event.code);
      setState('disconnected');
      connectTimeRef.current = null;

      // Track reconnect attempts (code 1006 = abnormal closure, likely reconnecting)
      if (event.code !== 1000 && event.code !== 1001) {
        reconnectAttemptsRef.current++;
        setMetrics(prev => ({
          ...prev,
          reconnectAttempts: reconnectAttemptsRef.current,
        }));
      } else {
        // Normal closure, reset attempts
        reconnectAttemptsRef.current = 0;
      }
    };

    const handleError = () => {
      console.error('[ConnectionHealth] WebSocket error');
      setState('disconnected');
    };

    ws.addEventListener('open', handleOpen);
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', handleError);

    // Periodic state check (in case WS changes)
    const stateCheckInterval = setInterval(updateStateFromReadyState, 1000);

    return () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('message', handleMessage);
      ws.removeEventListener('close', handleClose);
      ws.removeEventListener('error', handleError);
      clearInterval(stateCheckInterval);
    };
  }, [wsRef]);

  // Monitor network online/offline status
  useEffect(() => {
    const handleOnline = () => {
      console.log('[ConnectionHealth] Network online');
      if (state === 'offline') {
        setState('disconnected');
      }
    };

    const handleOffline = () => {
      console.log('[ConnectionHealth] Network offline');
      setState('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check
    if (!navigator.onLine) {
      setState('offline');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [state]);

  // Update lastUpdateAge and check for stale data
  useEffect(() => {
    const updateAgeInterval = setInterval(() => {
      if (lastMessageTime) {
        const ageMs = Date.now() - lastMessageTime;
        const ageSec = Math.floor(ageMs / 1000);
        setLastUpdateAge(ageSec);

        // Check if data is stale
        if (ageMs > staleThresholdMs && state === 'connected') {
          setIsStale(true);
          setState('stale');
        } else if (ageMs <= staleThresholdMs && state === 'stale') {
          setIsStale(false);
          setState('connected');
        }
      } else {
        setLastUpdateAge(0);
        setIsStale(false);
      }
    }, 1000);

    return () => clearInterval(updateAgeInterval);
  }, [lastMessageTime, staleThresholdMs, state]);

  // Update uptime
  useEffect(() => {
    if (connectTimeRef.current === null) {
      setMetrics(prev => ({ ...prev, uptime: 0 }));
      return;
    }

    const uptimeInterval = setInterval(() => {
      if (connectTimeRef.current !== null) {
        const uptimeMs = Date.now() - connectTimeRef.current;
        setMetrics(prev => ({
          ...prev,
          uptime: Math.floor(uptimeMs / 1000),
        }));
      }
    }, 1000);

    return () => clearInterval(uptimeInterval);
  }, [connectTimeRef.current]);

  // Reconnect function
  const reconnect = () => {
    console.log('[ConnectionHealth] Manual reconnect triggered');
    if (reconnectCallback) {
      reconnectCallback();
    } else {
      // Fallback: close current connection to trigger auto-reconnect
      wsRef.current?.close();
    }
  };

  return {
    state,
    lastMessageTime,
    lastUpdateAge,
    metrics,
    isStale,
    reconnect,
  };
}
