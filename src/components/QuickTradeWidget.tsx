import { useState } from 'react';
import { useTick } from '../store/useAppStore';

interface QuickTradeWidgetProps {
  symbol: string;
  volume: number;
  isLoading: boolean;
  onVolumeChange: (volume: number) => void;
  onBuy: () => void;
  onSell: () => void;
  onOpenAdvanced: () => void;
}

const normalizeVolume = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0.01;
  return Math.max(0.01, Math.round(value * 100) / 100);
};

export function QuickTradeWidget({
  symbol,
  volume,
  isLoading,
  onVolumeChange,
  onBuy,
  onSell,
  onOpenAdvanced,
}: QuickTradeWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const tick = useTick(symbol);
  const bid = tick?.bid ?? 0;
  const ask = tick?.ask ?? 0;
  const digits = Number.isFinite(tick?.digits) ? Number(tick?.digits) : 5;
  const spread = bid > 0 && ask > 0 ? ask - bid : 0;
  const canTrade = !isLoading && normalizeVolume(volume) > 0;

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="bg-[#131316]/95 border border-zinc-700 rounded-md shadow-xl backdrop-blur-sm px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-2"
        title="Open Quick Trade"
      >
        <span className="font-semibold">{symbol}</span>
        <span className="text-[10px] uppercase text-zinc-500">Quick Trade</span>
        <svg className="w-3 h-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  return (
    <div className="w-56 bg-[#131316]/95 border border-zinc-700 rounded-md shadow-xl backdrop-blur-sm">
      <div
        className="px-3 py-2 border-b border-zinc-800 cursor-pointer flex justify-between items-center hover:bg-zinc-800/50 transition-colors"
        onClick={() => setIsExpanded(false)}
        title="Close Quick Trade"
      >
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Quick Trade</div>
          <div className="text-sm font-semibold text-zinc-100">{symbol}</div>
        </div>
        <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </div>

      <div className="px-3 py-2 text-xs">
        <div className="flex justify-between mb-1">
          <span className="text-zinc-500">Bid</span>
          <span className="font-mono text-red-400">{bid > 0 ? bid.toFixed(digits) : '-'}</span>
        </div>
        <div className="flex justify-between mb-2">
          <span className="text-zinc-500">Ask</span>
          <span className="font-mono text-blue-400">{ask > 0 ? ask.toFixed(digits) : '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Spread</span>
          <span className="font-mono text-zinc-300">{spread > 0 ? spread.toFixed(digits) : '-'}</span>
        </div>
      </div>

      <div className="px-3 pb-2">
        <label className="text-[11px] text-zinc-500 block mb-1">Volume (lots)</label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={volume}
          onChange={(e) => onVolumeChange(normalizeVolume(parseFloat(e.target.value)))}
          className="w-full bg-[#252525] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500/50"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <button
          onClick={onSell}
          disabled={!canTrade}
          className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded transition-colors"
        >
          SELL
        </button>
        <button
          onClick={onBuy}
          disabled={!canTrade}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded transition-colors"
        >
          BUY
        </button>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={onOpenAdvanced}
          className="w-full bg-zinc-700/40 hover:bg-zinc-700/70 text-zinc-200 text-[11px] py-1.5 rounded transition-colors"
        >
          Advanced Order
        </button>
      </div>
    </div>
  );
}
