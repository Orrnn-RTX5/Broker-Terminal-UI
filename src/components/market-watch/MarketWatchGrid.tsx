import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import type { ContextMenuItemConfig } from '../ui/ContextMenu';
import {
  MARKET_WATCH_COLUMN_HEADERS,
  type MarketWatchColumnId,
  type MarketWatchOptions,
  type MarketWatchSortMode,
} from '../../utils/marketWatchView';
import { normalizeSymbol } from './marketWatchPanelModel';
import { MarketWatchRow } from './MarketWatchRow';

type Translate = (source: string, values?: Record<string, unknown>) => string;

interface MarketWatchGridProps {
  actionableSymbolSet: ReadonlySet<string>;
  chartOpenableSymbolSet: ReadonlySet<string>;
  /** Broker catalog price digits by normalized symbol (rows without published digits are absent). */
  catalogPriceDigits?: ReadonlyMap<string, number>;
  closedDailyChanges: ReadonlyMap<string, number>;
  columns: readonly MarketWatchColumnId[];
  getContextMenuItems: (symbol: string) => ContextMenuItemConfig[];
  getInstrumentSources?: (symbol: string) => readonly unknown[];
  footer?: ReactNode;
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
  showRows?: boolean;
  translate: Translate;
}

/** Responsive Market Watch grid, including row visibility binding and theme state. */
export const MarketWatchGrid = ({
  actionableSymbolSet,
  chartOpenableSymbolSet,
  catalogPriceDigits,
  closedDailyChanges,
  columns,
  getContextMenuItems,
  getInstrumentSources,
  footer,
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
  showRows = true,
  translate,
}: MarketWatchGridProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [isLightSkin, setIsLightSkin] = useState(false);

  const bindViewport = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setMarketWatchViewportRef(node);
  }, [setMarketWatchViewportRef]);

  useEffect(() => {
    const ownerDocument = viewportRef.current?.ownerDocument;
    if (!ownerDocument) return;
    const releaseRowFocus = (event: PointerEvent) => {
      const focused = ownerDocument.activeElement;
      if (!(focused instanceof HTMLElement)
        || !focused.classList.contains('rtx-market-watch__row')
        || !viewportRef.current?.contains(focused)
        || !(event.target instanceof Node)
        || focused.contains(event.target)) return;
      // Canvas tools can prevent the normal pointer focus transfer. Release
      // just this list's row before those handlers run, retaining its symbol.
      focused.blur();
    };
    ownerDocument.addEventListener('pointerdown', releaseRowFocus, true);
    return () => ownerDocument.removeEventListener('pointerdown', releaseRowFocus, true);
  }, []);

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

  const columnHeaders = MARKET_WATCH_COLUMN_HEADERS;
  const hasSeparateDailyChangePrice = columns.includes('dailyChangePrice');
  const columnWidths = useMemo<Partial<Record<MarketWatchColumnId, number>>>(() => ({
    symbol: 76,
    bid: hasSeparateDailyChangePrice ? 74 : 55,
    ask: hasSeparateDailyChangePrice ? 74 : 55,
    last: 80,
    high: 80,
    low: 80,
    volume: 76,
    spread: 64,
    time: marketWatchOptions.showMilliseconds ? 104 : 82,
    dailyChange: hasSeparateDailyChangePrice ? 76 : 94,
    dailyChangePrice: 76,
    source: 110,
    accruedInterest: 102,
    initialMargin: 94,
    maintenanceMargin: 118,
    initialBuyMargin: 112,
    initialSellMargin: 112,
    settlementPrice: 102,
    dealsVolume: 92,
    openInterest: 92,
    averageWeightedPrice: 138,
    theoreticalPrice: 106,
  }), [hasSeparateDailyChangePrice, marketWatchOptions.showMilliseconds]);
  const totalBaseColumnWidth = Math.max(
    1,
    columns.reduce((total, column) => total + (columnWidths[column] ?? 82), 0),
  );
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
        display: showRows ? 'block' : 'flex',
        flexDirection: 'column',
      }}
      className="rtx-market-watch__table mw-scrollbar"
    >
      {showRows && (rows.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 72,
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
                color: 'var(--rtx-light-text-muted, #808088)',
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
          data-wide={panelWidth >= 320 ? 'true' : undefined}
          style={{
            width: marketWatchOptions.autoArrange ? '100%' : Math.max(panelWidth || 999, tableMinimumWidth),
            minWidth: marketWatchOptions.autoArrange ? 0 : tableMinimumWidth,
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            {columns.map((column) => {
              const baseWidth = columnWidths[column] ?? 82;
              const style = marketWatchOptions.autoArrange
                ? { width: `${((baseWidth / totalBaseColumnWidth) * 100).toFixed(2)}%` }
                : column === 'symbol'
                  ? undefined
                  : {
                    width: panelWidth > tableMinimumWidth
                      ? Math.round(baseWidth * (panelWidth / tableMinimumWidth))
                      : baseWidth,
                  };
              return <col key={column} style={style} />;
            })}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: 'none' }}>
              {columns.map((column) => {
                const sortableMode: MarketWatchSortMode = column === 'symbol'
                  ? 'symbol'
                  : column === 'dailyChange'
                    ? (sortMode === 'gainers' ? 'losers' : 'gainers')
                    : column === 'dailyChangePrice' ? (sortMode === 'change-desc' ? 'change-asc' : 'change-desc')
                    : column === 'volume' ? 'volume' : null;
                const isSortable = column === 'symbol' || column === 'dailyChange' || column === 'dailyChangePrice' || column === 'volume';
                const isSorted = (column === 'symbol' && sortMode === 'symbol')
                  || (column === 'volume' && sortMode === 'volume')
                  || (column === 'dailyChange' && (sortMode === 'gainers' || sortMode === 'losers'));
                const amountSorted = column === 'dailyChangePrice' && (sortMode === 'change-asc' || sortMode === 'change-desc');
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
                    aria-sort={isSorted || amountSorted
                      ? (sortMode === 'gainers' || sortMode === 'change-desc' || sortMode === 'volume' ? 'descending' : 'ascending')
                      : 'none'}
                    style={{
                      textAlign: column === 'symbol' || column === 'source' ? 'left' : 'right',
                      padding: '0 5px',
                      fontSize: 12,
                      fontWeight: 400,
                      lineHeight: '23px',
                      color: 'var(--text-primary)',
                      letterSpacing: 'normal',
                      background: 'var(--bg-secondary)',
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      cursor: isSortable ? 'pointer' : 'default',
                    }}
                  >
                    {translate(columnHeaders[column])}
                    {(isSorted || amountSorted) && (
                      <span
                        className="rtx-market-watch__sort-arrow"
                        aria-hidden="true"
                        data-descending={sortMode === 'gainers' || sortMode === 'change-desc' || sortMode === 'volume'}
                      />
                    )}
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
                instrumentSources={getInstrumentSources?.(symbol)}
                catalogPriceDigits={catalogPriceDigits?.get(normalizeSymbol(symbol)) ?? null}
                symbolUniverse={quoteEligibleSymbols}
                rowRef={marketWatchRowRefCallbacks.get(symbol)}
              />
            ))}
          </tbody>
        </table>
      ))}
      {footer}
    </div>
  );
};
