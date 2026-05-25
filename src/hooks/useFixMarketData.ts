import { useState, useRef, useEffect, useCallback } from 'react';
import * as endpoints from '../api/endpoints';
import {
  candleAggregationService,
  CandleData,
  Timeframe,
} from '../services/candleAggregationService';
import { getCandleSocketManager } from '../services/candleSocketManager';

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

function toValidTimeframe(tf: string): Timeframe {
  const upperTf = tf.toUpperCase();
  return isValidTimeframe(upperTf) ? upperTf : 'M1';
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
    return toValidTimeframe(timeframeRef.current);
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

  const normalizeCandle = useCallback((candle: any): CandleData | null => {
    if (!candle) return null;
    const time = Number(candle.time);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);

    if (![time, open, high, low, close].every(Number.isFinite)) {
      return null;
    }

    return {
      time: time > 1_000_000_000_000 ? Math.floor(time / 1000) : time,
      open,
      high,
      low,
      close,
      volume: Number(candle.volume ?? candle.tick_count) || 0,
      isComplete: true,
    };
  }, []);

  const applyServerCandles = useCallback((
    candlesInput: any,
    options: { timeframe?: Timeframe; isSnapshot?: boolean } = {},
  ) => {
    const normalizedCandles = (Array.isArray(candlesInput) ? candlesInput : [candlesInput])
      .map(normalizeCandle)
      .filter((candle): candle is CandleData => candle !== null)
      .sort((a, b) => a.time - b.time);

    if (normalizedCandles.length === 0) return;

    const targetTimeframe = options.timeframe ?? getCurrentTimeframe();

    if (Array.isArray(candlesInput) || options.isSnapshot) {
      candleAggregationService.loadHistoricalCandles(
        symbolRef.current,
        targetTimeframe,
        normalizedCandles
      );
    } else {
      candleAggregationService.addCompletedCandle(
        symbolRef.current,
        targetTimeframe,
        normalizedCandles[0]
      );
    }

    const visibleCandles = candleAggregationService.getCandles(
      symbolRef.current,
      getCurrentTimeframe(),
      true,
      true
    );

    const candlesToDisplay = visibleCandles.length > 0 ? visibleCandles : normalizedCandles;
    const latestCandle = candlesToDisplay[candlesToDisplay.length - 1];

    setHistoricalData(candlesToDisplay);
    setCandleCount(candlesToDisplay.length);
    setLastPrice(latestCandle.close);
    onCandleUpdateRef.current?.(latestCandle);
  }, [getCurrentTimeframe, normalizeCandle]);

  /**
   * Load historical data from API
   */
  const loadHistoricalData = useCallback(async (sym: string, tf: Timeframe, retryCount = 0) => {
    setStatus(`Loading ${sym} (${tf})...`);

    try {
      console.log(`[useFixMarketData] Fetching history candles for ${sym} (${tf})...`);
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
        volume: Number(c.volume ?? c.tick_count) || 0,
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
    if (!tickInfo.symbol && !tickInfo.bid) return;

    // Build tick object
    const tick = {
      symbol: tickInfo.symbol || symbolRef.current,
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
   * Connect to WebSocket — uses CandleSocketManager (Section 3 of WS flow).
   * Ref-counted: multiple chart instances with the same SYMBOL.TIMEFRAME share one subscription.
   */
  const connectWebSocket = useCallback(() => {
    try {
      // Clean up existing subscription
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      const currentSym = symbol;
      const currentTf = toValidTimeframe(timeframe);

      console.log(`[useFixMarketData] Subscribing via CandleSocketManager: ${currentSym}.${currentTf}`);

      const manager = getCandleSocketManager();
      setIsConnected(manager.isConnected());

      // Candle callback — when server sends a completed or updated candle
      const handleCandle = (candlePayload: any) => {
        if (!isMountedRef.current) return;
        try {
          applyServerCandles(candlePayload, {
            timeframe: currentTf,
            isSnapshot: false,
          });
        } catch (err) {
          console.error('[useFixMarketData] Candle handler error:', err);
        }
      };

      // Tick callback — realtime ticks move the active candle
      const handleTick = (tickInfo: any) => {
        if (!isMountedRef.current) return;
        try {
          processTick(tickInfo);
        } catch (err) {
          console.error('[useFixMarketData] Tick handler error:', err);
        }
      };

      // Subscribe (ref-counted deduplication by SYMBOL.TIMEFRAME)
      const { unsubscribe } = manager.subscribe(currentSym, currentTf, handleCandle, handleTick);
      unsubscribeRef.current = unsubscribe;

    } catch (err) {
      console.error('[useFixMarketData] WS error:', err);
      if (isMountedRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) connectWebSocket();
        }, 5000);
      }
    }
  }, [
    applyServerCandles,
    processTick,
    symbol,
    timeframe,
  ]);

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
    const currentTf = toValidTimeframe(timeframe);
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
