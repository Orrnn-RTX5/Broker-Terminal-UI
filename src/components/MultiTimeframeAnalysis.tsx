/**
 * Multi-Timeframe Analysis (MTA) Panel
 * Analyzes multiple timeframes simultaneously to identify trading confluences
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo } from 'react';
import { API_ENDPOINTS } from '../config/api';

// ============================================================================
// Types
// ============================================================================

type Timeframe = 'M15' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN1';
type Signal = 'bullish' | 'bearish' | 'neutral';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TimeframeData {
  timeframe: Timeframe;
  candles: Candle[];
  lastClose: number;
  trend: Signal;
  rsi: number;
  macd: Signal;
  maPosition: Signal; // Price above/below MA(20)
  support: number;
  resistance: number;
}

interface ConfluenceData {
  overall: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  score: number; // -6 to +6
}

// ============================================================================
// Mock Data Generation
// ============================================================================

const SYMBOLS = [
  { name: 'EURUSD', type: 'forex', basePrice: 1.0850 },
  { name: 'GBPUSD', type: 'forex', basePrice: 1.2720 },
  { name: 'USDJPY', type: 'forex', basePrice: 148.50 },
  { name: 'AUDUSD', type: 'forex', basePrice: 0.6580 },
  { name: 'USDCAD', type: 'forex', basePrice: 1.3650 },
  { name: 'NZDUSD', type: 'forex', basePrice: 0.6120 },
  { name: 'XAUUSD', type: 'metal', basePrice: 2034.50 },
  { name: 'XAGUSD', type: 'metal', basePrice: 23.45 },
  { name: 'BTCUSD', type: 'crypto', basePrice: 43250.0 },
  { name: 'ETHUSD', type: 'crypto', basePrice: 2280.0 },
];

function generateCandles(basePrice: number, count: number, volatility: number): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = basePrice;
  const now = Date.now();

  for (let i = count - 1; i >= 0; i--) {
    const open = currentPrice;
    const change = (Math.random() - 0.5) * 2 * volatility;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.random() * 1000000;

    candles.push({
      time: now - i * 60000,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }

  return candles;
}

function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return Math.round(rsi * 10) / 10;
}

function calculateMACD(candles: Candle[]): Signal {
  if (candles.length < 26) return 'neutral';

  // Simplified MACD calculation
  const ema12 = candles.slice(-12).reduce((sum, c) => sum + c.close, 0) / 12;
  const ema26 = candles.slice(-26).reduce((sum, c) => sum + c.close, 0) / 26;
  const macdLine = ema12 - ema26;

  // Signal line (9-period EMA of MACD)
  const signalLine = macdLine * 0.8; // Simplified

  if (macdLine > signalLine && macdLine > 0) return 'bullish';
  if (macdLine < signalLine && macdLine < 0) return 'bearish';
  return 'neutral';
}

function calculateMA(candles: Candle[], period: number = 20): number {
  if (candles.length < period) return candles[candles.length - 1].close;
  const sum = candles.slice(-period).reduce((sum, c) => sum + c.close, 0);
  return sum / period;
}

function calculateSupportResistance(candles: Candle[]): { support: number; resistance: number } {
  if (candles.length < 20) {
    const lastCandle = candles[candles.length - 1];
    return {
      support: lastCandle.low * 0.99,
      resistance: lastCandle.high * 1.01,
    };
  }

  // Find swing lows and highs
  const lows = candles.slice(-20).map(c => c.low);
  const highs = candles.slice(-20).map(c => c.high);

  const support = Math.min(...lows);
  const resistance = Math.max(...highs);

  return { support, resistance };
}

function determineTrend(candles: Candle[]): Signal {
  if (candles.length < 20) return 'neutral';

  const ma20 = calculateMA(candles, 20);
  const lastClose = candles[candles.length - 1].close;

  // Price vs MA
  const priceAboveMA = lastClose > ma20;

  // Recent momentum
  const recentCandles = candles.slice(-5);
  const bullishCount = recentCandles.filter(c => c.close > c.open).length;
  const bearishCount = recentCandles.filter(c => c.close < c.open).length;

  if (priceAboveMA && bullishCount >= 3) return 'bullish';
  if (!priceAboveMA && bearishCount >= 3) return 'bearish';
  return 'neutral';
}

function generateTimeframeData(symbol: string, basePrice: number): TimeframeData[] {
  const timeframes: Timeframe[] = ['M15', 'H1', 'H4', 'D1', 'W1', 'MN1'];
  const volatilities = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.03]; // Relative to base price

  return timeframes.map((tf, idx) => {
    const volatility = basePrice * volatilities[idx];
    const candles = generateCandles(basePrice, 50, volatility);
    const lastClose = candles[candles.length - 1].close;
    const rsi = calculateRSI(candles);
    const macd = calculateMACD(candles);
    const ma20 = calculateMA(candles, 20);
    const maPosition: Signal = lastClose > ma20 ? 'bullish' : lastClose < ma20 ? 'bearish' : 'neutral';
    const { support, resistance } = calculateSupportResistance(candles);
    const trend = determineTrend(candles);

    return {
      timeframe: tf,
      candles,
      lastClose,
      trend,
      rsi,
      macd,
      maPosition,
      support,
      resistance,
    };
  });
}

// ============================================================================
// Main Component
// ============================================================================

export const MultiTimeframeAnalysis: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');

  const symbolData = useMemo(() => {
    const symbol = SYMBOLS.find(s => s.name === selectedSymbol) || SYMBOLS[0];
    return {
      symbol: symbol.name,
      basePrice: symbol.basePrice,
      bid: symbol.basePrice - 0.0002,
      ask: symbol.basePrice + 0.0002,
    };
  }, [selectedSymbol]);

  const timeframeData = useMemo(() => {
    return generateTimeframeData(selectedSymbol, symbolData.basePrice);
  }, [selectedSymbol, symbolData.basePrice]);

  const confluence = useMemo((): ConfluenceData => {
    let bullish = 0;
    let bearish = 0;
    let neutral = 0;

    timeframeData.forEach(tf => {
      let score = 0;

      // Trend
      if (tf.trend === 'bullish') score++;
      else if (tf.trend === 'bearish') score--;

      // RSI
      if (tf.rsi > 50) score++;
      else if (tf.rsi < 50) score--;

      // MACD
      if (tf.macd === 'bullish') score++;
      else if (tf.macd === 'bearish') score--;

      // MA Position
      if (tf.maPosition === 'bullish') score++;
      else if (tf.maPosition === 'bearish') score--;

      if (score > 0) bullish++;
      else if (score < 0) bearish++;
      else neutral++;
    });

    const totalScore = bullish - bearish;
    let overall: ConfluenceData['overall'] = 'neutral';

    if (totalScore >= 5) overall = 'strong_buy';
    else if (totalScore >= 3) overall = 'buy';
    else if (totalScore <= -5) overall = 'strong_sell';
    else if (totalScore <= -3) overall = 'sell';

    return {
      overall,
      bullishCount: bullish,
      bearishCount: bearish,
      neutralCount: neutral,
      score: totalScore,
    };
  }, [timeframeData]);

  const keyLevels = useMemo(() => {
    const levels: { level: number; type: 'support' | 'resistance'; count: number }[] = [];

    // Collect all support and resistance levels
    timeframeData.forEach(tf => {
      levels.push({ level: tf.support, type: 'support', count: 1 });
      levels.push({ level: tf.resistance, type: 'resistance', count: 1 });
    });

    // Group similar levels (within 0.1% of each other)
    const grouped: typeof levels = [];
    levels.forEach(level => {
      const existing = grouped.find(
        g => g.type === level.type && Math.abs(g.level - level.level) / level.level < 0.001
      );
      if (existing) {
        existing.count++;
      } else {
        grouped.push({ ...level });
      }
    });

    // Sort by proximity to current price
    return grouped
      .sort((a, b) => {
        const distA = Math.abs(a.level - symbolData.basePrice);
        const distB = Math.abs(b.level - symbolData.basePrice);
        return distA - distB;
      })
      .slice(0, 6);
  }, [timeframeData, symbolData.basePrice]);

  return (
    <div className="h-full flex flex-col bg-[#131316] text-zinc-300 overflow-hidden">
      {/* Symbol Selector */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-[#252526]">
        <div className="flex items-center gap-4">
          <div className="relative">
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-[#131316] border border-zinc-600 rounded px-3 py-1.5 text-sm text-white pr-8 cursor-pointer focus:outline-none focus:border-zinc-600"
            >
              <optgroup label="Forex">
                {SYMBOLS.filter(s => s.type === 'forex').map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </optgroup>
              <optgroup label="Metals">
                {SYMBOLS.filter(s => s.type === 'metal').map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </optgroup>
              <optgroup label="Crypto">
                {SYMBOLS.filter(s => s.type === 'crypto').map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </optgroup>
            </select>
            <Icon name="chevron-down" size="sm" className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div>
              <span className="text-zinc-500">Bid:</span>
              <span className="ml-2 font-mono text-red-400 font-semibold">{symbolData.bid.toFixed(5)}</span>
            </div>
            <div>
              <span className="text-zinc-500">Ask:</span>
              <span className="ml-2 font-mono text-green-400 font-semibold">{symbolData.ask.toFixed(5)}</span>
            </div>
          </div>
        </div>
        <div className="text-xs text-zinc-400">
          Multi-Timeframe Analysis
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        {/* Left: Timeframe Grid + Tables */}
        <div className="flex-1 flex flex-col gap-3 overflow-auto">
          {/* Timeframe Grid (2x3) */}
          <div className="grid grid-cols-3 gap-3">
            {timeframeData.map(tf => (
              <TimeframeCard key={tf.timeframe} data={tf} currentPrice={symbolData.basePrice} />
            ))}
          </div>

          {/* Key Levels Summary */}
          <div className="bg-[#252526] rounded border border-zinc-700 p-3">
            <div className="text-xs font-semibold text-zinc-300 mb-2">Key Levels Summary</div>
            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="text-left py-1">Type</th>
                  <th className="text-right py-1">Level</th>
                  <th className="text-center py-1">Distance (pips)</th>
                  <th className="text-center py-1">Confluence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {keyLevels.map((level, idx) => {
                  const distance = Math.abs(level.level - symbolData.basePrice);
                  const pips = Math.round(distance * 10000);
                  return (
                    <tr key={idx} className={level.count >= 3 ? 'bg-blue-900/20' : ''}>
                      <td className="py-1">
                        <span className={`text-xs ${level.type === 'support' ? 'text-green-400' : 'text-red-400'}`}>
                          {level.type === 'support' ? '▼ Support' : '▲ Resistance'}
                        </span>
                      </td>
                      <td className="py-1 text-right font-mono text-zinc-300">{level.level.toFixed(5)}</td>
                      <td className="py-1 text-center text-zinc-500">{pips}</td>
                      <td className="py-1 text-center">
                        {level.count >= 3 ? (
                          <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] font-semibold">
                            {level.count} TF
                          </span>
                        ) : (
                          <span className="text-zinc-600">{level.count}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Signal Summary Table */}
          <div className="bg-[#252526] rounded border border-zinc-700 p-3">
            <div className="text-xs font-semibold text-zinc-300 mb-2">Signal Summary</div>
            <table className="w-full text-xs">
              <thead className="text-zinc-500 border-b border-zinc-700">
                <tr>
                  <th className="text-left py-1 px-2">TF</th>
                  <th className="text-center py-1 px-2">Trend</th>
                  <th className="text-center py-1 px-2">RSI</th>
                  <th className="text-center py-1 px-2">MACD</th>
                  <th className="text-center py-1 px-2">MA</th>
                  <th className="text-center py-1 px-2">Overall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {timeframeData.map(tf => {
                  const rsiSignal: Signal = tf.rsi > 50 ? 'bullish' : tf.rsi < 50 ? 'bearish' : 'neutral';
                  const overallScore =
                    (tf.trend === 'bullish' ? 1 : tf.trend === 'bearish' ? -1 : 0) +
                    (rsiSignal === 'bullish' ? 1 : rsiSignal === 'bearish' ? -1 : 0) +
                    (tf.macd === 'bullish' ? 1 : tf.macd === 'bearish' ? -1 : 0) +
                    (tf.maPosition === 'bullish' ? 1 : tf.maPosition === 'bearish' ? -1 : 0);
                  const overall: Signal = overallScore > 0 ? 'bullish' : overallScore < 0 ? 'bearish' : 'neutral';

                  return (
                    <tr key={tf.timeframe}>
                      <td className="py-1.5 px-2 font-mono font-semibold text-zinc-200">{tf.timeframe}</td>
                      <td className="py-1.5 px-2 text-center">
                        <SignalIcon signal={tf.trend} />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <SignalIcon signal={rsiSignal} />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <SignalIcon signal={tf.macd} />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <SignalIcon signal={tf.maPosition} />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <SignalIcon signal={overall} />
                      </td>
                    </tr>
                  );
                })}
                {/* Aggregate Row */}
                <tr className="bg-zinc-800/50 font-semibold">
                  <td className="py-1.5 px-2 text-zinc-300">Total</td>
                  <td className="py-1.5 px-2 text-center text-zinc-400">—</td>
                  <td className="py-1.5 px-2 text-center text-zinc-400">—</td>
                  <td className="py-1.5 px-2 text-center text-zinc-400">—</td>
                  <td className="py-1.5 px-2 text-center text-zinc-400">—</td>
                  <td className="py-1.5 px-2 text-center">
                    <span className={`${
                      confluence.score > 0 ? 'text-emerald-400' :
                      confluence.score < 0 ? 'text-red-400' : 'text-zinc-500'
                    }`}>
                      {confluence.score > 0 ? '+' : ''}{confluence.score}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Confluence Panel */}
        <div className="w-64 flex-shrink-0 bg-[#252526] rounded border border-zinc-700 p-3">
          <div className="text-xs font-semibold text-zinc-300 mb-3">Confluence Analysis</div>

          {/* Overall Signal */}
          <div className="mb-4">
            <div className="text-[10px] text-zinc-500 mb-1">Overall Signal</div>
            <div className={`text-center py-3 rounded font-bold text-sm ${
              confluence.overall === 'strong_buy' ? 'bg-emerald-600 text-white' :
              confluence.overall === 'buy' ? 'bg-emerald-700 text-white' :
              confluence.overall === 'strong_sell' ? 'bg-red-600 text-white' :
              confluence.overall === 'sell' ? 'bg-red-700 text-white' :
              'bg-zinc-700 text-zinc-300'
            }`}>
              {confluence.overall.replace('_', ' ').toUpperCase()}
            </div>
          </div>

          {/* Score */}
          <div className="mb-4">
            <div className="text-[10px] text-zinc-500 mb-1">Confluence Score</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-zinc-800 rounded h-6 overflow-hidden relative">
                <div
                  className={`h-full transition-all ${
                    confluence.score > 0 ? 'bg-emerald-500' : confluence.score < 0 ? 'bg-red-500' : 'bg-zinc-600'
                  }`}
                  style={{ width: `${Math.abs(confluence.score) / 6 * 100}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                  {confluence.score > 0 ? '+' : ''}{confluence.score} / 6
                </div>
              </div>
            </div>
          </div>

          {/* Breakdown */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Bullish TF:</span>
              <span className="text-emerald-400 font-semibold">{confluence.bullishCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Bearish TF:</span>
              <span className="text-red-400 font-semibold">{confluence.bearishCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Neutral TF:</span>
              <span className="text-zinc-500 font-semibold">{confluence.neutralCount}</span>
            </div>
          </div>

          {/* Visual Alignment Meter */}
          <div>
            <div className="text-[10px] text-zinc-500 mb-2">Timeframe Alignment</div>
            <div className="space-y-1">
              {timeframeData.map(tf => {
                const score =
                  (tf.trend === 'bullish' ? 1 : tf.trend === 'bearish' ? -1 : 0) +
                  (tf.rsi > 50 ? 1 : tf.rsi < 50 ? -1 : 0) +
                  (tf.macd === 'bullish' ? 1 : tf.macd === 'bearish' ? -1 : 0) +
                  (tf.maPosition === 'bullish' ? 1 : tf.maPosition === 'bearish' ? -1 : 0);

                return (
                  <div key={tf.timeframe} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-400 w-8">{tf.timeframe}</span>
                    <div className="flex-1 flex gap-0.5">
                      {[1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className={`h-2 flex-1 rounded-sm ${
                            score > 0 && i <= score ? 'bg-emerald-500' :
                            score < 0 && i <= Math.abs(score) ? 'bg-red-500' :
                            'bg-zinc-700'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Timeframe Card Component
// ============================================================================

interface TimeframeCardProps {
  data: TimeframeData;
  currentPrice: number;
}

const TimeframeCard: React.FC<TimeframeCardProps> = ({ data, currentPrice }) => {
  const rsiColor = data.rsi > 70 ? 'text-red-400' : data.rsi > 50 ? 'text-emerald-400' : data.rsi > 30 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="bg-[#252526] rounded border border-zinc-700 p-2 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-200">{data.timeframe}</span>
          <TrendIcon trend={data.trend} />
        </div>
        <span className="text-xs font-mono text-zinc-400">{data.lastClose.toFixed(5)}</span>
      </div>

      {/* Mini Chart */}
      <div className="h-20 mb-2">
        <MiniCandleChart candles={data.candles.slice(-20)} support={data.support} resistance={data.resistance} />
      </div>

      {/* Indicators */}
      <div className="space-y-1 text-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">RSI:</span>
          <span className={`font-mono font-semibold ${rsiColor}`}>{data.rsi.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">MACD:</span>
          <MACDBadge signal={data.macd} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">MA(20):</span>
          <span className={`text-xs ${data.maPosition === 'bullish' ? 'text-emerald-400' : data.maPosition === 'bearish' ? 'text-red-400' : 'text-zinc-500'}`}>
            {data.maPosition === 'bullish' ? 'Above' : data.maPosition === 'bearish' ? 'Below' : 'At'}
          </span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-zinc-700">
          <span className="text-zinc-500">R:</span>
          <span className="font-mono text-red-300 text-[9px]">{data.resistance.toFixed(5)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">S:</span>
          <span className="font-mono text-green-300 text-[9px]">{data.support.toFixed(5)}</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Helper Components
// ============================================================================

const TrendIcon: React.FC<{ trend: Signal }> = ({ trend }) => {
  if (trend === 'bullish') {
    return <Icon name="trending-up" size="sm" className="text-emerald-400" />;
  }
  if (trend === 'bearish') {
    return <Icon name="trending-down" size="sm" className="text-red-400" />;
  }
  return <Icon name="minus" size="sm" className="text-zinc-500" />;
};

const MACDBadge: React.FC<{ signal: Signal }> = ({ signal }) => {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
      signal === 'bullish' ? 'bg-emerald-600 text-white' :
      signal === 'bearish' ? 'bg-red-600 text-white' :
      'bg-zinc-700 text-zinc-400'
    }`}>
      {signal === 'bullish' ? 'BULL' : signal === 'bearish' ? 'BEAR' : 'NEU'}
    </span>
  );
};

const SignalIcon: React.FC<{ signal: Signal }> = ({ signal }) => {
  if (signal === 'bullish') {
    return <span className="text-emerald-400 font-bold">✓</span>;
  }
  if (signal === 'bearish') {
    return <span className="text-red-400 font-bold">✗</span>;
  }
  return <span className="text-zinc-600">—</span>;
};

// ============================================================================
// Mini Candlestick Chart (SVG)
// ============================================================================

interface MiniCandleChartProps {
  candles: Candle[];
  support: number;
  resistance: number;
}

const MiniCandleChart: React.FC<MiniCandleChartProps> = ({ candles, support, resistance }) => {
  if (candles.length === 0) return <div className="h-full bg-zinc-900 rounded" />;

  const prices = candles.flatMap(c => [c.high, c.low]);
  const min = Math.min(...prices, support);
  const max = Math.max(...prices, resistance);
  const range = max - min;

  const width = 100;
  const height = 100;
  const candleWidth = width / candles.length * 0.6;
  const gap = width / candles.length * 0.4;

  const scaleY = (price: number) => {
    return height - ((price - min) / range) * height;
  };

  const supportY = scaleY(support);
  const resistanceY = scaleY(resistance);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
      {/* Support/Resistance Lines */}
      <line x1="0" y1={supportY} x2={width} y2={supportY} stroke="rgb(74, 222, 128)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
      <line x1="0" y1={resistanceY} x2={width} y2={resistanceY} stroke="rgb(248, 113, 113)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />

      {/* Candles */}
      {candles.map((candle, i) => {
        const x = (i * (candleWidth + gap)) + gap / 2;
        const isBullish = candle.close > candle.open;
        const color = isBullish ? 'rgb(74, 222, 128)' : 'rgb(248, 113, 113)';

        const highY = scaleY(candle.high);
        const lowY = scaleY(candle.low);
        const openY = scaleY(candle.open);
        const closeY = scaleY(candle.close);

        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.abs(closeY - openY);

        return (
          <g key={i}>
            {/* Wick */}
            <line
              x1={x + candleWidth / 2}
              y1={highY}
              x2={x + candleWidth / 2}
              y2={lowY}
              stroke={color}
              strokeWidth="0.5"
            />
            {/* Body */}
            <rect
              x={x}
              y={bodyTop}
              width={candleWidth}
              height={Math.max(bodyHeight, 0.5)}
              fill={isBullish ? color : 'transparent'}
              stroke={color}
              strokeWidth="0.5"
            />
          </g>
        );
      })}
    </svg>
  );
};
