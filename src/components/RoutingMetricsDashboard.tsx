/**
 * Routing Metrics Dashboard Component
 * Real-time A/B/C-Book routing analytics with charts
 * Features: Distribution charts, timeline, confidence levels, WebSocket updates
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  type IChartApi,
  type LineData,
  type HistogramData,
  ColorType,
} from 'lightweight-charts';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAppStore } from '../store/useAppStore';
import { API_BASE_URL as API_BASE, WS_ENDPOINTS } from '../config/api';
import { Activity, TrendingUp, Filter } from 'lucide-react';

// ============================================
// Type Definitions
// ============================================

type BookType = 'ABOOK' | 'BBOOK' | 'CBOOK';

type TimeRange = '1h' | '4h' | '24h' | '7d' | '30d' | 'custom';

type RoutingDecision = {
  timestamp: number;
  symbol: string;
  book: BookType;
  confidence: number;
  volume: number;
  reason: string;
};

type RoutingMetrics = {
  totalDecisions: number;
  breakdown: {
    ABOOK: number;
    BBOOK: number;
    CBOOK: number;
  };
  avgConfidence: number;
  recentDecisions: RoutingDecision[];
  timeline: Array<{
    timestamp: number;
    ABOOK: number;
    BBOOK: number;
    CBOOK: number;
  }>;
  confidenceDistribution: Array<{
    range: string;
    count: number;
  }>;
};

type RoutingMetricsDashboardProps = {
  className?: string;
};

// ============================================
// Component
// ============================================

export const RoutingMetricsDashboard = ({ className = '' }: RoutingMetricsDashboardProps) => {
  const { accountId, authToken } = useAppStore();

  // State
  const [metrics, setMetrics] = useState<RoutingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Chart refs
  const timelineChartRef = useRef<HTMLDivElement>(null);
  const confidenceChartRef = useRef<HTMLDivElement>(null);
  const timelineChart = useRef<IChartApi | null>(null);
  const confidenceChart = useRef<IChartApi | null>(null);

  // ============================================
  // Data Fetching
  // ============================================

  const fetchMetrics = async () => {
    if (!accountId) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        accountId,
        timeRange,
        ...(selectedSymbol && { symbol: selectedSymbol }),
      });

      const response = await fetch(
        `${API_BASE}/api/routing/metrics?${params}`,
        {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setMetrics(data);
    } catch (err) {
      console.error('Failed to fetch routing metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  const fetchSymbols = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/symbols`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });

      if (response.ok) {
        const data = await response.json();
        setSymbols(data.map((s: { symbol: string }) => s.symbol));
      }
    } catch (err) {
      console.error('Failed to fetch symbols:', err);
    }
  };

  // ============================================
  // WebSocket Real-Time Updates
  // ============================================

  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (!accountId || !autoRefresh) return;

    const unsubscribe = subscribe('routing_decisions', (data: any) => {
      // Filter by symbol if selected
      if (selectedSymbol && data.symbol !== selectedSymbol) return;

      // Update metrics with new decision
      setMetrics((prev) => {
        if (!prev) return prev;

        const newBreakdown = { ...prev.breakdown };
        newBreakdown[data.book] = (newBreakdown[data.book] || 0) + 1;

        return {
          ...prev,
          totalDecisions: prev.totalDecisions + 1,
          breakdown: newBreakdown,
          recentDecisions: [data, ...prev.recentDecisions.slice(0, 49)],
        };
      });
    });

    return () => {
      unsubscribe();
    };
  }, [accountId, selectedSymbol, autoRefresh]);

  // ============================================
  // Chart Initialization
  // ============================================

  useEffect(() => {
    if (!metrics) return;

    // Timeline Chart
    if (timelineChartRef.current && !timelineChart.current) {
      timelineChart.current = createChart(timelineChartRef.current, {
        width: timelineChartRef.current.clientWidth,
        height: 250,
        layout: {
          background: { type: ColorType.Solid, color: '#131316' },
          textColor: '#a1a1aa',
        },
        grid: {
          vertLines: { color: '#222226' },
          horzLines: { color: '#222226' },
        },
        timeScale: {
          borderColor: '#3f3f46',
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: '#3f3f46',
        },
      });

      // Add series for each book type
      const abookSeries = (timelineChart.current as any).addAreaSeries({
        topColor: 'rgba(34, 197, 94, 0.4)',
        bottomColor: 'rgba(34, 197, 94, 0.0)',
        lineColor: 'rgba(34, 197, 94, 1)',
        lineWidth: 2,
        title: 'A-Book',
      });

      const bbookSeries = (timelineChart.current as any).addAreaSeries({
        topColor: 'rgba(59, 130, 246, 0.4)',
        bottomColor: 'rgba(59, 130, 246, 0.0)',
        lineColor: 'rgba(59, 130, 246, 1)',
        lineWidth: 2,
        title: 'B-Book',
      });

      const cbookSeries = (timelineChart.current as any).addAreaSeries({
        topColor: 'rgba(168, 85, 247, 0.4)',
        bottomColor: 'rgba(168, 85, 247, 0.0)',
        lineColor: 'rgba(168, 85, 247, 1)',
        lineWidth: 2,
        title: 'C-Book',
      });

      // Set data
      const abookData: LineData[] = metrics.timeline.map((t) => ({
        time: t.timestamp as any,
        value: t.ABOOK,
      }));

      const bbookData: LineData[] = metrics.timeline.map((t) => ({
        time: t.timestamp as any,
        value: t.BBOOK,
      }));

      const cbookData: LineData[] = metrics.timeline.map((t) => ({
        time: t.timestamp as any,
        value: t.CBOOK,
      }));

      abookSeries.setData(abookData);
      bbookSeries.setData(bbookData);
      cbookSeries.setData(cbookData);
    }

    // Confidence Distribution Chart
    if (confidenceChartRef.current && !confidenceChart.current) {
      confidenceChart.current = createChart(confidenceChartRef.current, {
        width: confidenceChartRef.current.clientWidth,
        height: 200,
        layout: {
          background: { type: ColorType.Solid, color: '#131316' },
          textColor: '#a1a1aa',
        },
        grid: {
          vertLines: { color: '#222226' },
          horzLines: { color: '#222226' },
        },
        timeScale: {
          borderColor: '#3f3f46',
          visible: false,
        },
        rightPriceScale: {
          borderColor: '#3f3f46',
        },
      });

      const histogramSeries = (confidenceChart.current as any).addHistogramSeries({
        color: '#8a8a8f',
        priceFormat: {
          type: 'volume',
        },
      });

      const histogramData: HistogramData[] = metrics.confidenceDistribution.map((d, idx) => ({
        time: idx as any,
        value: d.count,
        color: getConfidenceColor(d.range),
      }));

      histogramSeries.setData(histogramData);
    }

    // Handle resize
    const handleResize = () => {
      if (timelineChart.current && timelineChartRef.current) {
        timelineChart.current.resize(timelineChartRef.current.clientWidth, 250);
      }
      if (confidenceChart.current && confidenceChartRef.current) {
        confidenceChart.current.resize(confidenceChartRef.current.clientWidth, 200);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [metrics]);

  // ============================================
  // Initial Data Load
  // ============================================

  useEffect(() => {
    fetchSymbols();
  }, []);

  useEffect(() => {
    fetchMetrics();

    // Auto-refresh every 30 seconds
    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, 30000);
      return () => clearInterval(interval);
    }
  }, [accountId, timeRange, selectedSymbol, autoRefresh]);

  // ============================================
  // Computed Values
  // ============================================

  const bookPercentages = useMemo(() => {
    if (!metrics) return { ABOOK: 0, BBOOK: 0, CBOOK: 0 };

    const total = metrics.totalDecisions || 1;
    return {
      ABOOK: (metrics.breakdown.ABOOK / total) * 100,
      BBOOK: (metrics.breakdown.BBOOK / total) * 100,
      CBOOK: (metrics.breakdown.CBOOK / total) * 100,
    };
  }, [metrics]);

  // ============================================
  // Render
  // ============================================

  if (loading && !metrics) {
    return (
      <div className={`flex items-center justify-center h-full bg-zinc-900 ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <Icon name="refresh" size="sm" className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-sm text-zinc-500">Loading routing metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full bg-zinc-900 ${className}`}>
        <div className="flex flex-col items-center gap-3 text-red-400">
          <Icon name="activity" size="sm" className="w-8 h-8" />
          <p className="text-sm">{error}</p>
          <button
            onClick={fetchMetrics}
            className="px-4 py-2 text-xs bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-zinc-900 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Icon name="bar-chart-3" size="sm" className="w-4 h-4 text-blue-500" />
            Routing Metrics Dashboard
          </h3>
          <p className="text-xs text-zinc-500">
            {metrics?.totalDecisions || 0} routing decisions
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Symbol Filter */}
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
          >
            <option value="">All Symbols</option>
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>

          {/* Time Range */}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
          >
            <option value="1h">Last Hour</option>
            <option value="4h">Last 4 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-2 rounded transition-colors ${autoRefresh
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
          >
            <Icon name="refresh" size="sm" className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
          </button>

          {/* Manual Refresh */}
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded text-xs transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-3">
          <SummaryCard
            label="Total Decisions"
            value={metrics?.totalDecisions.toLocaleString() || '0'}
            icon={Activity}
            color="blue"
          />
          <SummaryCard
            label="Avg Confidence"
            value={`${(metrics?.avgConfidence || 0).toFixed(1)}%`}
            icon={TrendingUp}
            color="green"
          />
          <SummaryCard
            label="A-Book"
            value={`${bookPercentages.ABOOK.toFixed(1)}%`}
            subtitle={`${metrics?.breakdown.ABOOK || 0} orders`}
            icon={Filter}
            color="green"
          />
          <SummaryCard
            label="B-Book"
            value={`${bookPercentages.BBOOK.toFixed(1)}%`}
            subtitle={`${metrics?.breakdown.BBOOK || 0} orders`}
            icon={Filter}
            color="blue"
          />
        </div>

        {/* Book Distribution Pie Chart */}
        <div className="bg-zinc-800/30 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Icon name="bar-chart-3" size="sm" className="w-4 h-4 text-blue-500" />
            A/B/C-Book Distribution
          </h4>
          <div className="grid grid-cols-3 gap-4">
            <BookDistributionCard
              book="A-Book"
              percentage={bookPercentages.ABOOK}
              count={metrics?.breakdown.ABOOK || 0}
              color="green"
            />
            <BookDistributionCard
              book="B-Book"
              percentage={bookPercentages.BBOOK}
              count={metrics?.breakdown.BBOOK || 0}
              color="blue"
            />
            <BookDistributionCard
              book="C-Book"
              percentage={bookPercentages.CBOOK}
              count={metrics?.breakdown.CBOOK || 0}
              color="purple"
            />
          </div>
        </div>

        {/* Timeline Chart */}
        <div className="bg-zinc-800/30 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Icon name="clock" size="sm" className="w-4 h-4 text-blue-500" />
            Routing Timeline
          </h4>
          <div ref={timelineChartRef} />
        </div>

        {/* Confidence Distribution */}
        <div className="bg-zinc-800/30 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Icon name="trending-up" size="sm" className="w-4 h-4 text-blue-500" />
            Confidence Distribution
          </h4>
          <div ref={confidenceChartRef} />
        </div>

        {/* Recent Decisions Table */}
        <div className="bg-zinc-800/30 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-zinc-800">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Icon name="activity" size="sm" className="w-4 h-4 text-blue-500" />
              Recent Routing Decisions
            </h4>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                <tr className="text-xs text-zinc-500 text-left">
                  <th className="p-2">Time</th>
                  <th className="p-2">Symbol</th>
                  <th className="p-2">Book</th>
                  <th className="p-2">Confidence</th>
                  <th className="p-2">Volume</th>
                  <th className="p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {metrics?.recentDecisions.slice(0, 20).map((decision, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors"
                  >
                    <td className="p-2 text-xs text-zinc-500 font-mono">
                      {new Date(decision.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="p-2 font-medium text-white">{decision.symbol}</td>
                    <td className="p-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getBookBadgeClass(
                          decision.book
                        )}`}
                      >
                        {decision.book}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-zinc-300">
                      {decision.confidence.toFixed(1)}%
                    </td>
                    <td className="p-2 font-mono text-zinc-300">{decision.volume.toFixed(2)}</td>
                    <td className="p-2 text-xs text-zinc-500">{decision.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// Helper Components
// ============================================

type SummaryCardProps = {
  label: string;
  value: string;
  subtitle?: string;
  icon: typeof Activity;
  color: string;
};

const SummaryCard = ({ label, value, subtitle, icon: Icon, color }: SummaryCardProps) => (
  <div className="flex flex-col gap-2 p-4 bg-zinc-800/30 rounded border border-zinc-800">
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 text-${color}-400`} />
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
    <div className={`text-2xl font-bold text-${color}-400`}>{value}</div>
    {subtitle && <div className="text-xs text-zinc-500">{subtitle}</div>}
  </div>
);

type BookDistributionCardProps = {
  book: string;
  percentage: number;
  count: number;
  color: string;
};

const BookDistributionCard = ({ book, percentage, count, color }: BookDistributionCardProps) => (
  <div className="flex flex-col gap-2 p-4 bg-zinc-900/50 rounded border border-zinc-800">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-white">{book}</span>
      <span className={`text-lg font-bold text-${color}-400`}>{percentage.toFixed(1)}%</span>
    </div>
    <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
      <div
        className={`h-full bg-${color}-500 transition-all duration-500`}
        style={{ width: `${percentage}%` }}
      />
    </div>
    <div className="text-xs text-zinc-500">{count.toLocaleString()} decisions</div>
  </div>
);

// ============================================
// Helper Functions
// ============================================

const getBookBadgeClass = (book: BookType): string => {
  switch (book) {
    case 'ABOOK':
      return 'bg-green-900/30 text-green-400';
    case 'BBOOK':
      return 'bg-blue-900/30 text-blue-400';
    case 'CBOOK':
      return 'bg-purple-900/30 text-purple-400';
    default:
      return 'bg-zinc-800 text-zinc-400';
  }
};

const getConfidenceColor = (range: string): string => {
  const value = parseInt(range.split('-')[0]);
  if (value >= 90) return '#22c55e'; // green
  if (value >= 70) return '#8a8a8f'; // blue
  if (value >= 50) return '#eab308'; // yellow
  return '#ef4444'; // red
};
