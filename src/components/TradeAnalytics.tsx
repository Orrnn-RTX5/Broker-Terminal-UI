/**
 * TradeAnalytics Component
 * Advanced trade analytics panel with statistical analysis
 */

import { Icon } from './ui/Icon';
import React, { useMemo } from 'react';
interface Trade {
  id: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  openTime: string;
  closeTime: string;
  openPrice: number;
  closePrice: number;
  volume: number;
  profit: number;
  commission: number;
  swap: number;
  durationMinutes: number;
}

// Generate realistic mock trade data (100+ trades over 6 months)
function generateMockTrades(): Trade[] {
  // TODO: Replace with API call to /api/trades/history
  return [];
}

export function TradeAnalytics() {
  const trades = useMemo(() => generateMockTrades(), []);

  // Calculate analytics
  const analytics = useMemo(() => {
    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit <= 0);

    const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));

    const winRate = (winningTrades.length / trades.length) * 100;
    const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
    const expectedPayoff = trades.length > 0 ? totalProfit / trades.length : 0;

    // Drawdown calculation
    let balance = 10000;
    let peak = 10000;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    const equityCurve: { date: string; balance: number; drawdown: number }[] = [];

    trades.forEach(trade => {
      balance += trade.profit + trade.commission + trade.swap;
      if (balance > peak) peak = balance;
      const drawdown = peak - balance;
      const drawdownPercent = (drawdown / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
      }
      equityCurve.push({
        date: trade.closeTime,
        balance,
        drawdown,
      });
    });

    // Sharpe Ratio (simplified - assuming risk-free rate = 0)
    const returns = trades.map(t => t.profit);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    // Sortino Ratio (downside deviation)
    const downsideReturns = returns.filter(r => r < 0);
    const downsideStdDev = downsideReturns.length > 0
      ? Math.sqrt(
          downsideReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / downsideReturns.length
        )
      : 0;
    const sortinoRatio = downsideStdDev > 0 ? (avgReturn / downsideStdDev) * Math.sqrt(252) : 0;

    // Recovery Factor
    const recoveryFactor = maxDrawdown > 0 ? totalProfit / maxDrawdown : 0;

    // Consecutive wins/losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    trades.forEach(trade => {
      if (trade.profit > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
      } else {
        currentLossStreak++;
        currentWinStreak = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
      }
    });

    // Best/Worst trades
    const sortedByProfit = [...trades].sort((a, b) => b.profit - a.profit);
    const bestTrades = sortedByProfit.slice(0, 5);
    const worstTrades = sortedByProfit.slice(-5).reverse();

    // Win/Loss distribution (bucket by P&L ranges)
    const bucketSize = 100;
    const buckets: { [key: number]: number } = {};
    trades.forEach(trade => {
      const bucket = Math.floor(trade.profit / bucketSize) * bucketSize;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    });

    // Monthly returns
    const monthlyReturns: { [key: string]: number } = {};
    trades.forEach(trade => {
      const month = trade.closeTime.substring(0, 7); // YYYY-MM
      monthlyReturns[month] = (monthlyReturns[month] || 0) + trade.profit;
    });

    // Trade duration by symbol
    const durationBySymbol: { [symbol: string]: { total: number; count: number } } = {};
    trades.forEach(trade => {
      if (!durationBySymbol[trade.symbol]) {
        durationBySymbol[trade.symbol] = { total: 0, count: 0 };
      }
      durationBySymbol[trade.symbol].total += trade.durationMinutes;
      durationBySymbol[trade.symbol].count += 1;
    });

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalProfit,
      grossProfit,
      grossLoss,
      avgWin,
      avgLoss,
      profitFactor,
      expectedPayoff,
      maxDrawdown,
      maxDrawdownPercent,
      sharpeRatio,
      sortinoRatio,
      recoveryFactor,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      equityCurve,
      bestTrades,
      worstTrades,
      buckets,
      monthlyReturns,
      durationBySymbol,
    };
  }, [trades]);

  const formatMoney = (val: number) => {
    const sign = val >= 0 ? '+' : '';
    return sign + new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  };

  return (
    <div className="h-full overflow-auto bg-zinc-900 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="bar-chart-3" size="sm" className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Trade Analytics</h2>
          <span className="text-xs text-zinc-500">
            {analytics.totalTrades} trades analyzed
          </span>
        </div>
        <div className="text-sm text-zinc-400">
          Last 6 months
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          icon={<Icon name="trending-up" size="sm" className="w-4 h-4" />}
          label="Sharpe Ratio"
          value={analytics.sharpeRatio.toFixed(2)}
          color={analytics.sharpeRatio > 1 ? 'emerald' : analytics.sharpeRatio > 0 ? 'yellow' : 'red'}
        />
        <MetricCard
          icon={<Icon name="activity" size="sm" className="w-4 h-4" />}
          label="Sortino Ratio"
          value={analytics.sortinoRatio.toFixed(2)}
          color={analytics.sortinoRatio > 1 ? 'emerald' : analytics.sortinoRatio > 0 ? 'yellow' : 'red'}
        />
        <MetricCard
          icon={<Icon name="trending-down" size="sm" className="w-4 h-4" />}
          label="Max Drawdown"
          value={`${analytics.maxDrawdownPercent.toFixed(1)}%`}
          subValue={formatMoney(-analytics.maxDrawdown)}
          color="red"
        />
        <MetricCard
          icon={<Icon name="credit-card" size="sm" className="w-4 h-4" />}
          label="Profit Factor"
          value={analytics.profitFactor.toFixed(2)}
          color={analytics.profitFactor > 1.5 ? 'emerald' : analytics.profitFactor > 1 ? 'yellow' : 'red'}
        />
        <MetricCard
          icon={<Icon name="check-circle" size="sm" className="w-4 h-4" />}
          label="Expected Payoff"
          value={formatMoney(analytics.expectedPayoff)}
          color={analytics.expectedPayoff > 0 ? 'emerald' : 'red'}
        />
        <MetricCard
          icon={<Icon name="shield" size="sm" className="w-4 h-4" />}
          label="Recovery Factor"
          value={analytics.recoveryFactor.toFixed(2)}
          color={analytics.recoveryFactor > 2 ? 'emerald' : analytics.recoveryFactor > 1 ? 'yellow' : 'red'}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Win/Loss Distribution */}
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="bar-chart-3" size="sm" className="w-4 h-4 text-emerald-400" />
            Win/Loss Distribution
          </h3>
          <WinLossHistogram buckets={analytics.buckets} />
        </div>

        {/* Cumulative P&L Curve */}
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="trending-up" size="sm" className="w-4 h-4 text-emerald-400" />
            Cumulative P&L Curve
          </h3>
          <EquityCurve data={analytics.equityCurve} />
        </div>
      </div>

      {/* Drawdown Chart */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Icon name="trending-down" size="sm" className="w-4 h-4 text-red-400" />
          Drawdown Chart
        </h3>
        <DrawdownChart data={analytics.equityCurve} maxDrawdown={analytics.maxDrawdown} />
      </div>

      {/* Monthly Returns Table */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Icon name="calendar" size="sm" className="w-4 h-4 text-blue-400" />
          Monthly Returns
        </h3>
        <MonthlyReturnsGrid returns={analytics.monthlyReturns} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Trade Duration Analysis */}
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="clock" size="sm" className="w-4 h-4 text-purple-400" />
            Avg Trade Duration by Symbol
          </h3>
          <DurationChart durationBySymbol={analytics.durationBySymbol} />
        </div>

        {/* Risk Metrics */}
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="alert-triangle" size="sm" className="w-4 h-4 text-yellow-400" />
            Risk Metrics
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">Win Rate:</span>
              <span className="text-white font-semibold">{analytics.winRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Avg Win / Avg Loss:</span>
              <span className="text-white font-semibold">
                {formatMoney(analytics.avgWin)} / {formatMoney(-analytics.avgLoss)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Win/Loss Ratio:</span>
              <span className="text-white font-semibold">
                {(analytics.avgWin / analytics.avgLoss).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Max Consecutive Wins:</span>
              <span className="text-emerald-400 font-semibold">{analytics.maxConsecutiveWins}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Max Consecutive Losses:</span>
              <span className="text-red-400 font-semibold">{analytics.maxConsecutiveLosses}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Total Profit:</span>
              <span className={`font-semibold ${analytics.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatMoney(analytics.totalProfit)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Gross Profit:</span>
              <span className="text-emerald-400 font-semibold">{formatMoney(analytics.grossProfit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Gross Loss:</span>
              <span className="text-red-400 font-semibold">{formatMoney(-analytics.grossLoss)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Best/Worst Trades */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
            <Icon name="check-circle" size="sm" className="w-4 h-4" />
            Top 5 Best Trades
          </h3>
          <TradeTable trades={analytics.bestTrades} formatMoney={formatMoney} />
        </div>

        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <Icon name="alert-triangle" size="sm" className="w-4 h-4" />
            Top 5 Worst Trades
          </h3>
          <TradeTable trades={analytics.worstTrades} formatMoney={formatMoney} />
        </div>
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({
  icon,
  label,
  value,
  subValue,
  color
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  color: 'emerald' | 'yellow' | 'red' | 'blue' | 'purple';
}) {
  const colorClasses = {
    emerald: 'text-emerald-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
  };

  return (
    <div className="bg-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={colorClasses[color]}>{icon}</span>
        <span className="text-xs text-zinc-400">{label}</span>
      </div>
      <div className={`text-xl font-bold ${colorClasses[color]}`}>{value}</div>
      {subValue && <div className="text-xs text-zinc-500 mt-1">{subValue}</div>}
    </div>
  );
}

// Win/Loss Histogram
function WinLossHistogram({ buckets }: { buckets: { [key: number]: number } }) {
  const bucketEntries = Object.entries(buckets)
    .map(([bucket, count]) => ({ bucket: parseInt(bucket), count }))
    .sort((a, b) => a.bucket - b.bucket);

  const maxCount = Math.max(...bucketEntries.map(b => b.count), 1);

  return (
    <svg width="100%" height="200" className="overflow-visible">
      {bucketEntries.map((entry, i) => {
        const x = (i / bucketEntries.length) * 100;
        const barWidth = (1 / bucketEntries.length) * 95;
        const height = (entry.count / maxCount) * 180;
        const y = 200 - height - 10;
        const color = entry.bucket >= 0 ? '#22c55e' : '#ef4444';

        return (
          <g key={entry.bucket}>
            <rect
              x={`${x}%`}
              y={y}
              width={`${barWidth}%`}
              height={height}
              fill={color}
              opacity={0.8}
            />
            <text
              x={`${x + barWidth / 2}%`}
              y={195}
              textAnchor="middle"
              fill="#71717a"
              fontSize="9"
            >
              {entry.bucket >= 0 ? '+' : ''}{entry.bucket}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Equity Curve
function EquityCurve({ data }: { data: { date: string; balance: number }[] }) {
  if (data.length === 0) return <div className="text-zinc-500 text-xs">No data</div>;

  const minBalance = Math.min(...data.map(d => d.balance));
  const maxBalance = Math.max(...data.map(d => d.balance));
  const range = maxBalance - minBalance;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 180 - ((d.balance - minBalance) / range) * 160;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height="200" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="#22c55e"
        strokeWidth="2"
      />
      <text x="5" y="15" fill="#71717a" fontSize="10">
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(maxBalance)}
      </text>
      <text x="5" y="195" fill="#71717a" fontSize="10">
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minBalance)}
      </text>
    </svg>
  );
}

// Drawdown Chart
function DrawdownChart({
  data,
  maxDrawdown
}: {
  data: { date: string; drawdown: number }[];
  maxDrawdown: number;
}) {
  if (data.length === 0) return <div className="text-zinc-500 text-xs">No data</div>;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 180 - (d.drawdown / maxDrawdown) * 160;
    return `${x},${y}`;
  }).join(' ');

  const pathData = `M 0,180 L ${points} L 100,180 Z`;

  return (
    <svg width="100%" height="200" className="overflow-visible">
      <path
        d={pathData}
        fill="#ef4444"
        opacity={0.3}
      />
      <polyline
        points={points}
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
      />
      <text x="5" y="15" fill="#71717a" fontSize="10">
        0
      </text>
      <text x="5" y="195" fill="#71717a" fontSize="10">
        -{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(maxDrawdown)}
      </text>
    </svg>
  );
}

// Monthly Returns Grid
function MonthlyReturnsGrid({ returns }: { returns: { [key: string]: number } }) {
  const months = Object.keys(returns).sort();
  const maxAbsReturn = Math.max(...Object.values(returns).map(Math.abs), 1);

  return (
    <div className="grid grid-cols-6 gap-2">
      {months.map(month => {
        const value = returns[month];
        const intensity = Math.min(Math.abs(value) / maxAbsReturn, 1);
        const bgColor = value >= 0
          ? `rgba(34, 197, 94, ${intensity * 0.8})`
          : `rgba(239, 68, 68, ${intensity * 0.8})`;

        return (
          <div
            key={month}
            className="p-2 rounded text-center border border-zinc-700"
            style={{ backgroundColor: bgColor }}
            title={`${month}: ${new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD'
            }).format(value)}`}
          >
            <div className="text-[9px] text-zinc-300 font-medium">{month.substring(5)}</div>
            <div className="text-xs font-semibold text-white mt-1">
              {value >= 0 ? '+' : ''}{value.toFixed(0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Duration Chart
function DurationChart({
  durationBySymbol
}: {
  durationBySymbol: { [symbol: string]: { total: number; count: number } };
}) {
  const symbols = Object.keys(durationBySymbol);
  const avgDurations = symbols.map(symbol => ({
    symbol,
    avgMinutes: durationBySymbol[symbol].total / durationBySymbol[symbol].count,
  })).sort((a, b) => b.avgMinutes - a.avgMinutes);

  const maxDuration = Math.max(...avgDurations.map(d => d.avgMinutes), 1);

  return (
    <svg width="100%" height="200" className="overflow-visible">
      {avgDurations.map((d, i) => {
        const barHeight = (d.avgMinutes / maxDuration) * 160;
        const y = 180 - barHeight;
        const x = (i / avgDurations.length) * 100;
        const barWidth = (1 / avgDurations.length) * 90;

        const hours = Math.floor(d.avgMinutes / 60);
        const minutes = Math.floor(d.avgMinutes % 60);
        const label = hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;

        return (
          <g key={d.symbol}>
            <rect
              x={`${x}%`}
              y={y}
              width={`${barWidth}%`}
              height={barHeight}
              fill="#8b5cf6"
              opacity={0.8}
            />
            <text
              x={`${x + barWidth / 2}%`}
              y={175}
              textAnchor="middle"
              fill="#a1a1aa"
              fontSize="10"
              fontWeight="bold"
            >
              {d.symbol}
            </text>
            <text
              x={`${x + barWidth / 2}%`}
              y={195}
              textAnchor="middle"
              fill="#71717a"
              fontSize="9"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Trade Table
function TradeTable({
  trades,
  formatMoney
}: {
  trades: Trade[];
  formatMoney: (val: number) => string;
}) {
  return (
    <div className="space-y-1">
      {trades.map(trade => (
        <div
          key={trade.id}
          className="flex items-center justify-between p-2 bg-zinc-900 rounded text-xs"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-zinc-500">#{trade.id}</span>
            <span className="font-semibold text-white">{trade.symbol}</span>
            <span className={trade.type === 'BUY' ? 'text-blue-400' : 'text-orange-400'}>
              {trade.type}
            </span>
            <span className="text-zinc-500">{trade.volume.toFixed(2)}</span>
          </div>
          <span className={`font-bold ${trade.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatMoney(trade.profit)}
          </span>
        </div>
      ))}
    </div>
  );
}
