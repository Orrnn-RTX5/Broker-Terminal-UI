/**
 * Pip/Margin Calculator Tool
 * MT5-style calculator with 3 tabs: Pip Value, Margin, and Profit/Loss
 */

import { Icon } from './ui/Icon';
import { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Calculator } from 'lucide-react';

interface PipCalculatorProps {
  onClose: () => void;
}

type TabType = 'pip' | 'margin' | 'profit';

const LEVERAGE_PRESETS = [50, 100, 200, 500];
const VOLUME_PRESETS = [0.01, 0.1, 0.5, 1.0, 5.0, 10.0];

// Symbol categories for contract size determination
const SYMBOL_CATEGORIES = {
  forex: { contractSize: 100000, symbols: ['EUR', 'GBP', 'USD', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD'] },
  metals: { contractSize: 100, symbols: ['XAU', 'XAG', 'XPT', 'XPD'] },
  crypto: { contractSize: 1, symbols: ['BTC', 'ETH', 'XRP', 'SOL', 'BNB'] },
  indices: { contractSize: 1, symbols: ['US30', 'NAS100', 'SPX500', 'UK100', 'DE30', 'JP225'] },
  commodities: { contractSize: 1000, symbols: ['WTI', 'BCO', 'NATGAS'] },
};

// Determine symbol category and contract size
function getSymbolInfo(symbol: string): { category: string; contractSize: number; pipSize: number } {
  // Check if JPY pair (different pip size)
  const isJPY = symbol.includes('JPY');

  // Determine category
  for (const [category, { contractSize, symbols }] of Object.entries(SYMBOL_CATEGORIES)) {
    if (symbols.some((s) => symbol.includes(s))) {
      // Special pip sizes
      let pipSize = 0.0001; // Default for forex

      if (category === 'forex') {
        pipSize = isJPY ? 0.01 : 0.0001;
      } else if (category === 'metals') {
        pipSize = symbol.includes('XAU') ? 0.01 : 0.001; // Gold is 0.01, Silver is 0.001
      } else if (category === 'crypto') {
        pipSize = symbol.includes('BTC') ? 1 : 0.01; // BTC = 1, others = 0.01
      } else if (category === 'indices' || category === 'commodities') {
        pipSize = 0.01;
      }

      return { category, contractSize, pipSize };
    }
  }

  // Default to forex
  return { category: 'forex', contractSize: 100000, pipSize: isJPY ? 0.01 : 0.0001 };
}

export default function PipCalculator({ onClose }: PipCalculatorProps) {
  const { ticks, account } = useAppStore();

  const [activeTab, setActiveTab] = useState<TabType>('pip');

  // Pip Value Tab
  const [pipSymbol, setPipSymbol] = useState('EURUSD');
  const [pipVolume, setPipVolume] = useState(1.0);
  const [pipAccountCurrency, setPipAccountCurrency] = useState('USD');

  // Margin Tab
  const [marginSymbol, setMarginSymbol] = useState('EURUSD');
  const [marginVolume, setMarginVolume] = useState(1.0);
  const [leverage, setLeverage] = useState(100);

  // Profit Tab
  const [profitSymbol, setProfitSymbol] = useState('EURUSD');
  const [profitDirection, setProfitDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [profitVolume, setProfitVolume] = useState(1.0);
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');

  // Calculate Pip Value
  const pipValueResult = useMemo(() => {
    const symbolInfo = getSymbolInfo(pipSymbol);
    const tick = ticks[pipSymbol];

    if (!tick) {
      return { pipValue: 0, pipValuePerLot: 0, totalPipValue: 0 };
    }

    // For forex, pip value depends on counter currency
    // For non-forex, use contract size directly
    let pipValuePerLot = 0;

    if (symbolInfo.category === 'forex') {
      // Pip value = (contract size × pip size) / quote currency rate
      // For USD-based pairs (XXXUSD), pip value = contract size × pip size
      // For other pairs, need to convert
      const isDirectQuote = pipSymbol.endsWith('USD');

      if (isDirectQuote) {
        pipValuePerLot = symbolInfo.contractSize * symbolInfo.pipSize;
      } else {
        // Need conversion rate (simplified - use ask price as approximation)
        const conversionRate = tick.ask || 1;
        pipValuePerLot = (symbolInfo.contractSize * symbolInfo.pipSize) / conversionRate;
      }
    } else {
      // For non-forex, pip value = contract size × pip size
      pipValuePerLot = symbolInfo.contractSize * symbolInfo.pipSize;
    }

    const totalPipValue = pipValuePerLot * pipVolume;

    return {
      pipValue: pipValuePerLot,
      pipValuePerLot,
      totalPipValue,
      category: symbolInfo.category,
      contractSize: symbolInfo.contractSize,
      pipSize: symbolInfo.pipSize,
    };
  }, [pipSymbol, pipVolume, ticks]);

  // Calculate Margin
  const marginResult = useMemo(() => {
    const symbolInfo = getSymbolInfo(marginSymbol);
    const tick = ticks[marginSymbol];

    if (!tick) {
      return { margin: 0, marginPerLot: 0 };
    }

    // Margin = (contract size × volume × price) / leverage
    const price = tick.ask || 1;
    const notionalValue = symbolInfo.contractSize * marginVolume * price;
    const margin = notionalValue / leverage;
    const marginPerLot = (symbolInfo.contractSize * price) / leverage;

    return {
      margin,
      marginPerLot,
      notionalValue,
      price,
      contractSize: symbolInfo.contractSize,
    };
  }, [marginSymbol, marginVolume, leverage, ticks]);

  // Calculate Profit/Loss
  const profitResult = useMemo(() => {
    const symbolInfo = getSymbolInfo(profitSymbol);

    const entry = parseFloat(entryPrice);
    const exit = parseFloat(exitPrice);

    if (isNaN(entry) || isNaN(exit)) {
      return { profit: 0, profitPips: 0, profitPerLot: 0 };
    }

    // Calculate price difference
    let priceDiff = 0;
    if (profitDirection === 'BUY') {
      priceDiff = exit - entry; // Profit if exit > entry
    } else {
      priceDiff = entry - exit; // Profit if entry > exit
    }

    // Calculate pips
    const profitPips = priceDiff / symbolInfo.pipSize;

    // Calculate profit in dollars
    // For forex: profit = contract size × volume × price diff
    // For others: profit = contract size × volume × price diff
    const profit = symbolInfo.contractSize * profitVolume * priceDiff;
    const profitPerLot = symbolInfo.contractSize * priceDiff;

    return {
      profit,
      profitPips,
      profitPerLot,
      priceDiff,
      pipSize: symbolInfo.pipSize,
    };
  }, [profitSymbol, profitDirection, profitVolume, entryPrice, exitPrice]);

  // Get all unique symbols from ticks
  const availableSymbols = useMemo(() => {
    const symbols = Object.keys(ticks);
    return symbols.length > 0 ? symbols : ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD'];
  }, [ticks]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-[500px] max-h-[90vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#252525] border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <Calculator size={16} className="text-blue-400" />
            <h3 className="text-sm font-bold text-zinc-200">Trading Calculator</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 transition-colors"
          >
            <Icon name="x-close" size="md" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-700 bg-[#252525]">
          <button
            onClick={() => setActiveTab('pip')}
            className={`flex-1 px-4 py-3 text-xs font-semibold transition-colors ${
              activeTab === 'pip'
                ? 'bg-[#131316] text-blue-400 border-b-2 border-zinc-600'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            Pip Value
          </button>
          <button
            onClick={() => setActiveTab('margin')}
            className={`flex-1 px-4 py-3 text-xs font-semibold transition-colors ${
              activeTab === 'margin'
                ? 'bg-[#131316] text-blue-400 border-b-2 border-zinc-600'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            Margin
          </button>
          <button
            onClick={() => setActiveTab('profit')}
            className={`flex-1 px-4 py-3 text-xs font-semibold transition-colors ${
              activeTab === 'profit'
                ? 'bg-[#131316] text-blue-400 border-b-2 border-zinc-600'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            Profit/Loss
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Pip Value Tab */}
          {activeTab === 'pip' && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-400">
                Calculate the value of a pip movement for a given symbol and volume.
              </p>

              {/* Symbol */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Symbol</label>
                <select
                  value={pipSymbol}
                  onChange={(e) => setPipSymbol(e.target.value)}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                >
                  {availableSymbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </div>

              {/* Volume */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Volume (Lots)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0.01}
                  value={pipVolume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0) setPipVolume(val);
                  }}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                />
                {/* Volume Presets */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {VOLUME_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setPipVolume(preset)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        pipVolume === preset
                          ? 'bg-zinc-700/30 text-zinc-400 border border-zinc-600/50'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Account Currency */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Account Currency</label>
                <select
                  value={pipAccountCurrency}
                  onChange={(e) => setPipAccountCurrency(e.target.value)}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm focus:outline-none focus:border-zinc-600"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="JPY">JPY</option>
                </select>
              </div>

              {/* Results */}
              <div className="bg-[#252525] border border-zinc-700/50 rounded p-4 space-y-3">
                <h4 className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                  <Calculator size={14} className="text-blue-400" />
                  Calculation Results
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Symbol Type:</span>
                    <span className="text-zinc-300 font-medium capitalize">
                      {pipValueResult.category}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Contract Size:</span>
                    <span className="text-zinc-300 font-mono">
                      {pipValueResult.contractSize?.toLocaleString() || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Pip Size:</span>
                    <span className="text-zinc-300 font-mono">
                      {pipValueResult.pipSize?.toFixed(pipValueResult.pipSize >= 0.01 ? 2 : 4) || 'N/A'}
                    </span>
                  </div>
                  <div className="h-px bg-zinc-700 my-2"></div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Pip Value (per lot):</span>
                    <span className="text-blue-400 font-mono font-semibold">
                      ${pipValueResult.pipValuePerLot.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Total Pip Value ({pipVolume} lot{pipVolume !== 1 ? 's' : ''}):</span>
                    <span className="text-blue-400 font-mono font-bold text-base">
                      ${pipValueResult.totalPipValue.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Margin Tab */}
          {activeTab === 'margin' && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-400">
                Calculate the margin required to open a position with given leverage.
              </p>

              {/* Symbol */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Symbol</label>
                <select
                  value={marginSymbol}
                  onChange={(e) => setMarginSymbol(e.target.value)}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                >
                  {availableSymbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </div>

              {/* Volume */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Volume (Lots)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0.01}
                  value={marginVolume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0) setMarginVolume(val);
                  }}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                />
                {/* Volume Presets */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {VOLUME_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setMarginVolume(preset)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        marginVolume === preset
                          ? 'bg-zinc-700/30 text-zinc-400 border border-zinc-600/50'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Leverage */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Leverage</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={leverage}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val > 0) setLeverage(val);
                  }}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                />
                {/* Leverage Presets */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {LEVERAGE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setLeverage(preset)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        leverage === preset
                          ? 'bg-zinc-700/30 text-zinc-400 border border-zinc-600/50'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700'
                      }`}
                    >
                      1:{preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Results */}
              <div className="bg-[#252525] border border-zinc-700/50 rounded p-4 space-y-3">
                <h4 className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                  <Calculator size={14} className="text-blue-400" />
                  Calculation Results
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Current Price:</span>
                    <span className="text-zinc-300 font-mono">
                      {marginResult.price?.toFixed(marginSymbol.includes('JPY') ? 3 : 5) || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Contract Size:</span>
                    <span className="text-zinc-300 font-mono">
                      {marginResult.contractSize?.toLocaleString() || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Notional Value:</span>
                    <span className="text-zinc-300 font-mono">
                      ${marginResult.notionalValue?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || 'N/A'}
                    </span>
                  </div>
                  <div className="h-px bg-zinc-700 my-2"></div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Margin (per lot):</span>
                    <span className="text-blue-400 font-mono font-semibold">
                      ${marginResult.marginPerLot.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Required Margin ({marginVolume} lot{marginVolume !== 1 ? 's' : ''}):</span>
                    <span className="text-blue-400 font-mono font-bold text-base">
                      ${marginResult.margin.toFixed(2)}
                    </span>
                  </div>

                  {account && (
                    <>
                      <div className="h-px bg-zinc-700 my-2"></div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Available Balance:</span>
                        <span className="text-zinc-300 font-mono">
                          ${account.balance.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Margin Usage:</span>
                        <span className={`font-mono font-semibold ${
                          (marginResult.margin / account.balance) > 0.8 ? 'text-rose-400' :
                          (marginResult.margin / account.balance) > 0.5 ? 'text-yellow-400' : 'text-emerald-400'
                        }`}>
                          {((marginResult.margin / account.balance) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Profit/Loss Tab */}
          {activeTab === 'profit' && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-400">
                Calculate profit or loss based on entry and exit prices.
              </p>

              {/* Symbol */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Symbol</label>
                <select
                  value={profitSymbol}
                  onChange={(e) => setProfitSymbol(e.target.value)}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                >
                  {availableSymbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </div>

              {/* Direction */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setProfitDirection('BUY')}
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded transition-colors ${
                      profitDirection === 'BUY'
                        ? 'bg-blue-600 text-white border-2 border-zinc-600'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border-2 border-zinc-700'
                    }`}
                  >
                    <Icon name="trending-up" size="md" />
                    <span className="text-sm font-semibold">BUY</span>
                  </button>
                  <button
                    onClick={() => setProfitDirection('SELL')}
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded transition-colors ${
                      profitDirection === 'SELL'
                        ? 'bg-rose-600 text-white border-2 border-rose-500'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border-2 border-zinc-700'
                    }`}
                  >
                    <Icon name="trending-down" size="md" />
                    <span className="text-sm font-semibold">SELL</span>
                  </button>
                </div>
              </div>

              {/* Volume */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Volume (Lots)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0.01}
                  value={profitVolume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0) setProfitVolume(val);
                  }}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                />
                {/* Volume Presets */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {VOLUME_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setProfitVolume(preset)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        profitVolume === preset
                          ? 'bg-zinc-700/30 text-zinc-400 border border-zinc-600/50'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Entry Price */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Entry Price</label>
                <input
                  type="number"
                  step={profitSymbol.includes('JPY') ? 0.001 : 0.00001}
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                  placeholder="0.00000"
                />
              </div>

              {/* Exit Price */}
              <div>
                <label className="block text-xs text-zinc-400 mb-2">Exit Price</label>
                <input
                  type="number"
                  step={profitSymbol.includes('JPY') ? 0.001 : 0.00001}
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-zinc-300 text-sm font-mono focus:outline-none focus:border-zinc-600"
                  placeholder="0.00000"
                />
              </div>

              {/* Results */}
              <div className="bg-[#252525] border border-zinc-700/50 rounded p-4 space-y-3">
                <h4 className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                  <Calculator size={14} className="text-blue-400" />
                  Calculation Results
                </h4>

                {entryPrice && exitPrice ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Price Difference:</span>
                      <span className={`font-mono ${
                        (profitResult.priceDiff || 0) > 0 ? 'text-emerald-400' :
                        (profitResult.priceDiff || 0) < 0 ? 'text-rose-400' : 'text-zinc-300'
                      }`}>
                        {(profitResult.priceDiff || 0) >= 0 ? '+' : ''}{profitResult.priceDiff?.toFixed(profitSymbol.includes('JPY') ? 3 : 5) || '0'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Movement in Pips:</span>
                      <span className={`font-mono ${
                        profitResult.profitPips > 0 ? 'text-emerald-400' :
                        profitResult.profitPips < 0 ? 'text-rose-400' : 'text-zinc-300'
                      }`}>
                        {profitResult.profitPips >= 0 ? '+' : ''}{profitResult.profitPips.toFixed(1)} pips
                      </span>
                    </div>
                    <div className="h-px bg-zinc-700 my-2"></div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Profit/Loss (per lot):</span>
                      <span className={`font-mono font-semibold ${
                        profitResult.profitPerLot > 0 ? 'text-emerald-400' :
                        profitResult.profitPerLot < 0 ? 'text-rose-400' : 'text-zinc-300'
                      }`}>
                        {profitResult.profitPerLot >= 0 ? '+' : ''}${profitResult.profitPerLot.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Total P/L ({profitVolume} lot{profitVolume !== 1 ? 's' : ''}):</span>
                      <span className={`font-mono font-bold text-base ${
                        profitResult.profit > 0 ? 'text-emerald-400' :
                        profitResult.profit < 0 ? 'text-rose-400' : 'text-zinc-300'
                      }`}>
                        {profitResult.profit >= 0 ? '+' : ''}${profitResult.profit.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-xs text-zinc-500 py-4">
                    Enter entry and exit prices to calculate profit/loss
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#252525] border-t border-zinc-700 text-center">
          <p className="text-[10px] text-zinc-600">
            Calculations are estimates. Actual trading results may vary based on execution, slippage, and spread.
          </p>
        </div>
      </div>
    </div>
  );
}
