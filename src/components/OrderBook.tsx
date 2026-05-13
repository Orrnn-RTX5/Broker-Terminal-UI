/**
 * Live Order Book Component
 * Displays real-time bid/ask depth with aggregation levels
 */

import { Icon } from './ui/Icon';
import { useState, useMemo } from 'react';
import { formatPrice as formatPriceUtil } from '../utils/symbolUtils';
import { useLiveOrderBook } from '../hooks/useLiveMarketData';

type OrderBookProps = {
  symbol: string;
  currentBid?: number;
  currentAsk?: number;
};

export const OrderBook = ({ symbol, currentBid = 0, currentAsk = 0 }: OrderBookProps) => {
  const [depth, setDepth] = useState<10 | 20 | 50>(20);
  const { orderBook, loading, error } = useLiveOrderBook(symbol, depth);

  // Calculate max volume for bar chart sizing
  const maxVolume = useMemo(() => {
    if (!orderBook) return 0;
    const allVolumes = [...orderBook.bids, ...orderBook.asks].map((entry) => entry.volume);
    return Math.max(...allVolumes, 0);
  }, [orderBook]);

  const formatPrice = (price: number) => {
    return formatPriceUtil(price, symbol);
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1000) {
      return `${(volume / 1000).toFixed(1)}K`;
    }
    return volume.toFixed(2);
  };

  if (loading && !orderBook) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        <Icon name="layers" size="sm" className="w-6 h-6 animate-pulse" />
        <span className="ml-2">Loading order book...</span>
      </div>
    );
  }

  if (!orderBook) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2 px-4 text-center">
        <Icon name="layers" size="sm" className="w-6 h-6" />
        <p>{error || 'No order book data available'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Order Book</h3>
          <p className="text-xs text-zinc-500">{symbol}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Depth:</span>
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value) as 10 | 20 | 50)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:outline-none focus:border-emerald-500"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>

      {/* Spread Info */}
      <div className="flex items-center justify-between p-2 bg-zinc-800/50 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">Spread:</span>
          <span className="font-mono text-zinc-300">{formatPrice(orderBook.spread)}</span>
          <span className="text-zinc-500">({orderBook.spreadPips.toFixed(1)} pips)</span>
        </div>
        <div className="text-zinc-500">
          {new Date(orderBook.timestamp).toLocaleTimeString()}
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b border-zinc-800 text-xs text-zinc-500 font-medium">
        <div className="text-left">Price</div>
        <div className="text-right">Volume</div>
        <div className="text-right">Total</div>
      </div>

      {/* Order Book Content */}
      <div className="flex-1 overflow-auto">
        {/* Asks (Sell Orders) - Reversed to show highest first */}
        <div className="border-b-2 border-red-500/20">
          {[...orderBook.asks].reverse().map((ask, index) => (
            <OrderBookRow
              key={`ask-${index}`}
              price={ask.price}
              volume={ask.volume}
              total={ask.total}
              maxVolume={maxVolume}
              side="ask"
              formatPrice={formatPrice}
              formatVolume={formatVolume}
            />
          ))}
        </div>

        {/* Current Market Price */}
        <div className="sticky top-0 z-10 bg-zinc-900 border-y border-zinc-700">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <Icon name="trending-down" size="sm" className="w-4 h-4 text-red-400" />
              <span className="text-sm font-mono font-bold text-red-400">
                {formatPrice(currentBid)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold text-emerald-400">
                {formatPrice(currentAsk)}
              </span>
              <Icon name="trending-up" size="sm" className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
        </div>

        {/* Bids (Buy Orders) */}
        <div className="border-t-2 border-emerald-500/20">
          {orderBook.bids.map((bid, index) => (
            <OrderBookRow
              key={`bid-${index}`}
              price={bid.price}
              volume={bid.volume}
              total={bid.total}
              maxVolume={maxVolume}
              side="bid"
              formatPrice={formatPrice}
              formatVolume={formatVolume}
            />
          ))}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="flex items-center justify-between p-3 border-t border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span className="text-zinc-500">Bid Total:</span>
            <span className="font-mono text-emerald-400">
              {formatVolume(orderBook.bids.reduce((sum, b) => sum + b.volume, 0))}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <span className="text-zinc-500">Ask Total:</span>
            <span className="font-mono text-red-400">
              {formatVolume(orderBook.asks.reduce((sum, a) => sum + a.volume, 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

type OrderBookRowProps = {
  price: number;
  volume: number;
  total: number;
  maxVolume: number;
  side: 'bid' | 'ask';
  formatPrice: (price: number) => string;
  formatVolume: (volume: number) => string;
};

const OrderBookRow = ({
  price,
  volume,
  total,
  maxVolume,
  side,
  formatPrice,
  formatVolume,
}: OrderBookRowProps) => {
  const percentage = maxVolume > 0 ? (volume / maxVolume) * 100 : 0;
  const bgColor = side === 'bid' ? 'bg-emerald-500/10' : 'bg-red-500/10';
  const textColor = side === 'bid' ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="relative group hover:bg-zinc-800/50 transition-colors">
      {/* Volume bar background */}
      <div
        className={`absolute right-0 top-0 h-full ${bgColor} transition-all duration-300`}
        style={{ width: `${percentage}%` }}
      />

      {/* Content */}
      <div className="relative grid grid-cols-3 gap-2 px-3 py-1.5 text-xs">
        <div className={`font-mono ${textColor}`}>{formatPrice(price)}</div>
        <div className="text-right font-mono text-zinc-300">{formatVolume(volume)}</div>
        <div className="text-right font-mono text-zinc-500">{formatVolume(total)}</div>
      </div>
    </div>
  );
};
