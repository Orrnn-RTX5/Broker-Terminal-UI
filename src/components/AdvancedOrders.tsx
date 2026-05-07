import { Icon } from './ui/Icon';
import React, { useState, useMemo } from 'react';
import { useAdvancedOrdersStore } from '../store/useAdvancedOrdersStore';
import { Link, TrendingUp, Calendar, Layers, Split } from 'lucide-react';
type AdvancedOrderTab = 'oco' | 'trailing' | 'timebased' | 'bracket' | 'scaled';

export default function AdvancedOrders() {
  const [activeTab, setActiveTab] = useState<AdvancedOrderTab>('oco');

  const tabs = [
    { id: 'oco' as AdvancedOrderTab, label: 'OCO', icon: Link },
    { id: 'trailing' as AdvancedOrderTab, label: 'Trailing Stop', icon: TrendingUp },
    { id: 'timebased' as AdvancedOrderTab, label: 'Time-based', icon: Calendar },
    { id: 'bracket' as AdvancedOrderTab, label: 'Bracket', icon: Layers },
    { id: 'scaled' as AdvancedOrderTab, label: 'Scaled', icon: Split },
  ];

  return (
    <div className="flex flex-col h-full bg-[#1C1E24] text-[#E4E4E7]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#25272E] border-b border-[#383A42]">
        <h2 className="text-sm font-bold text-[#F5C542]">Advanced Order Types</h2>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-[#383A42] bg-[#1E2026]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 text-xs font-bold transition-none
                ${
                  activeTab === tab.id
                    ? 'bg-[#1C1E24] text-[#F5C542] border-b-2 border-[#F5C542]'
                    : 'text-[#888] hover:bg-[#25272E] hover:text-[#CCC]'
                }
              `}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'oco' && <OCOOrderTab />}
        {activeTab === 'trailing' && <TrailingStopTab />}
        {activeTab === 'timebased' && <TimeBasedTab />}
        {activeTab === 'bracket' && <BracketOrderTab />}
        {activeTab === 'scaled' && <ScaledOrderTab />}
      </div>
    </div>
  );
}

// ============================================================================
// OCO (One-Cancels-Other) Order Tab
// ============================================================================
function OCOOrderTab() {
  const { ocoOrder, setOCOOrder, submitOCOOrder } = useAdvancedOrdersStore();

  return (
    <div className="space-y-4">
      <div className="text-xs text-[#888] mb-4">
        Place two linked orders where filling one automatically cancels the other.
      </div>

      {/* Symbol & Volume */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Symbol</label>
          <input
            type="text"
            value={ocoOrder.symbol}
            onChange={(e) => setOCOOrder({ symbol: e.target.value })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Volume (lots)</label>
          <input
            type="number"
            value={ocoOrder.volume}
            onChange={(e) => setOCOOrder({ volume: parseFloat(e.target.value) })}
            step="0.01"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Two Orders Side by Side */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
        {/* Order 1 */}
        <div className="bg-[#25272E] border border-[#383A42] rounded p-3 space-y-2">
          <div className="text-xs font-bold text-[#F5C542] mb-2">Order 1</div>
          <div>
            <label className="text-xs text-[#888] mb-1 block">Type</label>
            <select
              value={ocoOrder.order1.type}
              onChange={(e) =>
                setOCOOrder({
                  order1: { ...ocoOrder.order1, type: e.target.value as any },
                })
              }
              className="w-full bg-[#1C1E24] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
            >
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="STOP">Stop</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#888] mb-1 block">Side</label>
            <select
              value={ocoOrder.order1.side}
              onChange={(e) =>
                setOCOOrder({
                  order1: { ...ocoOrder.order1, side: e.target.value as any },
                })
              }
              className="w-full bg-[#1C1E24] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
            >
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#888] mb-1 block">Price</label>
            <input
              type="number"
              value={ocoOrder.order1.price}
              onChange={(e) =>
                setOCOOrder({
                  order1: { ...ocoOrder.order1, price: parseFloat(e.target.value) },
                })
              }
              step="0.0001"
              className="w-full bg-[#1C1E24] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
            />
          </div>
        </div>

        {/* Link Icon */}
        <div className="flex items-center justify-center">
          <Icon name="move-up-right" size="lg" className="text-[#F5C542]" />
        </div>

        {/* Order 2 */}
        <div className="bg-[#25272E] border border-[#383A42] rounded p-3 space-y-2">
          <div className="text-xs font-bold text-[#F5C542] mb-2">Order 2</div>
          <div>
            <label className="text-xs text-[#888] mb-1 block">Type</label>
            <select
              value={ocoOrder.order2.type}
              onChange={(e) =>
                setOCOOrder({
                  order2: { ...ocoOrder.order2, type: e.target.value as any },
                })
              }
              className="w-full bg-[#1C1E24] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
            >
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="STOP">Stop</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#888] mb-1 block">Side</label>
            <select
              value={ocoOrder.order2.side}
              onChange={(e) =>
                setOCOOrder({
                  order2: { ...ocoOrder.order2, side: e.target.value as any },
                })
              }
              className="w-full bg-[#1C1E24] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
            >
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#888] mb-1 block">Price</label>
            <input
              type="number"
              value={ocoOrder.order2.price}
              onChange={(e) =>
                setOCOOrder({
                  order2: { ...ocoOrder.order2, price: parseFloat(e.target.value) },
                })
              }
              step="0.0001"
              className="w-full bg-[#1C1E24] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
            />
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-3">
        <div className="text-xs font-bold text-[#F5C542] mb-2">Order Preview</div>
        <div className="text-xs text-[#888] space-y-1">
          <div>
            Symbol: <span className="text-[#E4E4E7]">{ocoOrder.symbol}</span> | Volume:{' '}
            <span className="text-[#E4E4E7]">{ocoOrder.volume} lots</span>
          </div>
          <div>
            Order 1: <span className="text-[#10b981]">{ocoOrder.order1.side}</span>{' '}
            {ocoOrder.order1.type} @ {ocoOrder.order1.price}
          </div>
          <div>
            Order 2: <span className="text-[#ef4444]">{ocoOrder.order2.side}</span>{' '}
            {ocoOrder.order2.type} @ {ocoOrder.order2.price}
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={submitOCOOrder}
        className="w-full bg-[#8a8a8f] hover:bg-[#2563EB] text-white font-bold py-2 px-4 rounded text-xs transition-colors"
      >
        Submit OCO Order
      </button>
    </div>
  );
}

// ============================================================================
// Trailing Stop Order Tab
// ============================================================================
function TrailingStopTab() {
  const { trailingStopOrder, setTrailingStopOrder, submitTrailingStopOrder } =
    useAdvancedOrdersStore();

  // Mock current price for diagram
  const currentPrice = 1.1020;
  const trailingStopPrice =
    currentPrice - (trailingStopOrder.trailingDistance / 10000) * (trailingStopOrder.side === 'BUY' ? 1 : -1);

  return (
    <div className="space-y-4">
      <div className="text-xs text-[#888] mb-4">
        Stop loss that automatically follows the market price by a fixed distance.
      </div>

      {/* Symbol & Volume */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Symbol</label>
          <input
            type="text"
            value={trailingStopOrder.symbol}
            onChange={(e) => setTrailingStopOrder({ symbol: e.target.value })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Volume (lots)</label>
          <input
            type="number"
            value={trailingStopOrder.volume}
            onChange={(e) => setTrailingStopOrder({ volume: parseFloat(e.target.value) })}
            step="0.01"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Side & Trailing Distance */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Side</label>
          <select
            value={trailingStopOrder.side}
            onChange={(e) => setTrailingStopOrder({ side: e.target.value as any })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          >
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Trailing Distance (pips)</label>
          <input
            type="number"
            value={trailingStopOrder.trailingDistance}
            onChange={(e) => setTrailingStopOrder({ trailingDistance: parseInt(e.target.value) })}
            step="1"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Visual Diagram */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-4">
        <div className="text-xs font-bold text-[#F5C542] mb-3">Trailing Stop Visualization</div>
        <div className="relative h-32">
          <svg className="w-full h-full">
            {/* Current Price Line */}
            <line x1="20" y1="40" x2="280" y2="40" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
            <text x="290" y="45" fill="#10b981" fontSize="11">
              Current: {currentPrice.toFixed(4)}
            </text>

            {/* Trailing Stop Line */}
            <line x1="20" y1="80" x2="280" y2="80" stroke="#ef4444" strokeWidth="2" />
            <text x="290" y="85" fill="#ef4444" fontSize="11">
              Stop: {trailingStopPrice.toFixed(4)}
            </text>

            {/* Distance Arrow */}
            <line x1="30" y1="40" x2="30" y2="80" stroke="#F5C542" strokeWidth="1.5" />
            <polygon points="30,40 27,46 33,46" fill="#F5C542" />
            <polygon points="30,80 27,74 33,74" fill="#F5C542" />
            <text x="35" y="63" fill="#F5C542" fontSize="10">
              {trailingStopOrder.trailingDistance} pips
            </text>

            {/* Price Movement Path */}
            <polyline
              points="20,60 80,50 140,35 200,40 260,38"
              fill="none"
              stroke="#888"
              strokeWidth="1"
              opacity="0.5"
            />
          </svg>
        </div>
        <div className="text-xs text-[#888] mt-2">
          As price moves favorably, the stop loss follows at {trailingStopOrder.trailingDistance} pips distance. If
          price reverses, the stop remains at its highest/lowest level.
        </div>
      </div>

      {/* Preview */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-3">
        <div className="text-xs font-bold text-[#F5C542] mb-2">Order Preview</div>
        <div className="text-xs text-[#888] space-y-1">
          <div>
            Symbol: <span className="text-[#E4E4E7]">{trailingStopOrder.symbol}</span> | Volume:{' '}
            <span className="text-[#E4E4E7]">{trailingStopOrder.volume} lots</span>
          </div>
          <div>
            Side: <span className="text-[#10b981]">{trailingStopOrder.side}</span>
          </div>
          <div>
            Trailing Distance: <span className="text-[#E4E4E7]">{trailingStopOrder.trailingDistance} pips</span>
          </div>
          <div>
            Current Stop Level: <span className="text-[#ef4444]">{trailingStopPrice.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={submitTrailingStopOrder}
        className="w-full bg-[#8a8a8f] hover:bg-[#2563EB] text-white font-bold py-2 px-4 rounded text-xs transition-colors"
      >
        Submit Trailing Stop Order
      </button>
    </div>
  );
}

// ============================================================================
// Time-based Order Tab
// ============================================================================
function TimeBasedTab() {
  const { timeBasedOrder, setTimeBasedOrder, submitTimeBasedOrder } = useAdvancedOrdersStore();

  return (
    <div className="space-y-4">
      <div className="text-xs text-[#888] mb-4">
        Control order validity with time-based execution constraints.
      </div>

      {/* Symbol & Volume */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Symbol</label>
          <input
            type="text"
            value={timeBasedOrder.symbol}
            onChange={(e) => setTimeBasedOrder({ symbol: e.target.value })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Volume (lots)</label>
          <input
            type="number"
            value={timeBasedOrder.volume}
            onChange={(e) => setTimeBasedOrder({ volume: parseFloat(e.target.value) })}
            step="0.01"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Type, Side, Price */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Type</label>
          <select
            value={timeBasedOrder.type}
            onChange={(e) => setTimeBasedOrder({ type: e.target.value as any })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          >
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
            <option value="STOP">Stop</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Side</label>
          <select
            value={timeBasedOrder.side}
            onChange={(e) => setTimeBasedOrder({ side: e.target.value as any })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          >
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Price</label>
          <input
            type="number"
            value={timeBasedOrder.price || ''}
            onChange={(e) => setTimeBasedOrder({ price: parseFloat(e.target.value) })}
            step="0.0001"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Time In Force Radio Buttons */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-3">
        <div className="text-xs font-bold text-[#F5C542] mb-3">Time In Force</div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="tif"
              checked={timeBasedOrder.timeInForce === 'GTC'}
              onChange={() => setTimeBasedOrder({ timeInForce: 'GTC' })}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs text-[#E4E4E7] font-bold">GTC - Good Till Cancel</div>
              <div className="text-xs text-[#888]">Order remains active until manually cancelled</div>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="tif"
              checked={timeBasedOrder.timeInForce === 'GTD'}
              onChange={() => setTimeBasedOrder({ timeInForce: 'GTD' })}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs text-[#E4E4E7] font-bold">GTD - Good Till Date</div>
              <div className="text-xs text-[#888]">Order expires on a specific date/time</div>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="tif"
              checked={timeBasedOrder.timeInForce === 'IOC'}
              onChange={() => setTimeBasedOrder({ timeInForce: 'IOC' })}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs text-[#E4E4E7] font-bold">IOC - Immediate or Cancel</div>
              <div className="text-xs text-[#888]">Fill immediately, cancel any unfilled portion</div>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="tif"
              checked={timeBasedOrder.timeInForce === 'FOK'}
              onChange={() => setTimeBasedOrder({ timeInForce: 'FOK' })}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs text-[#E4E4E7] font-bold">FOK - Fill or Kill</div>
              <div className="text-xs text-[#888]">Fill entire order immediately or cancel completely</div>
            </div>
          </label>
        </div>

        {/* GTD Date Picker */}
        {timeBasedOrder.timeInForce === 'GTD' && (
          <div className="mt-3">
            <label className="text-xs text-[#888] mb-1 block">Expiry Date & Time</label>
            <input
              type="datetime-local"
              value={timeBasedOrder.expiryDate || ''}
              onChange={(e) => setTimeBasedOrder({ expiryDate: e.target.value })}
              className="w-full bg-[#1C1E24] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
            />
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-3">
        <div className="text-xs font-bold text-[#F5C542] mb-2">Order Preview</div>
        <div className="text-xs text-[#888] space-y-1">
          <div>
            Symbol: <span className="text-[#E4E4E7]">{timeBasedOrder.symbol}</span> | Volume:{' '}
            <span className="text-[#E4E4E7]">{timeBasedOrder.volume} lots</span>
          </div>
          <div>
            {timeBasedOrder.side} {timeBasedOrder.type}{' '}
            {timeBasedOrder.price && `@ ${timeBasedOrder.price.toFixed(4)}`}
          </div>
          <div>
            Time In Force: <span className="text-[#E4E4E7]">{timeBasedOrder.timeInForce}</span>
          </div>
          {timeBasedOrder.timeInForce === 'GTD' && timeBasedOrder.expiryDate && (
            <div>
              Expires: <span className="text-[#E4E4E7]">{new Date(timeBasedOrder.expiryDate).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={submitTimeBasedOrder}
        className="w-full bg-[#8a8a8f] hover:bg-[#2563EB] text-white font-bold py-2 px-4 rounded text-xs transition-colors"
      >
        Submit Time-based Order
      </button>
    </div>
  );
}

// ============================================================================
// Bracket Order Tab
// ============================================================================
function BracketOrderTab() {
  const { bracketOrder, setBracketOrder, submitBracketOrder } = useAdvancedOrdersStore();

  // Calculate pip distances for display
  const tpDistance = Math.abs(bracketOrder.takeProfitPrice - bracketOrder.entryPrice) * 10000;
  const slDistance = Math.abs(bracketOrder.entryPrice - bracketOrder.stopLossPrice) * 10000;
  const riskRewardRatio = (tpDistance / slDistance).toFixed(2);

  return (
    <div className="space-y-4">
      <div className="text-xs text-[#888] mb-4">
        Create an entry order with automatic take profit and stop loss levels in one package.
      </div>

      {/* Symbol & Volume */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Symbol</label>
          <input
            type="text"
            value={bracketOrder.symbol}
            onChange={(e) => setBracketOrder({ symbol: e.target.value })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Volume (lots)</label>
          <input
            type="number"
            value={bracketOrder.volume}
            onChange={(e) => setBracketOrder({ volume: parseFloat(e.target.value) })}
            step="0.01"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Side */}
      <div>
        <label className="text-xs text-[#888] mb-1 block">Side</label>
        <select
          value={bracketOrder.side}
          onChange={(e) => setBracketOrder({ side: e.target.value as any })}
          className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
        >
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </select>
      </div>

      {/* Price Ladder Inputs */}
      <div className="space-y-2">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Take Profit Price</label>
          <input
            type="number"
            value={bracketOrder.takeProfitPrice}
            onChange={(e) => setBracketOrder({ takeProfitPrice: parseFloat(e.target.value) })}
            step="0.0001"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#10b981] font-bold"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Entry Price</label>
          <input
            type="number"
            value={bracketOrder.entryPrice}
            onChange={(e) => setBracketOrder({ entryPrice: parseFloat(e.target.value) })}
            step="0.0001"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#F5C542] font-bold"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Stop Loss Price</label>
          <input
            type="number"
            value={bracketOrder.stopLossPrice}
            onChange={(e) => setBracketOrder({ stopLossPrice: parseFloat(e.target.value) })}
            step="0.0001"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#ef4444] font-bold"
          />
        </div>
      </div>

      {/* Visual Price Ladder */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-4">
        <div className="text-xs font-bold text-[#F5C542] mb-3">Price Ladder Visualization</div>
        <div className="flex flex-col gap-2">
          {/* Take Profit */}
          <div className="flex items-center gap-2 bg-[#10b981] bg-opacity-20 border border-[#10b981] rounded p-2">
            <Icon name="trending-up" size="md" className="text-[#10b981]" />
            <div className="flex-1 text-xs">
              <div className="font-bold text-[#10b981]">Take Profit</div>
              <div className="text-[#888]">{bracketOrder.takeProfitPrice.toFixed(4)}</div>
            </div>
            <div className="text-xs text-[#10b981]">+{tpDistance.toFixed(1)} pips</div>
          </div>

          {/* Entry */}
          <div className="flex items-center gap-2 bg-[#F5C542] bg-opacity-20 border border-[#F5C542] rounded p-2">
            <Icon name="layers" size="md" className="text-[#F5C542]" />
            <div className="flex-1 text-xs">
              <div className="font-bold text-[#F5C542]">Entry</div>
              <div className="text-[#888]">{bracketOrder.entryPrice.toFixed(4)}</div>
            </div>
            <div className="text-xs text-[#888]">R:R {riskRewardRatio}</div>
          </div>

          {/* Stop Loss */}
          <div className="flex items-center gap-2 bg-[#ef4444] bg-opacity-20 border border-[#ef4444] rounded p-2">
            <Icon name="trending-down" size="md" className="text-[#ef4444]" />
            <div className="flex-1 text-xs">
              <div className="font-bold text-[#ef4444]">Stop Loss</div>
              <div className="text-[#888]">{bracketOrder.stopLossPrice.toFixed(4)}</div>
            </div>
            <div className="text-xs text-[#ef4444]">-{slDistance.toFixed(1)} pips</div>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-3">
        <div className="text-xs font-bold text-[#F5C542] mb-2">Order Preview</div>
        <div className="text-xs text-[#888] space-y-1">
          <div>
            Symbol: <span className="text-[#E4E4E7]">{bracketOrder.symbol}</span> | Volume:{' '}
            <span className="text-[#E4E4E7]">{bracketOrder.volume} lots</span>
          </div>
          <div>
            Side: <span className="text-[#10b981]">{bracketOrder.side}</span> @ {bracketOrder.entryPrice.toFixed(4)}
          </div>
          <div>
            Take Profit: <span className="text-[#10b981]">{bracketOrder.takeProfitPrice.toFixed(4)}</span> (+
            {tpDistance.toFixed(1)} pips)
          </div>
          <div>
            Stop Loss: <span className="text-[#ef4444]">{bracketOrder.stopLossPrice.toFixed(4)}</span> (-
            {slDistance.toFixed(1)} pips)
          </div>
          <div>
            Risk:Reward Ratio: <span className="text-[#E4E4E7]">{riskRewardRatio}</span>
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={submitBracketOrder}
        className="w-full bg-[#8a8a8f] hover:bg-[#2563EB] text-white font-bold py-2 px-4 rounded text-xs transition-colors"
      >
        Submit Bracket Order
      </button>
    </div>
  );
}

// ============================================================================
// Scaled Order Tab
// ============================================================================
function ScaledOrderTab() {
  const { scaledOrder, setScaledOrder, submitScaledOrder, calculateScaledOrderPreview } = useAdvancedOrdersStore();

  const preview = useMemo(() => calculateScaledOrderPreview(), [scaledOrder]);

  return (
    <div className="space-y-4">
      <div className="text-xs text-[#888] mb-4">
        Split a large order into multiple smaller orders at incremental price levels to reduce market impact.
      </div>

      {/* Symbol & Total Volume */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Symbol</label>
          <input
            type="text"
            value={scaledOrder.symbol}
            onChange={(e) => setScaledOrder({ symbol: e.target.value })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Total Volume (lots)</label>
          <input
            type="number"
            value={scaledOrder.totalVolume}
            onChange={(e) => setScaledOrder({ totalVolume: parseFloat(e.target.value) })}
            step="0.1"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Side & Number of Orders */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Side</label>
          <select
            value={scaledOrder.side}
            onChange={(e) => setScaledOrder({ side: e.target.value as any })}
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          >
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Number of Orders</label>
          <input
            type="number"
            value={scaledOrder.numberOfOrders}
            onChange={(e) => setScaledOrder({ numberOfOrders: parseInt(e.target.value) })}
            min="2"
            max="20"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Price Range */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-[#888] mb-1 block">Start Price</label>
          <input
            type="number"
            value={scaledOrder.startPrice}
            onChange={(e) => setScaledOrder({ startPrice: parseFloat(e.target.value) })}
            step="0.0001"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">End Price</label>
          <input
            type="number"
            value={scaledOrder.endPrice}
            onChange={(e) => setScaledOrder({ endPrice: parseFloat(e.target.value) })}
            step="0.0001"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] mb-1 block">Price Increment</label>
          <input
            type="number"
            value={scaledOrder.priceIncrement}
            onChange={(e) => setScaledOrder({ priceIncrement: parseFloat(e.target.value) })}
            step="0.0001"
            className="w-full bg-[#25272E] border border-[#383A42] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
          />
        </div>
      </div>

      {/* Preview Table */}
      <div className="bg-[#25272E] border border-[#383A42] rounded overflow-hidden">
        <div className="px-3 py-2 bg-[#1C1E24] border-b border-[#383A42]">
          <div className="text-xs font-bold text-[#F5C542]">Order Preview ({preview.length} orders)</div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#1C1E24] sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 text-[#888] font-bold">#</th>
                <th className="text-right px-3 py-2 text-[#888] font-bold">Price</th>
                <th className="text-right px-3 py-2 text-[#888] font-bold">Volume</th>
                <th className="text-right px-3 py-2 text-[#888] font-bold">Side</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((order) => (
                <tr
                  key={order.orderNumber}
                  className="border-t border-[#383A42] hover:bg-[#1C1E24] transition-colors"
                >
                  <td className="px-3 py-2 text-[#888]">{order.orderNumber}</td>
                  <td className="px-3 py-2 text-right text-[#E4E4E7]">{order.price.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right text-[#E4E4E7]">{order.volume.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={scaledOrder.side === 'BUY' ? 'text-[#10b981]' : 'text-[#ef4444]'}>
                      {scaledOrder.side}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-[#25272E] border border-[#383A42] rounded p-3">
        <div className="text-xs font-bold text-[#F5C542] mb-2">Order Summary</div>
        <div className="text-xs text-[#888] space-y-1">
          <div>
            Symbol: <span className="text-[#E4E4E7]">{scaledOrder.symbol}</span>
          </div>
          <div>
            Total Volume: <span className="text-[#E4E4E7]">{scaledOrder.totalVolume} lots</span> split into{' '}
            <span className="text-[#E4E4E7]">{scaledOrder.numberOfOrders} orders</span>
          </div>
          <div>
            Price Range: <span className="text-[#E4E4E7]">{scaledOrder.startPrice.toFixed(4)}</span> to{' '}
            <span className="text-[#E4E4E7]">{scaledOrder.endPrice.toFixed(4)}</span>
          </div>
          <div>
            Volume per order:{' '}
            <span className="text-[#E4E4E7]">
              {(scaledOrder.totalVolume / scaledOrder.numberOfOrders).toFixed(2)} lots
            </span>
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={submitScaledOrder}
        className="w-full bg-[#8a8a8f] hover:bg-[#2563EB] text-white font-bold py-2 px-4 rounded text-xs transition-colors"
      >
        Submit Scaled Order ({preview.length} orders)
      </button>
    </div>
  );
}
