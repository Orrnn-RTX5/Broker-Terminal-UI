/**
 * LP Comparison Dashboard Component
 * Real-time LP performance comparison with interactive charts and ranking
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  createChart,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
// ============================================
// Types
// ============================================

type MetricType = 'latency' | 'fillRate' | 'slippage';

type SortDirection = 'asc' | 'desc';

interface LPMetrics {
  lpName: string;
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  fillRate: number;
  slippage: {
    avg: number;
    max: number;
  };
  totalOrders: number;
  lastUpdate: number;
}

interface TimeSeriesDataPoint {
  time: Time;
  value: number;
}

interface LPTimeSeriesData {
  lpName: string;
  data: TimeSeriesDataPoint[];
}

interface SortConfig {
  key: string;
  direction: SortDirection;
}

// ============================================
// LP Color Mapping
// ============================================

const LP_COLORS: Record<string, string> = {
  'LP-1': '#10b981', // emerald
  'LP-2': '#8a8a8f', // blue
  'LP-3': '#f59e0b', // amber
  'LP-4': '#ef4444', // red
  'LP-5': '#8b5cf6', // violet
  'LP-6': '#ec4899', // pink
  'Default': '#71717a', // zinc
};

const getLPColor = (lpName: string): string => {
  return LP_COLORS[lpName] || LP_COLORS['Default'];
};

// ============================================
// API Configuration
// ============================================

import { API_BASE_URL, WS_ENDPOINTS } from '../config/api';

// ============================================
// Main Component
// ============================================

export const LPComparisonDashboard = () => {
  const [lpMetrics, setLpMetrics] = useState<LPMetrics[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('latency');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('ALL');
  const [availableSymbols, setAvailableSymbols] = useState<string[]>(['ALL']);
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'latency.avg',
    direction: 'asc',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeSeriesData, setTimeSeriesData] = useState<LPTimeSeriesData[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  // ============================================
  // Fetch Initial Data
  // ============================================

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch LP metrics
        const metricsRes = await fetch(
          `${API_BASE_URL}/api/analytics/lp/metrics${selectedSymbol !== 'ALL' ? `?symbol=${selectedSymbol}` : ''}`
        );

        if (!metricsRes.ok) {
          throw new Error(`Failed to fetch LP metrics: ${metricsRes.statusText}`);
        }

        const metricsData = await metricsRes.json();
        setLpMetrics(Array.isArray(metricsData) ? metricsData : []);

        // Fetch available symbols
        const symbolsRes = await fetch(`${API_BASE_URL}/api/symbols`);
        if (symbolsRes.ok) {
          const symbols = await symbolsRes.json();
          const symbolNames = Array.isArray(symbols)
            ? symbols.map((s: any) => s.symbol || s)
            : [];
          setAvailableSymbols(['ALL', ...symbolNames]);
        }

        setIsLoading(false);
      } catch (err: any) {
        console.error('Failed to fetch LP data:', err);
        setError(err.message || 'Failed to load LP comparison data');
        setIsLoading(false);
      }
    };

    fetchInitialData();
  }, [selectedSymbol]);

  // ============================================
  // WebSocket Connection for Real-Time Updates
  // ============================================

  useEffect(() => {
    const ws: WebSocket | null = null;
    const reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    const isUnmounting = false;

    // Use centralized WebSocket with auto-reconnection
    const { subscribe, sendMessage } = useWebSocket({
      url: WS_ENDPOINTS.admin,
      autoConnect: true,
    });

    // Subscribe to lp-metrics-update messages
    const unsubscribe = subscribe('*', (message: any) => {
      try {
        const data = message;

        if (data.type === 'lp-metrics-update') {
          // Update metrics
          setLpMetrics(prev => {
            const existing = prev.find(lp => lp.lpName === data.lpName);
            if (existing) {
              return prev.map(lp =>
                lp.lpName === data.lpName ? { ...lp, ...data.metrics } : lp
              );
            }
            return [...prev, { lpName: data.lpName, ...data.metrics }];
          });

          // Update time series data
          setTimeSeriesData(prev => {
            const lpData = prev.find(lp => lp.lpName === data.lpName);
            const newPoint: TimeSeriesDataPoint = {
              time: Math.floor(Date.now() / 1000) as Time,
              value: getMetricValue(data.metrics, selectedMetric),
            };

            if (lpData) {
              return prev.map(lp =>
                lp.lpName === data.lpName
                  ? { ...lp, data: [...lp.data.slice(-100), newPoint] }
                  : lp
              );
            }
            return [...prev, { lpName: data.lpName, data: [newPoint] }];
          });
        }
      } catch (err) {
        console.error('[LP Dashboard] WebSocket message error:', err);
      }
    });

    // Send subscription message on connect
    sendMessage({
      type: 'subscribe',
      channel: 'lp-performance',
      symbol: selectedSymbol,
    });

    return () => {
      unsubscribe();
    };
  }, [selectedSymbol, selectedMetric]);

  // ============================================
  // Helper Functions
  // ============================================

  const getMetricValue = (metrics: LPMetrics, type: MetricType): number => {
    switch (type) {
      case 'latency':
        return metrics.latency.avg;
      case 'fillRate':
        return metrics.fillRate;
      case 'slippage':
        return metrics.slippage.avg;
      default:
        return 0;
    }
  };

  // ============================================
  // Sorting Logic
  // ============================================

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedMetrics = useMemo(() => {
    const sorted = [...lpMetrics];

    sorted.sort((a, b) => {
      let aValue: number;
      let bValue: number;

      if (sortConfig.key.includes('.')) {
        const keys = sortConfig.key.split('.');
        aValue = (a as any)[keys[0]][keys[1]];
        bValue = (b as any)[keys[0]][keys[1]];
      } else {
        aValue = (a as any)[sortConfig.key];
        bValue = (b as any)[sortConfig.key];
      }

      if (sortConfig.direction === 'asc') {
        return aValue - bValue;
      }
      return bValue - aValue;
    });

    return sorted;
  }, [lpMetrics, sortConfig]);

  // ============================================
  // Ranking Logic
  // ============================================

  const rankings = useMemo(() => {
    const getScore = (lp: LPMetrics): number => {
      // Lower latency = better, higher fill rate = better, lower slippage = better
      const latencyScore = 1000 / (lp.latency.avg + 1);
      const fillRateScore = lp.fillRate * 1000;
      const slippageScore = 100 / (lp.slippage.avg + 1);
      return latencyScore + fillRateScore + slippageScore;
    };

    return [...lpMetrics]
      .map(lp => ({ ...lp, score: getScore(lp) }))
      .sort((a, b) => b.score - a.score);
  }, [lpMetrics]);

  // ============================================
  // Loading & Error States
  // ============================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="text-center">
          <Icon name="refresh" size="sm" className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Loading LP comparison data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96 bg-red-900/20 rounded-lg border border-red-700/50">
        <div className="text-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-4 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">LP Performance Comparison</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Real-time comparison of liquidity provider performance
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Symbol Filter */}
          <div className="flex items-center gap-2">
            <Icon name="filter" size="sm" className="w-4 h-4 text-zinc-500" />
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
            >
              {availableSymbols.map(symbol => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </div>

          {/* Metric Selector */}
          <div className="flex gap-2 bg-zinc-800 rounded-lg p-1">
            <MetricButton
              active={selectedMetric === 'latency'}
              onClick={() => setSelectedMetric('latency')}
              icon={<Icon name="clock" size="sm" className="w-4 h-4" />}
              label="Latency"
            />
            <MetricButton
              active={selectedMetric === 'fillRate'}
              onClick={() => setSelectedMetric('fillRate')}
              icon={<Icon name="crosshair" size="sm" className="w-4 h-4" />}
              label="Fill Rate"
            />
            <MetricButton
              active={selectedMetric === 'slippage'}
              onClick={() => setSelectedMetric('slippage')}
              icon={<Icon name="zap" size="sm" className="w-4 h-4" />}
              label="Slippage"
            />
          </div>
        </div>
      </div>

      {/* Performance Chart */}
      <PerformanceChart
        data={timeSeriesData}
        metricType={selectedMetric}
      />

      {/* Comparison Table */}
      <ComparisonTable
        metrics={sortedMetrics}
        sortConfig={sortConfig}
        onSort={handleSort}
      />

      {/* Rankings */}
      <RankingView rankings={rankings} />
    </div>
  );
};

// ============================================
// Metric Button Component
// ============================================

const MetricButton = ({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${active
      ? 'bg-emerald-500 text-black'
      : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
      }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

// ============================================
// Performance Chart Component
// ============================================

const PerformanceChart = ({
  data,
  metricType,
}: {
  data: LPTimeSeriesData[];
  metricType: MetricType;
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131316' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: '#222226' },
        horzLines: { color: '#222226' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#222226',
      },
      timeScale: {
        borderColor: '#222226',
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 300,
    });

    chartRef.current = chart;

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
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;

    // Clear existing series
    seriesMapRef.current.forEach(series => {
      chartRef.current?.removeSeries(series);
    });
    seriesMapRef.current.clear();

    // Create series for each LP
    data.forEach(lpData => {
      const series = (chartRef.current! as any).addLineSeries({
        color: getLPColor(lpData.lpName),
        lineWidth: 2,
        title: lpData.lpName,
      });

      series.setData(lpData.data);
      seriesMapRef.current.set(lpData.lpName, series);
    });

    // Fit content
    chartRef.current.timeScale().fitContent();
  }, [data]);

  const getMetricLabel = (): string => {
    switch (metricType) {
      case 'latency':
        return 'Latency (ms)';
      case 'fillRate':
        return 'Fill Rate (%)';
      case 'slippage':
        return 'Slippage (pips)';
    }
  };

  return (
    <div className="bg-zinc-800/50 rounded-lg border border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white">Performance Over Time</h3>
        <span className="text-xs text-zinc-500">{getMetricLabel()}</span>
      </div>
      <div ref={chartContainerRef} />

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {data.map(lpData => (
          <div key={lpData.lpName} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: getLPColor(lpData.lpName) }}
            />
            <span className="text-xs text-zinc-400">{lpData.lpName}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// Comparison Table Component
// ============================================

const ComparisonTable = ({
  metrics,
  sortConfig,
  onSort,
}: {
  metrics: LPMetrics[];
  sortConfig: SortConfig;
  onSort: (key: string) => void;
}) => {
  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column) {
      return <Icon name="chevron-up" size="sm" className="w-3 h-3 text-zinc-600" />;
    }
    return sortConfig.direction === 'asc' ? (
      <Icon name="chevron-up" size="sm" className="w-3 h-3 text-emerald-400" />
    ) : (
      <Icon name="chevron-down" size="sm" className="w-3 h-3 text-emerald-400" />
    );
  };

  const TableHeader = ({ column, label }: { column: string; label: string }) => (
    <th
      onClick={() => onSort(column)}
      className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors"
    >
      <div className="flex items-center gap-1">
        {label}
        <SortIcon column={column} />
      </div>
    </th>
  );

  return (
    <div className="bg-zinc-800/50 rounded-lg border border-zinc-700 overflow-hidden">
      <table className="w-full">
        <thead className="bg-zinc-900/50">
          <tr>
            <TableHeader column="lpName" label="LP Name" />
            <TableHeader column="latency.avg" label="Avg Latency" />
            <TableHeader column="latency.p95" label="P95 Latency" />
            <TableHeader column="latency.p99" label="P99 Latency" />
            <TableHeader column="fillRate" label="Fill Rate" />
            <TableHeader column="slippage.avg" label="Avg Slippage" />
            <TableHeader column="slippage.max" label="Max Slippage" />
            <TableHeader column="totalOrders" label="Orders" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700">
          {metrics.map((lp, index) => (
            <tr
              key={lp.lpName}
              className={`hover:bg-zinc-800/50 transition-colors ${index === 0 ? 'bg-emerald-900/10' : ''
                }`}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getLPColor(lp.lpName) }}
                  />
                  <span className="text-sm font-medium text-white">{lp.lpName}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-zinc-300">
                {lp.latency.avg.toFixed(2)}ms
              </td>
              <td className="px-4 py-3 text-sm text-zinc-300">
                {lp.latency.p95.toFixed(2)}ms
              </td>
              <td className="px-4 py-3 text-sm text-zinc-300">
                {lp.latency.p99.toFixed(2)}ms
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-300">
                    {(lp.fillRate * 100).toFixed(2)}%
                  </span>
                  {lp.fillRate >= 0.95 && (
                    <Icon name="trending-up" size="sm" className="w-4 h-4 text-emerald-400" />
                  )}
                  {lp.fillRate < 0.8 && (
                    <Icon name="trending-down" size="sm" className="w-4 h-4 text-red-400" />
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-zinc-300">
                {lp.slippage.avg.toFixed(2)} pips
              </td>
              <td className="px-4 py-3 text-sm text-zinc-300">
                {lp.slippage.max.toFixed(2)} pips
              </td>
              <td className="px-4 py-3 text-sm text-zinc-300">
                {lp.totalOrders.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {metrics.length === 0 && (
        <div className="p-8 text-center text-sm text-zinc-500">
          No LP data available
        </div>
      )}
    </div>
  );
};

// ============================================
// Ranking View Component
// ============================================

const RankingView = ({ rankings }: { rankings: Array<LPMetrics & { score: number }> }) => {
  return (
    <div className="bg-zinc-800/50 rounded-lg border border-zinc-700 p-4">
      <h3 className="text-sm font-medium text-white mb-3">Overall Rankings</h3>
      <div className="space-y-2">
        {rankings.slice(0, 5).map((lp, index) => (
          <div
            key={lp.lpName}
            className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg"
          >
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full font-bold ${index === 0
                ? 'bg-yellow-500/20 text-yellow-400'
                : index === 1
                  ? 'bg-zinc-400/20 text-zinc-400'
                  : index === 2
                    ? 'bg-orange-700/20 text-orange-400'
                    : 'bg-zinc-700/20 text-zinc-500'
                }`}
            >
              {index + 1}
            </div>
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: getLPColor(lp.lpName) }}
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-white">{lp.lpName}</div>
              <div className="text-xs text-zinc-500">
                Score: {lp.score.toFixed(2)} • {lp.totalOrders.toLocaleString()} orders
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-zinc-400">
              <div className="flex items-center gap-1">
                <Icon name="clock" size="sm" className="w-3 h-3" />
                {lp.latency.avg.toFixed(1)}ms
              </div>
              <div className="flex items-center gap-1">
                <Icon name="crosshair" size="sm" className="w-3 h-3" />
                {(lp.fillRate * 100).toFixed(1)}%
              </div>
              <div className="flex items-center gap-1">
                <Icon name="zap" size="sm" className="w-3 h-3" />
                {lp.slippage.avg.toFixed(2)}p
              </div>
            </div>
          </div>
        ))}
      </div>

      {rankings.length === 0 && (
        <div className="text-center text-sm text-zinc-500 py-4">
          No ranking data available
        </div>
      )}
    </div>
  );
};
