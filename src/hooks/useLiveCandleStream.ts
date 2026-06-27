/**
 * useLiveCandleStream — React hook for Section 3 (Chart Candle /ws/v2)
 *
 * Wraps CandleSocketManager with ref-counted subscriptions.
 * Merges live candle updates with REST history via candleAggregationService.
 *
 * Usage:
 *   const { candles, isConnected, lastUpdate } = useLiveCandleStream('EURUSD', 'M1');
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCandleSocketManager, type CandlePayload } from '../services/candleSocketManager';
import {
  candleAggregationService,
  type CandleData,
  type Timeframe,
} from '../services/candleAggregationService';
import { useAppStore } from '../store/useAppStore';

const VALID_TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];

function toValidTimeframe(tf: string): Timeframe {
  const upper = tf.toUpperCase();
  return VALID_TIMEFRAMES.includes(upper as Timeframe) ? (upper as Timeframe) : 'M1';
}

export interface UseLiveCandleStreamReturn {
  candles: CandleData[];
  isConnected: boolean;
  lastUpdate: number | null;
}

export function useLiveCandleStream(
  symbol: string,
  timeframe: string,
  onCandleUpdate?: (candle: CandleData) => void,
): UseLiveCandleStreamReturn {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const onCandleUpdateRef = useRef(onCandleUpdate);
  onCandleUpdateRef.current = onCandleUpdate;

  const validTimeframe = toValidTimeframe(timeframe);

  // Step 8: Canonical candle engine — ingest live candle
  const handleCandle = useCallback((payload: CandlePayload) => {
    // Normalize to CandleData format
    const candle: CandleData = {
      time: payload.time > 1_000_000_000_000 ? Math.floor(payload.time / 1000) : payload.time,
      open: payload.open,
      high: payload.high,
      low: payload.low,
      close: payload.close,
      volume: payload.volume,
      isComplete: false,
    };

    // Step 9: Merge live + history — via candleAggregationService
    candleAggregationService.addCompletedCandle(symbol, validTimeframe, candle);

    // Get merged candles (REST history + live)
    const merged = candleAggregationService
      .getCandles(symbol, validTimeframe, true, false)
      .filter(candle => !candle.isSynthetic);
    setCandles(merged);
    setLastUpdate(Date.now());

    // Notify callback
    onCandleUpdateRef.current?.(candle);
  }, [symbol, validTimeframe]);

  // Step 7: Quote tick extension — tick moves active candle
  const handleTick = useCallback((tick: { symbol: string; bid: number; ask: number; timestamp: number }) => {
    const tickData = {
      symbol: tick.symbol,
      bid: tick.bid,
      ask: tick.ask,
      timestamp: tick.timestamp,
      volume: 1,
    };

    // Process through aggregation service (updates the active candle)
    candleAggregationService.processTick(tickData);

    // Get updated candles
    const merged = candleAggregationService
      .getCandles(symbol, validTimeframe, true, false)
      .filter(candle => !candle.isSynthetic);
    if (merged.length > 0) {
      setCandles(merged);
      setLastUpdate(Date.now());
      onCandleUpdateRef.current?.(merged[merged.length - 1]);
    }
  }, [symbol, validTimeframe]);

  // Step 2: Subscribe hook — runs on mount/change
  useEffect(() => {
    if (!isAuthenticated || !symbol) return;

    const manager = getCandleSocketManager();
    setIsConnected(manager.isConnected());

    // Step 3: Candle service demand — deduplicated by SYMBOL.TIMEFRAME key
    const { unsubscribe } = manager.subscribe(
      symbol,
      validTimeframe,
      handleCandle,
      handleTick,
    );

    return () => {
      unsubscribe();
    };
  }, [symbol, validTimeframe, isAuthenticated, handleCandle, handleTick]);

  return { candles, isConnected, lastUpdate };
}
