/**
 * Symbol Info / Contract Specifications Panel
 * MT5-style detailed symbol information dialog
 * Opens from MarketWatch context menu
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
import { buildApiUrl } from '../config/api';
import { useMarketDataStore } from '../store/useMarketDataStore';
import type { SymbolSpecification } from '../types/trading';

interface SymbolInfoProps {
  symbol: string;
  isOpen: boolean;
  onClose: () => void;
}

// Derive symbol type from symbol name
function getSymbolType(symbol: string): 'Forex' | 'Crypto' | 'Commodity' | 'Index' | 'Stock' {
  const symbolUpper = symbol.toUpperCase();

  // Crypto
  if (symbolUpper.includes('BTC') || symbolUpper.includes('ETH') ||
      symbolUpper.includes('XRP') || symbolUpper.includes('SOL') ||
      symbolUpper.includes('BNB')) {
    return 'Crypto';
  }

  // Commodities (precious metals, energy)
  if (symbolUpper.startsWith('XAU') || symbolUpper.startsWith('XAG') ||
      symbolUpper.startsWith('XPT') || symbolUpper.startsWith('XPD') ||
      symbolUpper.includes('OIL') || symbolUpper.includes('BRENT') ||
      symbolUpper.includes('WTI') || symbolUpper.includes('NATGAS')) {
    return 'Commodity';
  }

  // Indices
  if (symbolUpper.includes('SPX') || symbolUpper.includes('NAS') ||
      symbolUpper.includes('DOW') || symbolUpper.includes('DAX') ||
      symbolUpper.includes('FTSE') || symbolUpper.includes('NIKKEI') ||
      symbolUpper.includes('US30') || symbolUpper.includes('US500') ||
      symbolUpper.includes('NAS100') || symbolUpper.includes('JP225')) {
    return 'Index';
  }

  // Default to Forex for currency pairs
  return 'Forex';
}

// Get trading hours based on symbol type
function getTradingHours(symbolType: 'Forex' | 'Crypto' | 'Commodity' | 'Index' | 'Stock'): string {
  switch (symbolType) {
    case 'Crypto':
      return '24/7 (No breaks)';
    case 'Forex':
      return 'Mon 00:00 - Fri 23:59 (24/5)';
    case 'Commodity':
      return 'Mon 01:00 - Fri 23:00 (Variable)';
    case 'Index':
      return 'Mon 00:00 - Fri 22:00 (Variable)';
    case 'Stock':
      return 'Mon 09:30 - Fri 16:00 (Market hours)';
    default:
      return '24/5';
  }
}

export const SymbolInfo = ({ symbol, isOpen, onClose }: SymbolInfoProps) => {
  const [spec, setSpec] = useState<SymbolSpecification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get current tick for spread calculation
  const getCurrentTick = useMarketDataStore((state) => state.getCurrentTick);
  const currentTick = getCurrentTick(symbol);

  useEffect(() => {
    if (!isOpen || !symbol) return;

    const fetchSymbolSpec = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch symbol specification from backend
        const response = await fetch(buildApiUrl(`/api/symbols/${symbol}/specification`));

        if (!response.ok) {
          throw new Error(`Failed to fetch symbol specification: ${response.statusText}`);
        }

        const data: SymbolSpecification = await response.json();
        setSpec(data);
      } catch (err) {
        console.error('Error fetching symbol specification:', err);
        setError(err instanceof Error ? err.message : 'Failed to load symbol data');

        // Fallback to mock data for development
        setSpec({
          symbol: symbol,
          description: `${symbol} - Contract For Difference`,
          contractSize: 100000,
          pipValue: 10,
          pipPosition: 5,
          minLot: 0.01,
          maxLot: 100,
          lotStep: 0.01,
          marginRate: 0.01,
          swapLong: -2.5,
          swapShort: 0.5,
          commission: 0,
          currency: 'USD',
          baseCurrency: symbol.substring(0, 3),
          quoteCurrency: symbol.substring(3, 6),
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSymbolSpec();
  }, [symbol, isOpen]);

  if (!isOpen) return null;

  const symbolType = getSymbolType(symbol);
  const tradingHours = getTradingHours(symbolType);
  const currentSpread = currentTick ? (currentTick.ask - currentTick.bid) : 0;
  const spreadPips = currentSpread * Math.pow(10, spec?.pipPosition || 5);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#131316] border border-zinc-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-[#252525]">
          <div className="flex items-center gap-3">
            <Icon name="info" size="sm" className="w-5 h-5 text-blue-500" />
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">{symbol}</h2>
              <p className="text-xs text-zinc-500">Contract Specifications</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-700 rounded transition-colors"
            title="Close"
          >
            <Icon name="x-close" size="sm" className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm text-zinc-500">Loading symbol data...</p>
              </div>
            </div>
          )}

          {error && !spec && (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3 text-center max-w-md">
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Icon name="x-close" size="sm" className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-sm text-zinc-300">{error}</p>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {spec && (
            <div className="space-y-6">
              {/* General Information Section */}
              <Section icon={<Icon name="info" size="sm" className="w-4 h-4" />} title="General Information">
                <SpecRow label="Symbol" value={spec.symbol} />
                <SpecRow label="Description" value={spec.description} />
                <SpecRow label="Type" value={symbolType} badge />
                <SpecRow label="Currency" value={spec.currency} />
                <SpecRow label="Base Currency" value={spec.baseCurrency} />
                <SpecRow label="Quote Currency" value={spec.quoteCurrency} />
              </Section>

              {/* Trading Conditions Section */}
              <Section icon={<Icon name="trending-up" size="sm" className="w-4 h-4" />} title="Trading Conditions">
                <SpecRow label="Contract Size" value={spec.contractSize.toLocaleString()} />
                <SpecRow
                  label="Digits (Precision)"
                  value={spec.pipPosition.toString()}
                  hint={`Price shown with ${spec.pipPosition} decimal places`}
                />
                <SpecRow
                  label="Spread (Current)"
                  value={`${spreadPips.toFixed(1)} pips`}
                  valueColor={currentTick ? 'text-emerald-400' : 'text-zinc-500'}
                  hint={currentTick ? `Bid: ${currentTick.bid.toFixed(spec.pipPosition)} / Ask: ${currentTick.ask.toFixed(spec.pipPosition)}` : 'No market data'}
                />
                <SpecRow label="Pip Value" value={`$${spec.pipValue}`} />
              </Section>

              {/* Volume & Margin Section */}
              <Section icon={<Icon name="credit-card" size="sm" className="w-4 h-4" />} title="Volume & Margin">
                <SpecRow label="Minimum Volume" value={`${spec.minLot} lot${spec.minLot !== 1 ? 's' : ''}`} />
                <SpecRow label="Maximum Volume" value={`${spec.maxLot} lot${spec.maxLot !== 1 ? 's' : ''}`} />
                <SpecRow label="Volume Step" value={spec.lotStep.toString()} />
                <SpecRow
                  label="Margin Required"
                  value={`${(spec.marginRate * 100).toFixed(2)}%`}
                  hint={`Leverage: 1:${Math.round(1 / spec.marginRate)}`}
                />
              </Section>

              {/* Costs Section */}
              <Section icon={<Icon name="check-circle" size="sm" className="w-4 h-4" />} title="Costs">
                <SpecRow
                  label="Swap Long (Buy)"
                  value={spec.swapLong.toFixed(2)}
                  valueColor={spec.swapLong >= 0 ? 'text-emerald-400' : 'text-red-400'}
                  hint="Points per lot per day"
                />
                <SpecRow
                  label="Swap Short (Sell)"
                  value={spec.swapShort.toFixed(2)}
                  valueColor={spec.swapShort >= 0 ? 'text-emerald-400' : 'text-red-400'}
                  hint="Points per lot per day"
                />
                <SpecRow
                  label="Commission"
                  value={spec.commission === 0 ? 'No commission' : `$${spec.commission} per lot`}
                />
              </Section>

              {/* Trading Hours Section */}
              <Section icon={<Icon name="clock" size="sm" className="w-4 h-4" />} title="Trading Hours">
                <SpecRow label="Trading Schedule" value={tradingHours} />
                <SpecRow
                  label="Quote Mode"
                  value="3-way quotes"
                  hint="Bid / Ask / Last price available"
                />
              </Section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-[#252525]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Section Component
const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <div className="border border-zinc-800 rounded-lg overflow-hidden bg-[#252525]">
    <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
      <span className="text-blue-500">{icon}</span>
      <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wide">{title}</h3>
    </div>
    <div className="divide-y divide-zinc-800">
      {children}
    </div>
  </div>
);

// Spec Row Component
interface SpecRowProps {
  label: string;
  value: string;
  valueColor?: string;
  hint?: string;
  badge?: boolean;
}

const SpecRow = ({ label, value, valueColor = 'text-zinc-100', hint, badge }: SpecRowProps) => (
  <div className="px-4 py-3 hover:bg-zinc-800/30 transition-colors group">
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-400">{label}</span>
      {badge ? (
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
          value === 'Forex' ? 'bg-zinc-700/30 text-zinc-400 border border-zinc-600/30' :
          value === 'Crypto' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
          value === 'Commodity' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
          value === 'Index' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
          'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30'
        }`}>
          {value}
        </span>
      ) : (
        <span className={`text-sm font-mono font-medium ${valueColor}`}>{value}</span>
      )}
    </div>
    {hint && (
      <div className="mt-1 text-xs text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
        {hint}
      </div>
    )}
  </div>
);
