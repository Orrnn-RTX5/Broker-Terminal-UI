/**
 * OHLC Terminal View
 * Trading terminal style display of OHLC data
 * Similar to MT5 Market Watch / Data Window
 */

import React, { useEffect, useState, useCallback } from 'react';
import { candleAggregationService, CandleData, Timeframe } from '../services/candleAggregationService';
import { formatPrice as formatPriceUtil } from '../utils/symbolUtils';

interface OHLCTerminalViewProps {
  symbol: string;
  timeframe?: Timeframe;
  showMultipleTimeframes?: boolean;
  className?: string;
}

interface OHLCRow {
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  direction: 'up' | 'down' | 'flat';
  isComplete: boolean;
}

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

export const OHLCTerminalView: React.FC<OHLCTerminalViewProps> = ({
  symbol,
  timeframe = 'M1',
  showMultipleTimeframes = true,
  className = ''
}) => {
  const [rows, setRows] = useState<OHLCRow[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [selectedTf, setSelectedTf] = useState<Timeframe>(timeframe);

  const formatPrice = (price: number): string => {
    return formatPriceUtil(price, symbol);
  };

  const formatVolume = (vol: number): string => {
    if (vol >= 1000000) return (vol / 1000000).toFixed(2) + 'M';
    if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
    return vol.toString();
  };

  const getDirection = (change: number): 'up' | 'down' | 'flat' => {
    if (change > 0.00001) return 'up';
    if (change < -0.00001) return 'down';
    return 'flat';
  };

  const updateRows = useCallback(() => {
    const timeframesToShow = showMultipleTimeframes ? TIMEFRAMES : [selectedTf];

    const newRows: OHLCRow[] = timeframesToShow.map(tf => {
      const candles = candleAggregationService.getCandles(symbol, tf, true, true);
      const lastCandle = candles[candles.length - 1];
      const prevCandle = candles.length > 1 ? candles[candles.length - 2] : null;

      if (!lastCandle) {
        return {
          timeframe: tf,
          open: 0, high: 0, low: 0, close: 0, volume: 0,
          change: 0, changePercent: 0, direction: 'flat', isComplete: false
        };
      }

      const change = prevCandle ? lastCandle.close - prevCandle.close : 0;
      const changePercent = prevCandle ? (change / prevCandle.close) * 100 : 0;

      return {
        timeframe: tf,
        open: lastCandle.open,
        high: lastCandle.high,
        low: lastCandle.low,
        close: lastCandle.close,
        volume: lastCandle.volume,
        change,
        changePercent,
        direction: getDirection(change),
        isComplete: lastCandle.isComplete || false
      };
    });

    setRows(newRows);
    setLastUpdate(new Date());
  }, [symbol, selectedTf, showMultipleTimeframes]);

  // Subscribe to updates
  useEffect(() => {
    updateRows();

    const interval = setInterval(updateRows, 500); // Update every 500ms
    return () => clearInterval(interval);
  }, [updateRows]);

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
      default: return '−';
    }
  };

  return (
    <div className={`bg-zinc-900 border border-zinc-700 rounded ${className}`}>
      {/* Header */}
      <div className="bg-zinc-800 px-3 py-2 border-b border-zinc-700 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white">{symbol}</span>
          {!showMultipleTimeframes && (
            <select
              value={selectedTf}
              onChange={(e) => setSelectedTf(e.target.value as Timeframe)}
              className="bg-zinc-700 text-white text-xs px-2 py-1 rounded border border-zinc-600"
            >
              {TIMEFRAMES.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          )}
        </div>
        <div className="text-xs text-zinc-500">
          {lastUpdate.toLocaleTimeString()}
        </div>
      </div>

      {/* OHLC Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-800 text-zinc-400">
              <th className="px-2 py-1.5 text-left font-medium">TF</th>
              <th className="px-2 py-1.5 text-right font-medium">Open</th>
              <th className="px-2 py-1.5 text-right font-medium">High</th>
              <th className="px-2 py-1.5 text-right font-medium">Low</th>
              <th className="px-2 py-1.5 text-right font-medium">Close</th>
              <th className="px-2 py-1.5 text-right font-medium">Volume</th>
              <th className="px-2 py-1.5 text-right font-medium">Change</th>
              <th className="px-2 py-1.5 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.timeframe}
                className={`border-t border-zinc-800 hover:bg-zinc-800/50 transition-colors ${
                  row.timeframe === selectedTf ? 'bg-zinc-800/30' : ''
                }`}
              >
                <td className="px-2 py-1.5 text-zinc-300 font-medium">
                  {row.timeframe}
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-300">
                  {formatPrice(row.open)}
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-300">
                  {formatPrice(row.high)}
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-300">
                  {formatPrice(row.low)}
                </td>
                <td className={`px-2 py-1.5 text-right font-medium ${getDirectionColor(row.direction)}`}>
                  {formatPrice(row.close)}
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-500">
                  {formatVolume(row.volume)}
                </td>
                <td className={`px-2 py-1.5 text-right ${getDirectionColor(row.direction)}`}>
                  <span className="mr-1">{getChangeSymbol(row.direction)}</span>
                  {row.change >= 0 ? '+' : ''}{formatPrice(row.change)}
                  <span className="text-zinc-500 ml-1">
                    ({row.changePercent >= 0 ? '+' : ''}{row.changePercent.toFixed(2)}%)
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    row.isComplete ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
                  }`} title={row.isComplete ? 'Complete' : 'Forming...'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary Bar */}
      {rows.length > 0 && (
        <div className="bg-zinc-800 px-3 py-2 border-t border-zinc-700 text-xs">
          <div className="flex justify-between items-center">
            <div className="text-zinc-400">
              Spread: <span className="text-zinc-200">
                {formatPrice(Math.max(...rows.map(r => r.high)) - Math.min(...rows.map(r => r.low)))}
              </span>
            </div>
            <div className="text-zinc-400">
              Range: <span className="text-zinc-200">
                {formatPrice(Math.min(...rows.map(r => r.low)))} - {formatPrice(Math.max(...rows.map(r => r.high)))}
              </span>
            </div>
            <div className="text-zinc-500">
              {rows.filter(r => !r.isComplete).length} forming
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OHLCTerminalView;
