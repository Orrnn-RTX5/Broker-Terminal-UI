/**
 * WebSocket Connection State Store
 * Centralized Zustand store for WebSocket connection status and metrics
 */

import { create } from 'zustand';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'offline';

export interface ConnectionMetrics {
  messagesSent: number;
  messagesReceived: number;
  reconnectAttempts: number;
  lastLatency: number;
  averageLatency: number;
  uptime: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
}

interface WebSocketStoreState {
  // Connection state
  connectionState: ConnectionState; // The global UI indicator (mirrors fix_socket strictly)
  legacyConnectionState: ConnectionState; // Actual state of MT5 socket
  fixConnectionState: ConnectionState; // Actual state of FIX socket
  isStale: boolean;
  lastMessageTime: number | null;

  // Metrics
  fixMetrics: ConnectionMetrics;
  legacyMetrics: ConnectionMetrics;

  // Actions
  setConnectionState: (state: ConnectionState, source?: 'fix_socket' | 'legacy_mt5') => void;
  updateMetrics: (metrics: Partial<ConnectionMetrics>, source?: 'fix_socket' | 'legacy_mt5') => void;
  markStale: (stale: boolean) => void;
  updateLastMessageTime: (time: number) => void;
  resetReconnectAttempts: (source?: 'fix_socket' | 'legacy_mt5') => void;
  incrementReconnectAttempts: (source?: 'fix_socket' | 'legacy_mt5') => void;
}

// NOTE: Socket states are tracked INSIDE the Zustand store (fixConnectionState,
// legacyConnectionState) so they survive Vite HMR module reloads.

const initialMetrics: ConnectionMetrics = {
  messagesSent: 0,
  messagesReceived: 0,
  reconnectAttempts: 0,
  lastLatency: 0,
  averageLatency: 0,
  uptime: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
};

export const useWebSocketStore = create<WebSocketStoreState>((set) => ({
  // Initial state
  connectionState: 'disconnected',
  legacyConnectionState: 'disconnected',
  fixConnectionState: 'disconnected',
  isStale: false,
  lastMessageTime: null,

  fixMetrics: { ...initialMetrics },
  legacyMetrics: { ...initialMetrics },

  // Actions
  setConnectionState: (newState, source) =>
    set((prev) => {
      const fixState = source === 'fix_socket' ? newState : prev.fixConnectionState;
      const legacyState = source === 'legacy_mt5' ? newState : prev.legacyConnectionState;

      // Determine the most optimistic connection state for the UI indicator.
      // If either socket is fully connected, the app is "Connected".
      let nextUiState: ConnectionState = legacyState;
      if (fixState === 'connected' || legacyState === 'connected') {
        nextUiState = 'connected';
      } else if (fixState !== 'disconnected') {
        nextUiState = fixState;
      }

      return {
        fixConnectionState: fixState,
        legacyConnectionState: legacyState,
        connectionState: nextUiState,
      };
    }),

  updateMetrics: (metricsUpdate, source) =>
    set((state) => {
      if (source === 'legacy_mt5') {
        return { legacyMetrics: { ...state.legacyMetrics, ...metricsUpdate } };
      }
      return { fixMetrics: { ...state.fixMetrics, ...metricsUpdate } };
    }),

  markStale: (isStale) => set({ isStale }),

  updateLastMessageTime: (lastMessageTime) => set({ lastMessageTime, isStale: false }),

  resetReconnectAttempts: (source) =>
    set((state) => {
      if (source === 'legacy_mt5') {
         return { legacyMetrics: { ...state.legacyMetrics, reconnectAttempts: 0 } };
      }
      return { fixMetrics: { ...state.fixMetrics, reconnectAttempts: 0 } };
    }),

  incrementReconnectAttempts: (source) =>
    set((state) => {
      if (source === 'legacy_mt5') {
         return { legacyMetrics: { ...state.legacyMetrics, reconnectAttempts: state.legacyMetrics.reconnectAttempts + 1 } };
      }
      return { fixMetrics: { ...state.fixMetrics, reconnectAttempts: state.fixMetrics.reconnectAttempts + 1 } };
    }),
}));
