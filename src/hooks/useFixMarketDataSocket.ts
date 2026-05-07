/**
 * React Hook for Fix Market Data WebSocket
 * Connects to wss://fixapibackend.tradecopier.org/ws
 * Handles real-time tick and candle updates
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  getFixMarketDataSocket,
  FixMarketDataSocket,
  FixSocketState,
  FixTickMessage,
  FixCandleMessage,
} from '../services/fixMarketDataSocket';
import { FIX_WS_URL } from '../config/api';
import { useMarketDataStore } from '../store/useMarketDataStore';

export interface UseFixMarketDataSocketProps {
  symbols: string[];
  autoConnect?: boolean;
}

export interface UseFixMarketDataSocketReturn {
  isConnected: boolean;
  connectionState: FixSocketState;
  lastTick: FixTickMessage | null;
  lastCandle: FixCandleMessage | null;
  connect: () => void;
  disconnect: () => void;
  subscribe: (symbols: string[]) => void;
  unsubscribe: (symbols: string[]) => void;
}

export function useFixMarketDataSocket({
  symbols,
  autoConnect = true,
}: UseFixMarketDataSocketProps): UseFixMarketDataSocketReturn {
  const [connectionState, setConnectionState] = useState<FixSocketState>('disconnected');
  const [lastTick, setLastTick] = useState<FixTickMessage | null>(null);
  const [lastCandle, setLastCandle] = useState<FixCandleMessage | null>(null);

  const socketRef = useRef<FixMarketDataSocket | null>(null);
  const symbolsRef = useRef<string[]>(symbols);
  const isMountedRef = useRef(true);

  // Update symbols ref when props change
  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);

  // Initialize socket
  useEffect(() => {
    socketRef.current = getFixMarketDataSocket(FIX_WS_URL);

    // Listen for state changes
    const unsubscribeState = socketRef.current.onStateChange((state) => {
      if (isMountedRef.current) {
        setConnectionState(state);
      }
    });

    // Listen for messages
    const unsubscribeMessage = socketRef.current.onMessage((data) => {
      if (!isMountedRef.current) return;

      if (data.type === 'tick') {
        setLastTick(data);
      } else if (data.type === 'update' && data.candle) {
        setLastCandle(data);
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribeState();
      unsubscribeMessage();
    };
  }, []);

  // Auto-connect and subscribe to symbols
  useEffect(() => {
    if (!socketRef.current || !autoConnect) return;

    if (symbols.length > 0) {
      // Connect if not already connected
      if (socketRef.current.getState() === 'disconnected') {
        socketRef.current.connect();
      }

      // Subscribe to symbols
      socketRef.current.subscribe(symbols);
    }

    return () => {
      if (socketRef.current && symbols.length > 0) {
        socketRef.current.unsubscribe(symbols);
      }
    };
  }, [symbols, autoConnect]);

  const connect = useCallback(() => {
    socketRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
  }, []);

  const subscribe = useCallback((newSymbols: string[]) => {
    socketRef.current?.subscribe(newSymbols);
  }, []);

  const unsubscribe = useCallback((removeSymbols: string[]) => {
    socketRef.current?.unsubscribe(removeSymbols);
  }, []);

  return {
    isConnected: connectionState === 'connected',
    connectionState,
    lastTick,
    lastCandle,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
  };
}

/**
 * Hook for getting real-time price for a single symbol
 */
export function useSymbolPrice(symbol: string) {
  const tick = useMarketDataStore((state) => state.symbolData[symbol]?.currentTick);

  const { isConnected } = useFixMarketDataSocket({
    symbols: symbol ? [symbol] : [],
    autoConnect: !!symbol,
  });

  return {
    bid: tick?.bid ?? null,
    ask: tick?.ask ?? null,
    spread: tick?.spread ?? null,
    timestamp: tick?.timestamp ?? null,
    isConnected,
  };
}

/**
 * Hook for getting candles for a symbol
 */
export function useSymbolCandles(symbol: string, timeframe: '1m' | '5m' | '15m' | '1h' = '1m') {
  const candles = useMarketDataStore((state) => {
    const data = state.symbolData[symbol];
    if (!data) return [];

    switch (timeframe) {
      case '1m':
        return data.ohlcv1m;
      case '5m':
        return data.ohlcv5m;
      case '15m':
        return data.ohlcv15m;
      case '1h':
        return data.ohlcv1h;
      default:
        return data.ohlcv1m;
    }
  });

  const { isConnected, lastCandle } = useFixMarketDataSocket({
    symbols: symbol ? [symbol] : [],
    autoConnect: !!symbol,
  });

  return {
    candles,
    lastCandle,
    isConnected,
  };
}
