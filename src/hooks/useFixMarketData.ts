import { useState, useRef, useEffect, useCallback } from 'react';
import * as endpoints from '../api/endpoints';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { getFixMarketDataSocket } from '../services/fixMarketDataSocket';
import {
  candleAggregationService,
  CandleData,
  Timeframe,
} from '../services/candleAggregationService';

// Re-export CandleData for components using this hook
export type { CandleData };

interface UseFixMarketDataProps {
  symbol: string;
  timeframe: string;
  onCandleUpdate?: (candle: CandleData) => void;
}

const VALID_TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];

function isValidTimeframe(tf: string): tf is Timeframe {
  return VALID_TIMEFRAMES.includes(tf as Timeframe);
}

export function useFixMarketData({
  symbol,
  timeframe,
  onCandleUpdate,
}: UseFixMarketDataProps) {
  // State
  const [status, setStatus] = useState('Initializing...');
  const [isConnected, setIsConnected] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [allSymbolsList, setAllSymbolsList] = useState<string[]>([]);
  const [tickCount, setTickCount] = useState(0);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [candleCount, setCandleCount] = useState(0);
  const [historicalData, setHistoricalData] = useState<CandleData[]>([]);

  // Refs
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const lastHistoricalLoadRef = useRef<number>(0);

  // Sync refs with props
  const timeframeRef = useRef(timeframe);
  const symbolRef = useRef(symbol);
  const onCandleUpdateRef = useRef(onCandleUpdate);

  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);
  useEffect(() => { onCandleUpdateRef.current = onCandleUpdate; }, [onCandleUpdate]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  /**
   * Get current timeframe as valid Timeframe type
   */
  const getCurrentTimeframe = useCallback((): Timeframe => {
    const tf = timeframeRef.current.toUpperCase();
    return isValidTimeframe(tf) ? tf : 'M1';
  }, []);

  /**
   * Update candles from aggregation service
   */
  const updateCandlesFromService = useCallback(() => {
    const currentTf = getCurrentTimeframe();
    const candles = candleAggregationService.getCandles(symbolRef.current, currentTf, true, true);

    if (candles.length > 0) {
      setHistoricalData(candles);
      setCandleCount(candles.length);
      setLastPrice(candles[candles.length - 1].close);

      // Notify callback with latest candle
      const latestCandle = candles[candles.length - 1];
      onCandleUpdateRef.current?.(latestCandle);
    }
  }, [getCurrentTimeframe]);

  /**
   * Load historical data from API
   */
  const loadHistoricalData = useCallback(async (sym: string, tf: Timeframe, retryCount = 0) => {
    setStatus(`Loading ${sym} (${tf})...`);

    try {
      // Fetch candles from backend using FIX API endpoint
      console.log(`[useFixMarketData] Fetching candles for ${sym} (${tf})...`);
      const candles = await endpoints.marketApi.getOHLC(sym, tf, 200);

      if (!candles || candles.length === 0) {
        console.warn(`[useFixMarketData] No candles returned for ${sym}`);
        setStatus(`${sym} ${tf} - No data - waiting for FIX feed...`);
        return;
      }

      console.log(`[useFixMarketData] Loaded ${candles.length} candles for ${sym}`);

      // Normalize and transform candles
      const normalizedCandles: CandleData[] = candles.map((c: any) => ({
        time: c.time > 1_000_000_000_000 ? Math.floor(c.time / 1000) : c.time,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume) || 0,
        isComplete: true,
      }));

      // Sort chronologically
      normalizedCandles.sort((a, b) => a.time - b.time);

      // Load into aggregation service
      candleAggregationService.loadHistoricalCandles(sym, tf, normalizedCandles);

      // Update state
      setHistoricalData(normalizedCandles);
      setCandleCount(normalizedCandles.length);
      setLastPrice(normalizedCandles[normalizedCandles.length - 1].close);

      setStatus(`${sym} ${tf} - ${normalizedCandles.length} candles loaded`);
      lastHistoricalLoadRef.current = Date.now();
    } catch (err: any) {
      console.error('[useFixMarketData] Error loading historical:', err);
      setStatus(`Error loading ${sym}: ${err.message}`);

      if (retryCount < 3 && isMountedRef.current) {
        setTimeout(() => {
          if (isMountedRef.current) loadHistoricalData(sym, tf, retryCount + 1);
        }, 2000);
      }
    }
  }, []);

  /**
   * Load available symbols
   */
  const loadSymbols = useCallback(async () => {
    try {
      const apiSymbols = await endpoints.marketApi.getSymbols();
      const fetchedSymbols = apiSymbols.map(s => s.id || s.name);
      if (fetchedSymbols.length > 0) {
        setAllSymbolsList(fetchedSymbols);
        setAvailableSymbols(fetchedSymbols);
      }
    } catch (e) {
      console.error('Failed to load symbols array', e);
    }
  }, []);

  /**
   * Process incoming WebSocket tick
   */
  const processTick = useCallback((tickInfo: any) => {
    if (!tickInfo.symbol || !tickInfo.bid) return;

    // Build tick object
    const tick = {
      symbol: tickInfo.symbol,
      bid: tickInfo.bid,
      ask: tickInfo.ask || tickInfo.bid,
      timestamp: tickInfo.timestamp || Date.now(),
      volume: 1,
    };

    // Process through aggregation service
    const updates = candleAggregationService.processTick(tick);

    // Update tick count
    setTickCount(prev => prev + 1);

    // Update price
    setLastPrice((tick.bid + tick.ask) / 2);

    // Get current timeframe update
    const currentTf = getCurrentTimeframe();
    const updatedCandle = updates.get(currentTf);

    if (updatedCandle) {
      // Update historical data with new candle — always return a new array so React detects the change
      setHistoricalData(prev => {
        const lastIndex = prev.findIndex(c => c.time === updatedCandle.time);

        if (lastIndex >= 0) {
          // Update existing candle — spread to guarantee new reference
          return [
            ...prev.slice(0, lastIndex),
            updatedCandle,
            ...prev.slice(lastIndex + 1),
          ];
        } else {
          // New candle — append
          return [...prev, updatedCandle];
        }
      });

      // Notify callback
      onCandleUpdateRef.current?.(updatedCandle);
    }
  }, [getCurrentTimeframe]);

  /**
   * Connect to WebSocket
   */
  const connectWebSocket = useCallback(() => {
    try {
      // Clean up existing subscription
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      const currentSym = symbolRef.current;
      const tickChannel = `quotes.${currentSym}`;

      console.log(`[useFixMarketData] Subscribing to ${tickChannel}...`);

      const wsService = getEnhancedWebSocketService();
      setIsConnected(wsService.getState() === 'connected');

      const handleWsMessage = (msg: any) => {
        if (!isMountedRef.current) return;

        try {
          const payload = msg.data || msg;

          // Handle tick data
          if (msg.type === 'channel_message' &&
              (msg.channel === tickChannel || msg.channel === 'prices')) {

            const tickInfo = payload;
            if (tickInfo.symbol === symbolRef.current) {
              processTick(tickInfo);
            }
          }
        } catch (err) {
          console.error('[useFixMarketData] WS message error:', err);
        }
      };

      // Subscribe to WebSocket
      unsubscribeRef.current = wsService.subscribe(tickChannel, handleWsMessage);

      // Monitor connection state
      const unbindStatus = wsService.onStateChange((state) => {
        setIsConnected(state === 'connected');

        if (state === 'error') {
          setStatus('Connection error');
        }

        // Resubscribe on reconnect
        if (state === 'connected') {
          wsService.sendMessage({
            type: 'subscribe',
            channel: tickChannel,
          });
        }
      });

      // Subscribe immediately if already connected
      if (wsService.getState() === 'connected') {
        wsService.sendMessage({
          type: 'subscribe',
          channel: tickChannel,
        });
      }

      // Combined unsubscribe function
      const originalUnsubscribe = unsubscribeRef.current;
      unsubscribeRef.current = () => {
        originalUnsubscribe();
        unbindStatus();
        try {
          wsService.sendMessage({
            type: 'unsubscribe',
            channel: tickChannel,
          });
        } catch (e) { /* ignore */ }
      };

    } catch (err) {
      console.error('[useFixMarketData] WS error:', err);
      if (isMountedRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) connectWebSocket();
        }, 5000);
      }
    }
  }, [processTick]);

  /**
   * Refresh data manually
   */
  const refreshData = useCallback(() => {
    const currentTf = getCurrentTimeframe();
    loadHistoricalData(symbol, currentTf);
  }, [symbol, getCurrentTimeframe, loadHistoricalData]);

  // Effects

  // Load historical data on symbol/timeframe change
  useEffect(() => {
    const currentTf = isValidTimeframe(timeframe) ? timeframe : 'M1';
    loadHistoricalData(symbol, currentTf);
  }, [symbol, timeframe, loadHistoricalData]);

  // Connect WebSocket on mount
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [connectWebSocket]);

  // Load symbols on mount
  useEffect(() => {
    loadSymbols();
  }, [loadSymbols]);

  // Periodic refresh of historical data (every 30 seconds instead of 3)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      const now = Date.now();
      // Only refresh if we haven't loaded in the last 25 seconds
      if (now - lastHistoricalLoadRef.current > 25000) {
        const currentTf = getCurrentTimeframe();
        loadHistoricalData(symbolRef.current, currentTf);
      }
    }, 30000);

    return () => clearInterval(refreshInterval);
  }, [getCurrentTimeframe, loadHistoricalData]);

  // Subscribe to FIX socket candle 'update' messages to drive new-candle creation
  // The FIX socket sends finalized server-side candles every minute (type='update').
  // Without this, the chart only gets new candles when a tick straddles a minute
  // boundary OR after the 30-second periodic reload — causing the "no new candle" bug.
  useEffect(() => {
    const fixSocket = getFixMarketDataSocket();

    const unsubscribe = fixSocket.onMessage((msg) => {
      if (!isMountedRef.current) return;
      if (msg.type !== 'update' || !msg.candle) return;
      if (msg.symbol !== symbolRef.current) return;

      // Only process M1 candles (the server always sends M1)
      const currentTf = getCurrentTimeframe();
      if (currentTf !== 'M1') return;

      const serverCandle: CandleData = {
        time: msg.candle.time,       // already Unix seconds
        open: msg.candle.open,
        high: msg.candle.high,
        low: msg.candle.low,
        close: msg.candle.close,
        volume: msg.candle.volume,
      };

      setHistoricalData(prev => {
        const lastIndex = prev.findIndex(c => c.time === serverCandle.time);

        if (lastIndex >= 0) {
          // Update existing (forming) candle with latest server data
          return [
            ...prev.slice(0, lastIndex),
            serverCandle,
            ...prev.slice(lastIndex + 1),
          ];
        } else {
          // Brand new candle — new minute has started!
          return [...prev, serverCandle];
        }
      });

      // Push directly to the lightweight-charts series for zero-lag rendering
      onCandleUpdateRef.current?.(serverCandle);
    });

    return () => unsubscribe();
  }, [getCurrentTimeframe]);

  return {
    status,
    isConnected,
    tickCount,
    lastPrice,
    candleCount,
    historicalData,
    availableSymbols,
    allSymbolsList,
    refreshData,
  };
}
