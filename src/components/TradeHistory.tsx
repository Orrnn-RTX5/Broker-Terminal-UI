/**
 * Trade History Component
 * Displays closed trades with P&L, filters, and export functionality
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getStoredAccountLogin, tradeGatewayApi } from '../api/tradeGateway';
import { DollarSign, TrendingUp } from 'lucide-react';

type Trade = {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  closePrice: number;
  openTime: string;
  closeTime: string;
  profit: number;
  commission: number;
  swap: number;
  pips: number;
  duration: string;
};

type TradeHistoryProps = {
  accountId?: string;
};

export const TradeHistory = ({ accountId }: TradeHistoryProps) => {
  const { accountId: storeAccountId } = useAppStore();
  const activeAccountId = accountId || storeAccountId;

  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSide, setFilterSide] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [filterProfit, setFilterProfit] = useState<'ALL' | 'PROFIT' | 'LOSS'>('ALL');
  const [dateRange, setDateRange] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');

  // Fetch trade history
  useEffect(() => {
    const activeLogin = Number.parseInt(String(activeAccountId || ''), 10) || getStoredAccountLogin();
    if (!activeLogin) return;

    const fetchTrades = async () => {
      setLoading(true);
      try {
        const data = await tradeGatewayApi.getOrderHistory(activeLogin);
        setTrades(data.map((trade) => ({
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side?.toUpperCase().includes('SELL') ? 'SELL' : 'BUY',
          volume: trade.volume,
          openPrice: trade.openPrice,
          closePrice: trade.closePrice ?? trade.openPrice,
          openTime: trade.openTime,
          closeTime: trade.closeTime ?? trade.openTime,
          profit: trade.profit,
          commission: trade.commission,
          swap: trade.swap,
          pips: 0,
          duration: '0s',
        })));
      } catch (error) {
        console.error('Failed to fetch trade history:', error);
        setTrades([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTrades();
    const interval = setInterval(fetchTrades, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [activeAccountId]);

  const displayTrades = trades;

  // Filter trades
  const filteredTrades = useMemo(() => {
    return displayTrades.filter((trade) => {
      // Search filter
      if (searchTerm && !trade.symbol.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Side filter
      if (filterSide !== 'ALL' && trade.side !== filterSide) {
        return false;
      }

      // Profit filter
      if (filterProfit === 'PROFIT' && trade.profit <= 0) return false;
      if (filterProfit === 'LOSS' && trade.profit >= 0) return false;

      // Date filter
      if (dateRange !== 'ALL') {
        const tradeDate = new Date(trade.closeTime);
        const now = new Date();
        const diffDays = Math.floor(
          (now.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (dateRange === 'TODAY' && diffDays > 0) return false;
        if (dateRange === 'WEEK' && diffDays > 7) return false;
        if (dateRange === 'MONTH' && diffDays > 30) return false;
      }

      return true;
    });
  }, [displayTrades, searchTerm, filterSide, filterProfit, dateRange]);

  // Calculate statistics
  const stats = useMemo(() => {
    const totalTrades = filteredTrades.length;
    const winningTrades = filteredTrades.filter((t) => t.profit > 0).length;
    const losingTrades = filteredTrades.filter((t) => t.profit < 0).length;
    const totalProfit = filteredTrades.reduce((sum, t) => sum + t.profit, 0);
    const totalCommission = filteredTrades.reduce((sum, t) => sum + t.commission, 0);
    const totalSwap = filteredTrades.reduce((sum, t) => sum + t.swap, 0);
    const netProfit = totalProfit - totalCommission - totalSwap;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      totalProfit,
      totalCommission,
      totalSwap,
      netProfit,
      winRate,
    };
  }, [filteredTrades]);

  const exportToCSV = () => {
    if (filteredTrades.length === 0) {
      alert('No trades to export');
      return;
    }

    const headers = [
      'ID',
      'Symbol',
      'Side',
      'Volume',
      'Open Price',
      'Close Price',
      'Open Time',
      'Close Time',
      'Profit',
      'Commission',
      'Swap',
      'Pips',
      'Duration',
    ];

    const rows = filteredTrades.map((trade) => [
      trade.id,
      trade.symbol,
      trade.side,
      trade.volume,
      trade.openPrice,
      trade.closePrice,
      trade.openTime,
      trade.closeTime,
      trade.profit,
      trade.commission,
      trade.swap,
      trade.pips,
      trade.duration,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trade-history-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (timeString: string) => {
    try {
      const date = new Date(timeString);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timeString;
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Trade History</h3>
          <p className="text-xs text-zinc-500">
            {filteredTrades.length} trade{filteredTrades.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={filteredTrades.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="download" size="sm" className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Statistics Panel */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-zinc-800 bg-zinc-900/50">
        <StatCard
          label="Total Trades"
          value={stats.totalTrades.toString()}
          icon={DollarSign}
          color="blue"
        />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          icon={TrendingUp}
          color={stats.winRate >= 50 ? 'green' : 'red'}
        />
        <StatCard
          label="Gross P&L"
          value={`$${stats.totalProfit.toFixed(2)}`}
          icon={DollarSign}
          color={stats.totalProfit >= 0 ? 'green' : 'red'}
        />
        <StatCard
          label="Net P&L"
          value={`$${stats.netProfit.toFixed(2)}`}
          icon={DollarSign}
          color={stats.netProfit >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 p-3 border-b border-zinc-800">
        {/* Search */}
        <div className="flex-1 relative">
          <Icon name="search" size="sm" className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by symbol..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Side Filter */}
        <select
          value={filterSide}
          onChange={(e) => setFilterSide(e.target.value as 'ALL' | 'BUY' | 'SELL')}
          className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-emerald-500"
        >
          <option value="ALL">All Sides</option>
          <option value="BUY">Buy Only</option>
          <option value="SELL">Sell Only</option>
        </select>

        {/* Profit Filter */}
        <select
          value={filterProfit}
          onChange={(e) => setFilterProfit(e.target.value as 'ALL' | 'PROFIT' | 'LOSS')}
          className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-emerald-500"
        >
          <option value="ALL">All Results</option>
          <option value="PROFIT">Profits Only</option>
          <option value="LOSS">Losses Only</option>
        </select>

        {/* Date Range */}
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as any)}
          className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-emerald-500"
        >
          <option value="ALL">All Time</option>
          <option value="TODAY">Today</option>
          <option value="WEEK">Last 7 Days</option>
          <option value="MONTH">Last 30 Days</option>
        </select>
      </div>

      {/* Trade List */}
      <div className="flex-1 overflow-auto">
        {loading && trades.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <Icon name="clock" size="sm" className="w-6 h-6 animate-pulse mr-2" />
            Loading trade history...
          </div>
        ) : filteredTrades.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Icon name="filter" size="sm" className="w-8 h-8 mb-2 text-zinc-700" />
            <p>No trades found</p>
            <p className="text-xs mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
              <tr className="text-xs text-zinc-500 text-left">
                <th className="p-2">ID</th>
                <th className="p-2">Symbol</th>
                <th className="p-2">Side</th>
                <th className="p-2">Volume</th>
                <th className="p-2">Open</th>
                <th className="p-2">Close</th>
                <th className="p-2">Pips</th>
                <th className="p-2">Profit</th>
                <th className="p-2">Costs</th>
                <th className="p-2">Close Time</th>
                <th className="p-2">Duration</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((trade) => (
                <tr
                  key={trade.id}
                  className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors"
                >
                  <td className="p-2 text-zinc-500 font-mono text-xs">#{trade.id}</td>
                  <td className="p-2 font-medium text-white">{trade.symbol}</td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${trade.side === 'BUY'
                          ? 'bg-green-900/30 text-green-400'
                          : 'bg-red-900/30 text-red-400'
                        }`}
                    >
                      {trade.side === 'BUY' ? (
                        <Icon name="trending-up" size="sm" className="w-3 h-3" />
                      ) : (
                        <Icon name="trending-down" size="sm" className="w-3 h-3" />
                      )}
                      {trade.side}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-zinc-300">{trade.volume.toFixed(2)}</td>
                  <td className="p-2 font-mono text-zinc-400">{trade.openPrice.toFixed(5)}</td>
                  <td className="p-2 font-mono text-zinc-400">{trade.closePrice.toFixed(5)}</td>
                  <td className="p-2 font-mono text-zinc-300">
                    {trade.pips >= 0 ? '+' : ''}
                    {trade.pips.toFixed(1)}
                  </td>
                  <td className="p-2">
                    <div
                      className={`font-mono font-bold ${trade.profit >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                    >
                      {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                    </div>
                  </td>
                  <td className="p-2 text-xs text-zinc-500">
                    <div>C: ${trade.commission.toFixed(2)}</div>
                    <div>S: ${trade.swap.toFixed(2)}</div>
                  </td>
                  <td className="p-2 text-xs text-zinc-500">
                    <Icon name="clock" size="sm" className="inline w-3 h-3 mr-1" />
                    {formatTime(trade.closeTime)}
                  </td>
                  <td className="p-2 text-xs text-zinc-500">{trade.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

type StatCardProps = {
  label: string;
  value: string;
  icon: typeof DollarSign;
  color: string;
};

const StatCard = ({ label, value, icon: Icon, color }: StatCardProps) => (
  <div className="flex flex-col gap-1 p-3 bg-zinc-800/30 rounded border border-zinc-800">
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 text-${color}-400`} />
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
    <div className={`text-lg font-bold text-${color}-400`}>{value}</div>
  </div>
);
