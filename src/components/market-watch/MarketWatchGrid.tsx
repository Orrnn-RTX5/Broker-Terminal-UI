import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import type { ContextMenuItemConfig } from '../ui/ContextMenu';
import type {
  MarketWatchColumnId,
  MarketWatchOptions,
  MarketWatchSortMode,
} from '../../utils/marketWatchView';
import { MarketWatchRow } from './MarketWatchRow';

type Translate = (source: string, values?: Record<string, unknown>) => string;

interface MarketWatchGridProps {
  actionableSymbolSet: ReadonlySet<string>;
  chartOpenableSymbolSet: ReadonlySet<string>;
  closedDailyChanges: ReadonlyMap<string, number>;
  columns: readonly MarketWatchColumnId[];
  getContextMenuItems: (symbol: string) => ContextMenuItemConfig[];
  isSymbolListLoading: boolean;
  lastPrices: ReadonlyMap<string, MarketWatchLastPrice>;
  liveQuoteSymbolSet: ReadonlySet<string>;
  marketWatchOptions: MarketWatchOptions;
  marketWatchRowRefCallbacks: ReadonlyMap<string, (node: HTMLTableRowElement | null) => void>;
  marketWatchSelectionSymbol: string;
  onContextSelect: (symbol: string) => void;
  onShowAll: () => void;
  onSymbolSelect: (symbol: string) => void;
  quoteEligibleSymbols: readonly string[];
  rows: readonly string[];
  setMarketWatchViewportRef: (node: HTMLElement | null) => void;
  setSortMode: (mode: MarketWatchSortMode) => void;
  sortMode: MarketWatchSortMode;
  translate: Translate;
}

/** Responsive Market Watch grid, including row visibility binding and theme state. */
export const MarketWatchGrid = ({
  actionableSymbolSet,
  chartOpenableSymbolSet,
  closedDailyChanges,
  columns,
  getContextMenuItems,
  isSymbolListLoading,
  lastPrices,
  liveQuoteSymbolSet,
  marketWatchOptions,
  marketWatchRowRefCallbacks,
  marketWatchSelectionSymbol,
  onContextSelect,
  onShowAll,
  onSymbolSelect,
  quoteEligibleSymbols,
  rows,
  setMarketWatchViewportRef,
  setSortMode,
  sortMode,
  translate,
}: MarketWatchGridProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(999);
  const [isLightSkin, setIsLightSkin] = useState(false);

  const bindViewport = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setMarketWatchViewportRef(node);
  }, [setMarketWatchViewportRef]);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setPanelWidth(entry.contentRect.width);
    });
    observer.observe(element);
    if (element.offsetWidth > 0) setPanelWidth(element.offsetWidth);
    return () => observer.disconnect();
  }, []);

  const columnHeaders: Record<MarketWatchColumnId, string> = {
    symbol: 'Symbol',
    bid: 'Bid',
    ask: 'Ask',
    last: 'Last',
    high: 'High',
    low: 'Low',
    volume: 'Volume',
    spread: 'Spread',
    time: 'Time',
    dailyChange: 'Daily Change',
    source: 'Source',
  };
  const columnWidths = useMemo<Partial<Record<MarketWatchColumnId, number>>>(() => ({
    bid: 82,
    ask: 82,
    last: 88,
    high: 88,
    low: 88,
    volume: 88,
    spread: 76,
    time: marketWatchOptions.showMilliseconds ? 104 : 82,
    dailyChange: 108,
    source: 110,
  }), [marketWatchOptions.showMilliseconds]);
  const tableMinimumWidth = 118 + columns.reduce(
    (total, column) => total + (column === 'symbol' ? 0 : (columnWidths[column] ?? 82)),
    0,
  );

  return (
    <div
      ref={bindViewport}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: marketWatchOptions.autoArrange ? 'hidden' : 'auto',
        minWidth: 0,
      }}
      className="rtx-market-watch__table mw-scrollbar"
    >
      {rows.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 8,
          color: '#222226',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span className="rtx-market-watch__empty-text" style={{ fontSize: 11, color: '#50505a' }}>
            {isSymbolListLoading ? translate('Loading symbols...') : translate('No live symbols')}
          </span>
          {!isSymbolListLoading && quoteEligibleSymbols.length > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 3,
                background: 'rgba(255,255,255,0.04)',
                color: '#808088',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 10,
                padding: '4px 8px',
              }}
            >
              {translate('Show all symbols')}
            </button>
          )}
        </div>
      ) : (
        <table
          className={`rtx-market-watch__grid${marketWatchOptions.showGrid ? ' rtx-market-watch__grid--lines' : ''}`}
          style={{
            width: marketWatchOptions.autoArrange ? '100%' : Math.max(panelWidth, tableMinimumWidth),
            minWidth: marketWatchOptions.autoArrange ? 0 : tableMinimumWidth,
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column} style={column === 'symbol' ? undefined : { width: columnWidths[column] ?? 82 }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: 'none' }}>
              {columns.map((column) => {
                const sortableMode: MarketWatchSortMode = column === 'symbol'
                  ? 'symbol'
                  : column === 'dailyChange'
                    ? (sortMode === 'gainers' ? 'losers' : 'gainers')
                    : column === 'volume' ? 'volume' : null;
                const isSortable = column === 'symbol' || column === 'dailyChange' || column === 'volume';
                const isSorted = (column === 'symbol' && sortMode === 'symbol')
                  || (column === 'volume' && sortMode === 'volume')
                  || (column === 'dailyChange' && (sortMode === 'gainers' || sortMode === 'losers'));
                return (
                  <th
                    key={column}
                    className={`rtx-market-watch__column-heading${column === 'symbol' ? ' rtx-market-watch__column-heading--symbol' : ''}`}
                    onClick={isSortable ? () => setSortMode(sortableMode) : undefined}
                    onKeyDown={isSortable ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setSortMode(sortableMode);
                    } : undefined}
                    tabIndex={isSortable ? 0 : undefined}
                    title={isSortable ? translate('Sort by {{value0}}', { value0: columnHeaders[column] }) : undefined}
                    aria-sort={isSorted
                      ? (sortMode === 'gainers' || sortMode === 'volume' ? 'descending' : 'ascending')
                      : 'none'}
                    style={{
                      textAlign: column === 'symbol' || column === 'source' ? 'left' : 'center',
                      padding: column === 'symbol' ? '3px 8px 3px 19px' : '3px 5px',
                      fontSize: 12,
                      fontWeight: 500,
                      lineHeight: '16px',
                      color: 'var(--text-primary)',
                      letterSpacing: 'normal',
                      background: 'var(--bg-secondary)',
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      textTransform: column === 'dailyChange' ? undefined : 'uppercase',
                      whiteSpace: 'nowrap',
                      cursor: isSortable ? 'pointer' : 'default',
                    }}
                  >
                    {translate(columnHeaders[column])}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((symbol) => (
              <MarketWatchRow
                key={symbol}
                symbol={symbol}
                isSelected={symbol === marketWatchSelectionSymbol}
                isLive={liveQuoteSymbolSet.has(symbol)}
                isChartOpenable={chartOpenableSymbolSet.has(symbol)}
                onClick={() => onSymbolSelect(symbol)}
                onContextSelect={() => onContextSelect(symbol)}
                onDoubleClick={() => {
                  if (actionableSymbolSet.has(symbol)) {
                    window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } }));
                  }
                }}
                contextMenuItems={getContextMenuItems(symbol)}
                columns={columns}
                showMilliseconds={marketWatchOptions.showMilliseconds}
                isLightSkin={isLightSkin}
                closedDailyChange={closedDailyChanges.get(symbol)}
                lastPrice={lastPrices.get(symbol)}
                symbolUniverse={quoteEligibleSymbols}
                rowRef={marketWatchRowRefCallbacks.get(symbol)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
