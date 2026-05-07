/**
 * Equity Curve / Account Performance Tracker
 * Visualizes account growth with detailed performance metrics
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo, useEffect } from 'react';
import { useEquityCurveStore, type TimeRange } from '../store/useEquityCurveStore';
import { api } from '../services/api';

interface DailySnapshot {
  date: Date;
  balance: number;
  equity: number;
  freeMargin: number;
  dailyPnL: number;
  deposit?: number;
  withdrawal?: number;
}

interface MonthlyPerformance {
  month: string;
  year: number;
  pnl: number;
  return: number;
}

async function fetchEquityCurveData(timeRange: TimeRange): Promise<DailySnapshot[]> {
  try {
    const periodMap: Record<TimeRange, '1d' | '7d' | '30d' | '90d' | '1y' | undefined> = {
      '1W': '7d',
      '1M': '30d',
      '3M': '90d',
      '6M': '1y', // Fallback
      '1Y': '1y',
      'All': undefined,
    };

    const data = await api.history.getEquityHistory(periodMap[timeRange]);
    return data.map(point => ({
      date: new Date(point.timestamp),
      balance: point.equity, // Simplified mapping as backend might only provide equity points
      equity: point.equity,
      freeMargin: point.equity,
      dailyPnL: 0, // Calculated later or simplified
    }));
  } catch (error) {
    console.error('[EquityCurveTracker] Failed to fetch equity data:', error);
    return [];
  }
}

// Calculate drawdown from peak
function calculateDrawdowns(data: DailySnapshot[]): number[] {
  const drawdowns: number[] = [];
  let peak = data[0].balance;

  for (const snapshot of data) {
    if (snapshot.balance > peak) {
      peak = snapshot.balance;
    }
    const drawdown = ((snapshot.balance - peak) / peak) * 100;
    drawdowns.push(drawdown);
  }

  return drawdowns;
}

// Calculate monthly performance
function calculateMonthlyPerformance(data: DailySnapshot[]): MonthlyPerformance[] {
  const monthlyMap = new Map<string, { pnl: number; startBalance: number }>();

  data.forEach((snapshot, index) => {
    const monthKey = `${snapshot.date.getFullYear()}-${snapshot.date.getMonth()}`;
    const month = snapshot.date.toLocaleString('default', { month: 'short' });
    const year = snapshot.date.getFullYear();

    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, {
        pnl: 0,
        startBalance: index > 0 ? data[index - 1].balance : data[0].balance - snapshot.dailyPnL,
      });
    }

    const monthData = monthlyMap.get(monthKey)!;
    monthData.pnl += snapshot.dailyPnL;
  });

  const performance: MonthlyPerformance[] = [];
  monthlyMap.forEach((value, key) => {
    const [yearStr, monthStr] = key.split('-');
    const year = parseInt(yearStr);
    const monthIndex = parseInt(monthStr);
    const month = new Date(year, monthIndex).toLocaleString('default', { month: 'short' });
    const returnPct = (value.pnl / value.startBalance) * 100;

    performance.push({
      month,
      year,
      pnl: value.pnl,
      return: returnPct,
    });
  });

  return performance.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month);
  });
}

export const EquityCurveTracker: React.FC = () => {
  const { selectedTimeRange, setTimeRange } = useEquityCurveStore();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [allData, setAllData] = useState<DailySnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch data when time range changes
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      const data = await fetchEquityCurveData(selectedTimeRange);
      setAllData(data);
      setIsLoading(false);
    };

    loadData();
  }, [selectedTimeRange]);

  // Filter data based on time range
  const filteredData = useMemo(() => {
    const now = new Date();
    let daysToShow = 90;

    switch (selectedTimeRange) {
      case '1W': daysToShow = 7; break;
      case '1M': daysToShow = 30; break;
      case '3M': daysToShow = 90; break;
      case '6M': daysToShow = 180; break;
      case '1Y': daysToShow = 365; break;
      case 'All': daysToShow = allData.length; break;
    }

    return allData.slice(-daysToShow);
  }, [allData, selectedTimeRange]);

  // Calculate drawdowns
  const drawdowns = useMemo(() => calculateDrawdowns(filteredData), [filteredData]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (filteredData.length === 0) {
      return {
        startBalance: 0,
        currentBalance: 0,
        totalPnL: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        maxDrawdownDollars: 0,
        winDays: 0,
        lossDays: 0,
        profitFactor: 0,
        bestDay: 0,
        worstDay: 0,
        avgDailyPnL: 0,
        recoveryFactor: 0,
      };
    }

    const startBalance = filteredData[0]?.balance - filteredData[0]?.dailyPnL || 0;
    const currentBalance = filteredData[filteredData.length - 1]?.balance || 0;
    const totalPnL = currentBalance - startBalance;
    const totalReturn = startBalance > 0 ? (totalPnL / startBalance) * 100 : 0;

    const maxDrawdown = Math.min(...drawdowns);
    const maxDrawdownIndex = drawdowns.indexOf(maxDrawdown);
    const maxDrawdownDollars = (maxDrawdown / 100) * filteredData[maxDrawdownIndex].balance;

    const winDays = filteredData.filter(d => d.dailyPnL > 0).length;
    const lossDays = filteredData.filter(d => d.dailyPnL < 0).length;

    const totalWins = filteredData.filter(d => d.dailyPnL > 0).reduce((sum, d) => sum + d.dailyPnL, 0);
    const totalLosses = Math.abs(filteredData.filter(d => d.dailyPnL < 0).reduce((sum, d) => sum + d.dailyPnL, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    const bestDay = Math.max(...filteredData.map(d => d.dailyPnL));
    const worstDay = Math.min(...filteredData.map(d => d.dailyPnL));
    const avgDailyPnL = totalPnL / filteredData.length;

    const recoveryFactor = Math.abs(maxDrawdownDollars) > 0 ? totalPnL / Math.abs(maxDrawdownDollars) : 0;

    return {
      startBalance,
      currentBalance,
      totalPnL,
      totalReturn,
      maxDrawdown,
      maxDrawdownDollars,
      winDays,
      lossDays,
      profitFactor,
      bestDay,
      worstDay,
      avgDailyPnL,
      recoveryFactor,
    };
  }, [filteredData, drawdowns]);

  // Monthly performance
  const monthlyPerformance = useMemo(() => {
    if (allData.length === 0) return [];
    return calculateMonthlyPerformance(allData);
  }, [allData]);

  // Time range buttons
  const timeRanges: TimeRange[] = ['1W', '1M', '3M', '6M', '1Y', 'All'];

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Icon name="trending-up" size="sm" className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-sm">Equity Curve</span>
        </div>

        {/* Time Range Selector */}
        <div className="flex gap-1">
          {timeRanges.map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2 py-1 text-xs rounded transition-colors ${selectedTimeRange === range
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Loading equity data...
            </div>
          </div>
        ) : allData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <Icon name="trending-up" size="sm" className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No equity data available</p>
              <p className="text-xs mt-1">Start trading to see your performance</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {/* Main Chart Area */}
            <div className="col-span-3 space-y-4">
              {/* Equity Curve Chart */}
              <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                  <Icon name="activity" size="sm" className="w-4 h-4" />
                  Equity Curve
                </h3>
                <EquityCurveChart
                  data={filteredData}
                  drawdowns={drawdowns}
                  startBalance={stats.startBalance}
                  hoveredIndex={hoveredIndex}
                  onHover={setHoveredIndex}
                />
              </div>

              {/* Drawdown Analysis */}
              <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Drawdown Analysis</h3>
                <DrawdownChart data={filteredData} drawdowns={drawdowns} />
              </div>

              {/* Monthly Performance Grid */}
              <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                  <Icon name="calendar" size="sm" className="w-4 h-4" />
                  Monthly Performance
                </h3>
                <MonthlyGrid performance={monthlyPerformance} />
              </div>
            </div>

            {/* Stats Sidebar */}
            <div className="space-y-3">
              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Starting Balance</div>
                <div className="text-lg font-bold text-zinc-100">${stats.startBalance.toFixed(2)}</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Current Balance</div>
                <div className="text-lg font-bold text-emerald-400">${stats.currentBalance.toFixed(2)}</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Total P&L</div>
                <div className={`text-lg font-bold ${stats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL.toFixed(2)}
                </div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Total Return</div>
                <div className={`text-lg font-bold ${stats.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.totalReturn >= 0 ? '+' : ''}{stats.totalReturn.toFixed(2)}%
                </div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Max Drawdown</div>
                <div className="text-lg font-bold text-red-400">{stats.maxDrawdown.toFixed(2)}%</div>
                <div className="text-xs text-red-400">${Math.abs(stats.maxDrawdownDollars).toFixed(2)}</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Recovery Factor</div>
                <div className="text-lg font-bold text-zinc-100">{stats.recoveryFactor.toFixed(2)}</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Best Day</div>
                <div className="text-sm font-bold text-emerald-400">+${stats.bestDay.toFixed(2)}</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Worst Day</div>
                <div className="text-sm font-bold text-red-400">${stats.worstDay.toFixed(2)}</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Avg Daily P&L</div>
                <div className={`text-sm font-bold ${stats.avgDailyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.avgDailyPnL >= 0 ? '+' : ''}${stats.avgDailyPnL.toFixed(2)}
                </div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Win / Loss Days</div>
                <div className="text-sm font-bold text-zinc-100">
                  <span className="text-emerald-400">{stats.winDays}</span> / <span className="text-red-400">{stats.lossDays}</span>
                </div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Profit Factor</div>
                <div className="text-lg font-bold text-zinc-100">{stats.profitFactor.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Equity Curve Chart Component
interface EquityCurveChartProps {
  data: DailySnapshot[];
  drawdowns: number[];
  startBalance: number;
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
}

const EquityCurveChart: React.FC<EquityCurveChartProps> = ({
  data,
  drawdowns,
  startBalance,
  hoveredIndex,
  onHover,
}) => {
  const width = 800;
  const height = 300;
  const padding = { top: 20, right: 60, bottom: 40, left: 60 };

  const minBalance = Math.min(...data.map(d => Math.min(d.balance, d.equity, d.freeMargin)));
  const maxBalance = Math.max(...data.map(d => Math.max(d.balance, d.equity, d.freeMargin)));
  const balanceRange = maxBalance - minBalance;

  const xScale = (index: number) => padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right);
  const yScale = (value: number) => height - padding.bottom - ((value - minBalance) / balanceRange) * (height - padding.top - padding.bottom);

  // Benchmark line (5% annual = ~0.0137% daily)
  const benchmarkData = data.map((_, i) => {
    return startBalance * Math.pow(1.05, i / 365);
  });

  // Find peak for drawdown shading
  let peak = data[0].balance;
  const peakPoints: { x: number; y: number }[] = [];
  const currentPoints: { x: number; y: number }[] = [];

  data.forEach((snapshot, i) => {
    if (snapshot.balance > peak) {
      peak = snapshot.balance;
    }
    peakPoints.push({ x: xScale(i), y: yScale(peak) });
    currentPoints.push({ x: xScale(i), y: yScale(snapshot.balance) });
  });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64 bg-zinc-900 rounded">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = height - padding.bottom - ratio * (height - padding.top - padding.bottom);
          const value = minBalance + ratio * balanceRange;
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#3f3f46"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <text x={padding.left - 10} y={y + 4} fill="#71717a" fontSize="10" textAnchor="end">
                ${value.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Drawdown shading (red when below peak) */}
        {drawdowns.some(dd => dd < 0) && (
          <polygon
            points={[
              ...peakPoints.map((p, i) => `${p.x},${p.y}`),
              ...currentPoints.reverse().map((p) => `${p.x},${p.y}`),
            ].join(' ')}
            fill="#ef4444"
            opacity="0.1"
          />
        )}

        {/* Benchmark line */}
        <polyline
          points={benchmarkData.map((value, i) => `${xScale(i)},${yScale(value)}`).join(' ')}
          fill="none"
          stroke="#eab308"
          strokeWidth="1.5"
          strokeDasharray="5,5"
          opacity="0.5"
        />

        {/* Free Margin line (gray dashed) */}
        <polyline
          points={data.map((d, i) => `${xScale(i)},${yScale(d.freeMargin)}`).join(' ')}
          fill="none"
          stroke="#71717a"
          strokeWidth="1.5"
          strokeDasharray="3,3"
        />

        {/* Equity line (green) */}
        <polyline
          points={data.map((d, i) => `${xScale(i)},${yScale(d.equity)}`).join(' ')}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
        />

        {/* Balance line (blue) */}
        <polyline
          points={data.map((d, i) => `${xScale(i)},${yScale(d.balance)}`).join(' ')}
          fill="none"
          stroke="#8a8a8f"
          strokeWidth="2.5"
        />

        {/* Deposit/Withdrawal markers */}
        {data.map((snapshot, i) => {
          if (snapshot.deposit) {
            return (
              <polygon
                key={`deposit-${i}`}
                points={`${xScale(i)},${yScale(snapshot.balance) - 10} ${xScale(i) - 5},${yScale(snapshot.balance)} ${xScale(i) + 5},${yScale(snapshot.balance)}`}
                fill="#10b981"
              />
            );
          }
          if (snapshot.withdrawal) {
            return (
              <polygon
                key={`withdrawal-${i}`}
                points={`${xScale(i)},${yScale(snapshot.balance) + 10} ${xScale(i) - 5},${yScale(snapshot.balance)} ${xScale(i) + 5},${yScale(snapshot.balance)}`}
                fill="#ef4444"
              />
            );
          }
          return null;
        })}

        {/* Hover area */}
        <rect
          x={padding.left}
          y={padding.top}
          width={width - padding.left - padding.right}
          height={height - padding.top - padding.bottom}
          fill="transparent"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const index = Math.round(((x - padding.left) / (width - padding.left - padding.right)) * (data.length - 1));
            onHover(Math.max(0, Math.min(data.length - 1, index)));
          }}
          onMouseLeave={() => onHover(null)}
        />

        {/* Hover tooltip */}
        {hoveredIndex !== null && (
          <>
            <line
              x1={xScale(hoveredIndex)}
              y1={padding.top}
              x2={xScale(hoveredIndex)}
              y2={height - padding.bottom}
              stroke="#60a5fa"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
            <circle cx={xScale(hoveredIndex)} cy={yScale(data[hoveredIndex].balance)} r="4" fill="#8a8a8f" />
          </>
        )}

        {/* X-axis labels */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text
            key={i}
            x={xScale(i)}
            y={height - padding.bottom + 20}
            fill="#71717a"
            fontSize="10"
            textAnchor="middle"
          >
            {data[i].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        ))}

        {/* Legend */}
        <g transform={`translate(${width - padding.right - 150}, 10)`}>
          <line x1="0" y1="0" x2="20" y2="0" stroke="#8a8a8f" strokeWidth="2.5" />
          <text x="25" y="4" fill="#71717a" fontSize="10">Balance</text>

          <line x1="0" y1="15" x2="20" y2="15" stroke="#10b981" strokeWidth="2" />
          <text x="25" y="19" fill="#71717a" fontSize="10">Equity</text>

          <line x1="0" y1="30" x2="20" y2="30" stroke="#71717a" strokeWidth="1.5" strokeDasharray="3,3" />
          <text x="25" y="34" fill="#71717a" fontSize="10">Free Margin</text>
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div className="absolute top-0 right-0 bg-zinc-800 border border-zinc-700 rounded p-2 text-xs">
          <div className="text-zinc-400">{data[hoveredIndex].date.toLocaleDateString()}</div>
          <div className="text-zinc-100">Balance: ${data[hoveredIndex].balance.toFixed(2)}</div>
          <div className="text-emerald-400">Equity: ${data[hoveredIndex].equity.toFixed(2)}</div>
          <div className={data[hoveredIndex].dailyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            Daily P&L: {data[hoveredIndex].dailyPnL >= 0 ? '+' : ''}${data[hoveredIndex].dailyPnL.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
};

// Drawdown Chart Component
interface DrawdownChartProps {
  data: DailySnapshot[];
  drawdowns: number[];
}

const DrawdownChart: React.FC<DrawdownChartProps> = ({ data, drawdowns }) => {
  const width = 800;
  const height = 150;
  const padding = { top: 10, right: 60, bottom: 30, left: 60 };

  const minDrawdown = Math.min(...drawdowns, 0);
  const maxDrawdown = 0;

  const xScale = (index: number) => padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right);
  const yScale = (value: number) => padding.top + ((maxDrawdown - value) / (maxDrawdown - minDrawdown)) * (height - padding.top - padding.bottom);

  const maxDrawdownIndex = drawdowns.indexOf(Math.min(...drawdowns));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32 bg-zinc-900 rounded">
      {/* Zero line */}
      <line
        x1={padding.left}
        y1={yScale(0)}
        x2={width - padding.right}
        y2={yScale(0)}
        stroke="#71717a"
        strokeWidth="1"
      />

      {/* Drawdown area */}
      <polygon
        points={[
          `${padding.left},${yScale(0)}`,
          ...drawdowns.map((dd, i) => `${xScale(i)},${yScale(dd)}`),
          `${xScale(data.length - 1)},${yScale(0)}`,
        ].join(' ')}
        fill="#ef4444"
        opacity="0.3"
      />

      {/* Drawdown line */}
      <polyline
        points={drawdowns.map((dd, i) => `${xScale(i)},${yScale(dd)}`).join(' ')}
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
      />

      {/* Max drawdown marker */}
      <circle cx={xScale(maxDrawdownIndex)} cy={yScale(drawdowns[maxDrawdownIndex])} r="4" fill="#ef4444" />
      <text
        x={xScale(maxDrawdownIndex)}
        y={yScale(drawdowns[maxDrawdownIndex]) + 15}
        fill="#ef4444"
        fontSize="10"
        textAnchor="middle"
      >
        Max DD: {drawdowns[maxDrawdownIndex].toFixed(2)}%
      </text>

      {/* Y-axis labels */}
      <text x={padding.left - 10} y={yScale(0) + 4} fill="#71717a" fontSize="10" textAnchor="end">0%</text>
      <text x={padding.left - 10} y={yScale(minDrawdown) + 4} fill="#71717a" fontSize="10" textAnchor="end">
        {minDrawdown.toFixed(1)}%
      </text>
    </svg>
  );
};

// Monthly Performance Grid Component
interface MonthlyGridProps {
  performance: MonthlyPerformance[];
}

const MonthlyGrid: React.FC<MonthlyGridProps> = ({ performance }) => {
  const maxAbsPnL = Math.max(...performance.map(p => Math.abs(p.pnl)));

  const getColorIntensity = (pnl: number) => {
    const intensity = Math.abs(pnl) / maxAbsPnL;
    if (pnl > 0) {
      return `rgba(16, 185, 129, ${0.2 + intensity * 0.6})`; // emerald with varying opacity
    } else if (pnl < 0) {
      return `rgba(239, 68, 68, ${0.2 + intensity * 0.6})`; // red with varying opacity
    }
    return '#222226'; // zinc-800
  };

  return (
    <div className="grid grid-cols-6 gap-2">
      {performance.map((month) => (
        <div
          key={`${month.year}-${month.month}`}
          className="border border-zinc-700 rounded p-2 text-center"
          style={{ backgroundColor: getColorIntensity(month.pnl) }}
        >
          <div className="text-xs text-zinc-300 font-medium">{month.month} {month.year}</div>
          <div className={`text-sm font-bold ${month.pnl >= 0 ? 'text-emerald-100' : 'text-red-100'}`}>
            {month.pnl >= 0 ? '+' : ''}${month.pnl.toFixed(0)}
          </div>
          <div className="text-xs text-zinc-400">
            {month.return >= 0 ? '+' : ''}{month.return.toFixed(1)}%
          </div>
        </div>
      ))}
    </div>
  );
};
