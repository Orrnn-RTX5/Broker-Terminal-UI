'use client';

import { Icon } from './ui/Icon';
import React, { useState, useEffect, useCallback } from 'react';
import { useTradingSimStore, type SimPositionType } from '../store/useTradingSimStore';
// Mock symbols for trading
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'NZDUSD'];

// Generate mock prices for symbols
const basePrices: Record<string, number> = {
  EURUSD: 1.0850,
  GBPUSD: 1.2650,
  USDJPY: 148.50,
  AUDUSD: 0.6450,
  USDCHF: 0.8750,
  USDCAD: 1.3550,
  NZDUSD: 0.5950,
};

export function TradingSimulator() {
  const {
    balance,
    equity,
    margin,
    freeMargin,
    positions,
    tradeHistory,
    equityCurve,
    simulationSpeed,
    selectedSymbol,
    startingBalance,
    setStartingBalance,
    openPosition,
    closePosition,
    updatePositionPrices,
    setSimulationSpeed,
    setSelectedSymbol,
    resetAccount,
  } = useTradingSimStore();

  const [volume, setVolume] = useState(0.01);
  const [sl, setSl] = useState<string>('');
  const [tp, setTp] = useState<string>('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isRunning, setIsRunning] = useState(true);

  // Current market prices
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(basePrices);

  // Generate random price movements
  const updatePrices = useCallback(() => {
    if (!isRunning) return;

    setCurrentPrices((prev) => {
      const updated: Record<string, number> = {};
      Object.keys(prev).forEach((symbol) => {
        const change = (Math.random() - 0.5) * 0.001 * simulationSpeed;
        updated[symbol] = prev[symbol] + change;
      });
      return updated;
    });
  }, [isRunning, simulationSpeed]);

  // Update positions with new prices
  useEffect(() => {
    if (!isRunning) return;

    const priceUpdates = Object.entries(currentPrices).map(([symbol, price]) => ({ symbol, price }));
    updatePositionPrices(priceUpdates);
  }, [currentPrices, updatePositionPrices, isRunning]);

  // Price update interval
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(updatePrices, 1000 / simulationSpeed);
    return () => clearInterval(interval);
  }, [updatePrices, simulationSpeed, isRunning]);

  const handleOpenPosition = (side: SimPositionType) => {
    const price = currentPrices[selectedSymbol];
    if (!price) return;

    const slValue = sl ? parseFloat(sl) : null;
    const tpValue = tp ? parseFloat(tp) : null;

    openPosition(selectedSymbol, side, volume, price, slValue, tpValue);
  };

  const handleClosePosition = (positionId: string, symbol: string) => {
    const exitPrice = currentPrices[symbol];
    if (!exitPrice) return;
    closePosition(positionId, exitPrice);
  };

  const handleResetAccount = () => {
    resetAccount();
    setShowResetConfirm(false);
  };

  // Calculate performance statistics
  const calculateStats = () => {
    const totalTrades = tradeHistory.length;
    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
      };
    }

    const winningTrades = tradeHistory.filter((t) => t.pnl > 0);
    const losingTrades = tradeHistory.filter((t) => t.pnl < 0);
    const winRate = (winningTrades.length / totalTrades) * 100;

    const totalWin = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const avgWin = winningTrades.length > 0 ? totalWin / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLoss / losingTrades.length : 0;
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : 0;

    // Max drawdown
    let maxDrawdown = 0;
    let peak = startingBalance;
    equityCurve.forEach((point) => {
      if (point.equity > peak) peak = point.equity;
      const drawdown = ((peak - point.equity) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // Sharpe ratio (simplified)
    const returns = equityCurve.slice(1).map((point, i) => {
      return (point.equity - equityCurve[i].equity) / equityCurve[i].equity;
    });
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    return {
      totalTrades,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown,
      sharpeRatio,
    };
  };

  const stats = calculateStats();

  // Render equity curve SVG
  const renderEquityCurve = () => {
    if (equityCurve.length < 2) {
      return (
        <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
          No equity history yet
        </div>
      );
    }

    const width = 600;
    const height = 150;
    const padding = { top: 10, right: 10, bottom: 20, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const minEquity = Math.min(...equityCurve.map((p) => p.equity));
    const maxEquity = Math.max(...equityCurve.map((p) => p.equity));
    const equityRange = maxEquity - minEquity || 1;

    const points = equityCurve.map((point, i) => {
      const x = padding.left + (i / (equityCurve.length - 1)) * chartWidth;
      const y = padding.top + chartHeight - ((point.equity - minEquity) / equityRange) * chartHeight;
      return `${x},${y}`;
    });

    const pathD = `M ${points.join(' L ')}`;

    return (
      <svg width={width} height={height} className="mx-auto">
        {/* Grid lines */}
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={padding.left + chartWidth}
          y2={padding.top + chartHeight}
          stroke="#52525b"
          strokeWidth="1"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + chartHeight}
          stroke="#52525b"
          strokeWidth="1"
        />

        {/* Equity line */}
        <path d={pathD} fill="none" stroke="#8a8a8f" strokeWidth="2" />

        {/* Y-axis labels */}
        <text x={padding.left - 5} y={padding.top + 5} textAnchor="end" fill="#a1a1aa" fontSize="10">
          ${maxEquity.toFixed(0)}
        </text>
        <text x={padding.left - 5} y={padding.top + chartHeight} textAnchor="end" fill="#a1a1aa" fontSize="10">
          ${minEquity.toFixed(0)}
        </text>
      </svg>
    );
  };

  const currentPrice = currentPrices[selectedSymbol] || 0;
  const totalPnL = equity - balance;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-bold text-zinc-100">Trading Simulator</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsRunning(!isRunning)}
              className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs flex items-center gap-1"
            >
              {isRunning ? <Icon name="stop" size="xs" /> : <Icon name="play" size="xs" />}
              {isRunning ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Starting balance selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Starting Balance:</span>
            <select
              value={startingBalance}
              onChange={(e) => setStartingBalance(Number(e.target.value))}
              className="bg-zinc-700 text-zinc-100 text-xs px-2 py-1 rounded border border-zinc-600"
            >
              <option value={1000}>$1,000</option>
              <option value={5000}>$5,000</option>
              <option value={10000}>$10,000</option>
              <option value={50000}>$50,000</option>
              <option value={100000}>$100,000</option>
            </select>
          </div>
          {/* Speed controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Speed:</span>
            {[1, 2, 5, 10].map((speed) => (
              <button
                key={speed}
                onClick={() => setSimulationSpeed(speed)}
                className={`px-2 py-1 text-xs rounded ${
                  simulationSpeed === speed
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
          {/* Reset button */}
          <button
            onClick={() => setShowResetConfirm(true)}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs flex items-center gap-1"
          >
            <Icon name="refresh" size="xs" />
            Reset
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Row 1: Account Display + Quick Trade Panel */}
        <div className="grid grid-cols-2 gap-4">
          {/* Virtual Account Display */}
          <div className="bg-zinc-800 rounded p-4 border border-zinc-700">
            <h3 className="text-xs font-bold text-zinc-300 mb-3">Virtual Account</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-zinc-500">Balance</div>
                <div className="text-lg font-bold text-zinc-100">${balance.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Equity</div>
                <div className={`text-lg font-bold ${equity >= balance ? 'text-green-400' : 'text-red-400'}`}>
                  ${equity.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Margin</div>
                <div className="text-sm font-mono text-zinc-100">${margin.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Free Margin</div>
                <div className="text-sm font-mono text-zinc-100">${freeMargin.toFixed(2)}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-zinc-500">Total P&L</div>
                <div className={`text-xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Trade Panel */}
          <div className="bg-zinc-800 rounded p-4 border border-zinc-700">
            <h3 className="text-xs font-bold text-zinc-300 mb-3">Quick Trade</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-16">Symbol:</span>
                <select
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  className="flex-1 bg-zinc-700 text-zinc-100 text-xs px-2 py-1 rounded border border-zinc-600"
                >
                  {SYMBOLS.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-mono text-blue-400">{currentPrice.toFixed(5)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-16">Volume:</span>
                <input
                  type="number"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  step="0.01"
                  min="0.01"
                  className="flex-1 bg-zinc-700 text-zinc-100 text-xs px-2 py-1 rounded border border-zinc-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-16">SL:</span>
                <input
                  type="text"
                  value={sl}
                  onChange={(e) => setSl(e.target.value)}
                  placeholder="Optional"
                  className="flex-1 bg-zinc-700 text-zinc-100 text-xs px-2 py-1 rounded border border-zinc-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-16">TP:</span>
                <input
                  type="text"
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                  placeholder="Optional"
                  className="flex-1 bg-zinc-700 text-zinc-100 text-xs px-2 py-1 rounded border border-zinc-600"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleOpenPosition('BUY')}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded text-sm"
                >
                  BUY
                </button>
                <button
                  onClick={() => handleOpenPosition('SELL')}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded text-sm"
                >
                  SELL
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Open Positions */}
        <div className="bg-zinc-800 rounded p-4 border border-zinc-700">
          <h3 className="text-xs font-bold text-zinc-300 mb-3">Open Positions ({positions.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-700">
                  <th className="text-left py-2 px-2 text-zinc-400 font-normal">Symbol</th>
                  <th className="text-left py-2 px-2 text-zinc-400 font-normal">Side</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">Volume</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">Open Price</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">Current Price</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">P&L</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">SL</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">TP</th>
                  <th className="text-center py-2 px-2 text-zinc-400 font-normal">Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-zinc-500">
                      No open positions
                    </td>
                  </tr>
                ) : (
                  positions.map((pos) => (
                    <tr key={pos.id} className="border-b border-zinc-700 hover:bg-zinc-750">
                      <td className="py-2 px-2 font-mono">{pos.symbol}</td>
                      <td className="py-2 px-2">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            pos.side === 'BUY' ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {pos.side === 'BUY' ? <Icon name="trending-up" size="xs" /> : <Icon name="trending-down" size="xs" />}
                          {pos.side}
                        </span>
                      </td>
                      <td className="text-right py-2 px-2 font-mono">{pos.volume.toFixed(2)}</td>
                      <td className="text-right py-2 px-2 font-mono">{pos.openPrice.toFixed(5)}</td>
                      <td className="text-right py-2 px-2 font-mono">{pos.currentPrice.toFixed(5)}</td>
                      <td className={`text-right py-2 px-2 font-mono font-bold ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                      </td>
                      <td className="text-right py-2 px-2 font-mono text-zinc-400">
                        {pos.sl ? pos.sl.toFixed(5) : '-'}
                      </td>
                      <td className="text-right py-2 px-2 font-mono text-zinc-400">
                        {pos.tp ? pos.tp.toFixed(5) : '-'}
                      </td>
                      <td className="text-center py-2 px-2">
                        <button
                          onClick={() => handleClosePosition(pos.id, pos.symbol)}
                          className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Row 3: Performance Stats + Equity Curve */}
        <div className="grid grid-cols-2 gap-4">
          {/* Performance Stats */}
          <div className="bg-zinc-800 rounded p-4 border border-zinc-700">
            <h3 className="text-xs font-bold text-zinc-300 mb-3">Performance Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-zinc-500">Total Trades</div>
                <div className="text-lg font-bold text-zinc-100">{stats.totalTrades}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Win Rate</div>
                <div className="text-lg font-bold text-blue-400">{stats.winRate.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Avg Win</div>
                <div className="text-sm font-mono text-green-400">${stats.avgWin.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Avg Loss</div>
                <div className="text-sm font-mono text-red-400">${stats.avgLoss.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Profit Factor</div>
                <div className="text-sm font-mono text-zinc-100">{stats.profitFactor.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Max Drawdown</div>
                <div className="text-sm font-mono text-red-400">{stats.maxDrawdown.toFixed(2)}%</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-zinc-500">Sharpe Ratio</div>
                <div className="text-lg font-bold text-purple-400">{stats.sharpeRatio.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Equity Curve */}
          <div className="bg-zinc-800 rounded p-4 border border-zinc-700">
            <h3 className="text-xs font-bold text-zinc-300 mb-3">Equity Curve</h3>
            {renderEquityCurve()}
          </div>
        </div>

        {/* Row 4: Trade History */}
        <div className="bg-zinc-800 rounded p-4 border border-zinc-700">
          <h3 className="text-xs font-bold text-zinc-300 mb-3">Trade History ({tradeHistory.length})</h3>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-800">
                <tr className="border-b border-zinc-700">
                  <th className="text-left py-2 px-2 text-zinc-400 font-normal">Time</th>
                  <th className="text-left py-2 px-2 text-zinc-400 font-normal">Symbol</th>
                  <th className="text-left py-2 px-2 text-zinc-400 font-normal">Side</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">Volume</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">Entry</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">Exit</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">P&L</th>
                  <th className="text-right py-2 px-2 text-zinc-400 font-normal">Duration</th>
                </tr>
              </thead>
              <tbody>
                {tradeHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-zinc-500">
                      No trade history
                    </td>
                  </tr>
                ) : (
                  tradeHistory.map((trade) => {
                    const durationSec = Math.floor(trade.duration / 1000);
                    const minutes = Math.floor(durationSec / 60);
                    const seconds = durationSec % 60;
                    return (
                      <tr key={trade.id} className="border-b border-zinc-700 hover:bg-zinc-750">
                        <td className="py-2 px-2 text-zinc-400">
                          {new Date(trade.closeTime).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-2 font-mono">{trade.symbol}</td>
                        <td className="py-2 px-2">
                          <span className={trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>
                            {trade.side}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 font-mono">{trade.volume.toFixed(2)}</td>
                        <td className="text-right py-2 px-2 font-mono">{trade.entryPrice.toFixed(5)}</td>
                        <td className="text-right py-2 px-2 font-mono">{trade.exitPrice.toFixed(5)}</td>
                        <td className={`text-right py-2 px-2 font-mono font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                        </td>
                        <td className="text-right py-2 px-2 text-zinc-400">
                          {minutes}m {seconds}s
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-zinc-800 rounded-lg p-6 border border-zinc-700 w-96">
            <h3 className="text-lg font-bold text-zinc-100 mb-4">Reset Account?</h3>
            <p className="text-sm text-zinc-400 mb-6">
              This will reset your virtual account to ${startingBalance.toFixed(0)}, close all positions, and clear
              your trade history. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleResetAccount}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded"
              >
                Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-bold py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
