/**
 * Trading Signals Panel
 * Display trading signals from signal providers
 */

import { Icon } from './ui/Icon';
import React, { useState, useEffect, useMemo } from 'react';
import {
  useSignalStore,
  type Signal,
  type SignalProvider,
  type SymbolGroup,
  type SignalDirection,
} from '../store/useSignalStore';

type SortField = 'timestamp' | 'symbol' | 'confidence' | 'pnl';
type SortDirection = 'asc' | 'desc';

export function TradingSignals() {
  const {
    signals: allSignals,
    historicalSignals,
    selectedProvider,
    symbolGroupFilter,
    signalTypeFilter,
    timeframeFilter,
    autoRefresh,
    refreshInterval,
    setSelectedProvider,
    setSymbolGroupFilter,
    setSignalTypeFilter,
    setTimeframeFilter,
    setAutoRefresh,
    setRefreshInterval,
    getFilteredSignals,
    getProviderStats,
    refreshSignals,
  } = useSignalStore();

  const [expandedSignalId, setExpandedSignalId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const filteredSignals = getFilteredSignals();

  // Sort signals
  const sortedSignals = useMemo(() => {
    const sorted = [...filteredSignals];
    sorted.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'timestamp') {
        aVal = a.timestamp.getTime();
        bVal = b.timestamp.getTime();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredSignals, sortField, sortDirection]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      refreshSignals();
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refreshSignals]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleCopyToOrderEntry = (signal: Signal) => {
    // Dispatch custom event with signal data
    window.dispatchEvent(
      new CustomEvent('openOrderEntry', {
        detail: {
          symbol: signal.symbol,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          volume: signal.suggestedLotSize,
        },
      })
    );
  };

  const getRiskRewardRatio = (signal: Signal) => {
    const risk = Math.abs(signal.entryPrice - signal.stopLoss);
    const reward = Math.abs(signal.takeProfit - signal.entryPrice);
    return reward / risk;
  };

  const providers: (SignalProvider | 'All')[] = ['All', 'RTX5 Algo', 'FX Maestro', 'CryptoEdge'];
  const symbolGroups: SymbolGroup[] = ['All', 'Forex', 'Crypto', 'Metals'];
  const signalTypes: ('All' | SignalDirection)[] = ['All', 'BUY', 'SELL'];
  const timeframes = ['All', 'M15', 'H1', 'H4', 'D1'];

  // Provider stats for selected provider
  const providerStats =
    selectedProvider !== 'All' ? getProviderStats(selectedProvider) : null;

  return (
    <div className="h-full flex bg-[#131316] text-zinc-300">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header / Controls */}
        <div className="bg-[#252528] border-b border-zinc-700 p-2 flex items-center gap-3 flex-wrap">
          {/* Provider Selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Provider:</label>
            <select
              value={selectedProvider}
              onChange={(e) =>
                setSelectedProvider(e.target.value as SignalProvider | 'All')
              }
              className="px-2 py-1 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Symbol Group Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Group:</label>
            <select
              value={symbolGroupFilter}
              onChange={(e) => setSymbolGroupFilter(e.target.value as SymbolGroup)}
              className="px-2 py-1 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              {symbolGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Signal Type Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Type:</label>
            <select
              value={signalTypeFilter}
              onChange={(e) =>
                setSignalTypeFilter(e.target.value as 'All' | SignalDirection)
              }
              className="px-2 py-1 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              {signalTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Timeframe Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Timeframe:</label>
            <select
              value={timeframeFilter}
              onChange={(e) => setTimeframeFilter(e.target.value)}
              className="px-2 py-1 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              {timeframes.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>

          <div className="h-4 w-px bg-zinc-700"></div>

          {/* Auto-Refresh */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-3.5 h-3.5 text-blue-600 bg-zinc-700 border-zinc-600 rounded focus:ring-blue-500 focus:ring-1"
              />
              <span className="text-xs text-zinc-400">Auto-refresh</span>
            </label>
            {autoRefresh && (
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
                className="px-2 py-1 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
              >
                <option value="10">10s</option>
                <option value="30">30s</option>
                <option value="60">60s</option>
              </select>
            )}
          </div>

          <button
            onClick={refreshSignals}
            className="ml-auto p-1.5 hover:bg-zinc-700 rounded transition-colors"
            title="Refresh signals"
          >
            <Icon name="refresh" size="sm" className="text-zinc-400" />
          </button>
        </div>

        {/* Active Signals Table */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
              <tr>
                <th
                  className="p-1 pl-2 border-r border-zinc-700 cursor-pointer hover:bg-zinc-700/50"
                  onClick={() => handleSort('timestamp')}
                >
                  Time {sortField === 'timestamp' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="p-1 border-r border-zinc-700 cursor-pointer hover:bg-zinc-700/50"
                  onClick={() => handleSort('symbol')}
                >
                  Symbol {sortField === 'symbol' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-1 border-r border-zinc-700">Direction</th>
                <th className="p-1 border-r border-zinc-700 text-right">Entry</th>
                <th className="p-1 border-r border-zinc-700 text-right">Stop Loss</th>
                <th className="p-1 border-r border-zinc-700 text-right">Take Profit</th>
                <th className="p-1 border-r border-zinc-700 text-right">R:R</th>
                <th
                  className="p-1 border-r border-zinc-700 cursor-pointer hover:bg-zinc-700/50"
                  onClick={() => handleSort('confidence')}
                >
                  Confidence {sortField === 'confidence' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-1 border-r border-zinc-700">Status</th>
                <th className="p-1 pr-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
              {sortedSignals.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-zinc-600 text-xs italic">
                    No signals match the current filters
                  </td>
                </tr>
              ) : (
                sortedSignals.map((signal, i) => (
                  <React.Fragment key={signal.id}>
                    <tr
                      className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} ${
                        signal.status === 'new' ? 'animate-pulse bg-blue-950/20' : ''
                      } hover:bg-[#191a1e] transition-colors cursor-pointer`}
                      onClick={() =>
                        setExpandedSignalId(expandedSignalId === signal.id ? null : signal.id)
                      }
                    >
                      <td className="p-1 pl-2 border-r border-zinc-800 text-zinc-500 text-[10px]">
                        {signal.timestamp.toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="p-1 border-r border-zinc-800 font-bold text-zinc-100">
                        {signal.symbol}
                      </td>
                      <td className="p-1 border-r border-zinc-800">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            signal.direction === 'BUY'
                              ? 'bg-emerald-600/20 text-emerald-400'
                              : 'bg-rose-600/20 text-rose-400'
                          }`}
                        >
                          {signal.direction === 'BUY' ? (
                            <Icon name="trending-up" size="xs" />
                          ) : (
                            <Icon name="trending-down" size="xs" />
                          )}
                          {signal.direction}
                        </span>
                      </td>
                      <td className="p-1 border-r border-zinc-800 text-right">
                        {signal.entryPrice.toFixed(signal.symbolGroup === 'Forex' ? 5 : 2)}
                      </td>
                      <td className="p-1 border-r border-zinc-800 text-right text-rose-400">
                        {signal.stopLoss.toFixed(signal.symbolGroup === 'Forex' ? 5 : 2)}
                      </td>
                      <td className="p-1 border-r border-zinc-800 text-right text-emerald-400">
                        {signal.takeProfit.toFixed(signal.symbolGroup === 'Forex' ? 5 : 2)}
                      </td>
                      <td className="p-1 border-r border-zinc-800 text-right text-blue-400 font-medium">
                        1:{getRiskRewardRatio(signal).toFixed(2)}
                      </td>
                      <td className="p-1 border-r border-zinc-800">
                        <div className="flex items-center gap-1">
                          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                signal.confidence >= 80
                                  ? 'bg-emerald-500'
                                  : signal.confidence >= 70
                                  ? 'bg-zinc-600'
                                  : 'bg-yellow-500'
                              }`}
                              style={{ width: `${signal.confidence}%` }}
                            ></div>
                          </div>
                          <span className="text-[10px] text-zinc-400 w-8 text-right">
                            {signal.confidence}%
                          </span>
                        </div>
                      </td>
                      <td className="p-1 border-r border-zinc-800">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
                            signal.status === 'new'
                              ? 'bg-zinc-700/30 text-zinc-400'
                              : 'bg-zinc-700/50 text-zinc-400'
                          }`}
                        >
                          {signal.status}
                        </span>
                      </td>
                      <td className="p-1 pr-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyToOrderEntry(signal);
                          }}
                          className="p-1 hover:bg-blue-600/20 rounded transition-colors"
                          title="Copy to Order Entry"
                        >
                          <Icon name="copy" size="xs" className="text-blue-400" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Detail */}
                    {expandedSignalId === signal.id && (
                      <tr className="bg-[#252528]">
                        <td colSpan={10} className="p-3 border-r border-zinc-800">
                          <div className="space-y-3 text-xs">
                            {/* Analysis */}
                            <div>
                              <div className="text-zinc-500 font-semibold mb-1">Analysis:</div>
                              <div className="text-zinc-300">{signal.analysis}</div>
                            </div>

                            {/* Indicators */}
                            <div>
                              <div className="text-zinc-500 font-semibold mb-1">
                                Technical Indicators:
                              </div>
                              <div className="flex gap-2 flex-wrap">
                                {signal.indicators.map((ind, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-1 bg-zinc-700/50 rounded text-[10px]"
                                  >
                                    {ind}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Suggested Lot Size */}
                            <div className="flex items-center gap-4">
                              <div>
                                <span className="text-zinc-500">Suggested Lot Size:</span>{' '}
                                <span className="text-zinc-200 font-semibold">
                                  {signal.suggestedLotSize.toFixed(2)} lots
                                </span>
                              </div>
                              <div>
                                <span className="text-zinc-500">Timeframe:</span>{' '}
                                <span className="text-zinc-200 font-semibold">{signal.timeframe}</span>
                              </div>
                              <div>
                                <span className="text-zinc-500">Provider:</span>{' '}
                                <span className="text-zinc-200 font-semibold">{signal.provider}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Signal History */}
        <div className="bg-[#252528] border-t border-zinc-700 p-2">
          <div className="text-xs font-semibold text-zinc-400 mb-2">
            Signal History (Last {historicalSignals.length} Closed)
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#191a1e] text-zinc-500 text-[9px] uppercase">
                <tr>
                  <th className="p-1 pl-2">Symbol</th>
                  <th className="p-1">Dir</th>
                  <th className="p-1 text-right">Entry</th>
                  <th className="p-1 text-right">Exit</th>
                  <th className="p-1 text-right">P&L</th>
                  <th className="p-1 text-right pr-2">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-[10px] font-mono">
                {historicalSignals.slice(0, 10).map((sig, i) => (
                  <tr
                    key={sig.id}
                    className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'}`}
                  >
                    <td className="p-1 pl-2 text-zinc-300">{sig.symbol}</td>
                    <td
                      className={`p-1 text-[9px] font-bold ${
                        sig.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {sig.direction}
                    </td>
                    <td className="p-1 text-right text-zinc-400">
                      {sig.entryPrice.toFixed(sig.symbolGroup === 'Forex' ? 5 : 2)}
                    </td>
                    <td className="p-1 text-right text-zinc-400">
                      {sig.closePrice?.toFixed(sig.symbolGroup === 'Forex' ? 5 : 2)}
                    </td>
                    <td
                      className={`p-1 text-right font-semibold ${
                        (sig.pnl || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {(sig.pnl || 0) >= 0 ? '+' : ''}
                      {(sig.pnl || 0).toFixed(2)}
                    </td>
                    <td className="p-1 text-right pr-2 text-zinc-500 text-[9px]">
                      {sig.duration}m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Provider Stats Sidebar */}
      {providerStats && (
        <div className="w-64 bg-[#252528] border-l border-zinc-700 p-3 space-y-3 overflow-y-auto custom-scrollbar">
          <div className="text-sm font-bold text-zinc-200 flex items-center gap-2">
            <Icon name="activity" size="md" className="text-blue-400" />
            {providerStats.provider} Stats
          </div>

          {/* Win Rate */}
          <div className="bg-[#131316] rounded p-3">
            <div className="text-[10px] text-zinc-500 uppercase mb-2">Win Rate</div>
            <div className="relative w-24 h-24 mx-auto">
              <svg className="transform -rotate-90 w-24 h-24">
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  stroke="#3f3f46"
                  strokeWidth="8"
                  fill="none"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  stroke="#10b981"
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={`${(providerStats.winRate / 100) * 251.2} 251.2`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-emerald-400">
                  {providerStats.winRate.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="space-y-2">
            <div className="bg-[#131316] rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="crosshair" size="xs" className="text-blue-400" />
                <div className="text-[10px] text-zinc-500 uppercase">Total Signals</div>
              </div>
              <div className="text-lg font-bold text-zinc-200">
                {providerStats.totalSignals}
              </div>
              <div className="text-[9px] text-zinc-600">This month</div>
            </div>

            <div className="bg-[#131316] rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="credit-card" size="xs" className="text-emerald-400" />
                <div className="text-[10px] text-zinc-500 uppercase">Avg P&L</div>
              </div>
              <div
                className={`text-lg font-bold ${
                  providerStats.avgPnLPerSignal > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {providerStats.avgPnLPerSignal >= 0 ? '+' : ''}
                {providerStats.avgPnLPerSignal.toFixed(2)}
              </div>
              <div className="text-[9px] text-zinc-600">Per signal</div>
            </div>

            <div className="bg-[#131316] rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="check-circle" size="xs" className="text-yellow-400" />
                <div className="text-[10px] text-zinc-500 uppercase">Best / Worst</div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-emerald-400">
                  +{providerStats.bestSignal.toFixed(2)}
                </span>
                <span className="text-sm font-bold text-rose-400">
                  {providerStats.worstSignal.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="bg-[#131316] rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="trending-up" size="xs" className="text-blue-400" />
                <div className="text-[10px] text-zinc-500 uppercase">Profit Factor</div>
              </div>
              <div className="text-lg font-bold text-blue-400">
                {providerStats.profitFactor.toFixed(2)}
              </div>
              <div className="text-[9px] text-zinc-600">Gross profit / loss</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
