/**
 * CopyTradingLeaderboard Component
 * Social/copy trading leaderboard showing top traders to follow
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
type TradingStyle = 'Scalper' | 'Day Trader' | 'Swing Trader' | 'Position Trader';
type RiskLevel = 'Conservative' | 'Moderate' | 'Aggressive';
type TimePeriod = '1M' | '3M' | '6M' | '1Y' | 'All';

interface Trader {
  id: number;
  username: string;
  avatar: string;
  totalReturn: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  followers: number;
  riskScore: number; // 1-10
  tradingStyle: TradingStyle;
  preferredSymbols: string[];
  avgHoldingTimeHours: number;
  totalTrades: number;
  equityCurve: { date: string; equity: number }[];
  monthlyReturns: { [month: string]: number };
}

interface CopiedTrader {
  traderId: number;
  traderName: string;
  startDate: string;
  currentPnL: number;
  copyMode: 'fixed' | 'proportional';
  lotSize: number;
  isPaused: boolean;
}


export function CopyTradingLeaderboard() {
  const [allTraders, setAllTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);

  const [timePeriod, setTimePeriod] = useState<TimePeriod>('All');
  const [minReturn, setMinReturn] = useState(0);
  const [maxDrawdown, setMaxDrawdown] = useState(100);
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'All'>('All');
  const [sortBy, setSortBy] = useState<'return' | 'followers' | 'risk'>('return');
  const [selectedTrader, setSelectedTrader] = useState<Trader | null>(null);
  const [copiedTraders, setCopiedTraders] = useState<CopiedTrader[]>([]);
  const [compareTraders, setCompareTraders] = useState<number[]>([]);

  // Fetch traders from API on mount
  useEffect(() => {
    const fetchTraders = async () => {
      try {
        const { apiClient } = await import('../api/client');
        const data = await apiClient.get<Trader[]>('/api/copy-trading/leaderboard');
        if (!data) throw new Error('Failed to fetch leaderboard');
        setAllTraders(data);
      } catch (error) {
        console.error('Error fetching traders:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTraders();
  }, []);

  // Filter traders
  const filteredTraders = (() => {
    const filtered = allTraders.filter(t => {
      if (t.totalReturn < minReturn) return false;
      if (t.maxDrawdown > maxDrawdown) return false;

      if (riskFilter !== 'All') {
        if (riskFilter === 'Conservative' && t.riskScore > 4) return false;
        if (riskFilter === 'Moderate' && (t.riskScore < 4 || t.riskScore > 7)) return false;
        if (riskFilter === 'Aggressive' && t.riskScore < 7) return false;
      }

      return true;
    });

    // Sort
    if (sortBy === 'return') {
      filtered.sort((a, b) => b.totalReturn - a.totalReturn);
    } else if (sortBy === 'followers') {
      filtered.sort((a, b) => b.followers - a.followers);
    } else if (sortBy === 'risk') {
      filtered.sort((a, b) => a.riskScore - b.riskScore);
    }

    return filtered;
  })();

  const getRiskColor = (score: number) => {
    if (score <= 3) return 'text-emerald-400';
    if (score <= 7) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getRiskLabel = (score: number) => {
    if (score <= 3) return 'Conservative';
    if (score <= 7) return 'Moderate';
    return 'Aggressive';
  };

  const handleCopyTrader = (trader: Trader) => {
    const newCopy: CopiedTrader = {
      traderId: trader.id,
      traderName: trader.username,
      startDate: new Date().toISOString(),
      currentPnL: 0,
      copyMode: 'proportional',
      lotSize: 0.1,
      isPaused: false,
    };
    setCopiedTraders(prev => [...prev, newCopy]);
    setSelectedTrader(null);
  };

  const handlePauseCopy = (traderId: number) => {
    setCopiedTraders(prev =>
      prev.map(t => t.traderId === traderId ? { ...t, isPaused: !t.isPaused } : t)
    );
  };

  const handleStopCopy = (traderId: number) => {
    setCopiedTraders(prev => prev.filter(t => t.traderId !== traderId));
  };

  const toggleCompare = (traderId: number) => {
    setCompareTraders(prev => {
      if (prev.includes(traderId)) {
        return prev.filter(id => id !== traderId);
      } else if (prev.length < 3) {
        return [...prev, traderId];
      }
      return prev;
    });
  };

  return (
    <div className="h-full overflow-auto bg-zinc-900 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="user" size="sm" className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Copy Trading Leaderboard</h2>
          <span className="text-xs text-zinc-500">{filteredTraders.length} traders</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="filter" size="sm" className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-300">Filters</span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Time Period</label>
            <select
              value={timePeriod}
              onChange={(e) => setTimePeriod(e.target.value as TimePeriod)}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            >
              <option value="1M">1 Month</option>
              <option value="3M">3 Months</option>
              <option value="6M">6 Months</option>
              <option value="1Y">1 Year</option>
              <option value="All">All Time</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Min Return (%)</label>
            <input
              type="number"
              value={minReturn}
              onChange={(e) => setMinReturn(parseFloat(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Max Drawdown (%)</label>
            <input
              type="number"
              value={maxDrawdown}
              onChange={(e) => setMaxDrawdown(parseFloat(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Risk Level</label>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value as RiskLevel | 'All')}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            >
              <option value="All">All Levels</option>
              <option value="Conservative">Conservative</option>
              <option value="Moderate">Moderate</option>
              <option value="Aggressive">Aggressive</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'return' | 'followers' | 'risk')}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white"
            >
              <option value="return">Return</option>
              <option value="followers">Followers</option>
              <option value="risk">Risk Score</option>
            </select>
          </div>
        </div>
      </div>

      {/* My Copies Section */}
      {copiedTraders.length > 0 && (
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="copy" size="sm" className="w-4 h-4 text-emerald-400" />
            My Copies ({copiedTraders.length})
          </h3>
          <div className="space-y-2">
            {copiedTraders.map(copy => (
              <div
                key={copy.traderId}
                className="flex items-center justify-between p-3 bg-zinc-900 rounded"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${copy.isPaused ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
                  <div>
                    <div className="text-sm font-semibold text-white">{copy.traderName}</div>
                    <div className="text-xs text-zinc-500">
                      {copy.copyMode === 'fixed' ? 'Fixed' : 'Proportional'} • {copy.lotSize} lots
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`text-sm font-bold ${copy.currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {copy.currentPnL >= 0 ? '+' : ''}{copy.currentPnL.toFixed(2)}
                  </div>
                  <button
                    onClick={() => handlePauseCopy(copy.traderId)}
                    className="p-1 hover:bg-zinc-700 rounded"
                    title={copy.isPaused ? 'Resume' : 'Pause'}
                  >
                    <Icon name="stop" size="sm" className="w-4 h-4 text-yellow-400" />
                  </button>
                  <button
                    onClick={() => handleStopCopy(copy.traderId)}
                    className="p-1 hover:bg-zinc-700 rounded"
                    title="Stop"
                  >
                    <Icon name="stop" size="sm" className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance Comparison */}
      {compareTraders.length > 0 && (
        <div className="bg-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="bar-chart-3" size="sm" className="w-4 h-4 text-purple-400" />
            Performance Comparison ({compareTraders.length})
          </h3>
          <EquityComparison traders={allTraders.filter(t => compareTraders.includes(t.id))} />
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-zinc-800 rounded-lg p-8 text-center">
          <div className="text-zinc-400">Loading traders...</div>
        </div>
      )}

      {/* Leaderboard Table */}
      {!loading && (
        <div className="bg-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 sticky top-0">
                <tr className="text-zinc-400 text-xs">
                  <th className="p-3 text-left w-12">Rank</th>
                  <th className="p-3 text-left w-48">Trader</th>
                  <th className="p-3 text-right">Return</th>
                  <th className="p-3 text-right">Win Rate</th>
                  <th className="p-3 text-right">Profit Factor</th>
                  <th className="p-3 text-right">Max DD</th>
                  <th className="p-3 text-center">Followers</th>
                  <th className="p-3 text-center">Risk</th>
                  <th className="p-3 text-center w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraders.map((trader, index) => (
                  <tr
                    key={trader.id}
                    className="border-t border-zinc-700 hover:bg-zinc-700/50 cursor-pointer"
                    onClick={() => setSelectedTrader(trader)}
                  >
                    <td className="p-3 text-zinc-500 font-mono">{index + 1}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <img
                          src={trader.avatar}
                          alt={trader.username}
                          className="w-8 h-8 rounded-full bg-zinc-700"
                        />
                        <div>
                          <div className="font-semibold text-white">{trader.username}</div>
                          <div className="text-xs text-zinc-500">{trader.tradingStyle}</div>
                        </div>
                      </div>
                    </td>
                    <td className={`p-3 text-right font-bold ${trader.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trader.totalReturn >= 0 ? '+' : ''}{trader.totalReturn.toFixed(2)}%
                    </td>
                    <td className="p-3 text-right text-white">{trader.winRate.toFixed(1)}%</td>
                    <td className="p-3 text-right text-white">{trader.profitFactor.toFixed(2)}</td>
                    <td className="p-3 text-right text-orange-400">{trader.maxDrawdown.toFixed(1)}%</td>
                    <td className="p-3 text-center text-zinc-400">{trader.followers.toLocaleString()}</td>
                    <td className="p-3 text-center">
                      <span className={`font-bold ${getRiskColor(trader.riskScore)}`}>
                        {trader.riskScore}/10
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCompare(trader.id);
                          }}
                          className={`p-1 rounded ${compareTraders.includes(trader.id) ? 'bg-purple-600' : 'hover:bg-zinc-600'}`}
                          title="Compare"
                        >
                          <Icon name="bar-chart-3" size="sm" className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTrader(trader);
                          }}
                          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 rounded text-xs flex items-center gap-1"
                        >
                          <Icon name="copy" size="sm" className="w-3 h-3" />
                          Copy
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trader Detail Modal */}
      {selectedTrader && (
        <TraderDetailModal
          trader={selectedTrader}
          onClose={() => setSelectedTrader(null)}
          onCopy={handleCopyTrader}
          isAlreadyCopied={copiedTraders.some(c => c.traderId === selectedTrader.id)}
        />
      )}
    </div>
  );
}

// Trader Detail Modal
function TraderDetailModal({
  trader,
  onClose,
  onCopy,
  isAlreadyCopied
}: {
  trader: Trader;
  onClose: () => void;
  onCopy: (trader: Trader) => void;
  isAlreadyCopied: boolean;
}) {
  const [copyMode, setCopyMode] = useState<'fixed' | 'proportional'>('proportional');
  const [lotSize, setLotSize] = useState(0.1);
  const [maxRiskPerTrade, setMaxRiskPerTrade] = useState(2);
  const [stopCopyingThreshold, setStopCopyingThreshold] = useState(-10);

  const getRiskColor = (score: number) => {
    if (score <= 3) return 'text-emerald-400';
    if (score <= 7) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getRiskLabel = (score: number) => {
    if (score <= 3) return 'Conservative';
    if (score <= 7) return 'Moderate';
    return 'Aggressive';
  };

  const formatHoldingTime = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    if (hours < 168) return `${Math.round(hours / 24)}d`;
    return `${Math.round(hours / 168)}w`;
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-zinc-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-700">
            <div className="flex items-center gap-3">
              <img src={trader.avatar} alt={trader.username} className="w-12 h-12 rounded-full" />
              <div>
                <h3 className="text-lg font-semibold text-white">{trader.username}</h3>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400">{trader.tradingStyle}</span>
                  <span className="text-zinc-600">•</span>
                  <span className={getRiskColor(trader.riskScore)}>
                    {getRiskLabel(trader.riskScore)} ({trader.riskScore}/10)
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-zinc-700 rounded">
              <Icon name="x-close" size="sm" className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Stats Overview */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-zinc-900 rounded p-3 text-center">
                <div className="text-xs text-zinc-500 mb-1">Total Return</div>
                <div className={`text-lg font-bold ${trader.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {trader.totalReturn >= 0 ? '+' : ''}{trader.totalReturn.toFixed(2)}%
                </div>
              </div>
              <div className="bg-zinc-900 rounded p-3 text-center">
                <div className="text-xs text-zinc-500 mb-1">Win Rate</div>
                <div className="text-lg font-bold text-white">{trader.winRate.toFixed(1)}%</div>
              </div>
              <div className="bg-zinc-900 rounded p-3 text-center">
                <div className="text-xs text-zinc-500 mb-1">Profit Factor</div>
                <div className="text-lg font-bold text-white">{trader.profitFactor.toFixed(2)}</div>
              </div>
              <div className="bg-zinc-900 rounded p-3 text-center">
                <div className="text-xs text-zinc-500 mb-1">Max Drawdown</div>
                <div className="text-lg font-bold text-orange-400">{trader.maxDrawdown.toFixed(1)}%</div>
              </div>
            </div>

            {/* Equity Curve */}
            <div className="bg-zinc-900 rounded p-4">
              <h4 className="text-sm font-semibold text-zinc-300 mb-3">Equity Curve</h4>
              <EquityCurveChart data={trader.equityCurve} />
            </div>

            {/* Monthly Returns */}
            <div className="bg-zinc-900 rounded p-4">
              <h4 className="text-sm font-semibold text-zinc-300 mb-3">Monthly Returns</h4>
              <MonthlyReturnsGrid returns={trader.monthlyReturns} />
            </div>

            {/* Trading Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-900 rounded p-4">
                <h4 className="text-sm font-semibold text-zinc-300 mb-3">Trading Style</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Preferred Symbols:</span>
                    <span className="text-white">{trader.preferredSymbols.join(', ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Avg Holding Time:</span>
                    <span className="text-white">{formatHoldingTime(trader.avgHoldingTimeHours)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Total Trades:</span>
                    <span className="text-white">{trader.totalTrades}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Followers:</span>
                    <span className="text-white">{trader.followers.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Copy Settings */}
              <div className="bg-zinc-900 rounded p-4">
                <h4 className="text-sm font-semibold text-zinc-300 mb-3">Copy Settings</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Copy Mode</label>
                    <select
                      value={copyMode}
                      onChange={(e) => setCopyMode(e.target.value as 'fixed' | 'proportional')}
                      className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-white"
                    >
                      <option value="fixed">Fixed Lot</option>
                      <option value="proportional">Proportional</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Lot Size</label>
                    <input
                      type="number"
                      step="0.01"
                      value={lotSize}
                      onChange={(e) => setLotSize(parseFloat(e.target.value))}
                      className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Max Risk per Trade (%)</label>
                    <input
                      type="number"
                      value={maxRiskPerTrade}
                      onChange={(e) => setMaxRiskPerTrade(parseFloat(e.target.value))}
                      className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Stop Copying at (%)</label>
                    <input
                      type="number"
                      value={stopCopyingThreshold}
                      onChange={(e) => setStopCopyingThreshold(parseFloat(e.target.value))}
                      className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Copy Button */}
            <button
              onClick={() => onCopy(trader)}
              disabled={isAlreadyCopied}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded font-semibold flex items-center justify-center gap-2"
            >
              <Icon name="copy" size="sm" className="w-4 h-4" />
              {isAlreadyCopied ? 'Already Copying This Trader' : 'Start Copying'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// Equity Curve Chart
function EquityCurveChart({ data }: { data: { date: string; equity: number }[] }) {
  if (data.length === 0) return <div className="text-zinc-500 text-xs">No data</div>;

  const minEquity = Math.min(...data.map(d => d.equity));
  const maxEquity = Math.max(...data.map(d => d.equity));
  const range = maxEquity - minEquity;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 80 - ((d.equity - minEquity) / range) * 70;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height="100" viewBox="0 0 100 80" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="#22c55e"
        strokeWidth="0.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Monthly Returns Grid
function MonthlyReturnsGrid({ returns }: { returns: { [month: string]: number } }) {
  const months = Object.keys(returns).sort();

  return (
    <div className="grid grid-cols-6 gap-2">
      {months.map(month => {
        const value = returns[month];
        const intensity = Math.min(Math.abs(value) / 20, 1);
        const bgColor = value >= 0
          ? `rgba(34, 197, 94, ${intensity * 0.8})`
          : `rgba(239, 68, 68, ${intensity * 0.8})`;

        return (
          <div
            key={month}
            className="p-2 rounded text-center border border-zinc-700"
            style={{ backgroundColor: bgColor }}
          >
            <div className="text-[9px] text-zinc-300">{month.substring(5)}</div>
            <div className="text-xs font-semibold text-white mt-1">
              {value >= 0 ? '+' : ''}{value.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Equity Comparison Chart
function EquityComparison({ traders }: { traders: Trader[] }) {
  const colors = ['#22c55e', '#8a8a8f', '#f59e0b'];

  return (
    <div>
      <svg width="100%" height="200" viewBox="0 0 800 200" className="bg-zinc-950 rounded">
        {traders.map((trader, tIndex) => {
          const data = trader.equityCurve;
          const minEquity = Math.min(...data.map(d => d.equity));
          const maxEquity = Math.max(...data.map(d => d.equity));
          const range = maxEquity - minEquity;

          const points = data.map((d, i) => {
            const x = (i / (data.length - 1)) * 800;
            const y = 180 - ((d.equity - minEquity) / range) * 160;
            return `${x},${y}`;
          }).join(' ');

          return (
            <polyline
              key={trader.id}
              points={points}
              fill="none"
              stroke={colors[tIndex]}
              strokeWidth="2"
            />
          );
        })}
      </svg>
      <div className="flex items-center gap-4 mt-2">
        {traders.map((trader, i) => (
          <div key={trader.id} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: colors[i] }} />
            <span className="text-zinc-400">{trader.username}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
