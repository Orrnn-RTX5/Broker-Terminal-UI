/**
 * Rule Effectiveness Dashboard Component
 * Dynamic data-driven dashboard for analyzing trading rule performance
 * Features: Sortable rankings, performance charts, win rate distribution, drawdown analysis
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useMemo, useRef } from 'react';
import { createChart, ColorType, LineSeries, AreaSeries } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import { API_BASE_URL } from '../config/api';
import { Award, BarChart3, TrendingUp, Activity } from 'lucide-react';

// ============================================
// Types
// ============================================

type RuleMetrics = {
  ruleId: string;
  ruleName: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  avgTradeDuration: string;
  lastExecuted: string;
};

type TimeSeriesPoint = {
  time: number;
  value: number;
};

type SortField = keyof RuleMetrics;
type SortOrder = 'asc' | 'desc';
type TimeRange = '1D' | '1W' | '1M' | '3M' | 'ALL';

// ============================================
// Main Component
// ============================================

export const RuleEffectivenessDashboard = () => {
  const [rules, setRules] = useState<RuleMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('sharpeRatio');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<TimeRange>('1M');
  const [_showTooltip, _setShowTooltip] = useState<string | null>(null);

  // Fetch rule metrics
  useEffect(() => {
    const fetchRules = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE_URL}/api/analytics/rules/metrics?timeRange=${timeRange}`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        setRules(data || []);
      } catch (err) {
        console.error('Failed to fetch rule metrics:', err);
        setError(err instanceof Error ? err.message : 'Failed to load rule metrics');
        setRules([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRules();
    const interval = setInterval(fetchRules, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [timeRange]);

  // Sort rules
  const sortedRules = useMemo(() => {
    const sorted = [...rules].sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return 0;
    });

    return sorted;
  }, [rules, sortField, sortOrder]);

  // Calculate aggregate metrics
  const aggregateMetrics = useMemo(() => {
    if (rules.length === 0) {
      return {
        totalRules: 0,
        avgSharpe: 0,
        avgProfitFactor: 0,
        totalTrades: 0,
        overallWinRate: 0,
        bestSharpe: 0,
        worstDrawdown: 0,
      };
    }

    const totalTrades = rules.reduce((sum, r) => sum + r.totalTrades, 0);
    const totalWins = rules.reduce((sum, r) => sum + r.winningTrades, 0);

    return {
      totalRules: rules.length,
      avgSharpe: rules.reduce((sum, r) => sum + r.sharpeRatio, 0) / rules.length,
      avgProfitFactor: rules.reduce((sum, r) => sum + r.profitFactor, 0) / rules.length,
      totalTrades,
      overallWinRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
      bestSharpe: Math.max(...rules.map(r => r.sharpeRatio)),
      worstDrawdown: Math.min(...rules.map(r => r.maxDrawdownPercent)),
    };
  }, [rules]);

  // Handle sort
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Handle rule selection
  const toggleRuleSelection = (ruleId: string) => {
    const newSelection = new Set(selectedRules);
    if (newSelection.has(ruleId)) {
      newSelection.delete(ruleId);
    } else {
      newSelection.add(ruleId);
    }
    setSelectedRules(newSelection);
  };

  // Get rank badge
  const getRankBadge = (index: number) => {
    if (index === 0) return { color: 'gold', icon: Award, label: '1st' };
    if (index === 1) return { color: 'silver', icon: Award, label: '2nd' };
    if (index === 2) return { color: 'bronze', icon: Award, label: '3rd' };
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div>
          <h2 className="text-lg font-bold text-white">Rule Effectiveness Dashboard</h2>
          <p className="text-xs text-zinc-500">Performance metrics and rankings</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center gap-2 bg-zinc-800 rounded p-1">
            {(['1D', '1W', '1M', '3M', 'ALL'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${timeRange === range
                  ? 'bg-emerald-500 text-white'
                  : 'text-zinc-400 hover:text-white'
                  }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Aggregate Metrics Cards */}
      <div className="grid grid-cols-4 gap-4 p-4 border-b border-zinc-800 bg-zinc-900/50">
        <MetricCard
          label="Total Rules"
          value={aggregateMetrics.totalRules.toString()}
          icon={BarChart3}
          color="blue"
          tooltip="Number of trading rules analyzed"
        />
        <MetricCard
          label="Avg Sharpe Ratio"
          value={aggregateMetrics.avgSharpe.toFixed(2)}
          icon={TrendingUp}
          color={aggregateMetrics.avgSharpe > 1 ? 'green' : aggregateMetrics.avgSharpe > 0 ? 'yellow' : 'red'}
          tooltip="Average risk-adjusted return (>1 is good, >2 is excellent)"
        />
        <MetricCard
          label="Avg Profit Factor"
          value={aggregateMetrics.avgProfitFactor.toFixed(2)}
          icon={Activity}
          color={aggregateMetrics.avgProfitFactor > 1.5 ? 'green' : aggregateMetrics.avgProfitFactor > 1 ? 'yellow' : 'red'}
          tooltip="Gross Profit / Gross Loss (>1.5 is good)"
        />
        <MetricCard
          label="Overall Win Rate"
          value={`${aggregateMetrics.overallWinRate.toFixed(1)}%`}
          icon={Award}
          color={aggregateMetrics.overallWinRate > 55 ? 'green' : aggregateMetrics.overallWinRate > 45 ? 'yellow' : 'red'}
          tooltip="Percentage of winning trades across all rules"
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {loading && rules.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <Icon name="clock" size="sm" className="w-6 h-6 animate-pulse mr-2" />
            Loading rule metrics...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500">
            <Icon name="alert-triangle" size="sm" className="w-8 h-8 mb-2" />
            <p>{error}</p>
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Icon name="bar-chart-3" size="sm" className="w-8 h-8 mb-2 text-zinc-700" />
            <p>No rule data available</p>
            <p className="text-xs mt-1">Execute trades with rules to see metrics</p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Sortable Rule Ranking Table */}
            <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="p-3 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Icon name="check-circle" size="sm" className="w-4 h-4" />
                  Rule Rankings
                  {selectedRules.size > 0 && (
                    <span className="text-xs text-emerald-400">
                      ({selectedRules.size} selected for comparison)
                    </span>
                  )}
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900 border-b border-zinc-800">
                    <tr className="text-xs text-zinc-500">
                      <th className="p-2 text-left">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedRules.size === rules.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRules(new Set(rules.map(r => r.ruleId)));
                            } else {
                              setSelectedRules(new Set());
                            }
                          }}
                        />
                      </th>
                      <th className="p-2 text-left">Rank</th>
                      <SortableHeader
                        label="Rule Name"
                        field="ruleName"
                        currentField={sortField}
                        currentOrder={sortOrder}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Sharpe Ratio"
                        field="sharpeRatio"
                        currentField={sortField}
                        currentOrder={sortOrder}
                        onSort={handleSort}
                        tooltip="Risk-adjusted return metric"
                      />
                      <SortableHeader
                        label="Profit Factor"
                        field="profitFactor"
                        currentField={sortField}
                        currentOrder={sortOrder}
                        onSort={handleSort}
                        tooltip="Gross Profit / Gross Loss"
                      />
                      <SortableHeader
                        label="Win Rate"
                        field="winRate"
                        currentField={sortField}
                        currentOrder={sortOrder}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Total P&L"
                        field="totalPnL"
                        currentField={sortField}
                        currentOrder={sortOrder}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Max DD %"
                        field="maxDrawdownPercent"
                        currentField={sortField}
                        currentOrder={sortOrder}
                        onSort={handleSort}
                        tooltip="Maximum drawdown percentage"
                      />
                      <SortableHeader
                        label="Trades"
                        field="totalTrades"
                        currentField={sortField}
                        currentOrder={sortOrder}
                        onSort={handleSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRules.map((rule, index) => {
                      const rankBadge = getRankBadge(index);
                      return (
                        <tr
                          key={rule.ruleId}
                          className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors"
                        >
                          <td className="p-2">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={selectedRules.has(rule.ruleId)}
                              onChange={() => toggleRuleSelection(rule.ruleId)}
                            />
                          </td>
                          <td className="p-2">
                            {rankBadge ? (
                              <div className="flex items-center gap-1">
                                <rankBadge.icon
                                  className={`w-4 h-4 ${rankBadge.color === 'gold'
                                    ? 'text-yellow-400'
                                    : rankBadge.color === 'silver'
                                      ? 'text-zinc-400'
                                      : 'text-orange-600'
                                    }`}
                                />
                                <span className="text-xs font-medium text-zinc-400">
                                  {rankBadge.label}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-zinc-500">#{index + 1}</span>
                            )}
                          </td>
                          <td className="p-2 font-medium text-white">{rule.ruleName}</td>
                          <td className="p-2">
                            <MetricValue
                              value={rule.sharpeRatio}
                              format={(v) => v.toFixed(2)}
                              threshold={{ good: 1, excellent: 2 }}
                            />
                          </td>
                          <td className="p-2">
                            <MetricValue
                              value={rule.profitFactor}
                              format={(v) => v.toFixed(2)}
                              threshold={{ good: 1, excellent: 1.5 }}
                            />
                          </td>
                          <td className="p-2">
                            <MetricValue
                              value={rule.winRate}
                              format={(v) => `${v.toFixed(1)}%`}
                              threshold={{ good: 45, excellent: 55 }}
                            />
                          </td>
                          <td className="p-2">
                            <div
                              className={`font-mono font-bold ${rule.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}
                            >
                              {rule.totalPnL >= 0 ? '+' : ''}${rule.totalPnL.toFixed(2)}
                            </div>
                          </td>
                          <td className="p-2">
                            <MetricValue
                              value={rule.maxDrawdownPercent}
                              format={(v) => `${v.toFixed(1)}%`}
                              threshold={{ good: -10, excellent: -5 }}
                              inverted
                            />
                          </td>
                          <td className="p-2 text-zinc-300 font-mono">{rule.totalTrades}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Win Rate Distribution */}
            {rules.length > 0 && (
              <WinRateDistribution rules={rules} />
            )}

            {/* Performance Timeline (if rules selected) */}
            {selectedRules.size > 0 && (
              <RulePerformanceChart
                selectedRuleIds={Array.from(selectedRules)}
                timeRange={timeRange}
              />
            )}

            {/* Drawdown Visualization (if rules selected) */}
            {selectedRules.size > 0 && (
              <DrawdownChart
                selectedRuleIds={Array.from(selectedRules)}
                timeRange={timeRange}
              />
            )}

            {/* Rule Comparison Table */}
            {selectedRules.size > 1 && (
              <RuleComparisonTable
                rules={rules.filter(r => selectedRules.has(r.ruleId))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================
// Metric Card Component
// ============================================

type MetricCardProps = {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  tooltip?: string;
};

const MetricCard = ({ label, value, icon: MetricIcon, color, tooltip }: MetricCardProps) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const colorClasses = {
    blue: 'text-blue-400 border-zinc-600/20 bg-zinc-700/20',
    green: 'text-green-400 border-green-500/20 bg-green-500/10',
    yellow: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10',
    red: 'text-red-400 border-red-500/20 bg-red-500/10',
  }[color] || 'text-zinc-400 border-zinc-500/20 bg-zinc-500/10';

  return (
    <div className={`relative flex flex-col gap-2 p-4 rounded-lg border ${colorClasses}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MetricIcon className={`w-5 h-5 text-${color}-400`} />
          <span className="text-xs text-zinc-400">{label}</span>
        </div>
        {tooltip && (
          <div
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <Icon name="info" size="sm" className="w-4 h-4 text-zinc-500 cursor-help" />
            {showTooltip && (
              <div className="absolute right-0 top-6 z-10 w-48 p-2 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 shadow-lg">
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold text-${color}-400`}>{value}</div>
    </div>
  );
};

// ============================================
// Sortable Header Component
// ============================================

type SortableHeaderProps = {
  label: string;
  field: SortField;
  currentField: SortField;
  currentOrder: SortOrder;
  onSort: (field: SortField) => void;
  tooltip?: string;
};

const SortableHeader = ({
  label,
  field,
  currentField,
  currentOrder,
  onSort,
  tooltip,
}: SortableHeaderProps) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const isActive = currentField === field;

  return (
    <th
      className="p-2 text-left cursor-pointer hover:text-emerald-400 transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1 relative">
        <span>{label}</span>
        {isActive && (
          currentOrder === 'asc' ? <Icon name="chevron-up" size="sm" className="w-3 h-3" /> : <Icon name="chevron-down" size="sm" className="w-3 h-3" />
        )}
        {tooltip && (
          <div
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <Icon name="info" size="sm" className="w-3 h-3 text-zinc-600 cursor-help" />
            {showTooltip && (
              <div className="absolute left-0 top-5 z-10 w-48 p-2 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 shadow-lg font-normal">
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  );
};

// ============================================
// Metric Value Component (with color coding)
// ============================================

type MetricValueProps = {
  value: number;
  format: (v: number) => string;
  threshold: { good: number; excellent: number };
  inverted?: boolean;
};

const MetricValue = ({ value, format, threshold, inverted = false }: MetricValueProps) => {
  let color = 'zinc';

  if (inverted) {
    if (value >= threshold.excellent) color = 'green';
    else if (value >= threshold.good) color = 'yellow';
    else color = 'red';
  } else {
    if (value >= threshold.excellent) color = 'green';
    else if (value >= threshold.good) color = 'yellow';
    else color = 'red';
  }

  return (
    <div className={`font-mono text-${color}-400 font-medium`}>
      {format(value)}
    </div>
  );
};

// ============================================
// Win Rate Distribution Component
// ============================================

type WinRateDistributionProps = {
  rules: RuleMetrics[];
};

const WinRateDistribution = ({ rules }: WinRateDistributionProps) => {
  const buckets = useMemo(() => {
    const ranges = [
      { min: 0, max: 30, label: '0-30%' },
      { min: 30, max: 40, label: '30-40%' },
      { min: 40, max: 50, label: '40-50%' },
      { min: 50, max: 60, label: '50-60%' },
      { min: 60, max: 70, label: '60-70%' },
      { min: 70, max: 100, label: '70%+' },
    ];

    return ranges.map(range => ({
      label: range.label,
      count: rules.filter(r => r.winRate >= range.min && r.winRate < range.max).length,
    }));
  }, [rules]);

  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  return (
    <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <Icon name="bar-chart-3" size="sm" className="w-4 h-4" />
        Win Rate Distribution
      </h3>
      <div className="space-y-3">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="flex items-center gap-3">
            <div className="w-16 text-xs text-zinc-400">{bucket.label}</div>
            <div className="flex-1 bg-zinc-900 rounded-full h-6 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 flex items-center justify-end px-2"
                style={{ width: `${(bucket.count / maxCount) * 100}%` }}
              >
                {bucket.count > 0 && (
                  <span className="text-xs font-medium text-white">{bucket.count}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// Rule Performance Chart Component
// ============================================

type RulePerformanceChartProps = {
  selectedRuleIds: string[];
  timeRange: TimeRange;
};

const RulePerformanceChart = ({ selectedRuleIds, timeRange }: RulePerformanceChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: '#222226' },
        horzLines: { color: '#222226' },
      },
      timeScale: {
        borderColor: '#3f3f46',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#3f3f46',
      },
    });

    chartRef.current = chart;

    // Fetch and render data
    const fetchData = async () => {
      setLoading(true);
      try {
        const promises = selectedRuleIds.map(async (ruleId) => {
          const response = await fetch(
            `${API_BASE_URL}/api/analytics/rules/${ruleId}/pnl?timeRange=${timeRange}`
          );
          const data = await response.json();
          return { ruleId, data };
        });

        const results = await Promise.all(promises);

        // Add series for each rule
        const colors = ['#10b981', '#8a8a8f', '#f59e0b', '#8b5cf6', '#ec4899'];
        results.forEach((result, index) => {
          const series = chart.addSeries(LineSeries, {
            color: colors[index % colors.length],
            lineWidth: 2,
          });

          const formattedData = result.data.map((point: TimeSeriesPoint) => ({
            time: point.time,
            value: point.value,
          }));

          series.setData(formattedData);
        });

        chart.timeScale().fitContent();
      } catch (error) {
        console.error('Failed to fetch performance data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [selectedRuleIds, timeRange]);

  return (
    <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <Icon name="line-chart" size="sm" className="w-4 h-4" />
        Performance Timeline ({selectedRuleIds.length} rule{selectedRuleIds.length !== 1 ? 's' : ''})
      </h3>
      {loading && (
        <div className="flex items-center justify-center h-[300px] text-zinc-500">
          <Icon name="clock" size="sm" className="w-6 h-6 animate-pulse mr-2" />
          Loading chart data...
        </div>
      )}
      <div ref={chartContainerRef} className={loading ? 'hidden' : ''} />
    </div>
  );
};

// ============================================
// Drawdown Chart Component
// ============================================

type DrawdownChartProps = {
  selectedRuleIds: string[];
  timeRange: TimeRange;
};

const DrawdownChart = ({ selectedRuleIds, timeRange }: DrawdownChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 250,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: '#222226' },
        horzLines: { color: '#222226' },
      },
      timeScale: {
        borderColor: '#3f3f46',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#3f3f46',
      },
    });

    chartRef.current = chart;

    const fetchData = async () => {
      setLoading(true);
      try {
        const promises = selectedRuleIds.map(async (ruleId) => {
          const response = await fetch(
            `${API_BASE_URL}/api/analytics/rules/${ruleId}/drawdown?timeRange=${timeRange}`
          );
          const data = await response.json();
          return { ruleId, data };
        });

        const results = await Promise.all(promises);

        const colors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16'];
        results.forEach((result, index) => {
          const series = chart.addSeries(AreaSeries, {
            topColor: `${colors[index % colors.length]}40`,
            bottomColor: `${colors[index % colors.length]}00`,
            lineColor: colors[index % colors.length],
            lineWidth: 2,
          });

          const formattedData = result.data.map((point: TimeSeriesPoint) => ({
            time: point.time,
            value: point.value,
          }));

          series.setData(formattedData);
        });

        chart.timeScale().fitContent();
      } catch (error) {
        console.error('Failed to fetch drawdown data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [selectedRuleIds, timeRange]);

  return (
    <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <Icon name="trending-down" size="sm" className="w-4 h-4" />
        Underwater Equity Curve (Drawdown)
      </h3>
      {loading && (
        <div className="flex items-center justify-center h-[250px] text-zinc-500">
          <Icon name="clock" size="sm" className="w-6 h-6 animate-pulse mr-2" />
          Loading drawdown data...
        </div>
      )}
      <div ref={chartContainerRef} className={loading ? 'hidden' : ''} />
    </div>
  );
};

// ============================================
// Rule Comparison Table Component
// ============================================

type RuleComparisonTableProps = {
  rules: RuleMetrics[];
};

const RuleComparisonTable = ({ rules }: RuleComparisonTableProps) => {
  const metrics = [
    { key: 'sharpeRatio', label: 'Sharpe Ratio', format: (v: number) => v.toFixed(2) },
    { key: 'profitFactor', label: 'Profit Factor', format: (v: number) => v.toFixed(2) },
    { key: 'winRate', label: 'Win Rate', format: (v: number) => `${v.toFixed(1)}%` },
    { key: 'totalPnL', label: 'Total P&L', format: (v: number) => `$${v.toFixed(2)}` },
    { key: 'maxDrawdownPercent', label: 'Max DD %', format: (v: number) => `${v.toFixed(1)}%` },
    { key: 'avgWin', label: 'Avg Win', format: (v: number) => `$${v.toFixed(2)}` },
    { key: 'avgLoss', label: 'Avg Loss', format: (v: number) => `$${v.toFixed(2)}` },
    { key: 'totalTrades', label: 'Total Trades', format: (v: number) => v.toString() },
  ];

  return (
    <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <Icon name="activity" size="sm" className="w-4 h-4" />
        Side-by-Side Comparison ({rules.length} rules)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 border-b border-zinc-800">
            <tr className="text-xs text-zinc-500">
              <th className="p-2 text-left sticky left-0 bg-zinc-900">Metric</th>
              {rules.map((rule) => (
                <th key={rule.ruleId} className="p-2 text-left">
                  {rule.ruleName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.key} className="border-b border-zinc-800">
                <td className="p-2 font-medium text-zinc-300 sticky left-0 bg-zinc-900/95">
                  {metric.label}
                </td>
                {rules.map((rule) => {
                  const value = rule[metric.key as keyof RuleMetrics] as number;
                  return (
                    <td key={rule.ruleId} className="p-2 font-mono text-zinc-400">
                      {metric.format(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
