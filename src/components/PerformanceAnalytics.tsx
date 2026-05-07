/**
 * Performance Analytics Dashboard
 * MT5-style trading performance analytics with metrics, charts, and detailed statistics
 */

import { Icon } from './ui/Icon';
import { useMemo } from 'react';
interface Trade {
  id: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  openTime: Date;
  closeTime: Date;
  profit: number;
  volume: number;
}

interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  avgWinLossRatio: number;
  sharpeRatio: number;
  maxDrawdown: number;
  grossProfit: number;
  grossLoss: number;
  largestWin: number;
  largestLoss: number;
  avgTradeDuration: number;
  consecutiveWins: number;
  consecutiveLosses: number;
}

export function PerformanceAnalytics() {
  // Generate mock trade history
  const trades = useMemo(() => generateMockTrades(), []);

  // Calculate performance metrics
  const metrics = useMemo(() => calculateMetrics(trades), [trades]);

  // Calculate equity curve data
  const equityCurve = useMemo(() => {
    let equity = 10000; // Starting balance
    return trades.map((trade) => {
      equity += trade.profit;
      return { date: trade.closeTime, equity };
    });
  }, [trades]);

  // Calculate monthly P&L
  const monthlyPL = useMemo(() => {
    const months = new Map<string, number>();
    trades.forEach((trade) => {
      const month = trade.closeTime.toISOString().substring(0, 7); // YYYY-MM
      months.set(month, (months.get(month) || 0) + trade.profit);
    });
    return Array.from(months.entries()).map(([month, pl]) => ({ month, pl }));
  }, [trades]);

  // Calculate win/loss distribution
  const winLossDistribution = useMemo(() => {
    const wins = trades.filter((t) => t.profit > 0).length;
    const losses = trades.filter((t) => t.profit < 0).length;
    const breakeven = trades.filter((t) => t.profit === 0).length;
    return [
      { label: 'Wins', count: wins, percentage: (wins / trades.length) * 100, color: 'text-green-500' },
      { label: 'Losses', count: losses, percentage: (losses / trades.length) * 100, color: 'text-red-500' },
      { label: 'Breakeven', count: breakeven, percentage: (breakeven / trades.length) * 100, color: 'text-gray-500' },
    ];
  }, [trades]);

  // Get max/min values for equity curve chart scaling
  const maxEquity = Math.max(...equityCurve.map((e) => e.equity));
  const minEquity = Math.min(...equityCurve.map((e) => e.equity));
  const equityRange = maxEquity - minEquity;

  // Get max absolute value for monthly P&L chart scaling
  const maxAbsPL = Math.max(...monthlyPL.map((m) => Math.abs(m.pl)));

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300 overflow-auto p-4 gap-4">
      {/* Top Row - 6 Metric Cards */}
      <div className="grid grid-cols-6 gap-3">
        <MetricCard
          icon={<Icon name="activity" size="lg" />}
          label="Total Trades"
          value={metrics.totalTrades.toString()}
          color="text-blue-400"
        />
        <MetricCard
          icon={<Icon name="crosshair" size="lg" />}
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          color={metrics.winRate >= 50 ? 'text-green-400' : 'text-red-400'}
        />
        <MetricCard
          icon={<Icon name="trending-up" size="lg" />}
          label="Profit Factor"
          value={metrics.profitFactor.toFixed(2)}
          color={metrics.profitFactor >= 1.5 ? 'text-green-400' : metrics.profitFactor >= 1 ? 'text-yellow-400' : 'text-red-400'}
        />
        <MetricCard
          icon={<Icon name="credit-card" size="lg" />}
          label="Avg Win/Loss"
          value={metrics.avgWinLossRatio.toFixed(2)}
          color="text-purple-400"
        />
        <MetricCard
          icon={<Icon name="trending-up" size="lg" />}
          label="Sharpe Ratio"
          value={metrics.sharpeRatio.toFixed(2)}
          color={metrics.sharpeRatio >= 1 ? 'text-green-400' : 'text-yellow-400'}
        />
        <MetricCard
          icon={<Icon name="alert-triangle" size="lg" />}
          label="Max Drawdown"
          value={`${metrics.maxDrawdown.toFixed(1)}%`}
          color="text-red-400"
        />
      </div>

      {/* Main Charts Area */}
      <div className="grid grid-cols-3 gap-4">
        {/* Equity Curve Chart */}
        <div className="col-span-2 bg-[#252528] border border-zinc-700 rounded p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Equity Curve</h3>
          <div className="h-64">
            <svg viewBox="0 0 800 200" className="w-full h-full">
              {/* Grid lines */}
              {[0, 1, 2, 3, 4].map((i) => (
                <line
                  key={i}
                  x1="0"
                  y1={i * 50}
                  x2="800"
                  y2={i * 50}
                  stroke="#3f3f46"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              ))}

              {/* Equity line */}
              <polyline
                points={equityCurve
                  .map((point, i) => {
                    const x = (i / (equityCurve.length - 1)) * 800;
                    const y = 200 - ((point.equity - minEquity) / equityRange) * 180 - 10;
                    return `${x},${y}`;
                  })
                  .join(' ')}
                stroke="#8a8a8f"
                strokeWidth="2"
                fill="none"
              />

              {/* Area fill */}
              <polygon
                points={`0,200 ${equityCurve
                  .map((point, i) => {
                    const x = (i / (equityCurve.length - 1)) * 800;
                    const y = 200 - ((point.equity - minEquity) / equityRange) * 180 - 10;
                    return `${x},${y}`;
                  })
                  .join(' ')} 800,200`}
                fill="url(#equity-gradient)"
              />

              {/* Gradient definition */}
              <defs>
                <linearGradient id="equity-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8a8a8f" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#8a8a8f" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="flex justify-between text-xs text-zinc-500 mt-2">
            <span>${minEquity.toFixed(0)}</span>
            <span className="text-white font-medium">Final: ${equityCurve[equityCurve.length - 1].equity.toFixed(2)}</span>
            <span>${maxEquity.toFixed(0)}</span>
          </div>
        </div>

        {/* Win/Loss Distribution Pie Chart */}
        <div className="bg-[#252528] border border-zinc-700 rounded p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Win/Loss Distribution</h3>
          <div className="flex items-center justify-center h-40">
            <svg viewBox="0 0 200 200" className="w-40 h-40">
              <PieChart data={winLossDistribution} />
            </svg>
          </div>
          <div className="space-y-2 mt-4">
            {winLossDistribution.map((item) => (
              <div key={item.label} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${item.color.replace('text-', 'bg-')}`} />
                  <span>{item.label}</span>
                </div>
                <span className="font-medium">
                  {item.count} ({item.percentage.toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly P&L Bar Chart */}
      <div className="bg-[#252528] border border-zinc-700 rounded p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Monthly P&L</h3>
        <div className="h-48 flex items-end gap-2">
          {monthlyPL.map((month, i) => {
            const height = Math.abs(month.pl) / maxAbsPL * 100;
            const isProfit = month.pl >= 0;
            return (
              <div key={i} className="flex-1 flex flex-col items-center group">
                <div className="w-full flex flex-col items-center justify-end h-32">
                  <div
                    className={`w-full ${isProfit ? 'bg-green-500' : 'bg-red-500'} rounded-t transition-all group-hover:opacity-80`}
                    style={{ height: `${height}%`, minHeight: '2px' }}
                    title={`${month.month}: $${month.pl.toFixed(2)}`}
                  />
                </div>
                <span className="text-[9px] text-zinc-500 mt-2 rotate-45 origin-left whitespace-nowrap">
                  {month.month}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Statistics Table */}
      <div className="bg-[#252528] border border-zinc-700 rounded p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Detailed Statistics</h3>
        <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-xs">
          <StatRow label="Gross Profit" value={`$${metrics.grossProfit.toFixed(2)}`} valueColor="text-green-400" />
          <StatRow label="Gross Loss" value={`$${metrics.grossLoss.toFixed(2)}`} valueColor="text-red-400" />
          <StatRow label="Net Profit" value={`$${(metrics.grossProfit + metrics.grossLoss).toFixed(2)}`} valueColor={(metrics.grossProfit + metrics.grossLoss) >= 0 ? 'text-green-400' : 'text-red-400'} />

          <StatRow label="Largest Win" value={`$${metrics.largestWin.toFixed(2)}`} valueColor="text-green-400" />
          <StatRow label="Largest Loss" value={`$${metrics.largestLoss.toFixed(2)}`} valueColor="text-red-400" />
          <StatRow label="Avg Trade Duration" value={`${metrics.avgTradeDuration.toFixed(1)}h`} />

          <StatRow label="Consecutive Wins" value={metrics.consecutiveWins.toString()} valueColor="text-green-400" />
          <StatRow label="Consecutive Losses" value={metrics.consecutiveLosses.toString()} valueColor="text-red-400" />
          <StatRow label="Total Trades" value={metrics.totalTrades.toString()} />
        </div>
      </div>
    </div>
  );
}

// Helper Components
interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}

function MetricCard({ icon, label, value, color }: MetricCardProps) {
  return (
    <div className="bg-[#252528] border border-zinc-700 rounded p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={color}>{icon}</div>
        <span className="text-[9px] text-zinc-400 uppercase">{label}</span>
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  valueColor?: string;
}

function StatRow({ label, value, valueColor = 'text-white' }: StatRowProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-zinc-400">{label}:</span>
      <span className={`font-medium ${valueColor}`}>{value}</span>
    </div>
  );
}

// Pie Chart Component
interface PieData {
  label: string;
  count: number;
  percentage: number;
  color: string;
}

function PieChart({ data }: { data: PieData[] }) {
  let cumulativePercent = 0;

  return (
    <>
      <circle cx="100" cy="100" r="80" fill="#131316" />
      {data.map((item, i) => {
        const startAngle = (cumulativePercent / 100) * 360;
        const endAngle = ((cumulativePercent + item.percentage) / 100) * 360;
        const largeArc = item.percentage > 50 ? 1 : 0;

        const startRad = ((startAngle - 90) * Math.PI) / 180;
        const endRad = ((endAngle - 90) * Math.PI) / 180;

        const x1 = 100 + 80 * Math.cos(startRad);
        const y1 = 100 + 80 * Math.sin(startRad);
        const x2 = 100 + 80 * Math.cos(endRad);
        const y2 = 100 + 80 * Math.sin(endRad);

        const pathData = [
          `M 100 100`,
          `L ${x1} ${y1}`,
          `A 80 80 0 ${largeArc} 1 ${x2} ${y2}`,
          `Z`,
        ].join(' ');

        cumulativePercent += item.percentage;

        const colorMap: Record<string, string> = {
          'text-green-500': '#22c55e',
          'text-red-500': '#ef4444',
          'text-gray-500': '#6b7280',
        };

        return (
          <path
            key={i}
            d={pathData}
            fill={colorMap[item.color] || '#6b7280'}
            className="transition-opacity hover:opacity-80"
          />
        );
      })}
    </>
  );
}

// TODO: Replace with API call to /api/trades/history
function generateMockTrades(): Trade[] {
  // Placeholder: Returns empty array until backend API is implemented
  return [];
}

function calculateMetrics(trades: Trade[]): PerformanceMetrics {
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.profit > 0);
  const losingTrades = trades.filter((t) => t.profit < 0);

  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
  const grossLoss = losingTrades.reduce((sum, t) => sum + t.profit, 0);
  const profitFactor = grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : 0;

  const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(grossLoss / losingTrades.length) : 0;
  const avgWinLossRatio = avgLoss !== 0 ? avgWin / avgLoss : 0;

  const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map((t) => t.profit)) : 0;
  const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map((t) => t.profit)) : 0;

  // Calculate Sharpe Ratio (simplified)
  const returns = trades.map((t) => t.profit);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const stdDev = Math.sqrt(
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
  );
  const sharpeRatio = stdDev !== 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  // Calculate Max Drawdown
  let peak = 10000;
  let maxDrawdown = 0;
  let equity = 10000;
  trades.forEach((trade) => {
    equity += trade.profit;
    if (equity > peak) peak = equity;
    const drawdown = ((peak - equity) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });

  // Calculate avg trade duration
  const avgTradeDuration =
    trades.reduce((sum, t) => sum + (t.closeTime.getTime() - t.openTime.getTime()), 0) /
    trades.length /
    (1000 * 60 * 60);

  // Calculate consecutive wins/losses
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  trades.forEach((trade) => {
    if (trade.profit > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > consecutiveWins) consecutiveWins = currentWinStreak;
    } else if (trade.profit < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > consecutiveLosses) consecutiveLosses = currentLossStreak;
    }
  });

  return {
    totalTrades,
    winRate,
    profitFactor,
    avgWinLossRatio,
    sharpeRatio,
    maxDrawdown,
    grossProfit,
    grossLoss,
    largestWin,
    largestLoss,
    avgTradeDuration,
    consecutiveWins,
    consecutiveLosses,
  };
}
