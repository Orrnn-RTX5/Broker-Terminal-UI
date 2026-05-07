/**
 * Symbol Screener / Scanner Panel
 * MT5-style symbol screener with filters, presets, and mini charts
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo } from 'react';
import {
  useScreenerStore,
  type SymbolGroup,
  type MAFilter,
  type SortField,
  type SortDirection,
  type Signal,
} from '../store/useScreenerStore';

export function SymbolScreener() {
  const {
    allSymbols,
    filteredSymbols,
    filters,
    presets,
    isFilterPanelCollapsed,
    setFilters,
    resetFilters,
    applyFilters,
    toggleFilterPanel,
    savePreset,
    loadPreset,
    deletePreset,
    applyQuickFilter,
  } = useScreenerStore();

  const [presetName, setPresetName] = useState('');
  const [showPresetInput, setShowPresetInput] = useState(false);

  // Calculate stats
  const stats = useMemo(() => {
    const bullishCount = filteredSymbols.filter((s) => s.signal === 'BUY').length;
    const bearishCount = filteredSymbols.filter((s) => s.signal === 'SELL').length;
    const avgSpread = filteredSymbols.length > 0
      ? filteredSymbols.reduce((sum, s) => sum + s.spread, 0) / filteredSymbols.length
      : 0;

    return {
      total: allSymbols.length,
      matched: filteredSymbols.length,
      bullish: bullishCount,
      bearish: bearishCount,
      avgSpread: avgSpread.toFixed(2),
    };
  }, [allSymbols, filteredSymbols]);

  const handleSavePreset = () => {
    if (presetName.trim()) {
      savePreset(presetName.trim());
      setPresetName('');
      setShowPresetInput(false);
    }
  };

  const getSignalColor = (signal: Signal) => {
    if (signal === 'BUY') return 'text-emerald-400 bg-emerald-500/20';
    if (signal === 'SELL') return 'text-rose-400 bg-rose-500/20';
    return 'text-zinc-500 bg-zinc-700/20';
  };

  const getSignalIcon = (signal: Signal) => {
    if (signal === 'BUY') return <Icon name="trending-up" size="xs" />;
    if (signal === 'SELL') return <Icon name="trending-down" size="xs" />;
    return <Icon name="activity" size="xs" />;
  };

  // Mini sparkline chart
  const Sparkline = ({ data }: { data: number[] }) => {
    if (data.length === 0) return null;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * 60;
      const y = 20 - ((value - min) / range) * 20;
      return `${x},${y}`;
    }).join(' ');

    const isUptrend = data[data.length - 1] > data[0];

    return (
      <svg width="60" height="20" className="inline-block">
        <polyline
          points={points}
          fill="none"
          stroke={isUptrend ? '#10b981' : '#ef4444'}
          strokeWidth="1"
        />
      </svg>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300 overflow-hidden">
      {/* Header with Stats */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-[#252528]">
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <Icon name="search" size="sm" className="text-zinc-500" />
            <span className="text-zinc-400">
              {stats.matched} / {stats.total} symbols
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Icon name="trending-up" size="xs" className="text-emerald-400" />
            <span className="text-zinc-400">{stats.bullish} Bullish</span>
          </div>
          <div className="flex items-center gap-2">
            <Icon name="trending-down" size="xs" className="text-rose-400" />
            <span className="text-zinc-400">{stats.bearish} Bearish</span>
          </div>
          <div className="text-zinc-400">Avg Spread: {stats.avgSpread}</div>
        </div>
        <button
          onClick={toggleFilterPanel}
          className="flex items-center gap-2 px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
        >
          {isFilterPanelCollapsed ? <Icon name="chevron-down" size="sm" /> : <Icon name="chevron-up" size="sm" />}
          {isFilterPanelCollapsed ? 'Show Filters' : 'Hide Filters'}
        </button>
      </div>

      {/* Filter Panel */}
      {!isFilterPanelCollapsed && (
        <div className="border-b border-zinc-700 bg-[#252528] p-4 space-y-4">
          {/* Quick Presets */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Quick Filters
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => applyQuickFilter('oversold')}
                className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 rounded text-xs transition-colors"
              >
                Oversold (RSI&lt;30)
              </button>
              <button
                onClick={() => applyQuickFilter('overbought')}
                className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-600/30 rounded text-xs transition-colors"
              >
                Overbought (RSI&gt;70)
              </button>
              <button
                onClick={() => applyQuickFilter('highVolume')}
                className="px-3 py-1.5 bg-blue-600/20 hover:bg-zinc-700/30 text-zinc-400 border border-blue-600/30 rounded text-xs transition-colors"
              >
                <Icon name="zap" size="xs" className="inline mr-1" />
                High Volume
              </button>
              <button
                onClick={() => applyQuickFilter('tightSpread')}
                className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-600/30 rounded text-xs transition-colors"
              >
                Tight Spread
              </button>
              <button
                onClick={() => applyQuickFilter('trendingUp')}
                className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 rounded text-xs transition-colors"
              >
                <Icon name="trending-up" size="xs" className="inline mr-1" />
                Trending Up
              </button>
              <button
                onClick={() => applyQuickFilter('trendingDown')}
                className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-600/30 rounded text-xs transition-colors"
              >
                <Icon name="trending-down" size="xs" className="inline mr-1" />
                Trending Down
              </button>
            </div>
          </div>

          {/* Saved Presets */}
          {presets.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                Saved Presets
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <div key={preset.name} className="flex items-center gap-1">
                    <button
                      onClick={() => loadPreset(preset)}
                      className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-l text-xs transition-colors"
                    >
                      {preset.name}
                    </button>
                    <button
                      onClick={() => deletePreset(preset.name)}
                      className="px-2 py-1.5 bg-zinc-700 hover:bg-rose-600 text-zinc-400 hover:text-white rounded-r text-xs transition-colors"
                    >
                      <Icon name="trash" size="xs" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter Controls */}
          <div className="grid grid-cols-4 gap-4">
            {/* Symbol Group */}
            <div className="space-y-1">
              <label className="block text-xs text-zinc-500">Symbol Group</label>
              <select
                value={filters.symbolGroup}
                onChange={(e) => setFilters({ symbolGroup: e.target.value as SymbolGroup })}
                className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
              >
                <option value="All">All</option>
                <option value="Forex">Forex</option>
                <option value="Metals">Metals</option>
                <option value="Crypto">Crypto</option>
                <option value="Indices">Indices</option>
                <option value="Commodities">Commodities</option>
              </select>
            </div>

            {/* Price Change % Range */}
            <div className="space-y-1">
              <label className="block text-xs text-zinc-500">Change % Range</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={filters.priceChangeMin}
                  onChange={(e) => setFilters({ priceChangeMin: Number(e.target.value) })}
                  placeholder="Min"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
                <input
                  type="number"
                  value={filters.priceChangeMax}
                  onChange={(e) => setFilters({ priceChangeMax: Number(e.target.value) })}
                  placeholder="Max"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>

            {/* Spread Range */}
            <div className="space-y-1">
              <label className="block text-xs text-zinc-500">Spread Range</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={filters.spreadMin}
                  onChange={(e) => setFilters({ spreadMin: Number(e.target.value) })}
                  placeholder="Min"
                  step="0.1"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
                <input
                  type="number"
                  value={filters.spreadMax}
                  onChange={(e) => setFilters({ spreadMax: Number(e.target.value) })}
                  placeholder="Max"
                  step="0.1"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>

            {/* Volume Range */}
            <div className="space-y-1">
              <label className="block text-xs text-zinc-500">Volume Range</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={filters.volumeMin}
                  onChange={(e) => setFilters({ volumeMin: Number(e.target.value) })}
                  placeholder="Min"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
                <input
                  type="number"
                  value={filters.volumeMax}
                  onChange={(e) => setFilters({ volumeMax: Number(e.target.value) })}
                  placeholder="Max"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>

            {/* RSI Range */}
            <div className="space-y-1">
              <label className="block text-xs text-zinc-500">RSI(14) Range</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={filters.rsiMin}
                  onChange={(e) => setFilters({ rsiMin: Number(e.target.value) })}
                  placeholder="Min"
                  min="0"
                  max="100"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
                <input
                  type="number"
                  value={filters.rsiMax}
                  onChange={(e) => setFilters({ rsiMax: Number(e.target.value) })}
                  placeholder="Max"
                  min="0"
                  max="100"
                  className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>

            {/* MA Filter */}
            <div className="space-y-1">
              <label className="block text-xs text-zinc-500">Moving Average</label>
              <select
                value={filters.maFilter}
                onChange={(e) => setFilters({ maFilter: e.target.value as MAFilter })}
                className="w-full px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
              >
                <option value="none">No Filter</option>
                <option value="above20">Above MA(20)</option>
                <option value="below20">Below MA(20)</option>
                <option value="above50">Above MA(50)</option>
                <option value="below50">Below MA(50)</option>
                <option value="above200">Above MA(200)</option>
                <option value="below200">Below MA(200)</option>
              </select>
            </div>

            {/* Sort By */}
            <div className="space-y-1">
              <label className="block text-xs text-zinc-500">Sort By</label>
              <div className="flex gap-1">
                <select
                  value={filters.sortBy}
                  onChange={(e) => setFilters({ sortBy: e.target.value as SortField })}
                  className="flex-1 px-2 py-1.5 bg-[#131316] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                >
                  <option value="symbol">Symbol</option>
                  <option value="changePercent">Change %</option>
                  <option value="spread">Spread</option>
                  <option value="volume">Volume</option>
                </select>
                <button
                  onClick={() => setFilters({
                    sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc'
                  })}
                  className="px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition-colors"
                  title={filters.sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                >
                  {filters.sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={applyFilters}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Icon name="search" size="sm" />
              Scan
            </button>
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-sm transition-colors flex items-center gap-2"
            >
              <Icon name="refresh" size="sm" />
              Reset Filters
            </button>
            {!showPresetInput ? (
              <button
                onClick={() => setShowPresetInput(true)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-sm transition-colors flex items-center gap-2"
              >
                <Icon name="save" size="sm" />
                Save Preset
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name"
                  className="px-3 py-2 bg-[#131316] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
                  onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                />
                <button
                  onClick={handleSavePreset}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setShowPresetInput(false);
                    setPresetName('');
                  }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
            <tr>
              <th className="p-2 border-r border-zinc-700">Symbol</th>
              <th className="p-2 border-r border-zinc-700">Chart</th>
              <th className="p-2 border-r border-zinc-700 text-right">Last Price</th>
              <th className="p-2 border-r border-zinc-700 text-right">Change</th>
              <th className="p-2 border-r border-zinc-700 text-right">Change %</th>
              <th className="p-2 border-r border-zinc-700 text-right">Spread</th>
              <th className="p-2 border-r border-zinc-700 text-right">Volume</th>
              <th className="p-2 border-r border-zinc-700 text-right">RSI(14)</th>
              <th className="p-2 border-r border-zinc-700 text-right">MA(20)</th>
              <th className="p-2 border-r border-zinc-700 text-right">MA(50)</th>
              <th className="p-2 border-r border-zinc-700">Signal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
            {filteredSymbols.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-8 text-center text-zinc-600 text-xs italic">
                  No symbols match the current filters
                </td>
              </tr>
            ) : (
              filteredSymbols.map((symbol, i) => (
                <tr
                  key={symbol.symbol}
                  className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors cursor-pointer group`}
                  onClick={() => console.log('Open chart for', symbol.symbol)}
                  title="Click to open chart • Double-click to add to watchlist"
                >
                  <td className="p-2 border-r border-zinc-800 font-bold text-zinc-100">
                    {symbol.symbol}
                  </td>
                  <td className="p-2 border-r border-zinc-800">
                    <Sparkline data={symbol.sparklineData} />
                  </td>
                  <td className="p-2 border-r border-zinc-800 text-right text-zinc-400">
                    {symbol.lastPrice.toFixed(symbol.group === 'Forex' ? 5 : 2)}
                  </td>
                  <td className={`p-2 border-r border-zinc-800 text-right ${symbol.changeAbs >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {symbol.changeAbs >= 0 ? '+' : ''}{symbol.changeAbs.toFixed(symbol.group === 'Forex' ? 5 : 2)}
                  </td>
                  <td className={`p-2 border-r border-zinc-800 text-right font-bold ${symbol.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {symbol.changePercent >= 0 ? '+' : ''}{symbol.changePercent.toFixed(2)}%
                  </td>
                  <td className="p-2 border-r border-zinc-800 text-right text-zinc-500">
                    {symbol.spread.toFixed(1)}
                  </td>
                  <td className="p-2 border-r border-zinc-800 text-right text-zinc-400">
                    {symbol.volume.toLocaleString()}
                  </td>
                  <td className={`p-2 border-r border-zinc-800 text-right ${symbol.rsi14 < 30 ? 'text-emerald-400' : symbol.rsi14 > 70 ? 'text-rose-400' : 'text-zinc-400'}`}>
                    {symbol.rsi14.toFixed(1)}
                  </td>
                  <td className="p-2 border-r border-zinc-800 text-right text-zinc-500 text-[10px]">
                    {symbol.ma20.toFixed(symbol.group === 'Forex' ? 5 : 2)}
                  </td>
                  <td className="p-2 border-r border-zinc-800 text-right text-zinc-500 text-[10px]">
                    {symbol.ma50.toFixed(symbol.group === 'Forex' ? 5 : 2)}
                  </td>
                  <td className="p-2 border-r border-zinc-800">
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${getSignalColor(symbol.signal)}`}>
                      {getSignalIcon(symbol.signal)}
                      {symbol.signal}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
