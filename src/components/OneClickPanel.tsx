/**
 * One-Click Trading Panel
 * Compact overlay for instant market order execution
 * Shows bid/ask prices with quick buy/sell buttons
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { captureTradeOrderIntent } from '../services/orderLatencyTelemetry';
import { useTradeSettings } from '../store/useSettingsStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { formatSpreadDisplayWithUnit } from '../utils/spread';
import { formatOrderError } from '../utils/orderError';

interface OneClickPanelProps {
  symbol: string;
  currentBid: number;
  currentAsk: number;
  accountId: number;
  onClose: () => void;
  onOrderPlaced?: () => void;
}

const DISCLAIMER_KEY = 'oneClickTradingAccepted';

export function OneClickPanel({
  symbol,
  currentBid,
  currentAsk,
  accountId,
  onClose,
  onOrderPlaced,
}: OneClickPanelProps) {
  const tradeSettings = useTradeSettings();
  const [volume, setVolume] = useState(tradeSettings.defaultVolume);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read/parse preferences during render, never from the latency-critical click
  // callback. A render already occurs whenever this panel's controls change.
  const defaultSlPips = Number.parseFloat(localStorage.getItem('defaultStopLoss') || '0');
  const defaultTpPips = Number.parseFloat(localStorage.getItem('defaultTakeProfit') || '0');

  // Check if user has accepted disclaimer
  useEffect(() => {
    const accepted = localStorage.getItem(DISCLAIMER_KEY);
    if (!accepted) {
      setShowDisclaimer(true);
    }
  }, []);

  const handleAcceptDisclaimer = () => {
    localStorage.setItem(DISCLAIMER_KEY, 'true');
    setShowDisclaimer(false);
  };

  const handleDeclineDisclaimer = () => {
    onClose();
  };

  const incrementVolume = () => {
    setVolume((prev) => {
      const newVol = prev + 0.01;
      return Math.round(newVol * 100) / 100; // Round to 2 decimals
    });
  };

  const decrementVolume = () => {
    setVolume((prev) => {
      const newVol = Math.max(0.01, prev - 0.01);
      return Math.round(newVol * 100) / 100;
    });
  };

  const placeOrder = useCallback(
    async (side: 'BUY' | 'SELL') => {
      if (volume <= 0) return;
      const intentAtMs = captureTradeOrderIntent();
      if (!symbol.trim()) {
        setError('Missing symbol');
        return;
      }
      if (currentBid <= 0 || currentAsk <= 0) {
        setError('Waiting for a valid bid/ask price');
        return;
      }

      try {
        const orderData: any = {
          login: accountId,
          symbol,
          side: side.toLowerCase(),
          volume,
        };

        // Apply default SL/TP if configured
        if (Number.isFinite(defaultSlPips) && defaultSlPips > 0) {
            const pipSize = symbol.includes('JPY') ? 0.01 : 0.0001;
            orderData.sl = side === 'BUY'
              ? currentBid - (defaultSlPips * pipSize)
              : currentAsk + (defaultSlPips * pipSize);
        }

        if (Number.isFinite(defaultTpPips) && defaultTpPips > 0) {
            const pipSize = symbol.includes('JPY') ? 0.01 : 0.0001;
            orderData.tp = side === 'BUY'
              ? currentAsk + (defaultTpPips * pipSize)
              : currentBid - (defaultTpPips * pipSize);
        }

        const orderPromise = api.orders.placeMarketOrder(orderData, { intentAtMs });
        // Start the synchronous WS enqueue before cosmetic React state updates.
        // Do not serialize a deliberate click behind a previous terminal fill:
        // every call owns a separate durable UUID and pending-map entry.
        setError(null);
        await orderPromise;
        // A newer successful fill supersedes an older rejection banner from a
        // concurrently settling click; the rejected order still remains in the
        // Journal with its exact backend error.
        setError(null);

        // Track last traded symbol
        useLastSymbolStore.getState().setLastSymbol(symbol, side);

        // Notify parent
        onOrderPlaced?.();
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
      } catch (err: unknown) {
        console.error('One-click order failed:', err);
        setError(formatOrderError(err));
        setTimeout(() => setError(null), 6000);
      }
    },
    [accountId, symbol, volume, currentBid, currentAsk, defaultSlPips, defaultTpPips, onOrderPlaced]
  );

  const spread = currentAsk - currentBid;
  const spreadDisplay = formatSpreadDisplayWithUnit(symbol, spread, currentBid, currentAsk);

  // Disclaimer modal
  if (showDisclaimer) {
    return (
      <div className="absolute top-16 left-4 z-50 w-80 bg-zinc-900/95 backdrop-blur-sm border border-red-500/30 rounded-lg shadow-2xl p-4">
        <div className="flex items-start gap-3 mb-4">
          <Icon name="alert-triangle" size="sm" className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-red-400 mb-2">One-Click Trading Warning</h3>
            <p className="text-xs text-zinc-300 leading-relaxed">
              One-Click Trading executes orders <span className="font-bold text-red-400">immediately without confirmation</span>.
              Orders will be placed at market price as soon as you click BUY or SELL.
            </p>
            <p className="text-xs text-zinc-400 mt-2">
              This feature is for experienced traders only. Ensure you understand the risks before enabling.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleDeclineDisclaimer}
            className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAcceptDisclaimer}
            className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded transition-colors"
          >
            I Understand, Enable
          </button>
        </div>
      </div>
    );
  }

  // Main panel
  return (
    <div className="absolute top-16 left-4 z-40 w-52 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg shadow-xl pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-bold text-zinc-300">One-Click</span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Close (Ctrl+Shift+T)"
        >
          <Icon name="x-close" size="sm" />
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-3 mt-2 px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 flex items-center gap-1">
          <Icon name="alert-triangle" size="xs" />
          <span>{error}</span>
        </div>
      )}

      {/* Price Display */}
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Symbol:</span>
          <span className="font-mono font-bold text-zinc-200">{symbol}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Spread:</span>
          <span className="font-mono text-zinc-400">{spreadDisplay}</span>
        </div>
      </div>

      {/* Volume Controls */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={decrementVolume}
            disabled={volume <= 0.01}
            className="w-7 h-7 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800/50 disabled:cursor-not-allowed text-zinc-300 rounded transition-colors"
          >
            <Icon name="minus" size="sm" />
          </button>
          <input
            type="number"
            step={0.01}
            min={0.01}
            value={volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 0.01) {
                setVolume(Math.round(val * 100) / 100);
              }
            }}
            className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-center text-xs font-mono text-zinc-200 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <button
            onClick={incrementVolume}
            className="w-7 h-7 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800/50 disabled:cursor-not-allowed text-zinc-300 rounded transition-colors"
          >
            <Icon name="plus" size="sm" />
          </button>
        </div>
        <div className="text-xs text-zinc-500 text-center mt-1">Lots</div>
      </div>

      {/* Order Buttons */}
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        {/* SELL Button */}
        <button
          onClick={() => placeOrder('SELL')}
          disabled={volume <= 0}
          className="flex flex-col items-center justify-center px-2 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 hover:border-red-500/50 disabled:bg-red-600/10 disabled:border-red-500/20 disabled:cursor-not-allowed text-white rounded transition-all group"
        >
          <Icon name="trending-down" size="sm" className="mb-0.5 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-bold">SELL</span>
          <span className="text-xs font-mono mt-0.5 opacity-90">{currentBid.toFixed(5)}</span>
        </button>

        {/* BUY Button */}
        <button
          onClick={() => placeOrder('BUY')}
          disabled={volume <= 0}
          className="flex flex-col items-center justify-center px-2 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-zinc-600/30 hover:border-zinc-600/50 disabled:bg-blue-600/10 disabled:border-zinc-600/20 disabled:cursor-not-allowed text-white rounded transition-all group"
        >
          <Icon name="trending-up" size="sm" className="mb-0.5 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-bold">BUY</span>
          <span className="text-xs font-mono mt-0.5 opacity-90">{currentAsk.toFixed(5)}</span>
        </button>
      </div>

    </div>
  );
}
