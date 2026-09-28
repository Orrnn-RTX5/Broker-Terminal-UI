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
      minHeight: 26,
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
          minWidth: 64,
          border: 0,
          borderBottom: activeView === view ? '2px solid #0078d7' : '2px solid transparent',
          background: activeView === view ? 'var(--bg-quaternary)' : 'transparent',
          color: activeView === view ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontFamily: 'inherit',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {view === 'symbols' ? translate('Symbols') : view === 'details' ? translate('Details') : translate('Ticks')}
      </button>
    ))}
  </div>
);
