import React from 'react';

import { MARKET_WATCH_VIEWS, type MarketWatchViewId } from './marketWatchPanelModel';

interface MarketWatchViewTabsProps {
  activeView: MarketWatchViewId;
  onSelectView: (view: MarketWatchViewId) => void;
  translate: (text: string) => string;
}

export const MarketWatchViewTabs: React.FC<MarketWatchViewTabsProps> = ({
  activeView,
  onSelectView,
  translate,
}) => (
  <div
    className="rtx-market-watch__view-tabs"
    role="tablist"
    aria-label={translate('Market Watch views')}
    style={{
      display: 'flex',
      minHeight: 22,
      borderTop: '1px solid var(--border-primary)',
      background: 'var(--bg-secondary)',
    }}
  >
    {MARKET_WATCH_VIEWS.map((view) => (
      <button
        key={view}
        type="button"
        role="tab"
        aria-selected={activeView === view}
        onClick={() => onSelectView(view)}
        style={{
          minWidth: 0,
          padding: '0 10px',
          border: '1px solid transparent',
          borderTopColor: activeView === view ? 'var(--bg-secondary)' : 'transparent',
          borderInlineColor: activeView === view ? 'var(--border-primary)' : 'transparent',
          background: activeView === view ? 'var(--bg-secondary)' : 'transparent',
          color: activeView === view ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontFamily: 'inherit',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {translate(view === 'symbols' ? 'Symbols' : view === 'details' ? 'Details' : view === 'trading' ? 'Trading' : 'Ticks')}
      </button>
    ))}
  </div>
);
