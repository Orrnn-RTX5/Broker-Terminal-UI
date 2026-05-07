/**
 * OHLC Data Window
 * MT5-style Data Window showing detailed OHLC info
 * Displays current candle data with color-coded changes
 */

import React, { useEffect, useState, useCallback } from 'react';
import { candleAggregationService, CandleData, Timeframe } from '../services/candleAggregationService';
import { formatPrice } from '../utils/symbolUtils';

interface OHLCDataWindowProps {
  symbol: string;
  timeframe?: Timeframe;
  showTicks?: boolean;
  className?: string;
}

interface TickData {
  price: number;
  volume: number;
  time: number;
  side: 'bid' | 'ask';
}

export const OHLCDataWindow: React.FC<OHLCDataWindowProps> = ({
  symbol,
  timeframe = 'M1',
  showTicks = true,
  className = ''
}) => {
  const [currentCandle, setCurrentCandle] = useState<CandleData | null>(null);
  const [previousCandle, setPreviousCandle] = useState<CandleData | null>(null);
  const [ticks, setTicks] = useState<TickData[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());



  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const updateData = useCallback(() => {
    const candles = candleAggregationService.getCandles(symbol, timeframe, true, true);

    if (candles.length > 0) {
      setCurrentCandle(candles[candles.length - 1]);
      setPreviousCandle(candles.length > 1 ? candles[candles.length - 2] : null);
    }

    setLastUpdate(new Date());
  }, [symbol, timeframe]);

  useEffect(() => {
    updateData();
    const interval = setInterval(updateData, 250);
    return () => clearInterval(interval);
  }, [updateData]);

  const getChange = (current: number, previous: number): { value: number; percent: number; direction: 'up' | 'down' | 'flat' } => {
    const change = current - previous;
    const percent = previous !== 0 ? (change / previous) * 100 : 0;

    return {
      value: change,
      percent,
      direction: change > 0.00001 ? 'up' : change < -0.00001 ? 'down' : 'flat'
    };
  };

  const getDirectionColor = (direction: 'up' | 'down' | 'flat') => {
    switch (direction) {
      case 'up': return 'text-green-400';
      case 'down': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getChangeSymbol = (direction: 'up' | 'down' | 'flat') => {
    switch (direction) {
      case 'up': return '▲';
      case 'down': return '▼';
      default: return '●';
    }
  };

  const renderRow = (label: string, value: string | number, change?: { value: number; percent: number; direction: 'up' | 'down' | 'flat' }) => (
    <div className="flex justify-between items-center py-1 px-2 hover:bg-zinc-800/50">
      <span className="text-zinc-500 text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-zinc-200 font-mono text-xs">{value}</span>
        {change && (
          <span className={`text-xs ${getDirectionColor(change.direction)}`}>
            {getChangeSymbol(change.direction)} {change.value > 0 ? '+' : ''}{change.percent.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );

  if (!currentCandle) {
    return (
      <div className={`bg-zinc-900 border border-zinc-700 rounded ${className}`}>
        <div className="p-4 text-center text-zinc-500 text-sm">
          Waiting for data...
        </div>
      </div>
    );
  }

  const closeChange = previousCandle ? getChange(currentCandle.close, previousCandle.close) : null;
  const highChange = previousCandle ? getChange(currentCandle.high, previousCandle.high) : null;
  const lowChange = previousCandle ? getChange(currentCandle.low, previousCandle.low) : null;
  const openChange = previousCandle ? getChange(currentCandle.open, previousCandle.open) : null;

  return (
    <div className={`bg-zinc-900 border border-zinc-700 rounded ${className}`}>
      {/* Header */}
      <div className="bg-zinc-800 px-3 py-2 border-b border-zinc-700">
        <div className="flex justify-between items-center">
          <div>
            <span className="font-bold text-white">{symbol}</span>
            <span className="text-zinc-400 text-xs ml-2">{timeframe}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${currentCandle.isComplete ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="text-zinc-500 text-xs">{formatTime(currentCandle.time)}</span>
          </div>
        </div>
      </div>

      {/* OHLC Values */}
      <div className="py-1">
        {renderRow('Close', formatPrice(currentCandle.close, symbol), closeChange || undefined)}
        {renderRow('Open', formatPrice(currentCandle.open, symbol), openChange || undefined)}
        {renderRow('High', formatPrice(currentCandle.high, symbol), highChange || undefined)}
        {renderRow('Low', formatPrice(currentCandle.low, symbol), lowChange || undefined)}

        <div className="border-t border-zinc-800 my-1" />

        {renderRow('Volume', currentCandle.volume.toLocaleString())}

        {/* Range */}
        <div className="flex justify-between items-center py-1 px-2 hover:bg-zinc-800/50">
          <span className="text-zinc-500 text-xs">Range</span>
          <span className="text-zinc-200 font-mono text-xs">
            {(currentCandle.high - currentCandle.low).toFixed(5)}
          </span>
        </div>

        {/* Body */}
        <div className="flex justify-between items-center py-1 px-2 hover:bg-zinc-800/50">
          <span className="text-zinc-500 text-xs">Body</span>
          <span className={`font-mono text-xs ${currentCandle.close >= currentCandle.open ? 'text-green-400' : 'text-red-400'}`}>
            {Math.abs(currentCandle.close - currentCandle.open).toFixed(5)}
          </span>
        </div>

        {/* Shadow (Upper) */}
        <div className="flex justify-between items-center py-1 px-2 hover:bg-zinc-800/50">
          <span className="text-zinc-500 text-xs">Upper Shadow</span>
          <span className="text-zinc-200 font-mono text-xs">
            {(currentCandle.high - Math.max(currentCandle.open, currentCandle.close)).toFixed(5)}
          </span>
        </div>

        {/* Shadow (Lower) */}
        <div className="flex justify-between items-center py-1 px-2 hover:bg-zinc-800/50">
          <span className="text-zinc-500 text-xs">Lower Shadow</span>
          <span className="text-zinc-200 font-mono text-xs">
            {(Math.min(currentCandle.open, currentCandle.close) - currentCandle.low).toFixed(5)}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-zinc-800 px-3 py-1.5 border-t border-zinc-700 text-xs text-zinc-500 text-center">
        Last update: {lastUpdate.toLocaleTimeString()}
      </div>
    </div>
  );
};

export default OHLCDataWindow;
