/**
 * Volatility Analyzer / ATR Dashboard
 * Advanced volatility analysis with ATR, historical volatility, and position sizing
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo } from 'react';
import { useVolatilityStore, type Timeframe } from '../store/useVolatilityStore';

interface OHLC {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SymbolVolatility {
  symbol: string;
  atr: number;
  atrPercent: number;
  historicalVol: number;
  rank: number;
}

const SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
  'USDCHF', 'NZDUSD', 'EURJPY', 'GBPJPY', 'EURGBP',
  'AUDJPY', 'EURAUD', 'EURCHF', 'AUDNZD', 'NZDJPY',
  'GBPAUD', 'GBPCAD', 'EURNZD', 'AUDCAD', 'GBPNZD',
];

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

// Generate mock OHLC data for a symbol
function generateOHLC(symbol: string, periods: number, basePrice: number): OHLC[] {
  const data: OHLC[] = [];
  const now = Date.now();

  // Different volatility levels for different symbols
  const volatilityMap: Record<string, number> = {
    'GBPJPY': 0.012, 'EURJPY': 0.010, 'GBPUSD': 0.009,
    'EURUSD': 0.008, 'AUDUSD': 0.008, 'NZDUSD': 0.007,
    'USDJPY': 0.007, 'USDCAD': 0.006, 'EURGBP': 0.005,
  };

  const volatility = volatilityMap[symbol] || 0.007;
  let price = basePrice;

  for (let i = 0; i < periods; i++) {
    const timestamp = now - (periods - i) * 3600000; // 1 hour bars

    // Random walk with volatility
    const change = (Math.random() - 0.5) * price * volatility;
    const open = price;
    price += change;

    const high = Math.max(open, price) + Math.random() * price * volatility * 0.3;
    const low = Math.min(open, price) - Math.random() * price * volatility * 0.3;
    const close = price;

    data.push({ timestamp, open, high, low, close });
  }

  return data;
}

// Calculate ATR (Average True Range)
function calculateATR(data: OHLC[], period: number = 14): number[] {
  if (data.length < period + 1) return [];

  const atrValues: number[] = [];
  const trueRanges: number[] = [];

  // Calculate True Range for each period
  for (let i = 1; i < data.length; i++) {
    const current = data[i];
    const previous = data[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    trueRanges.push(tr);
  }

  // Calculate initial ATR (simple average)
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atrValues.push(atr);

  // Calculate subsequent ATR using Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    atrValues.push(atr);
  }

  return atrValues;
}

// Calculate historical volatility (annualized standard deviation of returns)
function calculateHistoricalVol(data: OHLC[], period: number = 30): number {
  if (data.length < period + 1) return 0;

  const returns: number[] = [];

  for (let i = 1; i < Math.min(period + 1, data.length); i++) {
    const ret = Math.log(data[i].close / data[i - 1].close);
    returns.push(ret);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize (assuming 252 trading days per year)
  return stdDev * Math.sqrt(252) * 100;
}

// Determine volatility regime
function getVolatilityRegime(percentile: number): { label: string; color: string } {
  if (percentile >= 80) return { label: 'Extreme', color: 'red' };
  if (percentile >= 60) return { label: 'High', color: 'orange' };
  if (percentile >= 30) return { label: 'Normal', color: 'blue' };
  return { label: 'Low', color: 'emerald' };
}

export const VolatilityAnalyzer: React.FC = () => {
  const { selectedSymbol, selectedTimeframe, riskPercent, setSymbol, setTimeframe, setRiskPercent } = useVolatilityStore();
  const [accountBalance, setAccountBalance] = useState<number>(10000);

  // Get base prices for symbols
  const basePrices: Record<string, number> = {
    'EURUSD': 1.0850, 'GBPUSD': 1.2650, 'USDJPY': 148.50, 'AUDUSD': 0.6550,
    'USDCAD': 1.3650, 'USDCHF': 0.8750, 'NZDUSD': 0.6050, 'EURJPY': 161.20,
    'GBPJPY': 187.80, 'EURGBP': 0.8580, 'AUDJPY': 97.30, 'EURAUD': 1.6560,
    'EURCHF': 0.9490, 'AUDNZD': 1.0820, 'NZDJPY': 89.80, 'GBPAUD': 1.9320,
    'GBPCAD': 1.7280, 'EURNZD': 1.7930, 'AUDCAD': 0.8940, 'GBPNZD': 2.0910,
  };

  // Generate OHLC data for all symbols
  const symbolsData = useMemo(() => {
    return SYMBOLS.map(symbol => ({
      symbol,
      data: generateOHLC(symbol, 120, basePrices[symbol] || 1.0),
    }));
  }, []);

  // Calculate volatility metrics for all symbols
  const symbolsVolatility = useMemo(() => {
    const volatilities: SymbolVolatility[] = symbolsData.map(({ symbol, data }) => {
      const atrValues = calculateATR(data, 14);
      const currentATR = atrValues[atrValues.length - 1] || 0;
      const currentPrice = data[data.length - 1].close;
      const atrPercent = (currentATR / currentPrice) * 100;
      const historicalVol = calculateHistoricalVol(data, 30);

      return {
        symbol,
        atr: currentATR,
        atrPercent,
        historicalVol,
        rank: 0,
      };
    });

    // Sort by ATR percentage (most volatile first) and assign ranks
    volatilities.sort((a, b) => b.atrPercent - a.atrPercent);
    volatilities.forEach((v, i) => v.rank = i + 1);

    return volatilities;
  }, [symbolsData]);

  // Get current symbol data
  const currentSymbolData = useMemo(() => {
    return symbolsData.find(s => s.symbol === selectedSymbol);
  }, [symbolsData, selectedSymbol]);

  // Calculate metrics for selected symbol
  const metrics = useMemo(() => {
    if (!currentSymbolData) return null;

    const { data } = currentSymbolData;
    const atrValues = calculateATR(data, 14);
    const currentATR = atrValues[atrValues.length - 1] || 0;
    const currentPrice = data[data.length - 1].close;
    const atrPercent = (currentATR / currentPrice) * 100;
    const historicalVol = calculateHistoricalVol(data, 30);

    // Calculate percentile rank
    const currentSymbolVol = symbolsVolatility.find(s => s.symbol === selectedSymbol);
    const rank = currentSymbolVol?.rank || 0;
    const percentile = ((SYMBOLS.length - rank + 1) / SYMBOLS.length) * 100;

    // Volatility regime
    const regime = getVolatilityRegime(percentile);

    // Pip calculations (for forex pairs)
    const pipSize = selectedSymbol.includes('JPY') ? 0.01 : 0.0001;
    const pipsPerATR = currentATR / pipSize;
    const dailyPipRange = pipsPerATR;
    const weeklyPipRange = pipsPerATR * Math.sqrt(5); // Sqrt of days
    const monthlyPipRange = pipsPerATR * Math.sqrt(21);

    // Position size suggestion based on volatility
    const riskAmount = (accountBalance * riskPercent) / 100;
    const stopLossPips = pipsPerATR * 1.5; // 1.5x ATR as stop loss
    const pipValue = 10; // Assume $10 per pip for standard lot
    const positionSize = riskAmount / (stopLossPips * pipValue);

    return {
      currentATR,
      atrPercent,
      historicalVol,
      percentile,
      regime,
      atrValues,
      dailyPipRange,
      weeklyPipRange,
      monthlyPipRange,
      positionSize,
      stopLossPips,
    };
  }, [currentSymbolData, symbolsVolatility, selectedSymbol, accountBalance, riskPercent]);

  if (!metrics) return null;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Icon name="activity" size="sm" className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-sm">Volatility Analyzer</span>
        </div>

        {/* Symbol Selector */}
        <div className="flex items-center gap-2">
          <select
            value={selectedSymbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm text-zinc-100"
          >
            {SYMBOLS.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>

          {/* Timeframe Selector */}
          <select
            value={selectedTimeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm text-zinc-100"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-4 gap-4">
          {/* Main Content Area */}
          <div className="col-span-3 space-y-4">
            {/* Key Metrics Cards */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Current ATR(14)</div>
                <div className="text-xl font-bold text-emerald-400">
                  {metrics.currentATR.toFixed(selectedSymbol.includes('JPY') ? 3 : 5)}
                </div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">ATR Percentage</div>
                <div className="text-xl font-bold text-blue-400">{metrics.atrPercent.toFixed(2)}%</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">30-Day Historical Vol</div>
                <div className="text-xl font-bold text-yellow-400">{metrics.historicalVol.toFixed(2)}%</div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Vol Percentile Rank</div>
                <div className={`text-xl font-bold text-${metrics.regime.color}-400`}>
                  {metrics.percentile.toFixed(0)}%
                </div>
              </div>
            </div>

            {/* ATR Chart */}
            <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Icon name="bar-chart-3" size="sm" className="w-4 h-4" />
                ATR(14) Over Last 100 Periods
              </h3>
              <ATRChart atrValues={metrics.atrValues} />
            </div>

            {/* Pip Range Calculator */}
            <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Icon name="crosshair" size="sm" className="w-4 h-4" />
                Expected Pip Ranges (Based on ATR)
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">Daily Range</div>
                  <div className="text-lg font-bold text-zinc-100">{metrics.dailyPipRange.toFixed(1)} pips</div>
                </div>

                <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">Weekly Range</div>
                  <div className="text-lg font-bold text-zinc-100">{metrics.weeklyPipRange.toFixed(1)} pips</div>
                </div>

                <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">Monthly Range</div>
                  <div className="text-lg font-bold text-zinc-100">{metrics.monthlyPipRange.toFixed(1)} pips</div>
                </div>
              </div>
            </div>

            {/* Position Size Suggestion */}
            <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Icon name="layers" size="sm" className="w-4 h-4" />
                Position Size Suggestion (Volatility-Based)
              </h3>

              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Account Balance ($)</label>
                  <input
                    type="number"
                    value={accountBalance}
                    onChange={(e) => setAccountBalance(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
                    min="100"
                    step="100"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Risk per Trade (%)</label>
                  <input
                    type="number"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
                    min="0.1"
                    max="10"
                    step="0.1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">Suggested Stop Loss</div>
                  <div className="text-lg font-bold text-red-400">{metrics.stopLossPips.toFixed(1)} pips</div>
                  <div className="text-xs text-zinc-500 mt-1">(1.5x ATR)</div>
                </div>

                <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">Recommended Position Size</div>
                  <div className="text-lg font-bold text-emerald-400">{metrics.positionSize.toFixed(2)} lots</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Risk: ${((accountBalance * riskPercent) / 100).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - Volatility Comparison */}
          <div className="space-y-4">
            {/* Volatility Regime */}
            <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
              <div className="text-xs text-zinc-400 mb-2">Volatility Regime</div>
              <div className={`text-center py-2 px-3 rounded bg-${metrics.regime.color}-900/30 border border-${metrics.regime.color}-600`}>
                <div className={`text-lg font-bold text-${metrics.regime.color}-400`}>
                  {metrics.regime.label}
                </div>
              </div>
            </div>

            {/* Volatility Comparison Table */}
            <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Icon name="trending-up" size="sm" className="w-4 h-4" />
                Volatility Rankings
              </h3>
              <div className="space-y-1 max-h-96 overflow-auto">
                {symbolsVolatility.map((sv, index) => (
                  <div
                    key={sv.symbol}
                    className={`flex items-center justify-between p-2 rounded text-xs ${
                      sv.symbol === selectedSymbol ? 'bg-emerald-900/30 border border-emerald-600' : 'bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500 w-5">#{index + 1}</span>
                      <span className="font-medium text-zinc-300">{sv.symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${
                        index < 5 ? 'text-red-400' : index < 10 ? 'text-yellow-400' : 'text-emerald-400'
                      }`}>
                        {sv.atrPercent.toFixed(2)}%
                      </div>
                      <div className="text-zinc-500 text-xs">
                        {sv.atr.toFixed(sv.symbol.includes('JPY') ? 3 : 5)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ATR Chart Component
interface ATRChartProps {
  atrValues: number[];
}

const ATRChart: React.FC<ATRChartProps> = ({ atrValues }) => {
  const width = 800;
  const height = 200;
  const padding = { top: 20, right: 40, bottom: 30, left: 50 };

  if (atrValues.length === 0) return null;

  const minATR = Math.min(...atrValues);
  const maxATR = Math.max(...atrValues);
  const atrRange = maxATR - minATR;

  const xScale = (index: number) =>
    padding.left + (index / (atrValues.length - 1)) * (width - padding.left - padding.right);

  const yScale = (value: number) =>
    height - padding.bottom - ((value - minATR) / atrRange) * (height - padding.top - padding.bottom);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 bg-zinc-900 rounded">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = height - padding.bottom - ratio * (height - padding.top - padding.bottom);
        const value = minATR + ratio * atrRange;
        return (
          <g key={ratio}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#3f3f46"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
            <text x={padding.left - 10} y={y + 4} fill="#71717a" fontSize="10" textAnchor="end">
              {value.toFixed(5)}
            </text>
          </g>
        );
      })}

      {/* ATR line */}
      <polyline
        points={atrValues.map((atr, i) => `${xScale(i)},${yScale(atr)}`).join(' ')}
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
      />

      {/* Area fill under line */}
      <polygon
        points={[
          `${padding.left},${height - padding.bottom}`,
          ...atrValues.map((atr, i) => `${xScale(i)},${yScale(atr)}`),
          `${xScale(atrValues.length - 1)},${height - padding.bottom}`,
        ].join(' ')}
        fill="#10b981"
        opacity="0.1"
      />

      {/* Current value marker */}
      <circle
        cx={xScale(atrValues.length - 1)}
        cy={yScale(atrValues[atrValues.length - 1])}
        r="4"
        fill="#10b981"
      />

      {/* X-axis labels */}
      {[0, Math.floor(atrValues.length / 2), atrValues.length - 1].map((i) => (
        <text
          key={i}
          x={xScale(i)}
          y={height - padding.bottom + 20}
          fill="#71717a"
          fontSize="10"
          textAnchor="middle"
        >
          -{atrValues.length - 1 - i}
        </text>
      ))}

      {/* Y-axis label */}
      <text
        x={padding.left - 35}
        y={height / 2}
        fill="#71717a"
        fontSize="10"
        textAnchor="middle"
        transform={`rotate(-90, ${padding.left - 35}, ${height / 2})`}
      >
        ATR Value
      </text>
    </svg>
  );
};
