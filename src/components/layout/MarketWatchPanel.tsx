import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useTerminalStartupReady } from '../../startup/TerminalStartupBoundary';
import React, { lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveTickFromLookup, selectTickCount, useAppStore, useTick } from '../../store/useAppStore';
import { useMarketDataStore } from '../../store/useMarketDataStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';
import { PriceDisplay } from '../ui/PriceDisplay';
import { RetainedLazyFeature } from '../../startup/RetainedLazyFeature';
import { MarketWatchTickChart, PopupPricesDialog } from '../market-watch';
import {
  useActiveMarketSymbols,
  useLiveQuotes,
  useMarketInstruments,
  useRemoteWatchlistSync,
  type MarketInstrumentsSnapshot,
} from '../../hooks/useLiveMarketData';
import { useBrokerAccountSessionScope } from '../../hooks/useBrokerAccountSessionScope';
import { useClosedMarketDailyChanges } from '../../hooks/useClosedMarketDailyChanges';
import { useLastMarketWatchQuotes, type MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import { useVisibleSymbolRows } from '../../hooks/useVisibleSymbolRows';
import {
  getHiddenSymbols,
  hideSymbol as persistHiddenSymbol,
  hideSymbols as persistHiddenSymbols,
  showAllSymbols as clearHiddenSymbols,
  showSymbol as restoreHiddenSymbol,
} from '../../services/marketWatchActions';
import { MARKET_WATCH_PROFILE_RESTORED_EVENT } from '../../services/localWorkspaceProfiles';
import { getInstrumentSymbolName, getUniqueSymbolNames } from '../../utils/symbolEligibility';
import { getFallbackSymbolDescription } from '../../utils/symbolDescription';
import {
  buildMarketWatchSymbolGroups,
  resolveMarketWatchSymbolGroup,
  selectDefaultMarketWatchSymbols,
} from '../../utils/marketWatchGroups';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { getChartPanels } from '../../services/chartPanelNavigation';
import { formatSpreadDisplay } from '../../utils/spread';
import { formatPrice } from '../../utils/symbolUtils';
import {
  deleteMarketWatchSavedSet,
  escapeMarketWatchCsvCell,
  escapeMarketWatchTsvCell,
  formatMarketWatchTime,
  loadMarketWatchColumns,
  loadMarketWatchOptions,
  loadMarketWatchSavedSets,
  normalizeMarketWatchColumns,
  normalizeMarketWatchOptions,
  saveMarketWatchColumns,
  saveMarketWatchOptions,
  saveMarketWatchSavedSet,
  sortMarketWatchSymbols,
  type MarketWatchColumnId,
  type MarketWatchOptions,
  type MarketWatchSavedSet,
  type MarketWatchSortMetadata,
  type MarketWatchSortMode,
} from '../../utils/marketWatchView';
import { copyTextToClipboard } from '../../utils/tradeShareLink';
import { downloadMarketWatchCsv, type MarketWatchExportResult } from '../../utils/marketWatchExport';
import type { ActionFeedbackNotice } from '../notifications/ActionFeedbackToast';
import {
  getMarketWatchDisplayErrors,
  getMarketWatchSymbolLabel,
  resolveMarketWatchSymbolInput,
  searchMarketWatchSymbols,
  shouldUseWatchlistAsMarketWatchSource,
} from '../../utils/marketWatchSource';
import {
  isAccountSymbolUniverseActive,
  pruneSymbolsToUniverse,
  selectAccountDefaultMarketWatchSymbols,
} from '../../utils/accountSymbolUniverse';

const SymbolSpecificationDialog = lazy(() => import('../dialogs/SymbolSpecificationDialog')
  .then(module => ({ default: module.SymbolSpecificationDialog })));

export interface ActiveMarketSymbolsSnapshot {
  symbols: string[];
  loading: boolean;
  settled: boolean;
  current: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

interface MarketWatchPanelBaseProps {
  allSymbols: unknown[];
  chartSymbols?: unknown[];
  selectedSymbol: string;
  onSymbolSelect: (symbol: string) => void;
  className?: string;
}

interface MarketWatchPanelProps extends MarketWatchPanelBaseProps {
  activeMarketSnapshot?: ActiveMarketSymbolsSnapshot;
  marketInstrumentsSnapshot?: MarketInstrumentsSnapshot;
}

interface ScopedManualSymbols {
  watchlistId: string;
  symbols: string[];
}

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const readFiniteDailyChange = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const TWO_DECIMAL_MARKET_WATCH_SYMBOLS = new Set([
  'JPN225',
  'JPN225-F',
  'WHEAT',
  'GOLD-PERP',
  'NICKEL',
  'COCOA',
  'MAERSKB.DK',
  'COFFEE',
  'SPA35-F',
]);

const getMarketWatchPriceDigits = (symbol: string): number | undefined => (
  TWO_DECIMAL_MARKET_WATCH_SYMBOLS.has(normalizeSymbol(symbol)) ? 2 : undefined
);

const formatMarketWatchExportPrice = (symbol: string, value: unknown): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '-';
  return formatPrice(parsed, getMarketWatchPriceDigits(symbol) ?? symbol);
};

const uniqueSymbols = (symbols: unknown[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

const findMarketWatchPanelId = (node: unknown): string | null => {
  if (!node || typeof node !== 'object') return null;
  const record = node as { id?: string; component?: string; children?: unknown[] };
  if (record.component === 'MarketWatch' && record.id) return record.id;
  if (!Array.isArray(record.children)) return null;
  for (const child of record.children) {
    const nestedId = findMarketWatchPanelId(child);
    if (nestedId) return nestedId;
  }
  return null;
};

const closeMarketWatchDockPanel = (): void => {
  const { layout, removePanel } = useDockLayoutStore.getState();
  const panelId = findMarketWatchPanelId(layout.root)
    ?? layout.floatingPanels.map((panel) => findMarketWatchPanelId(panel)).find(Boolean)
    ?? null;
  if (panelId) removePanel(panelId);
};

const SYMBOL_GROUP_ROW_HEIGHT = 36;
const SYMBOL_EXPLORER_ROW_HEIGHT = 48;
const SYMBOL_EXPLORER_OVERSCAN = 6;
const SYMBOL_EXPLORER_FALLBACK_HEIGHT = 288;
const MARKET_WATCH_QUOTE_UP_COLOR = '#4597ff';
const MARKET_WATCH_QUOTE_DOWN_COLOR = '#ff5858';
const EMPTY_SORT_TICKS = {};

interface FundamentalLink {
  label: string;
  url: string;
}

const getFundamentalLinks = (symbol: string, groupKey: string): FundamentalLink[] => {
  const ticker = normalizeSymbol(symbol);
  if (groupKey !== 'stocks' || !/^[A-Z]{1,5}$/.test(ticker)) return [];
  const encoded = encodeURIComponent(ticker);
  return [
    { label: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encoded}` },
    { label: 'Google Finance', url: `https://www.google.com/finance/?q=${encoded}` },
    { label: 'Market Watch', url: `https://www.marketwatch.com/investing/stock/${encoded.toLowerCase()}` },
    { label: 'SEC EDGAR', url: `https://www.sec.gov/edgar/browse/?CIK=${encoded}&owner=exclude&action=getcompany` },
    { label: 'Finviz', url: `https://finviz.com/quote.ashx?t=${encoded}` },
    { label: 'Investing', url: `https://www.investing.com/search/?q=${encoded}` },
    { label: 'Bloomberg', url: `https://www.bloomberg.com/search?query=${encoded}` },
    { label: 'CNBC', url: `https://www.cnbc.com/quotes/${encoded}` },
    { label: 'Seeking Alpha', url: `https://seekingalpha.com/symbol/${encoded}` },
    { label: 'The Motley Fool', url: `https://www.fool.com/search/solr.aspx?q=${encoded}` },
    { label: 'Barrons', url: `https://www.barrons.com/search?query=${encoded}` },
    { label: 'Morningstar', url: `https://www.morningstar.com/search?query=${encoded}` },
  ];
};

const openTrustedExternalLink = (url: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'https:') return;
  const electronOpenExternal = window.electron?.shell?.openExternal;
  if (electronOpenExternal) {
    void electronOpenExternal(parsed.toString());
    return;
  }
  window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
};

const MarketWatchSaveSetDialog: React.FC<{
  isOpen: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}> = ({ isOpen, value, onChange, onCancel, onSave }) => {
  const tr = useUiTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/45"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={tr('Save Market Watch set')}
        onSubmit={(event) => { event.preventDefault(); onSave(); }}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
        className="w-[360px] max-w-[calc(100vw-32px)] border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4 text-[var(--text-primary)] shadow-2xl"
      >
        <div className="mb-3 text-sm font-semibold">{tr('Save Market Watch set')}</div>
        <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="market-watch-set-name">
          {tr('Set name')}
        </label>
        <input
          ref={inputRef}
          id="market-watch-set-name"
          value={value}
          maxLength={100}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#0078d7]"
          autoComplete="off"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-8 border border-[var(--border-secondary)] px-3 text-xs">
            {tr('Cancel')}
          </button>
          <button type="submit" disabled={!value.trim()} className="h-8 bg-[#0078d7] px-3 text-xs text-white disabled:opacity-50">
            {tr('Save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

const readInstrumentDescription = (value: unknown, symbol: string): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const hasExplicitSymbol = Boolean(String(record.symbol ?? record.id ?? '').trim());
  const candidates = [
    record.description,
    record.display_name,
    record.displayName,
    record.full_name,
    record.fullName,
    hasExplicitSymbol ? record.name : undefined,
  ];
  for (const candidate of candidates) {
    const description = String(candidate ?? '').trim();
    if (description && normalizeSymbol(description) !== normalizeSymbol(symbol)) return description;
  }
  return '';
};

const findInstrumentBySymbol = (instruments: readonly unknown[], symbol: string): unknown => {
  const matches = instruments.filter((instrument) => getInstrumentSymbolName(instrument) === symbol);
  return matches.find((instrument) => instrument !== null && typeof instrument === 'object') ?? matches[0];
};

const getBrokerSpecificationSource = (instrument: unknown): unknown => {
  if (!instrument || typeof instrument !== 'object' || Array.isArray(instrument)) return instrument;
  const brokerSpecification = (instrument as Record<string, unknown>).brokerSpecification;
  return brokerSpecification && typeof brokerSpecification === 'object' && !Array.isArray(brokerSpecification)
    ? brokerSpecification
    : instrument;
};

const getPublicSpecificationSource = (instrument: unknown): unknown => {
  const source = getBrokerSpecificationSource(instrument);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;

  // Public Market Watch rows contain a live quote spread, not the broker's
  // contract spread. Keep public contract metadata, but never let changing
  // quote fields masquerade as symbol specification values.
  const specification = { ...(source as Record<string, unknown>) };
  [
    'bid', 'ask', 'last', 'spread', 'open', 'high', 'low', 'close', 'volume',
    'dailyChange', 'daily_change', 'time', 'timestamp', 'has_quote', 'hasQuote',
  ].forEach((key) => delete specification[key]);
  return specification;
};

// Price flash hook — returns 'up' | 'down' | null briefly when price changes
function usePriceFlash(value: number): 'up' | 'down' | null {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === 0 && value === 0) return;
    if (value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 600);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return flash;
}

const getTickSnapshot = (symbol: string) => {
  const state = useAppStore.getState();
  return resolveTickFromLookup(state.ticks, state.tickLookup, symbol);
};

const hasMarketWatchQuote = (tick: { bid?: number; ask?: number } | null | undefined): boolean => (
  Boolean(tick && (
    (Number.isFinite(tick.bid) && Number(tick.bid) > 0)
    || (Number.isFinite(tick.ask) && Number(tick.ask) > 0)
  ))
);

const formatLastPriceTime = (asOf: number): string => (
  new Date(asOf).toUTCString().replace('GMT', 'UTC')
);

// ─── Market Watch Row ─────────────────────────────────────────────────────────
const MarketWatchRow: React.FC<{
  symbol: string;
  isSelected: boolean;
  isLive: boolean;
  isChartOpenable: boolean;
  onClick: () => void;
  onContextSelect: () => void;
  onDoubleClick: () => void;
  contextMenuItems: ContextMenuItemConfig[];
  columns: readonly MarketWatchColumnId[];
  showMilliseconds: boolean;
  isLightSkin: boolean;
  closedDailyChange?: number | null;
  lastPrice?: MarketWatchLastPrice;
  symbolUniverse: readonly string[];
  rowRef?: (node: HTMLTableRowElement | null) => void;
}> = ({ symbol, isSelected, isLive, isChartOpenable, onClick, onContextSelect, onDoubleClick, contextMenuItems, columns, showMilliseconds, isLightSkin, closedDailyChange, lastPrice, symbolUniverse, rowRef }) => {
    const tr = useUiTranslation();
  const displaySymbol = getMarketWatchSymbolLabel(symbol, symbolUniverse);
  const cachedTick = useTick(symbol);
  const tick = cachedTick;
  // Historical prices belong only to this row; current quotes and trade gates
  // keep their existing ownership even when the market is closed.
  const hasTickQuote = hasMarketWatchQuote(tick);
  const fallbackPrice = hasTickQuote ? undefined : lastPrice;
  const quote = hasTickQuote ? tick : fallbackPrice?.kind === 'quote' ? fallbackPrice : undefined;
  const lastClose = fallbackPrice?.kind === 'close' ? fallbackPrice : undefined;
  const lastPriceTitle = fallbackPrice
    ? `${tr(fallbackPrice.kind === 'close' ? 'Last close' : 'Last quote')} · ${formatLastPriceTime(fallbackPrice.asOf)}`
    : undefined;
  const priceDigits = getMarketWatchPriceDigits(symbol);
  const bidDirection = hasTickQuote ? tick?.bidDirection ?? 'none' : 'none';
  const askDirection = hasTickQuote ? tick?.askDirection ?? 'none' : 'none';
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? 0;
  // The current quote remains authoritative. Closed-market history is only a
  // display fallback when the broker no longer publishes Daily Change.
  const dailyPct = readFiniteDailyChange(tick?.dailyChange)
    ?? readFiniteDailyChange(closedDailyChange);

  const hasData = hasMarketWatchQuote(quote);
  const hasDailyData = dailyPct !== null;

  const bidFlash = usePriceFlash(bid);
  const askFlash = usePriceFlash(ask);
  const bidPriceDirection = hasTickQuote ? bidFlash ?? (bidDirection !== 'none' ? bidDirection : null) : null;
  const askPriceDirection = hasTickQuote ? askFlash ?? (askDirection !== 'none' ? askDirection : null) : null;

  const dailyPositive = hasDailyData && dailyPct! > 0;
  const dailyNegative = hasDailyData && dailyPct! < 0;
  const quoteDataOpacity = isLive ? 1 : hasData ? 0.72 : 0.45;
  const dailyDataOpacity = isLive ? 1 : hasDailyData ? 0.72 : 0.45;
  const showAsk = columns.includes('ask');
  const showLast = columns.includes('last');
  const showHigh = columns.includes('high');
  const showLow = columns.includes('low');
  const showVolume = columns.includes('volume');
  const showSpread = columns.includes('spread');
  const showTime = columns.includes('time');
  const showDailyChange = columns.includes('dailyChange');
  const showSource = columns.includes('source');
  const renderNumber = (value: unknown, digits = priceDigits): React.ReactNode => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed !== 0
      ? <PriceDisplay price={parsed} symbol={symbol} digits={digits} />
      : <span style={{ color: '#50505a' }}>—</span>;
  };
  const quoteTimestamp = tick?.sourceTimestamp ?? tick?.timestamp ?? fallbackPrice?.asOf;

  return (
    <ContextMenu items={contextMenuItems} variant={isLightSkin ? 'mt5-light' : 'mt5-dark'} density="compact">
      <tr
        ref={rowRef}
        draggable={isChartOpenable}
        onDragStart={(e) => {
          if (!isChartOpenable) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', symbol);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        tabIndex={isSelected ? 0 : -1}
        onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onClick(); }}
        onContextMenu={(event) => { event.currentTarget.focus({ preventScroll: true }); onContextSelect(); }}
        onDoubleClick={(event) => { event.preventDefault(); onDoubleClick(); }}
        style={{
          height: 36,
          cursor: 'pointer',
          borderBottom: 'none',
          background: isSelected ? 'var(--bg-quaternary)' : 'var(--bg-secondary)',
          transition: 'background 0.15s ease',
          boxShadow: isSelected ? 'inset 2px 0 0 #60a5fa' : 'none',
        }}
        className={`${!isSelected ? 'mw-row ' : ''}rtx-market-watch__row${isSelected ? ' rtx-market-watch__row--selected' : ''}${!isLive ? ' rtx-market-watch__row--stale' : ''}`}
        aria-selected={isSelected}
        aria-disabled={!isChartOpenable}
        title={!isChartOpenable ? tr("{{value0}} chart is currently unavailable", { value0: displaySymbol }) : undefined}
      >
        {/* Symbol */}
        <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', maxWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 4, minWidth: 0 }}>
            {/* Direction arrow */}
            {hasData && bidDirection === 'up' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--up" width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0, color: '#4ade80', opacity: quoteDataOpacity }}>
                <path d="M3.5 1L6.5 6H0.5L3.5 1Z" fill="currentColor" />
              </svg>
            )}
            {hasData && bidDirection === 'down' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--down" width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0, color: '#f87171', opacity: quoteDataOpacity }}>
                <path d="M3.5 6L0.5 1H6.5L3.5 6Z" fill="currentColor" />
              </svg>
            )}
            {(!hasData || bidDirection === 'none') && (
              <span style={{ width: 7, flexShrink: 0, display: 'inline-block' }} />
            )}
            <span aria-label={displaySymbol} className="rtx-market-watch__symbol" style={{
              flexShrink: 0,
              maxWidth: 'calc(100% - 11px)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
              letterSpacing: 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {displaySymbol}
            </span>
          </div>
        </td>

        {lastClose ? <>
          <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center' }}>
            <span className="rtx-market-watch__last-close" style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'baseline', flexWrap: 'wrap', gap: '0 6px', color: 'var(--text-primary)' }}>
              <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                <PriceDisplay price={lastClose.close} symbol={symbol} digits={priceDigits} />
              </span>
            </span>
          </td>
          {showAsk && (
            <td style={{ padding: '3px 4px', textAlign: 'center', opacity: 0.45 }}>
              <span className="rtx-market-watch__price rtx-market-watch__price--ask rtx-market-watch__price--empty" style={{ fontSize: 13, color: '#36363e' }}>—</span>
            </td>
          )}
        </> : <>
        {/* Bid — most important: bright, large, tabular */}
        <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center', opacity: hasData ? 1 : quoteDataOpacity }}>
          <span className={`rtx-market-watch__price rtx-market-watch__price--bid${bidPriceDirection ? ` rtx-market-watch__price--${bidPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
            display: 'inline-block',
            fontSize: 13,
            fontWeight: 500,
            color: hasData
              ? bidPriceDirection === 'up' ? MARKET_WATCH_QUOTE_UP_COLOR
                : MARKET_WATCH_QUOTE_DOWN_COLOR
              : '#36363e',
            padding: '1px 4px',
            borderRadius: 3,
            background: 'transparent',
            transition: 'color 0.25s',
            letterSpacing: 'normal',
            fontVariantNumeric: 'tabular-nums',
            tabularNums: true,
          } as React.CSSProperties}>
            {hasData ? <PriceDisplay price={bid} symbol={symbol} digits={priceDigits} /> : '—'}
          </span>
        </td>

        {/* Ask — secondary, slightly softer */}
        {showAsk && (
          <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center', opacity: hasData ? 1 : quoteDataOpacity }}>
            <span className={`rtx-market-watch__price rtx-market-watch__price--ask${askPriceDirection ? ` rtx-market-watch__price--${askPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
              display: 'inline-block',
              fontSize: 13,
              fontWeight: 500,
              color: hasData
                ? askPriceDirection === 'down' ? MARKET_WATCH_QUOTE_DOWN_COLOR
                  : MARKET_WATCH_QUOTE_UP_COLOR
                : '#36363e',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'transparent',
              transition: 'color 0.25s',
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasData ? <PriceDisplay price={ask} symbol={symbol} digits={priceDigits} /> : '—'}
            </span>
          </td>
        )}
        </>}

        {showLast && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__last" style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {renderNumber(tick?.last)}
            </span>
          </td>
        )}
        {showHigh && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__high" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {renderNumber(tick?.high ?? tick?.high24h)}
            </span>
          </td>
        )}
        {showLow && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__low" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {renderNumber(tick?.low ?? tick?.low24h)}
            </span>
          </td>
        )}
        {showVolume && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__volume" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {Number.isFinite(Number(tick?.volume)) ? Number(tick?.volume).toLocaleString() : '—'}
            </span>
          </td>
        )}
        {showSpread && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__spread" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {hasData ? formatSpreadDisplay(symbol, tick?.spread, bid, ask) : '—'}
            </span>
          </td>
        )}
        {showTime && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__time" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {formatMarketWatchTime(quoteTimestamp, showMilliseconds)}
            </span>
          </td>
        )}

        {/* MetaTrader-style Daily Change follows Ask without changing its session-close semantics. */}
        {showDailyChange && (
          <td style={{ padding: '3px 4px', textAlign: 'center', opacity: hasDailyData ? 1 : dailyDataOpacity }}>
            <span className={`rtx-market-watch__daily${!hasDailyData ? ' rtx-market-watch__daily--empty' : ''}${dailyPositive ? ' rtx-market-watch__daily--up' : ''}${dailyNegative ? ' rtx-market-watch__daily--down' : ''}`} style={{
              fontSize: 13,
              fontWeight: 500,
              color: !hasDailyData
                ? '#50505a'
                : dailyPositive
                  ? MARKET_WATCH_QUOTE_UP_COLOR
                  : dailyNegative
                    ? MARKET_WATCH_QUOTE_DOWN_COLOR
                    : 'var(--text-primary)',
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasDailyData ? `${dailyPct!.toFixed(2)}%` : <span style={{ color: '#50505a' }}>—</span>
              }
            </span>
          </td>
        )}
        {showSource && (
          <td title={tick?.lp || ''} style={{ padding: '3px 5px', textAlign: 'left', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__source" style={{ display: 'block', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
              {tick?.lp || '—'}
            </span>
          </td>
        )}
      </tr>
    </ContextMenu>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────
const MarketWatchPanelContent: React.FC<MarketWatchPanelBaseProps & {
  activeMarketSnapshot: ActiveMarketSymbolsSnapshot;
  marketInstrumentsSnapshot: MarketInstrumentsSnapshot;
}> = ({
  allSymbols,
  chartSymbols,
  selectedSymbol,
  onSymbolSelect,
  className,
  activeMarketSnapshot,
  marketInstrumentsSnapshot,
}) => {
    const tr = useUiTranslation();
    // This panel only needs to know whether any quote exists. Subscribing to the
    // complete tick map redrew the entire panel for every freshness timestamp.
    const liveTickCount = useAppStore(selectTickCount);
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    const positions = useAppStore((state) => state.positions);
    const pendingOrders = useAppStore((state) => state.orders);
    const dockLayout = useDockLayoutStore((state) => state.layout);
    const brokerAccountScopeKey = useBrokerAccountSessionScope();
    const brokerAccountScopeParts = brokerAccountScopeKey.split('|');
    const dailyChangeScopeKey = isAuthenticated
      && brokerAccountScopeParts[0] === 'authenticated'
      && Boolean(brokerAccountScopeParts[1])
      ? brokerAccountScopeKey
      : null;
    const {
      symbols: marketInstruments,
      authorizedInstruments: authenticatedMarketInstruments = [],
      authorizedSymbols: authenticatedMarketSymbols = [],
      disabledSymbols,
      loading: isLoadingSymbols,
      error: symbolsError,
      accountCatalogStatus,
      loadSymbolSpecification,
    } = marketInstrumentsSnapshot;
    // A logged-in account sees only its own group catalogue (empty while it
    // loads). Guests and the catalogue-failure fallback keep the public list.
    const accountUniverseActive = isAccountSymbolUniverseActive(isAuthenticated, accountCatalogStatus);
    const {
      symbols: activeMarketSymbols,
      loading: activeSymbolsLoading,
      settled: activeSymbolsSettled,
      current: activeSymbolsCurrent,
      error: activeSymbolsError,
      reload: reloadActiveMarketSymbols,
    } = activeMarketSnapshot;

    const activeWatchlist = useWatchlistStore((s) => {
      return s.watchlists.find((w) => w.id === s.activeWatchlistId);
    });
    const {
      loading: watchlistLoading,
      error: watchlistError,
    } = useRemoteWatchlistSync(activeWatchlist?.id);
    const [search, setSearch] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const [marketWatchOptions, setMarketWatchOptions] = useState<MarketWatchOptions>(() => loadMarketWatchOptions());
    const [columns, setColumns] = useState<MarketWatchColumnId[]>(() => loadMarketWatchColumns());
    const [sortMode, setSortMode] = useState<MarketWatchSortMode>(null);
    const [savedSets, setSavedSets] = useState<Record<string, MarketWatchSavedSet>>(() => loadMarketWatchSavedSets());
    const [isSaveSetOpen, setIsSaveSetOpen] = useState(false);
    const [saveSetName, setSaveSetName] = useState('');
    const [marketWatchView, setMarketWatchView] = useState<'symbols' | 'ticks'>('symbols');
    const normalizedSelectedSymbol = normalizeSymbol(selectedSymbol);
    const [tickChartSymbol, setTickChartSymbol] = useState(() => normalizedSelectedSymbol);
    const [popupPricesOpen, setPopupPricesOpen] = useState(false);
    const [isLightSkin, setIsLightSkin] = useState(false);
    const [showSymbolsPanel, setShowSymbolsPanel] = useState(false);
    const [hiddenSymbols, setHiddenSymbols] = useState<string[]>(() => getHiddenSymbols());
    const [specificationSymbol, setSpecificationSymbol] = useState<string | null>(null);
    const [refreshedSpecification, setRefreshedSpecification] = useState<{
      scopeKey: string;
      symbol: string;
      instrument: Readonly<Record<string, unknown>>;
    } | null>(null);
    const [specificationRequestStatus, setSpecificationRequestStatus] = useState<
      'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
    >('idle');
    const [specificationRequestKey, setSpecificationRequestKey] = useState<string | null>(null);
    const [contextSelection, setContextSelection] = useState<{
      activeSymbol: string;
      symbol: string;
    } | null>(null);
    const marketWatchSelectionSymbol = contextSelection?.activeSymbol === normalizedSelectedSymbol
      ? contextSelection.symbol
      : normalizedSelectedSymbol;
    const [selectedSymbolGroupKey, setSelectedSymbolGroupKey] = useState<string | null>(null);
    const [symbolExplorerViewport, setSymbolExplorerViewport] = useState({
      scrollTop: 0,
      height: SYMBOL_EXPLORER_FALLBACK_HEIGHT,
    });
    const [manualSymbols, setManualSymbols] = useState<ScopedManualSymbols>({
      watchlistId: activeWatchlist?.id ?? '',
      symbols: [],
    });
    const [pendingStatusRefreshSymbol, setPendingStatusRefreshSymbol] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const symbolExplorerScrollRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
    const [panelWidth, setPanelWidth] = useState(999);
    const searchListboxId = useId();

    useEffect(() => {
      const requestedSymbol = specificationSymbol;
      if (!requestedSymbol) return undefined;
      if (!isAuthenticated || !loadSymbolSpecification) return undefined;

      const controller = new AbortController();
      const requestKey = `${brokerAccountScopeKey}\u0000${requestedSymbol}`;
      void loadSymbolSpecification(requestedSymbol, controller.signal)
        .then((instrument) => {
          if (controller.signal.aborted) return;
          setSpecificationRequestKey(requestKey);
          if (!instrument) {
            setSpecificationRequestStatus('unavailable');
            return;
          }
          setRefreshedSpecification({
            scopeKey: brokerAccountScopeKey,
            symbol: requestedSymbol,
            instrument,
          });
          setSpecificationRequestStatus('ready');
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
          setSpecificationRequestKey(requestKey);
          setSpecificationRequestStatus('error');
        });

      return () => controller.abort();
    }, [
      brokerAccountScopeKey,
      isAuthenticated,
      loadSymbolSpecification,
      specificationSymbol,
    ]);

    useEffect(() => {
      const nextSymbol = normalizeSymbol(selectedSymbol);
      if (nextSymbol) setTickChartSymbol(nextSymbol);
    }, [selectedSymbol]);

    useEffect(() => {
      const handleWorkspaceMarketWatchRestore = (event: Event) => {
        setHiddenSymbols(getHiddenSymbols());
        const detail = (event as CustomEvent<{ options?: unknown; columns?: unknown }>).detail;
        if (detail?.options) setMarketWatchOptions(normalizeMarketWatchOptions(detail.options));
        if (detail?.columns) setColumns(normalizeMarketWatchColumns(detail.columns));
        setSavedSets(loadMarketWatchSavedSets());
      };

      window.addEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, handleWorkspaceMarketWatchRestore);
      return () => window.removeEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, handleWorkspaceMarketWatchRestore);
    }, []);

    useEffect(() => saveMarketWatchOptions(marketWatchOptions), [marketWatchOptions]);
    useEffect(() => saveMarketWatchColumns(columns), [columns]);

    useEffect(() => {
      const root = document.documentElement;
      const update = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
      update();
      const observer = new MutationObserver(update);
      observer.observe(root, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width > 0) setPanelWidth(entry.contentRect.width);
      });
      ro.observe(el);
      if (el.offsetWidth > 0) setPanelWidth(el.offsetWidth);
      return () => ro.disconnect();
    }, []);

    const displayedColumns = columns;

    const disabledSymbolSet = useMemo(() => new Set(uniqueSymbols(disabledSymbols)), [disabledSymbols]);

    const catalogSymbols = useMemo(
      () => getUniqueSymbolNames(marketInstruments),
      [marketInstruments],
    );

    const authorizedSymbols = useMemo(() => isAuthenticated
      ? uniqueSymbols([
        ...getUniqueSymbolNames(allSymbols),
        ...authenticatedMarketSymbols,
      ])
        .filter((symbol) => !disabledSymbolSet.has(symbol))
        .sort((a, b) => a.localeCompare(b))
      : [], [allSymbols, authenticatedMarketSymbols, disabledSymbolSet, isAuthenticated]);

    const quoteEligibleSymbols = catalogSymbols;
    const quoteEligibleSymbolSet = useMemo(
      () => new Set(quoteEligibleSymbols),
      [quoteEligibleSymbols],
    );
    const defaultSymbols = useMemo(
      () => (accountUniverseActive ? selectAccountDefaultMarketWatchSymbols : selectDefaultMarketWatchSymbols)(
        marketInstruments,
        [...allSymbols, ...marketInstruments],
      ),
      [accountUniverseActive, allSymbols, marketInstruments],
    );
    const shouldMergePersistedSymbols = shouldUseWatchlistAsMarketWatchSource({
      activeWatchlistId: activeWatchlist?.id,
      activeWatchlistIsDefault: activeWatchlist?.isDefault,
    });
    // Saved/remote watchlist rows outside the account catalogue are filtered
    // on display only: the persisted store is shared across accounts and the
    // remote sync writes full lists, so pruning it would delete user data.
    const persistedSymbols = useMemo(() => {
      if (!shouldMergePersistedSymbols) return [];
      const saved = activeWatchlist?.symbols ?? [];
      if (accountUniverseActive) return pruneSymbolsToUniverse(saved, quoteEligibleSymbols);
      return uniqueSymbols(saved)
        .map((symbol) => resolveMarketWatchSymbolInput(quoteEligibleSymbols, symbol) ?? symbol);
    }, [
      accountUniverseActive,
      activeWatchlist?.symbols,
      quoteEligibleSymbols,
      shouldMergePersistedSymbols,
    ]);
    const activeManualSymbols = useMemo(
      () => manualSymbols.watchlistId === (activeWatchlist?.id ?? '')
        ? manualSymbols.symbols
        : [],
      [activeWatchlist?.id, manualSymbols.symbols, manualSymbols.watchlistId],
    );
    const hiddenSymbolSet = useMemo(() => new Set(uniqueSymbols(hiddenSymbols)), [hiddenSymbols]);
    const baseRows = useMemo(() => {
      const nextRows = uniqueSymbols([
        ...(shouldMergePersistedSymbols ? persistedSymbols : defaultSymbols),
        ...activeManualSymbols,
      ]).filter((symbol) => shouldMergePersistedSymbols || !hiddenSymbolSet.has(symbol));
      // Rows drive quote demand (only visible rows subscribe), so restricting
      // them to the account catalogue also restricts live streaming.
      return accountUniverseActive ? pruneSymbolsToUniverse(nextRows, quoteEligibleSymbols) : nextRows;
    }, [
      accountUniverseActive,
      activeManualSymbols,
      defaultSymbols,
      hiddenSymbolSet,
      persistedSymbols,
      quoteEligibleSymbols,
      shouldMergePersistedSymbols,
    ]);
    const activeSymbolSet = useMemo(() => new Set(uniqueSymbols(activeMarketSymbols)), [activeMarketSymbols]);
    const utcDay = new Date().getUTCDay();
    const isTraditionalMarketWeekend = utcDay === 0 || utcDay === 6;
    const canIdentifyClosedSymbols = activeSymbolsSettled && activeSymbolsCurrent;
    const sortMetadata = useMemo(() => {
      const metadata = new Map<string, MarketWatchSortMetadata>();
      for (const instrument of [...marketInstruments, ...allSymbols]) {
        const symbol = getInstrumentSymbolName(instrument);
        if (!symbol || !instrument || typeof instrument !== 'object') continue;
        const record = instrument as Record<string, unknown>;
        const previous = metadata.get(symbol) ?? {};
        const industry = String(record.industry ?? '').trim();
        const sector = String(record.sector ?? record.category ?? record.asset_class ?? record.assetClass ?? '').trim();
        metadata.set(symbol, {
          industry: previous.industry || industry || undefined,
          sector: previous.sector || sector || undefined,
        });
      }
      return metadata;
    }, [allSymbols, marketInstruments]);
    const usesClosedDailySort = sortMode === 'gainers' || sortMode === 'losers';
    const closedDailySortSymbols = useMemo(() => {
      if (
        !usesClosedDailySort
        || !dailyChangeScopeKey
        || (!canIdentifyClosedSymbols && !isTraditionalMarketWeekend)
      ) return [];
      // Re-evaluate the fallback scope when REST/WebSocket quotes populate.
      void liveTickCount;
      return baseRows.filter((symbol) => {
        if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
        if (readFiniteDailyChange(getTickSnapshot(symbol)?.dailyChange) !== null) return false;
        return resolveMarketWatchSymbolGroup(symbol).key !== 'crypto';
      });
    }, [
      activeSymbolSet,
      baseRows,
      canIdentifyClosedSymbols,
      dailyChangeScopeKey,
      isTraditionalMarketWeekend,
      liveTickCount,
      usesClosedDailySort,
    ]);
    const closedDailySortChanges = useClosedMarketDailyChanges({
      enabled: usesClosedDailySort
        && Boolean(dailyChangeScopeKey)
        && (canIdentifyClosedSymbols || isTraditionalMarketWeekend),
      scopeKey: dailyChangeScopeKey,
      symbols: closedDailySortSymbols,
    });
    const usesDynamicSort = usesClosedDailySort || sortMode === 'volume';
    const sortTickSnapshot = useAppStore((state) => usesDynamicSort ? state.ticks : EMPTY_SORT_TICKS);
    const rows = useMemo(() => sortMarketWatchSymbols(
      baseRows,
      sortMode,
      (symbol) => {
        const tick = resolveTickFromLookup(sortTickSnapshot, useAppStore.getState().tickLookup, symbol);
        if (!usesClosedDailySort || readFiniteDailyChange(tick?.dailyChange) !== null) return tick;
        const fallback = readFiniteDailyChange(closedDailySortChanges.get(symbol));
        return fallback === null ? tick : { dailyChange: fallback, volume: tick?.volume };
      },
      sortMetadata,
    ), [baseRows, closedDailySortChanges, sortMetadata, sortMode, sortTickSnapshot, usesClosedDailySort]);
    const {
      visibleSymbols: visibleRowSymbols,
      setViewportRef: setMarketWatchViewportRef,
      setRowRef: setVisibleMarketWatchRowRef,
    } = useVisibleSymbolRows(rows);
    const marketWatchRowsKey = rows.join('\u0000');
    const marketWatchSymbolOrder = useMemo(
      () => new Map(rows.map((symbol, index) => [symbol, index] as const)),
      [rows],
    );
    const marketWatchSymbolSet = useMemo(
      () => new Set(rows),
      [rows],
    );
    const marketWatchRowRefCallbacks = useMemo(
      () => new Map(
        (marketWatchRowsKey ? marketWatchRowsKey.split('\u0000') : []).map((symbol) => [
          symbol,
          (node: HTMLTableRowElement | null) => {
            setVisibleMarketWatchRowRef(symbol, node);
            if (node) {
              rowRefs.current.set(symbol, node);
            } else {
              rowRefs.current.delete(symbol);
            }
          },
        ] as const),
      ),
      [marketWatchRowsKey, setVisibleMarketWatchRowRef],
    );
    const actionableSymbolSet = useMemo(() => new Set(
      activeSymbolsCurrent
        ? authorizedSymbols.filter((symbol) => activeSymbolSet.has(symbol))
        : [],
    ), [activeSymbolSet, activeSymbolsCurrent, authorizedSymbols]);
    const chartOpenableSymbolSet = useMemo(() => (
      chartSymbols === undefined
        ? actionableSymbolSet
        : new Set(getUniqueSymbolNames(chartSymbols))
    ), [actionableSymbolSet, chartSymbols]);
    const liveQuoteSymbolSet = useMemo(() => new Set(
      activeSymbolsCurrent
        ? quoteEligibleSymbols.filter((symbol) => activeSymbolSet.has(symbol))
        : [],
    ), [activeSymbolSet, activeSymbolsCurrent, quoteEligibleSymbols]);
    const protectedSymbolSet = useMemo(() => {
      const protectedSymbols = new Set<string>();
      getChartPanels(dockLayout).forEach((panel) => {
        const chartSymbol = normalizeSymbol(panel.props?.symbol ?? panel.title?.split(',')[0]);
        if (chartSymbol) protectedSymbols.add(chartSymbol);
        panel.chartSymbolTabs?.forEach((tab) => {
          const tabSymbol = normalizeSymbol(tab.symbol);
          if (tabSymbol) protectedSymbols.add(tabSymbol);
        });
      });
      positions.forEach((position) => {
        if (Number(position.volume ?? position.quantity ?? 0) <= 0) return;
        const positionSymbol = normalizeSymbol(position.symbol);
        if (positionSymbol) protectedSymbols.add(positionSymbol);
      });
      pendingOrders.forEach((order) => {
        if (order.status !== 'PENDING' && order.status !== 'TRIGGERED') return;
        const orderSymbol = normalizeSymbol(order.symbol);
        if (orderSymbol) protectedSymbols.add(orderSymbol);
      });
      return protectedSymbols;
    }, [dockLayout, pendingOrders, positions]);
    const searchUniverse = quoteEligibleSymbols;
    const symbolDescriptionByName = useMemo(() => {
      const descriptions = new Map<string, string>();
      for (const instrument of [...marketInstruments, ...allSymbols]) {
        const instrumentSymbol = getInstrumentSymbolName(instrument);
        const description = readInstrumentDescription(instrument, instrumentSymbol);
        if (
          instrumentSymbol
          && description
          && !descriptions.has(instrumentSymbol)
        ) {
          descriptions.set(instrumentSymbol, description);
        }
      }
      return descriptions;
    }, [allSymbols, marketInstruments]);
    const symbolGroups = useMemo(() => buildMarketWatchSymbolGroups(
      searchUniverse,
      [...allSymbols, ...marketInstruments],
      rows,
    ), [allSymbols, marketInstruments, rows, searchUniverse]);
    const symbolGroupKeyByName = useMemo(() => {
      const groupsBySymbol = new Map<string, string>();
      symbolGroups.forEach((group) => {
        group.symbols.forEach((symbol) => groupsBySymbol.set(symbol, group.key));
      });
      return groupsBySymbol;
    }, [symbolGroups]);
    const missingQuoteSymbols = useMemo(() => {
      void liveTickCount;
      if (!dailyChangeScopeKey) return [];
      return visibleRowSymbols.filter((symbol) => !hasMarketWatchQuote(getTickSnapshot(symbol)));
    }, [dailyChangeScopeKey, liveTickCount, visibleRowSymbols]);
    const candleFallbackSymbols = useMemo(() => {
      if (!canIdentifyClosedSymbols && !isTraditionalMarketWeekend) return [];
      return missingQuoteSymbols.filter((symbol) => {
        if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
        const groupKey = symbolGroupKeyByName.get(symbol)
          ?? resolveMarketWatchSymbolGroup(symbol).key;
        return groupKey !== 'crypto';
      });
    }, [activeSymbolSet, canIdentifyClosedSymbols, isTraditionalMarketWeekend, missingQuoteSymbols, symbolGroupKeyByName]);
    const lastPrices = useLastMarketWatchQuotes({
      enabled: Boolean(dailyChangeScopeKey),
      scopeKey: dailyChangeScopeKey,
      symbols: missingQuoteSymbols,
      candleSymbols: candleFallbackSymbols,
    });
    const closedDailyChangeSymbols = useMemo(() => {
      if (!dailyChangeScopeKey || (!canIdentifyClosedSymbols && !isTraditionalMarketWeekend)) return [];
      // Re-evaluate after the initial REST quote batch populates the tick store.
      void liveTickCount;

      return visibleRowSymbols.filter((symbol) => {
        if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
        if (readFiniteDailyChange(getTickSnapshot(symbol)?.dailyChange) !== null) return false;
        const groupKey = symbolGroupKeyByName.get(symbol)
          ?? resolveMarketWatchSymbolGroup(symbol).key;
        return groupKey !== 'crypto';
      });
    }, [
      activeSymbolSet,
      canIdentifyClosedSymbols,
      dailyChangeScopeKey,
      isTraditionalMarketWeekend,
      liveTickCount,
      symbolGroupKeyByName,
      visibleRowSymbols,
    ]);
    const visibleClosedDailyChanges = useClosedMarketDailyChanges({
      enabled: !usesClosedDailySort
        && Boolean(dailyChangeScopeKey)
        && (canIdentifyClosedSymbols || isTraditionalMarketWeekend),
      scopeKey: dailyChangeScopeKey,
      symbols: usesClosedDailySort ? [] : closedDailyChangeSymbols,
    });
    const closedDailyChanges = usesClosedDailySort
      ? closedDailySortChanges
      : visibleClosedDailyChanges;
    const selectedSymbolGroup = useMemo(
      () => symbolGroups.find((group) => group.key === selectedSymbolGroupKey) ?? null,
      [selectedSymbolGroupKey, symbolGroups],
    );
    const selectedGroupSymbols = useMemo(() => {
      const groupSymbols = selectedSymbolGroup?.symbols ?? [];
      return [...groupSymbols].sort((left, right) => {
        const leftOrder = marketWatchSymbolOrder.get(left);
        const rightOrder = marketWatchSymbolOrder.get(right);
        if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
        if (leftOrder !== undefined) return -1;
        if (rightOrder !== undefined) return 1;
        return 0;
      });
    }, [marketWatchSymbolOrder, selectedSymbolGroup]);
    // Keep every symbol in the active watchlist subscribed, including rows that
    // are currently outside the scroll viewport. Visibility still scopes the
    // historical fallback requests below, but it must not suppress live ticks
    // for a symbol the user has explicitly added.
    const subscriptionSymbols = rows;

    const filteredSymbols = useMemo(() => {
      if (search.trim()) {
        return searchMarketWatchSymbols(searchUniverse, search, Math.max(1, searchUniverse.length));
      }
      return selectedGroupSymbols;
    }, [search, searchUniverse, selectedGroupSymbols]);
    const showingSymbolGroups = showSymbolsPanel && !search.trim() && !selectedSymbolGroup;
    const explorerOptionCount = showingSymbolGroups ? symbolGroups.length : filteredSymbols.length;
    const symbolExplorerWindow = useMemo(() => {
      const maxScrollTop = Math.max(
        0,
        filteredSymbols.length * SYMBOL_EXPLORER_ROW_HEIGHT - symbolExplorerViewport.height,
      );
      const effectiveScrollTop = Math.min(symbolExplorerViewport.scrollTop, maxScrollTop);
      const startIndex = Math.max(
        0,
        Math.floor(effectiveScrollTop / SYMBOL_EXPLORER_ROW_HEIGHT) - SYMBOL_EXPLORER_OVERSCAN,
      );
      const endIndex = Math.min(
        filteredSymbols.length,
        Math.ceil((effectiveScrollTop + symbolExplorerViewport.height) / SYMBOL_EXPLORER_ROW_HEIGHT)
        + SYMBOL_EXPLORER_OVERSCAN,
      );

      return {
        startIndex,
        endIndex,
        topSpacerHeight: startIndex * SYMBOL_EXPLORER_ROW_HEIGHT,
        bottomSpacerHeight: (filteredSymbols.length - endIndex) * SYMBOL_EXPLORER_ROW_HEIGHT,
      };
    }, [filteredSymbols.length, symbolExplorerViewport]);
    const renderedExplorerSymbols = filteredSymbols.slice(
      symbolExplorerWindow.startIndex,
      symbolExplorerWindow.endIndex,
    );

    useLayoutEffect(() => {
      const element = symbolExplorerScrollRef.current;
      if (!element || showingSymbolGroups) return;

      const measure = () => {
        const height = element.clientHeight || SYMBOL_EXPLORER_FALLBACK_HEIGHT;
        setSymbolExplorerViewport((current) => (
          current.height === height ? current : { ...current, height }
        ));
      };

      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }, [showSymbolsPanel, showingSymbolGroups]);

    useEffect(() => {
      const element = symbolExplorerScrollRef.current;
      if (element) element.scrollTop = 0;
      setSymbolExplorerViewport((current) => (
        current.scrollTop === 0 ? current : { ...current, scrollTop: 0 }
      ));
    }, [search, selectedSymbolGroupKey]);

    const handleSymbolExplorerScroll = useCallback(() => {
      const element = symbolExplorerScrollRef.current;
      if (!element) return;
      const scrollTop = element.scrollTop;
      const height = element.clientHeight || SYMBOL_EXPLORER_FALLBACK_HEIGHT;
      setSymbolExplorerViewport((current) => (
        current.scrollTop === scrollTop && current.height === height
          ? current
          : { scrollTop, height }
      ));
    }, []);

    const scrollSymbolIntoView = useCallback((symbol: string) => {
      window.requestAnimationFrame(() => {
        rowRefs.current.get(symbol)?.scrollIntoView({ block: 'center' });
      });
    }, []);

    const handleSelectSymbol = useCallback((symbol: string) => {
      const next = resolveMarketWatchSymbolInput(searchUniverse, symbol);
      if (!next || !quoteEligibleSymbolSet.has(next)) return;
      if (!shouldMergePersistedSymbols && hiddenSymbolSet.has(next)) {
        setHiddenSymbols(restoreHiddenSymbol(next));
      }
      const isNewRow = !rows.includes(next);
      if (isNewRow) {
        setManualSymbols((current) => {
          const watchlistId = activeWatchlist?.id ?? '';
          const currentSymbols = current.watchlistId === watchlistId ? current.symbols : [];
          return {
            watchlistId,
            symbols: currentSymbols.includes(next) ? currentSymbols : [...currentSymbols, next],
          };
        });
        setPendingStatusRefreshSymbol(next);
      }
      if (
        shouldMergePersistedSymbols
        && activeWatchlist
        && !persistedSymbols.includes(next)
      ) {
        useWatchlistStore.getState().addSymbolToWatchlist(activeWatchlist.id, next);
      }
      setSearch('');
      setShowSymbolsPanel(false);
      setSelectedSymbolGroupKey(null);
      setHighlightIndex(-1);
      inputRef.current?.blur();
      setTickChartSymbol(next);
      onSymbolSelect(next);
      scrollSymbolIntoView(next);

      // The shared selection callback owns chart navigation for rows and search.
      // Do not dispatch a second request that could open or select another pane.
    }, [
      activeWatchlist,
      hiddenSymbolSet,
      quoteEligibleSymbolSet,
      onSymbolSelect,
      persistedSymbols,
      rows,
      scrollSymbolIntoView,
      searchUniverse,
      shouldMergePersistedSymbols,
    ]);

    const publishMarketWatchFeedback = useCallback((
      message: string,
      type: 'success' | 'error' = 'success',
      notice?: ActionFeedbackNotice,
    ) => {
      window.dispatchEvent(new CustomEvent('rtx:order-feedback', { detail: { message, notice, type } }));
    }, []);

    const handleHideSymbol = useCallback((symbol: string) => {
      const next = normalizeSymbol(symbol);
      if (!next) return;
      if (protectedSymbolSet.has(next)) {
        publishMarketWatchFeedback(
          tr('{{value0}} cannot be hidden while it has an open chart, position, or order', { value0: next }),
          'error',
        );
        return;
      }

      const watchlistId = activeWatchlist?.id ?? '';
      setManualSymbols((current) => ({
        watchlistId,
        symbols: current.watchlistId === watchlistId
          ? current.symbols.filter((item) => normalizeSymbol(item) !== next)
          : [],
      }));

      if (!shouldMergePersistedSymbols) {
        setHiddenSymbols(persistHiddenSymbol(next));
      } else if (activeWatchlist) {
        const persistedSymbol = activeWatchlist.symbols.find((item) => (
          (resolveMarketWatchSymbolInput(authorizedSymbols, item) ?? normalizeSymbol(item)) === next
        )) ?? next;
        useWatchlistStore.getState().removeSymbolFromWatchlist(activeWatchlist.id, persistedSymbol);
      }
      useMarketDataStore.getState().clearTickBuffer(next);
    }, [
      activeWatchlist,
      authorizedSymbols,
      protectedSymbolSet,
      publishMarketWatchFeedback,
      shouldMergePersistedSymbols,
      tr,
    ]);

    const handleHideAll = useCallback(() => {
      const watchlistId = activeWatchlist?.id ?? '';
      const retained = rows.filter((symbol) => protectedSymbolSet.has(symbol));
      const hideable = rows.filter((symbol) => !protectedSymbolSet.has(symbol));
      setManualSymbols({ watchlistId, symbols: retained });
      if (!shouldMergePersistedSymbols) {
        setHiddenSymbols(persistHiddenSymbols(hideable));
      } else if (activeWatchlist) {
        useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, retained);
      }
      if (retained.length > 0) {
        publishMarketWatchFeedback(
          tr('{{value0}} in-use symbols were kept visible', { value0: retained.length }),
          'success',
        );
      }
      hideable.forEach((symbol) => useMarketDataStore.getState().clearTickBuffer(symbol));
    }, [activeWatchlist, protectedSymbolSet, publishMarketWatchFeedback, rows, shouldMergePersistedSymbols, tr]);

    const handleShowAll = useCallback(() => {
      const watchlistId = activeWatchlist?.id ?? '';
      setManualSymbols({ watchlistId, symbols: [...quoteEligibleSymbols] });
      if (!shouldMergePersistedSymbols) {
        clearHiddenSymbols();
        setHiddenSymbols([]);
      } else if (activeWatchlist) {
        useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, quoteEligibleSymbols);
      }
    }, [activeWatchlist, quoteEligibleSymbols, shouldMergePersistedSymbols]);

    const applySymbolSet = useCallback((set: MarketWatchSavedSet) => {
      const requestedSymbols = uniqueSymbols(set.symbols)
        .map((symbol) => resolveMarketWatchSymbolInput(quoteEligibleSymbols, symbol) ?? '')
        .filter(Boolean);
      const retainedProtected = rows.filter((symbol) => protectedSymbolSet.has(symbol));
      const nextSymbols = uniqueSymbols([...requestedSymbols, ...retainedProtected]);
      const nextSymbolSet = new Set(nextSymbols);
      rows
        .filter((symbol) => !nextSymbolSet.has(symbol))
        .forEach((symbol) => useMarketDataStore.getState().clearTickBuffer(symbol));
      const watchlistId = activeWatchlist?.id ?? '';
      setManualSymbols({ watchlistId, symbols: nextSymbols });
      setColumns(normalizeMarketWatchColumns(set.columns));
      setMarketWatchView('symbols');
      if (shouldMergePersistedSymbols && activeWatchlist) {
        useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, nextSymbols);
      } else {
        clearHiddenSymbols();
        const nextSet = new Set(nextSymbols);
        setHiddenSymbols(persistHiddenSymbols(quoteEligibleSymbols.filter((symbol) => !nextSet.has(symbol))));
      }
    }, [activeWatchlist, protectedSymbolSet, quoteEligibleSymbols, rows, shouldMergePersistedSymbols]);

    const handleSaveSet = useCallback(() => {
      const normalizedName = saveSetName.trim();
      if (!normalizedName) return;
      setSavedSets(saveMarketWatchSavedSet(normalizedName, rows, columns));
      setIsSaveSetOpen(false);
      setSaveSetName('');
      publishMarketWatchFeedback(tr('Market Watch set saved: {{value0}}', { value0: normalizedName }));
    }, [columns, publishMarketWatchFeedback, rows, saveSetName, tr]);

    const toggleColumn = useCallback((column: MarketWatchColumnId | 'highLow') => {
      setColumns((current) => {
        const currentSet = new Set(current);
        const targets: MarketWatchColumnId[] = column === 'highLow' ? ['high', 'low'] : [column];
        const shouldRemove = targets.some((target) => currentSet.has(target));
        targets.forEach((target) => {
          if (target === 'symbol' || target === 'bid') return;
          if (shouldRemove) currentSet.delete(target);
          else currentSet.add(target);
        });
        return normalizeMarketWatchColumns(Array.from(currentSet));
      });
    }, []);

    const handleExport = useCallback(async () => {
      const labels: Record<MarketWatchColumnId, string> = {
        symbol: 'Symbol', bid: 'Bid', ask: 'Ask', last: 'Last', high: 'High', low: 'Low',
        volume: 'Volume', spread: 'Spread', time: 'Time', dailyChange: 'Daily Change', source: 'Source',
      };
      const exportColumns = displayedColumns;
      const cells = rows.map((sym) => {
        const tick = getTickSnapshot(sym);
        const dailyChange = readFiniteDailyChange(tick?.dailyChange)
          ?? readFiniteDailyChange(closedDailyChanges.get(sym));
        const fallback = hasMarketWatchQuote(tick) ? undefined : lastPrices.get(sym);
        const quote = hasMarketWatchQuote(tick) ? tick : fallback?.kind === 'quote' ? fallback : undefined;
        return exportColumns.map((column) => {
          switch (column) {
            case 'symbol': return sym;
            case 'bid': return quote?.bid !== undefined
              ? formatMarketWatchExportPrice(sym, quote.bid)
              : fallback?.kind === 'close'
                ? `${tr('Last close')}: ${formatMarketWatchExportPrice(sym, fallback.close)}`
                : '-';
            case 'ask': return formatMarketWatchExportPrice(sym, quote?.ask);
            case 'last': return formatMarketWatchExportPrice(sym, tick?.last);
            case 'high': return formatMarketWatchExportPrice(sym, tick?.high ?? tick?.high24h);
            case 'low': return formatMarketWatchExportPrice(sym, tick?.low ?? tick?.low24h);
            case 'volume': return tick?.volume ?? '-';
            case 'spread': return hasMarketWatchQuote(quote)
              ? formatSpreadDisplay(sym, tick?.spread, quote?.bid, quote?.ask)
              : '-';
            case 'time': return formatMarketWatchTime(
              tick?.sourceTimestamp ?? tick?.timestamp ?? fallback?.asOf,
              marketWatchOptions.showMilliseconds,
            );
            case 'dailyChange': return dailyChange !== null ? `${dailyChange.toFixed(2)}%` : '-';
            case 'source': return tick?.lp ?? '-';
            default: return '-';
          }
        });
      });
      const headers = exportColumns.map((column) => tr(labels[column]));
      const clipboardPayload = `${headers.map(escapeMarketWatchTsvCell).join('\t')}\n${cells
        .map(cell => cell.map(escapeMarketWatchTsvCell).join('\t'))
        .join('\n')}`;
      const csv = `${headers.map(escapeMarketWatchCsvCell).join(',')}\n${cells
        .map(cell => cell.map(escapeMarketWatchCsvCell).join(','))
        .join('\n')}`;
      const fileName = `market-watch-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
      const exportSnapshot: Readonly<Omit<MarketWatchExportResult, 'destination'>> = Object.freeze({
        symbolCount: rows.length,
        columnCount: exportColumns.length,
        fileName,
        csv,
      });
      const copied = await copyTextToClipboard(clipboardPayload);
      if (copied) {
        const message = tr('Market Watch exported to clipboard ({{value0}} symbols)', { value0: exportSnapshot.symbolCount });
        publishMarketWatchFeedback(
          message,
          'success',
          {
            title: tr('Market Watch'),
            description: message,
            metaLabel: tr('Destination'),
            meta: tr('System clipboard'),
            metaIcon: 'copy',
            hint: tr('No file was created. Press Ctrl+V to paste into Excel or another app.'),
            exportResult: { destination: 'clipboard', ...exportSnapshot },
          },
        );
        return;
      }

      // Clipboard can be unavailable (permissions, embedded shells); fall back to a file.
      try {
        downloadMarketWatchCsv(exportSnapshot.csv, exportSnapshot.fileName);
        const message = tr('Market Watch exported to CSV ({{value0}} symbols)', { value0: exportSnapshot.symbolCount });
        publishMarketWatchFeedback(
          message,
          'success',
          {
            title: tr('Market Watch'),
            description: message,
            metaLabel: tr('Destination'),
            meta: tr('Browser download: {{value0}}', { value0: exportSnapshot.fileName }),
            metaIcon: 'download',
            exportResult: { destination: 'download', ...exportSnapshot },
          },
        );
      } catch {
        publishMarketWatchFeedback(
          tr('Market Watch export failed'),
          'error',
          {
            title: tr('Market Watch'),
            description: tr('Market Watch export failed'),
            meta: tr('Failed'),
            metaIcon: 'error',
            exportResult: { destination: 'failed', ...exportSnapshot },
          },
        );
      }
    }, [closedDailyChanges, displayedColumns, lastPrices, marketWatchOptions.showMilliseconds, publishMarketWatchFeedback, rows, tr]);

    const getContextMenuItems = useCallback((symbol: string): ContextMenuItemConfig[] => {
      const tradeDisabled = !actionableSymbolSet.has(symbol);
      const chartDisabled = !chartOpenableSymbolSet.has(symbol);
      const symbolProtected = protectedSymbolSet.has(symbol);
      const groupKey = symbolGroupKeyByName.get(symbol) ?? resolveMarketWatchSymbolGroup(symbol).key;
      const fundamentalLinks = getFundamentalLinks(symbol, groupKey);
      const isSubscriptionSymbol = groupKey === 'stocks';
      const hasIndustry = Array.from(sortMetadata.values()).some((metadata) => Boolean(metadata.industry));
      const hasSector = Array.from(sortMetadata.values()).some((metadata) => Boolean(metadata.sector));
      const savedSetEntries = Object.entries(savedSets).sort(([left], [right]) => left.localeCompare(right));
      const columnItems: ContextMenuItemConfig[] = [
        { label: 'Last', checked: columns.includes('last'), action: () => toggleColumn('last'), autoClose: false },
        { label: 'High/Low', checked: columns.includes('high') || columns.includes('low'), action: () => toggleColumn('highLow'), autoClose: false },
        { label: 'Volume', checked: columns.includes('volume'), action: () => toggleColumn('volume'), autoClose: false },
        { label: 'Spread', checked: columns.includes('spread'), action: () => toggleColumn('spread'), autoClose: false },
        { label: 'Time', checked: columns.includes('time'), action: () => toggleColumn('time'), autoClose: false },
        { label: 'Daily Change', checked: columns.includes('dailyChange'), action: () => toggleColumn('dailyChange'), autoClose: false },
        { label: 'Source', checked: columns.includes('source'), action: () => toggleColumn('source'), autoClose: false },
      ];
      const setsSubmenu: ContextMenuItemConfig[] = [
        {
          label: 'Save as',
          action: () => {
            setSaveSetName('');
            setIsSaveSetOpen(true);
          },
        },
        {
          label: 'Remove',
          disabled: savedSetEntries.length === 0,
          submenu: savedSetEntries.map(([name]) => ({
            label: name,
            action: () => setSavedSets(deleteMarketWatchSavedSet(name)),
          })),
        },
        {
          label: 'Add',
          submenu: symbolGroups.map((group) => ({
            label: group.label,
            action: () => applySymbolSet({
              symbols: uniqueSymbols([...rows, ...group.symbols]),
              columns,
            }),
          })),
        },
        ...(savedSetEntries.length > 0 ? [
          { divider: true } as ContextMenuItemConfig,
          ...savedSetEntries.map(([name, set]) => ({ label: name, action: () => applySymbolSet(set) })),
        ] : []),
      ];
      return [
        {
          label: 'New Order',
          icon: <Icon name="new-order" size="xs" />,
          shortcut: 'F9',
          disabled: tradeDisabled,
          action: () => {
            window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } }));
          },
        },
        {
          label: 'Chart Window',
          icon: <Icon name="new-chart" size="xs" />,
          disabled: chartDisabled,
          action: () => {
            window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol, newWindow: true } }));
          },
        },
        {
          label: 'Tick Chart',
          icon: <Icon name="line-chart" size="xs" />,
          disabled: !quoteEligibleSymbolSet.has(symbol),
          action: () => {
            setTickChartSymbol(symbol);
            setMarketWatchView('ticks');
            setShowSymbolsPanel(false);
          },
        },
        {
          label: 'Depth Of Market',
          icon: <Icon name="grid-3x3" size="xs" />,
          shortcut: 'Alt+B',
          disabled: tradeDisabled,
          action: () => {
            window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } }));
          },
        },
        {
          label: 'Options Board',
          icon: <Icon name="layers" size="xs" />,
          disabled: true,
        },
        {
          label: 'Specification',
          icon: <Icon name="file-text" size="xs" />,
          action: () => {
            setRefreshedSpecification(null);
            setSpecificationRequestKey(`${brokerAccountScopeKey}\u0000${symbol}`);
            setSpecificationRequestStatus(isAuthenticated && loadSymbolSpecification ? 'loading' : 'ready');
            setSpecificationSymbol(symbol);
          },
        },
        ...(isSubscriptionSymbol ? [{
          label: 'Subscribe to Realtime Datafeed',
          icon: <Icon name="refresh" size="xs" />,
          disabled: true,
        } as ContextMenuItemConfig] : []),
        ...(fundamentalLinks.length > 0 ? [{
          label: 'Fundamental Data',
          submenu: fundamentalLinks.map((link) => ({
            label: link.label,
            action: () => openTrustedExternalLink(link.url),
          })),
        } as ContextMenuItemConfig] : []),
        {
          label: 'Popup Prices',
          icon: <Icon name="bar-chart-2" size="xs" />,
          shortcut: 'F10',
          action: () => setPopupPricesOpen(true),
        },
        { divider: true },
        {
          label: 'Hide',
          icon: <Icon name="eye-off" size="xs" />,
          shortcut: 'Delete',
          disabled: symbolProtected,
          action: () => handleHideSymbol(symbol),
        },
        {
          label: 'Hide All',
          icon: <Icon name="x-close" size="xs" />,
          action: handleHideAll,
        },
        {
          label: 'Show All',
          icon: <Icon name="eye" size="xs" />,
          action: handleShowAll,
        },
        { divider: true },
        {
          label: 'Symbols',
          icon: <Icon name="symbol-box" size="xs" />,
          shortcut: 'Ctrl+U',
          action: () => window.dispatchEvent(new CustomEvent('openSymbolsDialog')),
        },
        {
          label: 'Sets',
          submenu: setsSubmenu,
        },
        {
          label: 'Sort',
          icon: <Icon name="sort" size="xs" />,
          submenu: [
            { label: 'Symbol', checked: sortMode === 'symbol', action: () => setSortMode('symbol') },
            { label: 'Industry', checked: sortMode === 'industry', disabled: !hasIndustry, action: () => setSortMode('industry') },
            { label: 'Sector', checked: sortMode === 'sector', disabled: !hasSector, action: () => setSortMode('sector') },
            { label: 'Gainers', checked: sortMode === 'gainers', action: () => setSortMode('gainers') },
            { label: 'Losers', checked: sortMode === 'losers', action: () => setSortMode('losers') },
            { label: 'Deals Volume', checked: sortMode === 'volume', action: () => setSortMode('volume') },
            { divider: true },
            { label: 'Reset', checked: sortMode === null, action: () => setSortMode(null) },
          ],
        },
        {
          label: 'Export',
          icon: <Icon name="export" size="xs" />,
          action: handleExport,
        },
        { divider: true },
        {
          label: 'Show Milliseconds',
          checked: marketWatchOptions.showMilliseconds,
          action: () => setMarketWatchOptions((current) => ({ ...current, showMilliseconds: !current.showMilliseconds })),
          autoClose: false,
        },
        {
          label: 'Auto Remove Expired',
          checked: marketWatchOptions.autoRemoveExpired,
          disabled: true,
        },
        {
          label: 'Auto Arrange',
          checked: marketWatchOptions.autoArrange,
          shortcut: 'A',
          action: () => setMarketWatchOptions((current) => ({ ...current, autoArrange: !current.autoArrange })),
          autoClose: false,
        },
        {
          label: 'Grid',
          icon: <Icon name="grid-3x3" size="xs" />,
          shortcut: 'G',
          checked: marketWatchOptions.showGrid,
          action: () => setMarketWatchOptions((current) => ({ ...current, showGrid: !current.showGrid })),
          autoClose: false,
        },
        { divider: true },
        {
          label: 'Columns',
          submenu: columnItems,
        },
      ];
    }, [
      actionableSymbolSet,
      applySymbolSet,
      brokerAccountScopeKey,
      chartOpenableSymbolSet,
      columns,
      handleExport,
      handleHideAll,
      handleHideSymbol,
      handleShowAll,
      isAuthenticated,
      loadSymbolSpecification,
      marketWatchOptions,
      protectedSymbolSet,
      quoteEligibleSymbolSet,
      rows,
      savedSets,
      sortMetadata,
      sortMode,
      symbolGroupKeyByName,
      symbolGroups,
      toggleColumn,
    ]);

    const specificationAuthorizedInstrument = useMemo(() => (
      specificationSymbol
        ? findInstrumentBySymbol(authenticatedMarketInstruments, specificationSymbol)
        : undefined
    ), [authenticatedMarketInstruments, specificationSymbol]);
    const specificationPublicInstrument = useMemo(() => (
      specificationSymbol ? findInstrumentBySymbol(allSymbols, specificationSymbol) : undefined
    ), [allSymbols, specificationSymbol]);
    const specificationCatalogInstrument = useMemo(() => (
      specificationSymbol ? findInstrumentBySymbol(marketInstruments, specificationSymbol) : undefined
    ), [marketInstruments, specificationSymbol]);
    const refreshedSpecificationInstrument = specificationSymbol
      && refreshedSpecification?.scopeKey === brokerAccountScopeKey
      && refreshedSpecification.symbol === specificationSymbol
      ? refreshedSpecification.instrument
      : undefined;
    const specificationInstrument = useMemo(() => (
      refreshedSpecificationInstrument
        ?? (isAuthenticated && loadSymbolSpecification
          ? undefined
          : specificationAuthorizedInstrument
            ? getBrokerSpecificationSource(specificationAuthorizedInstrument)
            : getPublicSpecificationSource(specificationPublicInstrument ?? specificationCatalogInstrument))
    ), [
      isAuthenticated,
      loadSymbolSpecification,
      refreshedSpecificationInstrument,
      specificationAuthorizedInstrument,
      specificationCatalogInstrument,
      specificationPublicInstrument,
    ]);
    const specificationFallbackInstrument = useMemo(() => {
      const fallback = specificationAuthorizedInstrument
        ? (specificationPublicInstrument ?? specificationCatalogInstrument)
        : (specificationCatalogInstrument ?? specificationPublicInstrument);
      return getPublicSpecificationSource(fallback);
    }, [
      specificationAuthorizedInstrument,
      specificationCatalogInstrument,
      specificationPublicInstrument,
    ]);
    const specificationRequestKeyForDialog = specificationSymbol
      ? `${brokerAccountScopeKey}\u0000${specificationSymbol}`
      : null;
    const effectiveSpecificationRequestStatus = !isAuthenticated || !loadSymbolSpecification
      ? 'ready'
      : specificationRequestKey === specificationRequestKeyForDialog
        ? specificationRequestStatus
        : 'loading';

    const isSymbolListLoading = isLoadingSymbols || watchlistLoading || (searchUniverse.length === 0 && activeSymbolsLoading);
    useTerminalStartupReady('marketWatch', !isSymbolListLoading);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (shouldIgnoreShortcutEvent(e) || isShortcutInput(e) || isShortcutLocalScope(e) || isShortcutOverlay(e)) return;
        if (!containerRef.current?.contains(getShortcutEventTarget(e))) return;
        // The global manager owns these commands. This scoped fallback serves
        // a standalone Market Watch only when the event was not already used.
        if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          e.preventDefault();
          if (actionableSymbolSet.has(normalizeSymbol(selectedSymbol))) {
            window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol: selectedSymbol } }));
          }
        }
        if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          e.preventDefault();
          setPopupPricesOpen(true);
        }
        if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          if (actionableSymbolSet.has(normalizeSymbol(selectedSymbol))) {
            window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol: selectedSymbol } }));
          }
        }
        if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          setMarketWatchOptions((current) => ({ ...current, autoArrange: !current.autoArrange }));
        }
        if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'g') {
          e.preventDefault();
          setMarketWatchOptions((current) => ({ ...current, showGrid: !current.showGrid }));
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [actionableSymbolSet, selectedSymbol]);

    const closeSymbolExplorer = useCallback(() => {
      setSearch('');
      setSelectedSymbolGroupKey(null);
      setShowSymbolsPanel(false);
      setHighlightIndex(-1);
    }, []);

    const handleSearchBarClose = useCallback(() => {
      if (showSymbolsPanel) {
        closeSymbolExplorer();
        inputRef.current?.blur();
        return;
      }
      closeMarketWatchDockPanel();
    }, [closeSymbolExplorer, showSymbolsPanel]);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setShowSymbolsPanel(true);
        setHighlightIndex((prev) => Math.min(prev + 1, explorerOptionCount - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((prev) => explorerOptionCount > 0 ? Math.max(prev - 1, 0) : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (showingSymbolGroups && highlightIndex >= 0 && highlightIndex < symbolGroups.length) {
          setSelectedSymbolGroupKey(symbolGroups[highlightIndex].key);
          setHighlightIndex(0);
        } else if (highlightIndex >= 0 && highlightIndex < filteredSymbols.length) {
          handleSelectSymbol(filteredSymbols[highlightIndex]);
        } else if (search.trim()) {
          handleSelectSymbol(search);
        }
      } else if (e.key === 'Escape') {
        if (search.trim()) {
          setSearch('');
          setHighlightIndex(-1);
        } else if (selectedSymbolGroup) {
          setSelectedSymbolGroupKey(null);
          setHighlightIndex(-1);
        } else {
          closeSymbolExplorer();
          inputRef.current?.blur();
        }
      }
    }, [
      closeSymbolExplorer,
      explorerOptionCount,
      filteredSymbols,
      handleSelectSymbol,
      highlightIndex,
      search,
      selectedSymbolGroup,
      showingSymbolGroups,
      symbolGroups,
    ]);

    const handleSearchChange = useCallback((value: string) => {
      setSearch(value);
      setShowSymbolsPanel(true);
      setHighlightIndex(-1);
    }, []);

    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          showSymbolsPanel
          && containerRef.current
          && !containerRef.current.contains(e.target as Node)
        ) {
          closeSymbolExplorer();
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeSymbolExplorer, showSymbolsPanel]);

    useEffect(() => {
      if (highlightIndex < 0 || showingSymbolGroups) return;
      const option = document.getElementById(`${searchListboxId}-option-${highlightIndex}`);
      if (option && typeof option.scrollIntoView === 'function') {
        option.scrollIntoView({ block: 'nearest' });
        return;
      }
      const element = symbolExplorerScrollRef.current;
      if (!element) return;
      element.scrollTop = highlightIndex * SYMBOL_EXPLORER_ROW_HEIGHT;
      handleSymbolExplorerScroll();
    }, [
      searchListboxId,
      handleSymbolExplorerScroll,
      highlightIndex,
      showingSymbolGroups,
    ]);

    const { loading: quotesLoading, error: quotesError } = useLiveQuotes(subscriptionSymbols);
    useEffect(() => {
      if (!pendingStatusRefreshSymbol || !subscriptionSymbols.includes(pendingStatusRefreshSymbol)) return;
      setPendingStatusRefreshSymbol(null);
      void reloadActiveMarketSymbols();
    }, [pendingStatusRefreshSymbol, reloadActiveMarketSymbols, subscriptionSymbols]);
    const marketWatchErrors = getMarketWatchDisplayErrors(
      symbolsError,
      watchlistError,
      quotesError,
      searchUniverse.length === 0 ? activeSymbolsError : null,
    );
    const activeSearchOptionId = highlightIndex >= 0 && highlightIndex < explorerOptionCount
      ? `${searchListboxId}-option-${highlightIndex}`
      : undefined;
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
    const columnWidths: Partial<Record<MarketWatchColumnId, number>> = {
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
    };
    const tableMinimumWidth = 118 + displayedColumns.reduce(
      (total, column) => total + (column === 'symbol' ? 0 : (columnWidths[column] ?? 82)),
      0,
    );

    return (
      <>
        {/* Shared Market Watch interaction styles for browser and Electron. */}
        <style>{`
        .rtx-market-watch .mw-row { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .rtx-market-watch .rtx-market-watch__price .price-big { font-size: inherit !important; font-weight: inherit !important; }
        .rtx-market-watch .rtx-market-watch__column-heading--symbol { color: var(--text-primary) !important; }
        .rtx-market-watch .mw-input::placeholder { color: var(--text-primary); opacity: 1; }
        .rtx-market-watch .mw-input:focus { border-color: transparent !important; box-shadow: none !important; background: transparent !important; }
        .rtx-market-watch .rtx-market-watch__search-bar:focus-within { box-shadow: inset 0 -1px 0 var(--border-secondary); }
        .rtx-market-watch .rtx-market-watch__explorer-option:hover { background: var(--bg-quaternary) !important; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .rtx-market-watch .rtx-market-watch__symbol-explorer .mw-scrollbar::-webkit-scrollbar-thumb { background: var(--border-tertiary); }
        .rtx-market-watch .rtx-market-watch__symbol-explorer .mw-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }
      `}</style>

        <div
          ref={containerRef}
          onKeyDown={(event) => {
            if (event.key !== 'Delete' || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || !selectedSymbol) return;
            if (shouldIgnoreShortcutEvent(event.nativeEvent) || isShortcutInput(event.nativeEvent) || isShortcutLocalScope(event.nativeEvent) || isShortcutOverlay(event.nativeEvent)) return;
            // Handle the focused row before document-level drawing deletion.
            event.preventDefault();
            event.stopPropagation();
            handleHideSymbol(selectedSymbol);
          }}
          className={`rtx-market-watch ${className ?? ''}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: 'var(--bg-secondary)',
            color: '#e2e2e8',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            userSelect: 'none',
            overflow: 'hidden',
          }}
        >
          {/* ── Search / Add Symbol ──────────────────────────────── */}
          <div
            className="rtx-market-watch__search"
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: showSymbolsPanel ? '1 1 auto' : '0 0 auto',
              minHeight: 0,
              borderBottom: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
            }}
          >
            <div
              className="rtx-market-watch__search-bar"
              style={{ position: 'relative', height: 42, flexShrink: 0 }}
            >
              <Icon
                name="search"
                size={20}
                style={{
                  position: 'absolute',
                  left: 13,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-primary)',
                  pointerEvents: 'none',
                }}
              />
              <input
                id="rtxMarketWatchSymbolSearch"
                name="marketWatchSymbolSearch"
                ref={inputRef}
                className="mw-input"
                style={{
                  width: '100%',
                  height: '100%',
                  boxSizing: 'border-box',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 0,
                  padding: '0 42px 0 42px',
                  fontSize: 14,
                  fontWeight: 400,
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
                aria-label={tr("Add symbol")}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSymbolsPanel}
                aria-controls={showSymbolsPanel ? searchListboxId : undefined}
                aria-activedescendant={activeSearchOptionId}
                autoComplete="off"
                placeholder={tr("Search symbol")}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setShowSymbolsPanel(true)}
              />
              <button
                type="button"
                aria-label={showSymbolsPanel ? tr("Close symbol search") : tr("Close Market Watch")}
                title={showSymbolsPanel ? tr("Close symbol search") : tr("Close")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleSearchBarClose}
                className="rtx-market-watch__close"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 30,
                  height: 30,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 0,
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <Icon name="x-close" size={18} />
              </button>
            </div>

            {showSymbolsPanel && (
              <div
                className="rtx-market-watch__symbol-explorer"
                style={{
                  display: 'flex',
                  flex: '1 1 auto',
                  flexDirection: 'column',
                  minHeight: 0,
                  background: 'var(--bg-secondary)',
                }}
              >
                {isSymbolListLoading && symbolGroups.length === 0 ? (
                  <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {tr("Loading symbols…")}</div>
                ) : showingSymbolGroups ? (
                  <div
                    id={searchListboxId}
                    role="listbox"
                    aria-label={tr("Symbol groups")}
                    className="rtx-market-watch__group-list mw-scrollbar"
                    style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
                  >
                    {symbolGroups.length === 0 ? (
                      <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {tr("No symbols available")}</div>
                    ) : symbolGroups.map((group, index) => (
                      <button
                        key={group.key}
                        id={`${searchListboxId}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === highlightIndex}
                        aria-label={tr("{{value0}} {{value1}} of {{value2}}", { value0: group.label, value1: group.visibleCount, value2: group.symbols.length })}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlightIndex(index)}
                        onClick={() => {
                          setSelectedSymbolGroupKey(group.key);
                          setHighlightIndex(0);
                        }}
                        className="rtx-market-watch__explorer-option rtx-market-watch__group-option"
                        style={{
                          width: '100%',
                          height: SYMBOL_GROUP_ROW_HEIGHT,
                          padding: '0 13px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          border: 0,
                          background: index === highlightIndex ? 'var(--bg-quaternary)' : 'transparent',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 14,
                          fontWeight: 600,
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tr(group.label)}
                        </span>
                        <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
                          {group.visibleCount}/{group.symbols.length}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    {selectedSymbolGroup && !search.trim() && (
                      <button
                        type="button"
                        aria-label={tr("Back to symbol groups")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSelectedSymbolGroupKey(null);
                          setHighlightIndex(-1);
                        }}
                        style={{
                          height: SYMBOL_GROUP_ROW_HEIGHT,
                          padding: '0 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          flexShrink: 0,
                          border: 0,
                          borderBottom: '1px solid var(--border-primary)',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 600,
                          textAlign: 'left',
                        }}
                      >
                        <Icon name="chevron-left" size="sm" />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedSymbolGroup.label}
                        </span>
                        <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 400 }}>
                          {selectedSymbolGroup.symbols.length}
                        </span>
                      </button>
                    )}
                    <div
                      ref={symbolExplorerScrollRef}
                      id={searchListboxId}
                      role="listbox"
                      aria-label={search.trim() ? tr("Symbol search results") : tr("{{value0}} symbols", { value0: selectedSymbolGroup?.label ?? '' })}
                      data-testid="market-watch-symbol-scroll"
                      onScroll={handleSymbolExplorerScroll}
                      className="rtx-market-watch__symbol-list mw-scrollbar"
                      style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}
                    >
                      {filteredSymbols.length === 0 ? (
                        <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {search.trim() ? tr("No matches found") : tr("No symbols in this group")}
                        </div>
                      ) : (
                        <>
                          {symbolExplorerWindow.topSpacerHeight > 0 && (
                            <div aria-hidden="true" style={{ height: symbolExplorerWindow.topSpacerHeight }} />
                          )}
                          {renderedExplorerSymbols.map((symbol, visibleIndex) => {
                            const absoluteIndex = symbolExplorerWindow.startIndex + visibleIndex;
                            const displaySymbol = getMarketWatchSymbolLabel(symbol, searchUniverse);
                            const symbolDescription = symbolDescriptionByName.get(normalizeSymbol(symbol))
                              ?? getFallbackSymbolDescription(symbol);
                            const isSubscribed = marketWatchSymbolSet.has(symbol);
                            return (
                              <button
                                key={symbol}
                                id={`${searchListboxId}-option-${absoluteIndex}`}
                                type="button"
                                role="option"
                                aria-selected={absoluteIndex === highlightIndex}
                                aria-disabled={false}
                                aria-label={symbolDescription ? `${displaySymbol}, ${symbolDescription}` : displaySymbol}
                                aria-posinset={absoluteIndex + 1}
                                aria-setsize={filteredSymbols.length}
                                data-subscribed={isSubscribed ? 'true' : 'false'}
                                tabIndex={-1}
                                onMouseDown={(event) => event.preventDefault()}
                                onMouseEnter={() => setHighlightIndex(absoluteIndex)}
                                onClick={() => handleSelectSymbol(symbol)}
                                className="rtx-market-watch__explorer-option rtx-market-watch__symbol-option"
                                style={{
                                  width: '100%',
                                  height: SYMBOL_EXPLORER_ROW_HEIGHT,
                                  padding: isSubscribed ? '0 11px 0 10px' : '0 13px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  borderTop: 0,
                                  borderRight: 0,
                                  borderBottom: '1px solid var(--bg-tertiary)',
                                  borderLeft: isSubscribed ? '3px solid var(--status-connected)' : 0,
                                  background: absoluteIndex === highlightIndex
                                    ? 'var(--bg-quaternary)'
                                    : isSubscribed
                                      ? 'var(--color-profit-dimmer)'
                                      : 'transparent',
                                  color: 'var(--text-primary)',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  fontSize: 14,
                                  fontWeight: 500,
                                  textAlign: 'left',
                                }}
                              >
                                <span
                                  className="rtx-market-watch__symbol-copy"
                                  style={{ minWidth: 0, display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}
                                >
                                  <span
                                    className="rtx-market-watch__symbol"
                                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '17px' }}
                                  >
                                    {displaySymbol}
                                  </span>
                                  {symbolDescription && (
                                    <span
                                      className="rtx-market-watch__symbol-description"
                                      title={symbolDescription}
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: 'var(--text-secondary)',
                                        fontSize: 11,
                                        fontWeight: 400,
                                        lineHeight: '14px',
                                      }}
                                    >
                                      {symbolDescription}
                                    </span>
                                  )}
                                </span>
                                {isSubscribed && (
                                  <span
                                    aria-hidden="true"
                                    className="rtx-market-watch__subscribed-badge"
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 5,
                                      flexShrink: 0,
                                      color: 'var(--status-connected)',
                                      fontSize: 10,
                                      fontWeight: 600,
                                      letterSpacing: '0.02em',
                                    }}
                                  >
                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                                    {tr("Subscribed")}</span>
                                )}
                              </button>
                            );
                          })}
                          {symbolExplorerWindow.bottomSpacerHeight > 0 && (
                            <div aria-hidden="true" style={{ height: symbolExplorerWindow.bottomSpacerHeight }} />
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Table & Column Headers ───────────────────────────── */}
          {!showSymbolsPanel && marketWatchView === 'symbols' && (
            <div
              ref={setMarketWatchViewportRef}
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
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  height: '100%', gap: 8, color: '#222226',
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  <span className="rtx-market-watch__empty-text" style={{ fontSize: 11, color: '#50505a' }}>
                    {isSymbolListLoading ? tr("Loading symbols...") : tr("No live symbols")}
                  </span>
                  {!isSymbolListLoading && quoteEligibleSymbols.length > 0 && (
                    <button
                      type="button"
                      onClick={handleShowAll}
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
                      {tr("Show all symbols")}</button>
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
                    {displayedColumns.map((column) => (
                      <col key={column} style={column === 'symbol' ? undefined : { width: columnWidths[column] ?? 82 }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: 'none' }}>
                      {displayedColumns.map((column) => {
                        const sortableMode: MarketWatchSortMode = column === 'symbol'
                          ? 'symbol'
                          : column === 'dailyChange'
                            ? (sortMode === 'gainers' ? 'losers' : 'gainers')
                            : column === 'volume'
                              ? 'volume'
                              : null;
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
                            title={isSortable ? tr('Sort by {{value0}}', { value0: columnHeaders[column] }) : undefined}
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
                            {tr(columnHeaders[column])}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((symbol) => {
                      return (
                        <MarketWatchRow
                          key={symbol}
                          symbol={symbol}
                          isSelected={symbol === marketWatchSelectionSymbol}
                          isLive={liveQuoteSymbolSet.has(symbol)}
                          isChartOpenable={chartOpenableSymbolSet.has(symbol)}
                          onClick={() => {
                            setContextSelection(null);
                            onSymbolSelect(symbol);
                          }}
                          onContextSelect={() => setContextSelection({
                            activeSymbol: normalizedSelectedSymbol,
                            symbol,
                          })}
                          onDoubleClick={() => {
                            if (actionableSymbolSet.has(symbol)) {
                              window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } }));
                            }
                          }}
                          contextMenuItems={getContextMenuItems(symbol)}
                          columns={displayedColumns}
                          showMilliseconds={marketWatchOptions.showMilliseconds}
                          isLightSkin={isLightSkin}
                          closedDailyChange={closedDailyChanges.get(symbol)}
                          lastPrice={lastPrices.get(symbol)}
                          symbolUniverse={quoteEligibleSymbols}
                          rowRef={marketWatchRowRefCallbacks.get(symbol)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {!showSymbolsPanel && marketWatchView === 'ticks' && (
            <MarketWatchTickChart symbol={tickChartSymbol || normalizeSymbol(selectedSymbol)} />
          )}

          {!showSymbolsPanel && (
            <>
              {marketWatchErrors.length > 0 && (
                <div role="alert" aria-label={tr("Market Watch errors")} style={{
                  padding: '5px 10px',
                  borderTop: '1px solid rgba(248,113,113,0.16)',
                  color: '#f87171',
                  background: 'rgba(248,113,113,0.06)',
                  fontSize: 10,
                  lineHeight: 1.3,
                }}>
                  <ul style={{ margin: 0, paddingLeft: 14 }}>
                    {marketWatchErrors.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                </div>
              )}
              {(quotesLoading || watchlistLoading) && rows.length > 0 && liveTickCount === 0 && (
                <div style={{ padding: '4px 10px', color: '#606068', fontSize: 10 }}>
                  {tr("Loading quotes...")}</div>
              )}
            </>
          )}
          {!showSymbolsPanel && (
            <div
              className="rtx-market-watch__view-tabs"
              role="tablist"
              aria-label={tr('Market Watch views')}
              style={{ display: 'flex', minHeight: 26, borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}
            >
              {(['symbols', 'ticks'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={marketWatchView === view}
                  onClick={() => {
                    if (view === 'ticks') setTickChartSymbol(normalizeSymbol(selectedSymbol));
                    setMarketWatchView(view);
                  }}
                  style={{
                    minWidth: 64,
                    border: 0,
                    borderBottom: marketWatchView === view ? '2px solid #0078d7' : '2px solid transparent',
                    background: marketWatchView === view ? 'var(--bg-quaternary)' : 'transparent',
                    color: marketWatchView === view ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontFamily: 'inherit',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {tr(view === 'symbols' ? 'Symbols' : 'Ticks')}
                </button>
              ))}
            </div>
          )}
        </div>
        <MarketWatchSaveSetDialog
          isOpen={isSaveSetOpen}
          value={saveSetName}
          onChange={setSaveSetName}
          onCancel={() => { setIsSaveSetOpen(false); setSaveSetName(''); }}
          onSave={handleSaveSet}
        />
        <PopupPricesDialog
          isOpen={popupPricesOpen}
          symbols={rows}
          columns={columns}
          showMilliseconds={marketWatchOptions.showMilliseconds}
          descriptions={symbolDescriptionByName}
          onClose={() => setPopupPricesOpen(false)}
        />
        <RetainedLazyFeature active={Boolean(specificationSymbol)}>
          <SymbolSpecificationDialog
            isOpen={Boolean(specificationSymbol)}
            symbol={specificationSymbol ?? ''}
            instrument={specificationInstrument}
            fallbackInstrument={specificationFallbackInstrument}
            requestStatus={effectiveSpecificationRequestStatus}
            onClose={() => {
              setSpecificationSymbol(null);
              setRefreshedSpecification(null);
              setSpecificationRequestKey(null);
              setSpecificationRequestStatus('idle');
            }}
          />
        </RetainedLazyFeature>
      </>
    );
  };

const MarketWatchPanelWithLocalDataOwners: React.FC<MarketWatchPanelBaseProps> = (props) => {
  const activeMarketSnapshot = useActiveMarketSymbols();
  const marketInstrumentsSnapshot = useMarketInstruments();
  return (
    <MarketWatchPanelContent
      {...props}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
    />
  );
};

const MarketWatchPanelWithLocalFreshnessOwner: React.FC<MarketWatchPanelBaseProps & {
  marketInstrumentsSnapshot: MarketInstrumentsSnapshot;
}> = ({ marketInstrumentsSnapshot, ...props }) => {
  const activeMarketSnapshot = useActiveMarketSymbols();
  return (
    <MarketWatchPanelContent
      {...props}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
    />
  );
};

const MarketWatchPanelWithLocalMarketInstrumentsOwner: React.FC<MarketWatchPanelBaseProps & {
  activeMarketSnapshot: ActiveMarketSymbolsSnapshot;
}> = ({ activeMarketSnapshot, ...props }) => {
  const marketInstrumentsSnapshot = useMarketInstruments();
  return (
    <MarketWatchPanelContent
      {...props}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
    />
  );
};

export const MarketWatchPanel: React.FC<MarketWatchPanelProps> = ({
  activeMarketSnapshot,
  marketInstrumentsSnapshot,
  ...props
}) => {
  if (activeMarketSnapshot && marketInstrumentsSnapshot) {
    return (
      <MarketWatchPanelContent
        {...props}
        activeMarketSnapshot={activeMarketSnapshot}
        marketInstrumentsSnapshot={marketInstrumentsSnapshot}
      />
    );
  }
  if (activeMarketSnapshot) {
    return <MarketWatchPanelWithLocalMarketInstrumentsOwner {...props} activeMarketSnapshot={activeMarketSnapshot} />;
  }
  if (marketInstrumentsSnapshot) {
    return <MarketWatchPanelWithLocalFreshnessOwner {...props} marketInstrumentsSnapshot={marketInstrumentsSnapshot} />;
  }
  return <MarketWatchPanelWithLocalDataOwners {...props} />;
};

export default MarketWatchPanel;
import { getShortcutEventTarget, isShortcutInput, isShortcutLocalScope, isShortcutOverlay, shouldIgnoreShortcutEvent } from '../../services/keyboardShortcutManager';
