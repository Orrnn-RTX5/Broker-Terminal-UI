/**
 * Market Sentiment Analysis Panel
 * Shows overall market sentiment, per-symbol sentiment, retail positioning, and sentiment indicators
 */

import { Icon } from './ui/Icon';
import React, { useEffect, useMemo } from 'react';
import { useSentimentStore, type SentimentTrend, type NewsSentiment } from '../store/useSentimentStore';

export function SentimentAnalysis() {
  const {
    overallSentiment,
    symbolSentiments,
    indicators,
    news,
    autoRefresh,
    refreshInterval,
    lastUpdate,
    setAutoRefresh,
    setRefreshInterval,
    refreshData,
  } = useSentimentStore();

  // Auto-refresh logic
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      refreshData();
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refreshData]);

  // Sort symbols by strongest sentiment first
  const sortedSymbols = useMemo(() => {
    return [...symbolSentiments].sort((a, b) => {
      const aStrength = Math.abs(a.bullishPercent - 50);
      const bStrength = Math.abs(b.bullishPercent - 50);
      return bStrength - aStrength;
    });
  }, [symbolSentiments]);

  // Overall sentiment label and color
  const sentimentLabel = useMemo(() => {
    if (overallSentiment >= 70) return 'Strongly Bullish';
    if (overallSentiment >= 60) return 'Bullish';
    if (overallSentiment >= 45) return 'Slightly Bullish';
    if (overallSentiment >= 40) return 'Neutral';
    if (overallSentiment >= 30) return 'Slightly Bearish';
    if (overallSentiment >= 20) return 'Bearish';
    return 'Strongly Bearish';
  }, [overallSentiment]);

  const sentimentColor = useMemo(() => {
    if (overallSentiment >= 60) return '#10b981'; // green
    if (overallSentiment >= 40) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  }, [overallSentiment]);

  const getTrendIcon = (trend: SentimentTrend) => {
    if (trend === 'up') return <Icon name="chevron-up" size="sm" className="text-emerald-400" />;
    if (trend === 'down') return <Icon name="chevron-down" size="sm" className="text-rose-400" />;
    return <Icon name="minus" size="sm" className="text-zinc-500" />;
  };

  const getNewsSentimentIcon = (sentiment: NewsSentiment) => {
    if (sentiment === 'positive') return <Icon name="connected" size="sm" className="text-emerald-400 fill-emerald-400" />;
    if (sentiment === 'negative') return <Icon name="connected" size="sm" className="text-rose-400 fill-rose-400" />;
    return <Icon name="connected" size="sm" className="text-zinc-500 fill-zinc-500" />;
  };

  const getFearGreedColor = (index: number) => {
    if (index < 25) return 'text-rose-400';
    if (index < 45) return 'text-orange-400';
    if (index < 55) return 'text-zinc-400';
    if (index < 75) return 'text-emerald-400';
    return 'text-green-500';
  };

  const getVixColor = (vix: number) => {
    if (vix < 15) return 'text-emerald-400'; // Low volatility
    if (vix < 25) return 'text-yellow-400'; // Medium volatility
    return 'text-rose-400'; // High volatility
  };

  const formatTime = (date: Date) => {
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300 overflow-hidden">
      {/* Header with Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-200">Market Sentiment Analysis</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            Last update: {formatTime(lastUpdate)}
          </span>
          <label className="flex items-center gap-2 cursor-pointer">
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
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="px-2 py-1 bg-[#252528] border border-zinc-700 rounded text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          )}
          <button
            onClick={refreshData}
            className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
            title="Refresh now"
          >
            <Icon name="refresh" size="sm" className="text-zinc-400" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-4 space-y-6">
          {/* Overall Market Sentiment Gauge */}
          <div className="bg-[#252528] border border-zinc-700 rounded-lg p-6">
            <h4 className="text-xs font-semibold text-zinc-300 mb-4 uppercase tracking-wide">
              Overall Market Sentiment
            </h4>
            <div className="flex flex-col items-center">
              {/* Semicircle Gauge */}
              <div className="relative w-64 h-32">
                <svg viewBox="0 0 200 100" className="w-full h-full">
                  {/* Background arc */}
                  <path
                    d="M 20 100 A 80 80 0 0 1 180 100"
                    fill="none"
                    stroke="#3f3f46"
                    strokeWidth="20"
                    strokeLinecap="round"
                  />
                  {/* Gradient arc */}
                  <defs>
                    <linearGradient id="sentimentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset="50%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M 20 100 A 80 80 0 0 1 180 100"
                    fill="none"
                    stroke="url(#sentimentGradient)"
                    strokeWidth="20"
                    strokeLinecap="round"
                    opacity="0.6"
                  />
                  {/* Needle */}
                  <g transform={`rotate(${-90 + (overallSentiment * 1.8)} 100 100)`}>
                    <line
                      x1="100"
                      y1="100"
                      x2="100"
                      y2="30"
                      stroke={sentimentColor}
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <circle cx="100" cy="100" r="6" fill={sentimentColor} />
                  </g>
                </svg>
              </div>
              {/* Labels */}
              <div className="mt-2 text-center">
                <div className="text-3xl font-bold" style={{ color: sentimentColor }}>
                  {overallSentiment.toFixed(1)}%
                </div>
                <div className="text-sm text-zinc-400 mt-1">{sentimentLabel}</div>
              </div>
              <div className="flex justify-between w-64 mt-2 text-xs">
                <span className="text-rose-400">Bearish</span>
                <span className="text-yellow-400">Neutral</span>
                <span className="text-emerald-400">Bullish</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Per-Symbol Sentiment */}
            <div className="bg-[#252528] border border-zinc-700 rounded-lg p-4">
              <h4 className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wide">
                Per-Symbol Sentiment
              </h4>
              <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                {sortedSymbols.map((item) => (
                  <div key={item.symbol} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-300 w-16">
                          {item.symbol}
                        </span>
                        {getTrendIcon(item.trend)}
                      </div>
                      <div className="flex gap-3 text-xs">
                        <span className="text-emerald-400">{item.bullishPercent.toFixed(1)}%</span>
                        <span className="text-rose-400">{item.bearishPercent.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="flex h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500/60"
                        style={{ width: `${item.bullishPercent}%` }}
                      />
                      <div
                        className="bg-rose-500/60"
                        style={{ width: `${item.bearishPercent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Retail Trader Positioning */}
            <div className="bg-[#252528] border border-zinc-700 rounded-lg p-4">
              <h4 className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wide">
                Retail Trader Positioning
              </h4>
              <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                {sortedSymbols.slice(0, 10).map((item) => {
                  const isExtremePosition = item.retailLongPercent > 75 || item.retailShortPercent > 75;

                  return (
                    <div key={item.symbol} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-zinc-300 w-16">
                            {item.symbol}
                          </span>
                          {isExtremePosition && (
                            <span title="Extreme positioning - contrarian signal">
                              <Icon name="alert-triangle" size="xs" className="text-yellow-400" />
                            </span>
                          )}
                        </div>
                        <div className="flex gap-3 text-xs">
                          <span className="text-emerald-400">{item.retailLongPercent.toFixed(1)}% Long</span>
                          <span className="text-rose-400">{item.retailShortPercent.toFixed(1)}% Short</span>
                        </div>
                      </div>
                      <div className="flex h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500/60"
                          style={{ width: `${item.retailLongPercent}%` }}
                        />
                        <div
                          className="bg-rose-500/60"
                          style={{ width: `${item.retailShortPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sentiment Indicators */}
          <div className="bg-[#252528] border border-zinc-700 rounded-lg p-4">
            <h4 className="text-xs font-semibold text-zinc-300 mb-4 uppercase tracking-wide">
              Sentiment Indicators
            </h4>
            <div className="grid grid-cols-4 gap-4">
              {/* Fear & Greed Index */}
              <div className="space-y-2">
                <div className="text-xs text-zinc-500">Fear & Greed Index</div>
                <div className={`text-2xl font-bold ${getFearGreedColor(indicators.fearGreedIndex)}`}>
                  {indicators.fearGreedIndex.toFixed(0)}
                </div>
                <div className="text-xs text-zinc-400">{indicators.fearGreedLevel}</div>
                <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getFearGreedColor(indicators.fearGreedIndex)} bg-current`}
                    style={{ width: `${indicators.fearGreedIndex}%` }}
                  />
                </div>
              </div>

              {/* VIX Level */}
              <div className="space-y-2">
                <div className="text-xs text-zinc-500">VIX Level</div>
                <div className={`text-2xl font-bold ${getVixColor(indicators.vixLevel)}`}>
                  {indicators.vixLevel.toFixed(1)}
                </div>
                <div className="text-xs text-zinc-400">
                  {indicators.vixLevel < 15 ? 'Low Vol' : indicators.vixLevel < 25 ? 'Medium Vol' : 'High Vol'}
                </div>
                <div className="flex gap-1">
                  <div className={`h-2 w-full rounded ${indicators.vixLevel >= 15 ? 'bg-yellow-500/60' : 'bg-emerald-500/60'}`} />
                  <div className={`h-2 w-full rounded ${indicators.vixLevel >= 25 ? 'bg-rose-500/60' : 'bg-zinc-700'}`} />
                </div>
              </div>

              {/* Put/Call Ratio */}
              <div className="space-y-2">
                <div className="text-xs text-zinc-500">Put/Call Ratio</div>
                <div className="text-2xl font-bold text-blue-400">
                  {indicators.putCallRatio.toFixed(2)}
                </div>
                <div className="text-xs text-zinc-400">
                  {indicators.putCallRatio > 1 ? 'Bearish' : indicators.putCallRatio < 0.85 ? 'Bullish' : 'Neutral'}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {indicators.putCallRatio > 1 ? '↑ More puts than calls' : '↓ More calls than puts'}
                </div>
              </div>

              {/* Net Speculative Positions */}
              <div className="space-y-2">
                <div className="text-xs text-zinc-500">COT Net Positions</div>
                <div className={`text-2xl font-bold ${indicators.netSpeculativePositions > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {indicators.netSpeculativePositions > 0 ? '+' : ''}{indicators.netSpeculativePositions.toFixed(0)}
                </div>
                <div className="text-xs text-zinc-400">
                  {indicators.netSpeculativePositions > 20 ? 'Net Long' : indicators.netSpeculativePositions < -20 ? 'Net Short' : 'Balanced'}
                </div>
                <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${indicators.netSpeculativePositions > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    style={{
                      width: `${Math.abs(indicators.netSpeculativePositions) / 2}%`,
                      marginLeft: indicators.netSpeculativePositions > 0 ? '50%' : `${50 - Math.abs(indicators.netSpeculativePositions) / 2}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* News Sentiment */}
          <div className="bg-[#252528] border border-zinc-700 rounded-lg p-4">
            <h4 className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wide">
              News Sentiment
            </h4>
            <div className="space-y-2">
              {news.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-2 hover:bg-zinc-700/30 rounded transition-colors"
                >
                  <div className="mt-1.5">
                    {getNewsSentimentIcon(item.sentiment)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-300 leading-tight mb-1">
                      {item.headline}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>{item.source}</span>
                      <span>•</span>
                      <span>{formatTime(item.timestamp)}</span>
                      <span>•</span>
                      <span className="text-blue-400">Impact: {item.impactScore}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
