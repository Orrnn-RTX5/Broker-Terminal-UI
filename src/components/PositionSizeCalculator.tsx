/**
 * Position Size Calculator / Risk Manager
 * Advanced position sizing tool with risk/reward visualization
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo, useCallback } from 'react';
import { usePositionSizeStore, type CalculationHistory } from '../store/usePositionSizeStore';
import { Calculator } from 'lucide-react';

// Pip values for standard lot (100,000 units) in USD
const PIP_VALUES: Record<string, number> = {
  'EURUSD': 10,
  'GBPUSD': 10,
  'AUDUSD': 10,
  'NZDUSD': 10,
  'USDCAD': 9.60,
  'USDCHF': 10.20,
  'USDJPY': 9.10,
  'EURJPY': 9.10,
  'GBPJPY': 9.10,
  'AUDJPY': 9.10,
  'EURGBP': 12.80,
  'EURAUD': 6.50,
  'EURCHF': 10.20,
  'GBPCHF': 10.20,
  'AUDCAD': 9.60,
  'NZDCAD': 9.60,
  'CADCHF': 10.60,
  'CHFJPY': 9.10,
  'AUDNZD': 6.20,
  'GBPAUD': 6.50,
};

const SYMBOLS = Object.keys(PIP_VALUES);

// Risk profile presets
const RISK_PRESETS = [
  { name: 'Conservative', risk: 1, color: 'emerald' },
  { name: 'Moderate', risk: 2, color: 'yellow' },
  { name: 'Aggressive', risk: 5, color: 'red' },
];

interface BatchSymbol {
  symbol: string;
  stopLossPips: number;
}

export const PositionSizeCalculator: React.FC = () => {
  const { addCalculation, clearHistory, calculationHistory } = usePositionSizeStore();

  // Form inputs
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [riskPercent, setRiskPercent] = useState<number>(2);
  const [stopLossPips, setStopLossPips] = useState<number>(20);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('EURUSD');
  const [currentPrice, setCurrentPrice] = useState<number>(1.0850);

  // Batch calculator
  const [batchSymbols, setBatchSymbols] = useState<BatchSymbol[]>([
    { symbol: 'EURUSD', stopLossPips: 20 },
    { symbol: 'GBPUSD', stopLossPips: 25 },
  ]);

  // Calculate position size and related metrics
  const calculations = useMemo(() => {
    const pipValue = PIP_VALUES[selectedSymbol] || 10;
    const monetaryRisk = (accountBalance * riskPercent) / 100;
    const pipRiskValue = stopLossPips * pipValue;
    const positionSize = pipRiskValue > 0 ? monetaryRisk / pipRiskValue : 0;

    // Rewards at different RR ratios
    const reward1to1 = monetaryRisk;
    const reward1to2 = monetaryRisk * 2;
    const reward1to3 = monetaryRisk * 3;

    // Margin required (assuming 1:100 leverage)
    const leverage = 100;
    const lotSize = positionSize * 100000; // Convert to units
    const marginRequired = lotSize / leverage;

    return {
      positionSize: Number(positionSize.toFixed(2)),
      monetaryRisk: Number(monetaryRisk.toFixed(2)),
      reward1to1: Number(reward1to1.toFixed(2)),
      reward1to2: Number(reward1to2.toFixed(2)),
      reward1to3: Number(reward1to3.toFixed(2)),
      marginRequired: Number(marginRequired.toFixed(2)),
      pipValue,
      takeProfitPips1to1: stopLossPips,
      takeProfitPips1to2: stopLossPips * 2,
      takeProfitPips1to3: stopLossPips * 3,
    };
  }, [accountBalance, riskPercent, stopLossPips, selectedSymbol]);

  // Save calculation to history
  const saveCalculation = useCallback(() => {
    addCalculation({
      symbol: selectedSymbol,
      accountBalance,
      riskPercent,
      stopLossPips,
      positionSize: calculations.positionSize,
      monetaryRisk: calculations.monetaryRisk,
      reward1to1: calculations.reward1to1,
      reward1to2: calculations.reward1to2,
      reward1to3: calculations.reward1to3,
      marginRequired: calculations.marginRequired,
    });
  }, [addCalculation, selectedSymbol, accountBalance, riskPercent, stopLossPips, calculations]);

  // Batch calculations
  const batchResults = useMemo(() => {
    return batchSymbols.map((batch) => {
      const pipValue = PIP_VALUES[batch.symbol] || 10;
      const monetaryRisk = (accountBalance * riskPercent) / 100;
      const pipRiskValue = batch.stopLossPips * pipValue;
      const positionSize = pipRiskValue > 0 ? monetaryRisk / pipRiskValue : 0;

      return {
        symbol: batch.symbol,
        stopLossPips: batch.stopLossPips,
        positionSize: Number(positionSize.toFixed(2)),
        monetaryRisk: Number(monetaryRisk.toFixed(2)),
      };
    });
  }, [batchSymbols, accountBalance, riskPercent]);

  // Add symbol to batch
  const addBatchSymbol = () => {
    setBatchSymbols([...batchSymbols, { symbol: 'EURUSD', stopLossPips: 20 }]);
  };

  // Remove symbol from batch
  const removeBatchSymbol = (index: number) => {
    setBatchSymbols(batchSymbols.filter((_, i) => i !== index));
  };

  // Update batch symbol
  const updateBatchSymbol = (index: number, field: keyof BatchSymbol, value: string | number) => {
    const updated = [...batchSymbols];
    updated[index] = { ...updated[index], [field]: value };
    setBatchSymbols(updated);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <Calculator className="w-4 h-4 text-emerald-400" />
        <span className="font-semibold text-sm">Position Size Calculator</span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Input Form */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
            <Icon name="credit-card" size="sm" className="w-4 h-4" />
            Calculator Inputs
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {/* Account Balance */}
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

            {/* Risk Percent */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Risk per Trade (%)</label>
              <input
                type="number"
                value={riskPercent}
                onChange={(e) => setRiskPercent(Math.min(5, Math.max(0.1, Number(e.target.value))))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
                min="0.1"
                max="5"
                step="0.1"
              />
            </div>

            {/* Symbol Selector */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Symbol</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
              >
                {SYMBOLS.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym} (${PIP_VALUES[sym]}/pip)
                  </option>
                ))}
              </select>
            </div>

            {/* Stop Loss Pips */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Stop Loss (pips)</label>
              <input
                type="number"
                value={stopLossPips}
                onChange={(e) => setStopLossPips(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
                min="1"
                step="1"
              />
            </div>

            {/* Current Price */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Current Price</label>
              <input
                type="number"
                value={currentPrice}
                onChange={(e) => setCurrentPrice(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
                step="0.0001"
              />
            </div>
          </div>

          {/* Risk Presets */}
          <div>
            <label className="text-xs text-zinc-400 block mb-2">Quick Risk Profiles</label>
            <div className="flex gap-2">
              {RISK_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => setRiskPercent(preset.risk)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    riskPercent === preset.risk
                      ? `bg-${preset.color}-600 text-white`
                      : `bg-zinc-700 text-zinc-300 hover:bg-zinc-600`
                  }`}
                >
                  {preset.name} ({preset.risk}%)
                </button>
              ))}
            </div>
          </div>

          {/* Save to History Button */}
          <button
            onClick={saveCalculation}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
          >
            Save Calculation
          </button>
        </div>

        {/* Calculation Results */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
            <div className="text-xs text-zinc-400 mb-1">Position Size</div>
            <div className="text-xl font-bold text-emerald-400">{calculations.positionSize} lots</div>
          </div>

          <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
            <div className="text-xs text-zinc-400 mb-1">Monetary Risk</div>
            <div className="text-xl font-bold text-red-400">${calculations.monetaryRisk}</div>
          </div>

          <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
            <div className="text-xs text-zinc-400 mb-1">Margin Required</div>
            <div className="text-xl font-bold text-yellow-400">${calculations.marginRequired}</div>
          </div>
        </div>

        {/* Reward Scenarios */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="crosshair" size="sm" className="w-4 h-4" />
            Reward Scenarios (Risk/Reward Ratios)
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
              <div className="text-xs text-zinc-400 mb-1">1:1 RR</div>
              <div className="text-lg font-bold text-emerald-400">${calculations.reward1to1}</div>
              <div className="text-xs text-zinc-500 mt-1">TP: {calculations.takeProfitPips1to1} pips</div>
            </div>

            <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
              <div className="text-xs text-zinc-400 mb-1">1:2 RR</div>
              <div className="text-lg font-bold text-emerald-400">${calculations.reward1to2}</div>
              <div className="text-xs text-zinc-500 mt-1">TP: {calculations.takeProfitPips1to2} pips</div>
            </div>

            <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
              <div className="text-xs text-zinc-400 mb-1">1:3 RR</div>
              <div className="text-lg font-bold text-emerald-400">${calculations.reward1to3}</div>
              <div className="text-xs text-zinc-500 mt-1">TP: {calculations.takeProfitPips1to3} pips</div>
            </div>
          </div>
        </div>

        {/* Risk/Reward Visualizer */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="bar-chart-3" size="sm" className="w-4 h-4" />
            Risk/Reward Visualizer
          </h3>
          <RiskRewardChart
            currentPrice={currentPrice}
            stopLossPips={stopLossPips}
            takeProfitPips1to1={calculations.takeProfitPips1to1}
            takeProfitPips1to2={calculations.takeProfitPips1to2}
            takeProfitPips1to3={calculations.takeProfitPips1to3}
            monetaryRisk={calculations.monetaryRisk}
            reward1to1={calculations.reward1to1}
            reward1to2={calculations.reward1to2}
            reward1to3={calculations.reward1to3}
            symbol={selectedSymbol}
          />
        </div>

        {/* Pip Value Table */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="bar-chart-2" size="sm" className="w-4 h-4" />
            Pip Values (Standard Lot)
          </h3>
          <div className="grid grid-cols-4 gap-2 max-h-64 overflow-auto">
            {SYMBOLS.map((symbol) => (
              <div
                key={symbol}
                className={`bg-zinc-900 border rounded p-2 text-xs ${
                  symbol === selectedSymbol ? 'border-emerald-600' : 'border-zinc-700'
                }`}
              >
                <div className="font-medium text-zinc-300">{symbol}</div>
                <div className="text-emerald-400">${PIP_VALUES[symbol]}/pip</div>
              </div>
            ))}
          </div>
        </div>

        {/* Batch Calculator */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Icon name="layers" size="sm" className="w-4 h-4" />
            Batch Calculator
          </h3>

          <div className="space-y-2 mb-3">
            {batchSymbols.map((batch, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={batch.symbol}
                  onChange={(e) => updateBatchSymbol(index, 'symbol', e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
                >
                  {SYMBOLS.map((sym) => (
                    <option key={sym} value={sym}>{sym}</option>
                  ))}
                </select>

                <input
                  type="number"
                  value={batch.stopLossPips}
                  onChange={(e) => updateBatchSymbol(index, 'stopLossPips', Number(e.target.value))}
                  placeholder="SL pips"
                  className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
                  min="1"
                />

                <div className="text-xs text-zinc-300 w-24">
                  {batchResults[index]?.positionSize} lots
                </div>

                <button
                  onClick={() => removeBatchSymbol(index)}
                  className="p-1 hover:bg-zinc-700 rounded transition-colors"
                >
                  <Icon name="trash" size="sm" className="w-3 h-3 text-red-400" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addBatchSymbol}
            className="w-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-3 py-1 rounded text-xs transition-colors"
          >
            + Add Symbol
          </button>
        </div>

        {/* Calculation History */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <Icon name="history" size="sm" className="w-4 h-4" />
              Calculation History (Last 10)
            </h3>
            {calculationHistory.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Icon name="trash" size="sm" className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>

          {calculationHistory.length === 0 ? (
            <div className="text-xs text-zinc-500 text-center py-4">
              No calculations saved yet. Click "Save Calculation" to track your position sizes.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto">
              {calculationHistory.map((calc) => (
                <div key={calc.id} className="bg-zinc-900 border border-zinc-700 rounded p-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-zinc-300">{calc.symbol}</span>
                    <span className="text-zinc-500">
                      {new Date(calc.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-zinc-400">
                    <div>
                      <span className="text-zinc-500">Lots:</span> {calc.positionSize}
                    </div>
                    <div>
                      <span className="text-zinc-500">Risk:</span> ${calc.monetaryRisk}
                    </div>
                    <div>
                      <span className="text-zinc-500">SL:</span> {calc.stopLossPips}p
                    </div>
                    <div>
                      <span className="text-zinc-500">R%:</span> {calc.riskPercent}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Risk/Reward Chart Component
interface RiskRewardChartProps {
  currentPrice: number;
  stopLossPips: number;
  takeProfitPips1to1: number;
  takeProfitPips1to2: number;
  takeProfitPips1to3: number;
  monetaryRisk: number;
  reward1to1: number;
  reward1to2: number;
  reward1to3: number;
  symbol: string;
}

const RiskRewardChart: React.FC<RiskRewardChartProps> = ({
  currentPrice,
  stopLossPips,
  takeProfitPips1to1,
  takeProfitPips1to2,
  takeProfitPips1to3,
  monetaryRisk,
  reward1to1,
  reward1to2,
  reward1to3,
  symbol,
}) => {
  const pipSize = symbol.includes('JPY') ? 0.01 : 0.0001;

  const stopLossPrice = currentPrice - (stopLossPips * pipSize);
  const tp1Price = currentPrice + (takeProfitPips1to1 * pipSize);
  const tp2Price = currentPrice + (takeProfitPips1to2 * pipSize);
  const tp3Price = currentPrice + (takeProfitPips1to3 * pipSize);

  const priceRange = Math.max(
    Math.abs(currentPrice - stopLossPrice),
    Math.abs(tp3Price - currentPrice)
  ) * 2.2;

  const minPrice = currentPrice - priceRange / 2;
  const maxPrice = currentPrice + priceRange / 2;

  const priceToY = (price: number) => {
    return 300 - ((price - minPrice) / (maxPrice - minPrice)) * 280 + 10;
  };

  const entryY = priceToY(currentPrice);
  const slY = priceToY(stopLossPrice);
  const tp1Y = priceToY(tp1Price);
  const tp2Y = priceToY(tp2Price);
  const tp3Y = priceToY(tp3Price);

  return (
    <svg viewBox="0 0 600 300" className="w-full h-64 bg-zinc-900 rounded">
      {/* Background grid */}
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={`grid-${i}`}
          x1="0"
          y1={60 * i}
          x2="600"
          y2={60 * i}
          stroke="#3f3f46"
          strokeWidth="1"
          strokeDasharray="2,2"
        />
      ))}

      {/* Stop Loss */}
      <line x1="0" y1={slY} x2="600" y2={slY} stroke="#ef4444" strokeWidth="2" />
      <text x="10" y={slY - 5} fill="#ef4444" fontSize="12">
        SL: {stopLossPrice.toFixed(symbol.includes('JPY') ? 3 : 5)} (-${monetaryRisk})
      </text>

      {/* Entry */}
      <line x1="0" y1={entryY} x2="600" y2={entryY} stroke="#60a5fa" strokeWidth="2" strokeDasharray="5,5" />
      <text x="10" y={entryY - 5} fill="#60a5fa" fontSize="12" fontWeight="bold">
        ENTRY: {currentPrice.toFixed(symbol.includes('JPY') ? 3 : 5)}
      </text>

      {/* Take Profit Levels */}
      <line x1="0" y1={tp1Y} x2="600" y2={tp1Y} stroke="#10b981" strokeWidth="1.5" strokeDasharray="3,3" />
      <text x="10" y={tp1Y - 5} fill="#10b981" fontSize="11">
        TP1 (1:1): {tp1Price.toFixed(symbol.includes('JPY') ? 3 : 5)} (+${reward1to1})
      </text>

      <line x1="0" y1={tp2Y} x2="600" y2={tp2Y} stroke="#10b981" strokeWidth="1.5" strokeDasharray="3,3" />
      <text x="10" y={tp2Y - 5} fill="#10b981" fontSize="11">
        TP2 (1:2): {tp2Price.toFixed(symbol.includes('JPY') ? 3 : 5)} (+${reward1to2})
      </text>

      <line x1="0" y1={tp3Y} x2="600" y2={tp3Y} stroke="#10b981" strokeWidth="1.5" strokeDasharray="3,3" />
      <text x="10" y={tp3Y - 5} fill="#10b981" fontSize="11">
        TP3 (1:3): {tp3Price.toFixed(symbol.includes('JPY') ? 3 : 5)} (+${reward1to3})
      </text>

      {/* Risk/Reward zones */}
      <rect x="550" y={entryY} width="40" height={slY - entryY} fill="#ef4444" opacity="0.2" />
      <rect x="550" y={tp1Y} width="40" height={entryY - tp1Y} fill="#10b981" opacity="0.15" />
      <rect x="550" y={tp2Y} width="40" height={tp1Y - tp2Y} fill="#10b981" opacity="0.25" />
      <rect x="550" y={tp3Y} width="40" height={tp2Y - tp3Y} fill="#10b981" opacity="0.35" />
    </svg>
  );
};
