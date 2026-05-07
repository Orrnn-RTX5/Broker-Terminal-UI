/**
 * MarketReplay Component
 * Historical market data replay tool for practice and analysis
 */

import { Icon } from './ui/Icon';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { formatPrice as formatPriceUtil } from '../utils/symbolUtils';
interface Tick {
  time: string;
  bid: number;
  ask: number;
  timestamp: number;
}

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PracticeOrder {
  id: number;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  entryTime: string;
  exitPrice?: number;
  exitTime?: string;
  volume: number;
  pnl?: number;
  status: 'OPEN' | 'CLOSED';
}

// TODO: Replace with API call to /api/market/ticks?symbol={symbol}&start={startDate}&hours={hours}
function generateMockTicks(_symbol: string, _startDate: Date, _hours: number): Tick[] {
  // Placeholder: Returns empty array until backend API is implemented
  return [];
}

// Convert ticks to candles (1-minute candles)
function ticksToCandles(ticks: Tick[]): Candle[] {
  if (ticks.length === 0) return [];

  const candles: Candle[] = [];
  const candleDuration = 60 * 1000; // 1 minute in ms

  let currentCandleStart = ticks[0].timestamp;
  let candleTicks: Tick[] = [];

  ticks.forEach(tick => {
    if (tick.timestamp >= currentCandleStart + candleDuration) {
      // Close current candle
      if (candleTicks.length > 0) {
        candles.push({
          time: new Date(currentCandleStart).toISOString(),
          open: candleTicks[0].bid,
          high: Math.max(...candleTicks.map(t => t.bid)),
          low: Math.min(...candleTicks.map(t => t.bid)),
          close: candleTicks[candleTicks.length - 1].bid,
        });
      }
      // Start new candle
      currentCandleStart = Math.floor(tick.timestamp / candleDuration) * candleDuration;
      candleTicks = [tick];
    } else {
      candleTicks.push(tick);
    }
  });

  // Close final candle
  if (candleTicks.length > 0) {
    candles.push({
      time: new Date(currentCandleStart).toISOString(),
      open: candleTicks[0].bid,
      high: Math.max(...candleTicks.map(t => t.bid)),
      low: Math.min(...candleTicks.map(t => t.bid)),
      close: candleTicks[candleTicks.length - 1].bid,
    });
  }

  return candles;
}

export function MarketReplay() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [replayHours, setReplayHours] = useState(4);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [currentTickIndex, setCurrentTickIndex] = useState(0);
  const [practiceOrders, setPracticeOrders] = useState<PracticeOrder[]>([]);
  const [orderVolume, setOrderVolume] = useState(0.1);

  // Generate mock data
  const allTicks = useMemo(() => {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - replayHours);
    return generateMockTicks(symbol, startDate, replayHours);
  }, [symbol, replayHours]);

  const visibleTicks = useMemo(
    () => allTicks.slice(0, currentTickIndex + 1),
    [allTicks, currentTickIndex]
  );

  const candles = useMemo(
    () => ticksToCandles(visibleTicks),
    [visibleTicks]
  );

  const currentTick = allTicks[currentTickIndex];
  const progress = (currentTickIndex / (allTicks.length - 1)) * 100;

  // Playback loop
  useEffect(() => {
    if (!isPlaying || currentTickIndex >= allTicks.length - 1) {
      if (currentTickIndex >= allTicks.length - 1) setIsPlaying(false);
      return;
    }

    const interval = setInterval(() => {
      setCurrentTickIndex(prev => Math.min(prev + 1, allTicks.length - 1));
    }, 100 / speed); // Base speed: 100ms per tick

    return () => clearInterval(interval);
  }, [isPlaying, currentTickIndex, allTicks.length, speed]);

  // Auto-close practice orders at current price
  useEffect(() => {
    if (!currentTick) return;

    setPracticeOrders(prev =>
      prev.map(order => {
        if (order.status === 'OPEN') {
          // Check if we want to auto-close (for demo, close after 50 ticks)
          const ticksSinceEntry = currentTickIndex - allTicks.findIndex(t => t.time === order.entryTime);
          if (ticksSinceEntry > 50) {
            const exitPrice = order.type === 'BUY' ? currentTick.bid : currentTick.ask;
            const pnl = order.type === 'BUY'
              ? (exitPrice - order.entryPrice) * 100000 * order.volume
              : (order.entryPrice - exitPrice) * 100000 * order.volume;

            return {
              ...order,
              exitPrice,
              exitTime: currentTick.time,
              pnl: parseFloat(pnl.toFixed(2)),
              status: 'CLOSED' as const,
            };
          }
        }
        return order;
      })
    );
  }, [currentTick, currentTickIndex, allTicks]);

  // Session statistics
  const statistics = useMemo(() => {
    const closedOrders = practiceOrders.filter(o => o.status === 'CLOSED');
    const winningOrders = closedOrders.filter(o => o.pnl! > 0);
    const losingOrders = closedOrders.filter(o => o.pnl! <= 0);

    const totalPnL = closedOrders.reduce((sum, o) => sum + (o.pnl || 0), 0);
    const winRate = closedOrders.length > 0 ? (winningOrders.length / closedOrders.length) * 100 : 0;
    const avgWin = winningOrders.length > 0
      ? winningOrders.reduce((sum, o) => sum + o.pnl!, 0) / winningOrders.length
      : 0;
    const avgLoss = losingOrders.length > 0
      ? losingOrders.reduce((sum, o) => sum + o.pnl!, 0) / losingOrders.length
      : 0;

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnL = 0;

    closedOrders.forEach(order => {
      runningPnL += order.pnl || 0;
      if (runningPnL > peak) peak = runningPnL;
      const drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    return {
      totalPnL,
      winRate,
      avgWin,
      avgLoss,
      maxDrawdown,
      totalTrades: closedOrders.length,
      openTrades: practiceOrders.filter(o => o.status === 'OPEN').length,
    };
  }, [practiceOrders]);

  // Handlers
  const handlePlay = () => {
    if (currentTickIndex >= allTicks.length - 1) {
      setCurrentTickIndex(0);
      setPracticeOrders([]);
    }
    setIsPlaying(true);
  };

  const handlePause = () => setIsPlaying(false);

  const handleStop = () => {
    setIsPlaying(false);
    setCurrentTickIndex(0);
    setPracticeOrders([]);
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newIndex = Math.floor((parseFloat(e.target.value) / 100) * (allTicks.length - 1));
    setCurrentTickIndex(newIndex);
    setIsPlaying(false);
  };

  const handlePlaceOrder = (type: 'BUY' | 'SELL') => {
    if (!currentTick) return;

    const newOrder: PracticeOrder = {
      id: Date.now(),
      type,
      entryPrice: type === 'BUY' ? currentTick.ask : currentTick.bid,
      entryTime: currentTick.time,
      volume: orderVolume,
      status: 'OPEN',
    };

    setPracticeOrders(prev => [...prev, newOrder]);
  };

  const handleCloseOrder = (orderId: number) => {
    if (!currentTick) return;

    setPracticeOrders(prev =>
      prev.map(order => {
        if (order.id === orderId && order.status === 'OPEN') {
          const exitPrice = order.type === 'BUY' ? currentTick.bid : currentTick.ask;
          const pnl = order.type === 'BUY'
            ? (exitPrice - order.entryPrice) * 100000 * order.volume
            : (order.entryPrice - exitPrice) * 100000 * order.volume;

          return {
            ...order,
            exitPrice,
            exitTime: currentTick.time,
            pnl: parseFloat(pnl.toFixed(2)),
            status: 'CLOSED' as const,
          };
        }
        return order;
      })
    );
  };

  const formatPrice = (price: number) => {
    return formatPriceUtil(price, symbol);
  };

  const formatTime = (time: string) => {
    return new Date(time).toLocaleTimeString('en-US', { hour12: false });
  };

  return (
    <div className="h-full overflow-auto bg-zinc-900 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="clock" size="sm" className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Market Replay</h2>
        </div>
      </div>

      {/* Configuration */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value);
                handleStop();
              }}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            >
              <option value="EURUSD">EUR/USD</option>
              <option value="GBPUSD">GBP/USD</option>
              <option value="USDJPY">USD/JPY</option>
              <option value="BTCUSD">BTC/USD</option>
              <option value="XAUUSD">XAU/USD (Gold)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Replay Period</label>
            <select
              value={replayHours}
              onChange={(e) => {
                setReplayHours(parseInt(e.target.value));
                handleStop();
              }}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            >
              <option value={2}>2 hours</option>
              <option value={4}>4 hours</option>
              <option value={8}>8 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Speed</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
              <option value={10}>10x</option>
              <option value={50}>50x</option>
            </select>
          </div>
        </div>
      </div>

      {/* Playback Controls */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handlePlay}
            disabled={isPlaying}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm font-medium flex items-center gap-2"
          >
            <Icon name="play" size="sm" className="w-4 h-4" />
            Play
          </button>
          <button
            onClick={handlePause}
            disabled={!isPlaying}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm font-medium flex items-center gap-2"
          >
            <Icon name="stop" size="sm" className="w-4 h-4" />
            Pause
          </button>
          <button
            onClick={handleStop}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium flex items-center gap-2"
          >
            <Icon name="rectangle" size="sm" className="w-4 h-4" />
            Stop
          </button>

          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={progress}
              onChange={handleProgressChange}
              className="flex-1"
            />
            <span className="text-xs text-zinc-400 min-w-[60px] text-right">
              {progress.toFixed(1)}%
            </span>
          </div>

          <div className="text-xs text-zinc-400">
            Tick {currentTickIndex + 1} / {allTicks.length}
          </div>
        </div>

        {/* Current Price Display */}
        {currentTick && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-900 rounded p-3 text-center">
              <div className="text-xs text-zinc-500 mb-1">TIME</div>
              <div className="text-sm font-mono text-white">{formatTime(currentTick.time)}</div>
            </div>
            <div className="bg-zinc-900 rounded p-3 text-center">
              <div className="text-xs text-zinc-500 mb-1">BID</div>
              <div className="text-lg font-mono font-bold text-red-400">{formatPrice(currentTick.bid)}</div>
            </div>
            <div className="bg-zinc-900 rounded p-3 text-center">
              <div className="text-xs text-zinc-500 mb-1">ASK</div>
              <div className="text-lg font-mono font-bold text-blue-400">{formatPrice(currentTick.ask)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Chart */}
        <div className="col-span-2 bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="trending-up" size="sm" className="w-4 h-4 text-emerald-400" />
            Live Chart ({candles.length} candles)
          </h3>
          <MiniCandlestickChart candles={candles} symbol={symbol} />
        </div>

        {/* Practice Order Panel */}
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="box" size="sm" className="w-4 h-4 text-blue-400" />
            Practice Orders
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Volume (Lots)</label>
              <input
                type="number"
                min="0.01"
                max="10"
                step="0.01"
                value={orderVolume}
                onChange={(e) => setOrderVolume(parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handlePlaceOrder('BUY')}
                disabled={!currentTick}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm font-medium"
              >
                BUY
              </button>
              <button
                onClick={() => handlePlaceOrder('SELL')}
                disabled={!currentTick}
                className="px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm font-medium"
              >
                SELL
              </button>
            </div>

            {/* Open Positions */}
            <div className="mt-4">
              <div className="text-xs text-zinc-400 mb-2">Open Positions ({statistics.openTrades})</div>
              <div className="space-y-1">
                {practiceOrders.filter(o => o.status === 'OPEN').map(order => (
                  <div key={order.id} className="bg-zinc-900 rounded p-2 text-xs">
                    <div className="flex justify-between items-center mb-1">
                      <span className={order.type === 'BUY' ? 'text-blue-400' : 'text-orange-400'}>
                        {order.type}
                      </span>
                      <span className="text-zinc-500">{order.volume} lots</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Entry: {formatPrice(order.entryPrice)}</span>
                      <button
                        onClick={() => handleCloseOrder(order.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                ))}
                {statistics.openTrades === 0 && (
                  <div className="text-xs text-zinc-600 text-center py-2">No open positions</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Session Statistics */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Icon name="check-circle" size="sm" className="w-4 h-4 text-yellow-400" />
          Session Statistics
        </h3>
        <div className="grid grid-cols-6 gap-4">
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Total P&L</div>
            <div className={`text-lg font-bold ${statistics.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {statistics.totalPnL >= 0 ? '+' : ''}{statistics.totalPnL.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Win Rate</div>
            <div className="text-lg font-bold text-white">{statistics.winRate.toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Avg Win</div>
            <div className="text-lg font-bold text-emerald-400">+{statistics.avgWin.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Avg Loss</div>
            <div className="text-lg font-bold text-red-400">{statistics.avgLoss.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Max DD</div>
            <div className="text-lg font-bold text-orange-400">{statistics.maxDrawdown.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Trades</div>
            <div className="text-lg font-bold text-white">{statistics.totalTrades}</div>
          </div>
        </div>
      </div>

      {/* Order History */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Icon name="crosshair" size="sm" className="w-4 h-4 text-cyan-400" />
          Order History ({practiceOrders.filter(o => o.status === 'CLOSED').length} closed)
        </h3>
        <div className="overflow-auto max-h-64">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 sticky top-0">
              <tr className="text-zinc-400">
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-right">Volume</th>
                <th className="p-2 text-right">Entry</th>
                <th className="p-2 text-left">Entry Time</th>
                <th className="p-2 text-right">Exit</th>
                <th className="p-2 text-left">Exit Time</th>
                <th className="p-2 text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {practiceOrders.filter(o => o.status === 'CLOSED').reverse().map(order => (
                <tr key={order.id} className="border-t border-zinc-700">
                  <td className={`p-2 ${order.type === 'BUY' ? 'text-blue-400' : 'text-orange-400'}`}>
                    {order.type}
                  </td>
                  <td className="p-2 text-right text-zinc-400">{order.volume}</td>
                  <td className="p-2 text-right text-zinc-300 font-mono">{formatPrice(order.entryPrice)}</td>
                  <td className="p-2 text-zinc-500">{formatTime(order.entryTime)}</td>
                  <td className="p-2 text-right text-zinc-300 font-mono">{order.exitPrice ? formatPrice(order.exitPrice) : '-'}</td>
                  <td className="p-2 text-zinc-500">{order.exitTime ? formatTime(order.exitTime) : '-'}</td>
                  <td className={`p-2 text-right font-bold ${order.pnl! >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {order.pnl !== undefined ? (order.pnl >= 0 ? '+' : '') + order.pnl.toFixed(2) : '-'}
                  </td>
                </tr>
              ))}
              {practiceOrders.filter(o => o.status === 'CLOSED').length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-zinc-600">
                    No closed orders yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Mini Candlestick Chart
function MiniCandlestickChart({ candles, symbol }: { candles: Candle[]; symbol: string }) {
  if (candles.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">
        Start playback to see chart build...
      </div>
    );
  }

  const prices = candles.flatMap(c => [c.high, c.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  const svgWidth = 800;
  const svgHeight = 300;
  const candleWidth = Math.max(2, Math.min(10, svgWidth / candles.length - 2));

  return (
    <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="bg-zinc-950 rounded">
      {candles.map((candle, i) => {
        const x = (i / candles.length) * svgWidth + candleWidth / 2;
        const openY = svgHeight - ((candle.open - minPrice) / priceRange) * (svgHeight - 20) - 10;
        const closeY = svgHeight - ((candle.close - minPrice) / priceRange) * (svgHeight - 20) - 10;
        const highY = svgHeight - ((candle.high - minPrice) / priceRange) * (svgHeight - 20) - 10;
        const lowY = svgHeight - ((candle.low - minPrice) / priceRange) * (svgHeight - 20) - 10;

        const isBullish = candle.close >= candle.open;
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.abs(closeY - openY) || 1;

        return (
          <g key={i}>
            {/* Wick */}
            <line
              x1={x}
              y1={highY}
              x2={x}
              y2={lowY}
              stroke={isBullish ? '#22c55e' : '#ef4444'}
              strokeWidth="1"
            />
            {/* Body */}
            <rect
              x={x - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              fill={isBullish ? '#22c55e' : '#ef4444'}
              opacity={0.9}
            />
          </g>
        );
      })}

      {/* Price labels */}
      <text x="5" y="15" fill="#71717a" fontSize="10">
        {maxPrice.toFixed(symbol.includes('JPY') ? 3 : 5)}
      </text>
      <text x="5" y={svgHeight - 5} fill="#71717a" fontSize="10">
        {minPrice.toFixed(symbol.includes('JPY') ? 3 : 5)}
      </text>
    </svg>
  );
}
