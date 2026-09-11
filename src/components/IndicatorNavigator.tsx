import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Indicator Navigator
 * Dialog for browsing and adding technical indicators
 */

import { Icon } from './ui/Icon';
import { useState } from 'react';
import { TrendingUp, Activity, BarChart3, Zap } from 'lucide-react';

export const SUPPORTED_INDICATOR_IDS = new Set(['ma', 'ema', 'bb', 'rsi', 'macd', 'volume']);

export const isIndicatorSupported = (indicatorId: string): boolean => (
  SUPPORTED_INDICATOR_IDS.has(indicatorId.trim().toLowerCase().split('-')[0])
);

export interface IndicatorInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters?: Record<string, any>;
}

interface IndicatorNavigatorProps {
  isOpen: boolean;
  onClose: () => void;
  onAddIndicator: (indicator: IndicatorInfo) => void;
  initialCategory?: string;
}

const INDICATOR_CATEGORIES = {
  'Trend': {
    icon: TrendingUp,
    indicators: [
      {
        id: 'ma',
        name: 'Moving Average',
        description: 'Simple, Exponential, or Weighted moving average',
        parameters: { period: 20, type: 'SMA' }
      },
      {
        id: 'ema',
        name: 'Exponential MA',
        description: 'Exponential moving average',
        parameters: { period: 12 }
      },
      {
        id: 'bb',
        name: 'Bollinger Bands',
        description: 'Volatility bands around moving average',
        parameters: { period: 20, deviation: 2 }
      },
      {
        id: 'ichimoku',
        name: 'Ichimoku Cloud',
        description: 'Japanese trend indicator with cloud',
        parameters: { tenkan: 9, kijun: 26, senkou: 52 }
      },
      {
        id: 'parabolic',
        name: 'Parabolic SAR',
        description: 'Stop and reverse indicator',
        parameters: { acceleration: 0.02, maximum: 0.2 }
      }
    ]
  },
  'Oscillators': {
    icon: Activity,
    indicators: [
      {
        id: 'rsi',
        name: 'RSI',
        description: 'Relative Strength Index (momentum oscillator)',
        parameters: { period: 14 }
      },
      {
        id: 'macd',
        name: 'MACD',
        description: 'Moving Average Convergence Divergence',
        parameters: { fast: 12, slow: 26, signal: 9 }
      },
      {
        id: 'stochastic',
        name: 'Stochastic',
        description: 'Stochastic oscillator (%K and %D)',
        parameters: { kPeriod: 14, dPeriod: 3 }
      },
      {
        id: 'cci',
        name: 'CCI',
        description: 'Commodity Channel Index',
        parameters: { period: 20 }
      },
      {
        id: 'momentum',
        name: 'Momentum',
        description: 'Rate of price change',
        parameters: { period: 10 }
      }
    ]
  },
  'Volume': {
    icon: BarChart3,
    indicators: [
      {
        id: 'volume',
        name: 'Volume',
        description: 'Trading volume bars',
        parameters: {}
      },
      {
        id: 'obv',
        name: 'On Balance Volume',
        description: 'Cumulative volume indicator',
        parameters: {}
      },
      {
        id: 'vwap',
        name: 'VWAP',
        description: 'Volume Weighted Average Price',
        parameters: {}
      },
      {
        id: 'mfi',
        name: 'Money Flow Index',
        description: 'Volume-weighted RSI',
        parameters: { period: 14 }
      }
    ]
  },
  'Bill Williams': {
    icon: Zap,
    indicators: [
      {
        id: 'alligator',
        name: 'Alligator',
        description: 'Three smoothed moving averages',
        parameters: { jaw: 13, teeth: 8, lips: 5 }
      },
      {
        id: 'awesome',
        name: 'Awesome Oscillator',
        description: 'Momentum indicator',
        parameters: { fast: 5, slow: 34 }
      },
      {
        id: 'fractals',
        name: 'Fractals',
        description: 'Reversal pattern indicator',
        parameters: {}
      },
      {
        id: 'gator',
        name: 'Gator Oscillator',
        description: 'Alligator derivative',
        parameters: { jaw: 13, teeth: 8, lips: 5 }
      }
    ]
  }
};

export function IndicatorNavigator({ isOpen, onClose, onAddIndicator, initialCategory }: IndicatorNavigatorProps) {
    const tr = useUiTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initialCategory ?? null);

  if (!isOpen) return null;

  const filteredCategories = Object.entries(INDICATOR_CATEGORIES).map(([category, data]) => {
    const filtered = data.indicators.filter(ind =>
      ind.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ind.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return { category, data, indicators: filtered };
  }).filter(cat => cat.indicators.length > 0);

  const handleAddIndicator = (category: string, indicator: any) => {
    onAddIndicator({
      id: `${indicator.id}-${Date.now()}`,
      name: indicator.name,
      category,
      description: indicator.description,
      parameters: indicator.parameters
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-zinc-900 rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-zinc-800">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">{tr("Indicators")}</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-zinc-100"
          >
            <Icon name="x-close" size="lg" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-zinc-800">
          <div className="relative">
            <Icon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder={tr("Search indicators...")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-zinc-800 overflow-visible">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium leading-none transition-colors ${selectedCategory === null
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
          >
            {tr("All")}</button>
          {Object.keys(INDICATOR_CATEGORIES).map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium leading-none transition-colors ${selectedCategory === category
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Indicators List */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredCategories
            .filter(cat => selectedCategory === null || cat.category === selectedCategory)
            .map(({ category, data, indicators }) => (
              <div key={category} className="mb-6 last:mb-0">
                <div className="flex items-center gap-2 mb-3">
                  {(() => {
                    const Icon = data.icon;
                    return <Icon size={18} className="text-emerald-400" />;
                  })()}
                  <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">
                    {category}
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {indicators.map(indicator => (
                    <div
                      key={indicator.id}
                      onDoubleClick={() => {
                        if (isIndicatorSupported(indicator.id)) handleAddIndicator(category, indicator);
                      }}
                      aria-disabled={!isIndicatorSupported(indicator.id)}
                      title={isIndicatorSupported(indicator.id) ? undefined : tr("This indicator is not available in the current chart engine")}
                      className={`p-3 rounded-lg border transition-all group ${isIndicatorSupported(indicator.id)
                        ? 'bg-zinc-800/50 hover:bg-zinc-800 border-zinc-700/50 hover:border-emerald-500/50 cursor-pointer'
                        : 'bg-zinc-800/25 border-zinc-800 cursor-not-allowed opacity-55'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-zinc-100 group-hover:text-emerald-400 transition-colors">
                            {indicator.name}
                          </h4>
                          <p className="text-xs text-zinc-500 mt-1">
                            {indicator.description}
                          </p>
                          {indicator.parameters && Object.keys(indicator.parameters).length > 0 && (
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {Object.entries(indicator.parameters).map(([key, value]) => (
                                <span
                                  key={key}
                                  className="text-[10px] px-2 py-0.5 bg-zinc-700/50 text-zinc-400 rounded"
                                >
                                  {key}: {String(value)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isIndicatorSupported(indicator.id)) return;
                            handleAddIndicator(category, indicator);
                          }}
                          disabled={!isIndicatorSupported(indicator.id)}
                          className="ml-2 px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs rounded transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
                        >
                          {!isIndicatorSupported(indicator.id) ? tr("Unavailable") : indicator.id === 'volume' ? tr("Enable") : tr("Add")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          {filteredCategories.length === 0 && (
            <div className="text-center py-12 text-zinc-500">
              <Icon name="activity" size="xl" className="mx-auto mb-4 opacity-50" />
              <p>{tr("No indicators found matching \"")}{searchTerm}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
          <p className="text-xs text-zinc-500 text-center">
            {tr("Double-click or press \"Add\" to insert an available indicator")}</p>
        </div>
      </div>
    </div>
  );
}
