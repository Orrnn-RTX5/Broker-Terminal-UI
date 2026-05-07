/**
 * Time & Sales Ticker
 * Scrolling tape of recent trades with buy/sell color coding and aggregated volume
 */

import { Icon } from '../ui/Icon';
import { useState, useEffect, useRef, useMemo } from 'react';
import type { TimeSalesEntry } from '../../types/trading';
import { useWebSocket } from '../../hooks/useWebSocket';
import { TrendingUp, TrendingDown } from 'lucide-react';

type TimeSalesProps = {
  symbol: string;
  maxEntries?: number;
};

export const TimeSales = ({ symbol, maxEntries = 100 }: TimeSalesProps) => {
  const [entries, setEntries] = useState<TimeSalesEntry[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [isPaused, setIsPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Use centralized WebSocket connection
  const {
    data: wsData,
    isConnected,
    connectionState,
    isStale,
    reconnect,
  } = useWebSocket<{ type: string; symbol: string; price: number; volume: number; side: string; timestamp: number; aggressor?: string }>({
    channel: `timesales:${symbol}`,
    autoConnect: true,
  });

  // Auto-scroll to latest entry
  useEffect(() => {
    if (!isPaused && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [entries, isPaused]);

  // Handle WebSocket data updates
  useEffect(() => {
    if (!wsData || wsData.type !== 'time_sales') return;

    const entry: TimeSalesEntry = {
      id: `${wsData.timestamp}-${Math.random()}`,
      symbol: wsData.symbol,
      price: wsData.price,
      volume: wsData.volume,
      side: wsData.side as 'BUY' | 'SELL',
      timestamp: wsData.timestamp,
      aggressor: wsData.aggressor as 'BUYER' | 'SELLER' | undefined,
    };

    setEntries((prev) => {
      const updated = [entry, ...prev];
      return updated.slice(0, maxEntries);
    });
  }, [wsData, maxEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    if (filter === 'ALL') return entries;
    return entries.filter((entry) => entry.side === filter);
  }, [entries, filter]);

  // Calculate aggregated volume
  const volumeStats = useMemo(() => {
    const buyVolume = entries.filter((e) => e.side === 'BUY').reduce((sum, e) => sum + e.volume, 0);
    const sellVolume = entries.filter((e) => e.side === 'SELL').reduce((sum, e) => sum + e.volume, 0);
    const totalVolume = buyVolume + sellVolume;

    return {
      buyVolume,
      sellVolume,
      totalVolume,
      buyPercent: totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50,
      sellPercent: totalVolume > 0 ? (sellVolume / totalVolume) * 100 : 50,
    };
  }, [entries]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-r border-zinc-800">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon name="activity" size="sm" className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Time & Sales</h3>
            {/* Connection Status Indicator */}
            {connectionState === 'connected' ? (
              <span title={isStale ? 'Connection stale' : 'Connected'}>
                <Icon name="wifi" size="sm" className={`w-3 h-3 ${isStale ? 'text-yellow-500' : 'text-emerald-500'}`} />
              </span>
            ) : (
              <span title={connectionState === 'connecting' ? 'Connecting...' : 'Disconnected'}>
                <Icon name="disconnected" size="sm"
                  className={`w-3 h-3 ${connectionState === 'connecting' ? 'text-blue-500 animate-pulse' : 'text-red-500'}`}
                />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isConnected && (
              <button
                onClick={reconnect}
                className="px-2 py-1 text-[10px] font-medium rounded bg-zinc-700/30 text-zinc-400 border border-zinc-600/30 hover:bg-zinc-700/40"
                title="Reconnect"
              >
                RECONNECT
              </button>
            )}
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${isPaused
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
            >
              {isPaused ? 'PAUSED' : 'LIVE'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-1">
          {(['ALL', 'BUY', 'SELL'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${filter === f
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Volume Statistics */}
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span className="text-zinc-500">Buy</span>
            <span className="font-mono text-emerald-400 ml-1">{volumeStats.buyVolume.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-mono text-red-400 mr-1">{volumeStats.sellVolume.toFixed(2)}</span>
            <span className="text-zinc-500">Sell</span>
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
          </div>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden flex">
          <div
            className="bg-emerald-500 transition-all duration-300"
            style={{ width: `${volumeStats.buyPercent}%` }}
          ></div>
          <div
            className="bg-red-500 transition-all duration-300"
            style={{ width: `${volumeStats.sellPercent}%` }}
          ></div>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/30 text-[10px] font-medium text-zinc-500 uppercase tracking-wide sticky top-0">
        <div className="w-4"></div>
        <div>Time</div>
        <div className="text-right">Price</div>
        <div className="text-right">Vol</div>
      </div>

      {/* Entries List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600">
            <Icon name="clock" size="sm" className="w-8 h-8 mb-2" />
            <p className="text-xs">No trades yet</p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <TimeSalesRow key={entry.id} entry={entry} />
          ))
        )}
      </div>

      {/* Footer Stats */}
      <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900/50 text-[10px] text-zinc-500">
        <div className="flex items-center justify-between">
          <span>Total Trades</span>
          <span className="font-mono text-zinc-300">{entries.length}</span>
        </div>
      </div>
    </div>
  );
};

// Time & Sales Row Component
const TimeSalesRow = ({ entry }: { entry: TimeSalesEntry }) => {
  const isBuy = entry.side === 'BUY';
  const bgColor = isBuy ? 'bg-emerald-500/5 hover:bg-emerald-500/10' : 'bg-red-500/5 hover:bg-red-500/10';
  const sideColor = isBuy ? 'text-emerald-400' : 'text-red-400';
  const borderColor = isBuy ? 'border-emerald-500' : 'border-red-500';

  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const SideIcon = isBuy ? TrendingUp : TrendingDown;

  return (
    <div
      className={`grid grid-cols-[auto_1fr_1fr_1fr] gap-2 px-3 py-1.5 border-l-2 ${borderColor} ${bgColor} transition-colors text-xs`}
    >
      <div className="flex items-center justify-center w-4">
        <SideIcon className={`w-3 h-3 ${sideColor}`} />
      </div>
      <div className="font-mono text-zinc-500 text-[10px]">{time}</div>
      <div className={`text-right font-mono ${sideColor} font-medium`}>
        {entry.price.toFixed(5)}
      </div>
      <div className="text-right font-mono text-zinc-400 text-[10px]">
        {entry.volume.toFixed(2)}
      </div>
    </div>
  );
};
