/**
 * Portfolio Overview Panel
 * Complete portfolio view showing account metrics, positions, exposure, and performance
 */

import { Icon } from './ui/Icon';
import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

interface GroupedPosition {
  symbol: string;
  positions: any[];
  netDirection: 'LONG' | 'SHORT' | 'HEDGED';
  totalVolume: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPL: number;
}

export function PortfolioOverview() {
  const account = useAppStore((state) => state.account);
  const positions = useAppStore((state) => state.positions);
  const ticks = useAppStore((state) => state.ticks);
  const trades = useAppStore((state) => state.trades);

  // Calculate account metrics
  const accountMetrics = useMemo(() => {
    if (!account) {
      return {
        balance: 0,
        equity: 0,
        usedMargin: 0,
        freeMargin: 0,
        equityChange: 0,
        usedMarginPercent: 0,
        freeMarginPercent: 0,
        freeMarginColor: 'text-green-400',
      };
    }

    const equityChange = account.equity - account.balance;
    const usedMarginPercent = account.equity > 0 ? (account.margin / account.equity) * 100 : 0;
    const freeMarginPercent = account.equity > 0 ? (account.freeMargin / account.equity) * 100 : 0;

    let freeMarginColor = 'text-green-400';
    if (freeMarginPercent < 20) freeMarginColor = 'text-red-400';
    else if (freeMarginPercent < 50) freeMarginColor = 'text-yellow-400';

    return {
      balance: account.balance,
      equity: account.equity,
      usedMargin: account.margin,
      freeMargin: account.freeMargin,
      equityChange,
      usedMarginPercent,
      freeMarginPercent,
      freeMarginColor,
    };
  }, [account]);

  // Group positions by symbol
  const groupedPositions = useMemo(() => {
    const groups = new Map<string, GroupedPosition>();

    positions.forEach((pos) => {
      if (!groups.has(pos.symbol)) {
        groups.set(pos.symbol, {
          symbol: pos.symbol,
          positions: [],
          netDirection: 'LONG',
          totalVolume: 0,
          avgEntryPrice: 0,
          currentPrice: 0,
          unrealizedPL: 0,
        });
      }

      const group = groups.get(pos.symbol)!;
      group.positions.push(pos);
      group.unrealizedPL += pos.unrealizedPnL;

      // Calculate net direction
      const longVolume = group.positions
        .filter((p) => p.side === 'BUY')
        .reduce((sum, p) => sum + p.volume, 0);
      const shortVolume = group.positions
        .filter((p) => p.side === 'SELL')
        .reduce((sum, p) => sum + p.volume, 0);

      if (longVolume > shortVolume) group.netDirection = 'LONG';
      else if (shortVolume > longVolume) group.netDirection = 'SHORT';
      else group.netDirection = 'HEDGED';

      group.totalVolume = Math.abs(longVolume - shortVolume);

      // Calculate weighted average entry price
      const totalValue = group.positions.reduce(
        (sum, p) => sum + p.openPrice * p.volume,
        0
      );
      const totalVol = group.positions.reduce((sum, p) => sum + p.volume, 0);
      group.avgEntryPrice = totalVol > 0 ? totalValue / totalVol : 0;

      // Get current price from ticks
      const tick = ticks[pos.symbol];
      if (tick) {
        group.currentPrice = group.netDirection === 'LONG' ? tick.bid : tick.ask;
      }
    });

    return Array.from(groups.values()).sort((a, b) => b.unrealizedPL - a.unrealizedPL);
  }, [positions, ticks]);

  const totalUnrealizedPL = useMemo(() => {
    return groupedPositions.reduce((sum, g) => sum + g.unrealizedPL, 0);
  }, [groupedPositions]);

  // Calculate exposure breakdown (margin used per symbol)
  const exposureData = useMemo(() => {
    const marginBySymbol = new Map<string, number>();

    positions.forEach((pos) => {
      const current = marginBySymbol.get(pos.symbol) || 0;
      // Simplified margin calculation (actual margin depends on leverage)
      const positionMargin = (pos.volume * pos.currentPrice * 100000) / 100; // Assuming 1:100 leverage
      marginBySymbol.set(pos.symbol, current + positionMargin);
    });

    const sorted = Array.from(marginBySymbol.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([symbol, margin]) => ({ symbol, margin }));

    const top5 = sorted.slice(0, 5);
    const others = sorted.slice(5);
    const othersTotal = others.reduce((sum, item) => sum + item.margin, 0);

    const total = sorted.reduce((sum, item) => sum + item.margin, 0);

    const withPercentages = top5.map((item) => ({
      ...item,
      percentage: total > 0 ? (item.margin / total) * 100 : 0,
    }));

    if (othersTotal > 0) {
      withPercentages.push({
        symbol: 'Other',
        margin: othersTotal,
        percentage: total > 0 ? (othersTotal / total) * 100 : 0,
      });
    }

    return withPercentages;
  }, [positions]);

  // Calculate performance metrics
  const performanceMetrics = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayTrades = trades.filter((t) => new Date(t.closeTime || '') >= todayStart);
    const weekTrades = trades.filter((t) => new Date(t.closeTime || '') >= weekStart);
    const monthTrades = trades.filter((t) => new Date(t.closeTime || '') >= monthStart);

    const todayPL = todayTrades.reduce((sum, t) => sum + t.profit, 0);
    const weekPL = weekTrades.reduce((sum, t) => sum + t.profit, 0);
    const monthPL = monthTrades.reduce((sum, t) => sum + t.profit, 0);

    // Best/Worst performing symbols (based on unrealized P&L)
    const best = groupedPositions.length > 0 ? groupedPositions[0] : null;
    const worst = groupedPositions.length > 0 ? groupedPositions[groupedPositions.length - 1] : null;

    const bestPercent = best && best.avgEntryPrice > 0
      ? ((best.currentPrice - best.avgEntryPrice) / best.avgEntryPrice) * 100
      : 0;
    const worstPercent = worst && worst.avgEntryPrice > 0
      ? ((worst.currentPrice - worst.avgEntryPrice) / worst.avgEntryPrice) * 100
      : 0;

    return {
      todayPL,
      weekPL,
      monthPL,
      bestSymbol: best?.symbol || '-',
      bestPercent,
      worstSymbol: worst?.symbol || '-',
      worstPercent,
    };
  }, [trades, groupedPositions]);

  // Colors for pie chart
  const colors = [
    'bg-zinc-600',
    'bg-green-500',
    'bg-yellow-500',
    'bg-red-500',
    'bg-purple-500',
    'bg-gray-500',
  ];

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300 overflow-auto p-4 gap-4">
      {/* Top Row - Account Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          icon={<Icon name="credit-card" size="xl" />}
          label="Total Balance"
          value={`$${accountMetrics.balance.toFixed(2)}`}
          color="text-blue-400"
        />
        <MetricCard
          icon={<Icon name="trending-up" size="xl" />}
          label="Total Equity"
          value={`$${accountMetrics.equity.toFixed(2)}`}
          subtitle={`${accountMetrics.equityChange >= 0 ? '+' : ''}$${accountMetrics.equityChange.toFixed(2)}`}
          subtitleColor={accountMetrics.equityChange >= 0 ? 'text-green-400' : 'text-red-400'}
          color="text-green-400"
        />
        <MetricCard
          icon={<Icon name="crosshair" size="xl" />}
          label="Used Margin"
          value={`$${accountMetrics.usedMargin.toFixed(2)}`}
          subtitle={`${accountMetrics.usedMarginPercent.toFixed(1)}% of equity`}
          color="text-yellow-400"
        />
        <MetricCard
          icon={<Icon name="credit-card" size="xl" />}
          label="Free Margin"
          value={`$${accountMetrics.freeMargin.toFixed(2)}`}
          subtitle={`${accountMetrics.freeMarginPercent.toFixed(1)}% of equity`}
          color={accountMetrics.freeMarginColor}
        />
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Middle - Open Positions Summary */}
        <div className="flex-1 bg-[#252528] border border-zinc-700 rounded overflow-hidden flex flex-col">
          <div className="bg-[#131316] border-b border-zinc-700 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Open Positions Summary</h3>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#131316] sticky top-0">
                <tr className="border-b border-zinc-700">
                  <th className="px-4 py-2 text-left font-medium text-zinc-400">Symbol</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-400">Direction</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-400">Volume</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-400">Avg Entry</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-400">Current</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-400">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {groupedPositions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-zinc-500">
                      No open positions
                    </td>
                  </tr>
                ) : (
                  <>
                    {groupedPositions.map((group) => (
                      <tr key={group.symbol} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                        <td className="px-4 py-3 font-medium text-white">{group.symbol}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                              group.netDirection === 'LONG'
                                ? 'bg-green-500/20 text-green-400'
                                : group.netDirection === 'SHORT'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-yellow-500/20 text-yellow-400'
                            }`}
                          >
                            {group.netDirection}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">{group.totalVolume.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">{group.avgEntryPrice.toFixed(5)}</td>
                        <td className="px-4 py-3 text-right">{group.currentPrice.toFixed(5)}</td>
                        <td
                          className={`px-4 py-3 text-right font-medium ${
                            group.unrealizedPL >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          ${group.unrealizedPL.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-[#131316] border-t-2 border-zinc-600 font-bold">
                      <td colSpan={5} className="px-4 py-3 text-white">Total</td>
                      <td
                        className={`px-4 py-3 text-right ${
                          totalUnrealizedPL >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        ${totalUnrealizedPL.toFixed(2)}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Sidebar - Exposure Breakdown */}
        <div className="w-80 bg-[#252528] border border-zinc-700 rounded overflow-hidden flex flex-col">
          <div className="bg-[#131316] border-b border-zinc-700 px-4 py-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Icon name="pie-chart" size="md" />
              Exposure Breakdown
            </h3>
          </div>

          <div className="flex-1 p-4 flex flex-col gap-4">
            {/* CSS Pie Chart */}
            <div className="relative w-48 h-48 mx-auto">
              {exposureData.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-40 h-40 rounded-full border-4 border-zinc-700 flex items-center justify-center text-zinc-500 text-xs">
                    No exposure
                  </div>
                </div>
              ) : (
                <PieChart_
                  data={exposureData.map((item, i) => ({
                    ...item,
                    color: colors[i % colors.length],
                  }))}
                />
              )}
            </div>

            {/* Legend */}
            <div className="space-y-2">
              {exposureData.map((item, i) => (
                <div key={item.symbol} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded ${colors[i % colors.length]}`} />
                    <span className="text-zinc-300">{item.symbol}</span>
                  </div>
                  <span className="text-zinc-400 font-medium">{item.percentage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom - Performance Metrics */}
      <div className="grid grid-cols-5 gap-4">
        <PerformanceCard
          label="Today's P&L"
          value={`$${performanceMetrics.todayPL.toFixed(2)}`}
          color={performanceMetrics.todayPL >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <PerformanceCard
          label="This Week's P&L"
          value={`$${performanceMetrics.weekPL.toFixed(2)}`}
          color={performanceMetrics.weekPL >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <PerformanceCard
          label="This Month's P&L"
          value={`$${performanceMetrics.monthPL.toFixed(2)}`}
          color={performanceMetrics.monthPL >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <PerformanceCard
          label="Best Performing"
          value={performanceMetrics.bestSymbol}
          subtitle={`${performanceMetrics.bestPercent >= 0 ? '+' : ''}${performanceMetrics.bestPercent.toFixed(2)}%`}
          color="text-green-400"
        />
        <PerformanceCard
          label="Worst Performing"
          value={performanceMetrics.worstSymbol}
          subtitle={`${performanceMetrics.worstPercent >= 0 ? '+' : ''}${performanceMetrics.worstPercent.toFixed(2)}%`}
          color="text-red-400"
        />
      </div>
    </div>
  );
}

// Helper Components
interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  subtitleColor?: string;
  color: string;
}

function MetricCard({ icon, label, value, subtitle, subtitleColor, color }: MetricCardProps) {
  return (
    <div className="bg-[#252528] border border-zinc-700 rounded p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={color}>{icon}</div>
        <span className="text-xs text-zinc-400 uppercase font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {subtitle && (
        <div className={`text-xs mt-1 ${subtitleColor || 'text-zinc-400'}`}>{subtitle}</div>
      )}
    </div>
  );
}

interface PerformanceCardProps {
  label: string;
  value: string;
  subtitle?: string;
  color: string;
}

function PerformanceCard({ label, value, subtitle, color }: PerformanceCardProps) {
  return (
    <div className="bg-[#252528] border border-zinc-700 rounded p-3">
      <div className="text-[10px] text-zinc-400 uppercase mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {subtitle && <div className={`text-xs mt-0.5 ${color}`}>{subtitle}</div>}
    </div>
  );
}

// CSS Pie Chart Component
interface PieChartData {
  symbol: string;
  percentage: number;
  color: string;
}

function PieChart_({ data }: { data: PieChartData[] }) {
  let cumulativePercent = 0;

  return (
    <div className="relative w-full h-full">
      <svg viewBox="0 0 100 100" className="transform -rotate-90">
        <circle cx="50" cy="50" r="40" fill="#131316" />
        {data.map((item, i) => {
          const startAngle = (cumulativePercent / 100) * 360;
          const endAngle = ((cumulativePercent + item.percentage) / 100) * 360;
          const largeArc = item.percentage > 50 ? 1 : 0;

          const startRad = (startAngle * Math.PI) / 180;
          const endRad = (endAngle * Math.PI) / 180;

          const x1 = 50 + 40 * Math.cos(startRad);
          const y1 = 50 + 40 * Math.sin(startRad);
          const x2 = 50 + 40 * Math.cos(endRad);
          const y2 = 50 + 40 * Math.sin(endRad);

          const pathData = [
            `M 50 50`,
            `L ${x1} ${y1}`,
            `A 40 40 0 ${largeArc} 1 ${x2} ${y2}`,
            `Z`,
          ].join(' ');

          cumulativePercent += item.percentage;

          const colorMap: Record<string, string> = {
            'bg-zinc-600': '#8a8a8f',
            'bg-green-500': '#22c55e',
            'bg-yellow-500': '#eab308',
            'bg-red-500': '#ef4444',
            'bg-purple-500': '#a855f7',
            'bg-gray-500': '#6b7280',
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
      </svg>
    </div>
  );
}
