import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Indicator Navigator
 * Dialog for browsing and adding technical indicators
 */

import { Icon } from './ui/Icon';
import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { isIndicatorSupported } from '../utils/indicatorSupport';
import './IndicatorNavigator.css';

export interface IndicatorInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters?: Record<string, string | number>;
}

interface IndicatorNavigatorProps {
  isOpen: boolean;
  onClose: () => void;
  onAddIndicator: (indicator: IndicatorInfo) => void;
  initialCategory?: string;
}

const INDICATOR_CATEGORIES: Record<string, {
  indicators: Omit<IndicatorInfo, 'category'>[];
}> = {
  'Trend': {
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

const createIndicatorInstanceId = (indicatorId: string): string => (
  `${indicatorId}-${Date.now()}`
);

export function IndicatorNavigator({ isOpen, onClose, onAddIndicator, initialCategory }: IndicatorNavigatorProps) {
  const tr = useUiTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initialCategory ?? null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => { previousFocus?.focus(); };
  }, [isOpen]);

  if (!isOpen) return null;

  const query = searchTerm.trim().toLowerCase();
  const filteredCategories = Object.entries(INDICATOR_CATEGORIES).map(([category, data]) => {
    const filtered = data.indicators.filter(ind =>
      ind.name.toLowerCase().includes(query) ||
      ind.description.toLowerCase().includes(query)
    );
    return { category, indicators: filtered };
  }).filter(cat => cat.indicators.length > 0 && (selectedCategory === null || cat.category === selectedCategory));

  const handleAddIndicator = (category: string, indicator: Omit<IndicatorInfo, 'category'>) => {
    onAddIndicator({
      id: createIndicatorInstanceId(indicator.id),
      name: indicator.name,
      category,
      description: indicator.description,
      parameters: indicator.parameters
    });
  };

  return (
    <div className="rtx-indicator-backdrop">
      <div
        ref={dialogRef}
        className="rtx-indicator-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, input') ?? [])
            .filter(control => !control.matches(':disabled'));
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {/* Header */}
        <div className="rtx-indicator-header">
          <h2 id={titleId}>{tr("Indicators")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("Close")}
            className="rtx-indicator-close"
          >
            <Icon name="x-close" size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="rtx-indicator-search-wrap">
          <div className="rtx-indicator-search-field">
            <Icon name="search" size={16} className="rtx-indicator-search-icon" />
            <input
              ref={searchRef}
              type="text"
              aria-label={tr("Search indicators...")}
              placeholder={tr("Search indicators...")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rtx-indicator-search"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="rtx-indicator-categories">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            aria-pressed={selectedCategory === null}
            className="rtx-indicator-category"
          >
            {tr("All")}
          </button>
          {Object.keys(INDICATOR_CATEGORIES).map(category => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              aria-pressed={selectedCategory === category}
              className="rtx-indicator-category"
            >
              {tr(category)}
            </button>
          ))}
        </div>

        {/* Indicators List */}
        <div className="rtx-indicator-list">
          {filteredCategories
            .map(({ category, indicators }) => (
              <section key={category} className="rtx-indicator-section" aria-label={tr(category)}>
                {selectedCategory === null && (
                  <div className="rtx-indicator-section-heading">
                    <h3>{tr(category)}</h3>
                  </div>
                )}

                <div className="rtx-indicator-rows">
                  {indicators.map(indicator => (
                    <div
                      key={indicator.id}
                      onDoubleClick={() => {
                        if (isIndicatorSupported(indicator.id)) handleAddIndicator(category, indicator);
                      }}
                      aria-disabled={!isIndicatorSupported(indicator.id)}
                      title={isIndicatorSupported(indicator.id) ? undefined : tr("This indicator is not available in the current chart engine")}
                      className="rtx-indicator-row"
                    >
                      <div className="rtx-indicator-details">
                        <h4>{indicator.name}</h4>
                        <p className="rtx-indicator-description" title={indicator.description}>
                          {indicator.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isIndicatorSupported(indicator.id)) return;
                          handleAddIndicator(category, indicator);
                        }}
                        disabled={!isIndicatorSupported(indicator.id)}
                        className="rtx-indicator-add"
                      >
                        {isIndicatorSupported(indicator.id) && <Plus size={14} aria-hidden="true" />}
                        {!isIndicatorSupported(indicator.id) ? tr("Unavailable") : indicator.id === 'volume' ? tr("Enable") : tr("Add")}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}

          {filteredCategories.length === 0 && (
            <div className="rtx-indicator-empty" role="status">
              <Icon name="search" size={24} />
              <p>{tr("No indicators found matching \"")}{searchTerm}"</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
