import { resolveDailyChangeDisplayDigits } from '../../services/dailyChangePriceModeRegistry';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelDrag } from '../../hooks/useFloatingPanelDrag';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { formatDailyChange } from '../../utils/dailyChange';
import { dailyChangeDescription } from '../../utils/dailyChangeSession';
import { readCurrentMarketWatchDailyChangePrice, describeCurrentMarketWatchDailyChange } from '../../services/marketWatchDailyChangeCache';
import { type Tick, useTick } from '../../store/useAppStore';
import {
  resolveMarketWatchDisplayMetadata,
  mayUseClosedDailyChange,
  useMarketWatchDisplayMetadata,
} from '../../store/useMarketWatchDisplayMetadataStore';
import {
  DEFAULT_MARKET_WATCH_COLUMNS,
  formatMarketWatchTime,
  MARKET_WATCH_COLUMN_HEADERS,
  normalizeMarketWatchColumns,
  type MarketWatchColumnId,
} from '../../utils/marketWatchView';
import { formatSpreadDisplay } from '../../utils/spread';
import { getSymbolDigits } from '../../utils/symbolUtils';
import { Icon } from '../ui/Icon';
import { PriceDisplay } from '../ui/PriceDisplay';
import { getLatestMarketWatchTimestamp } from './marketWatchPanelModel';
import { resolveMarketWatchExtendedColumn } from './marketWatchSymbolDetailsModel';
import './market-watch-views.css';

const CORE_POPUP_COLUMN_SET = new Set<MarketWatchColumnId>([
  'symbol',
  'bid',
  'ask',
  'last',
  'high',
  'low',
  'volume',
  'spread',
  'time',
  'dailyChangePrice',
  'dailyChange',
  'source',
]);

const VIEWPORT_GAP = 12;
const MINIMUM_WIDTH = 420;
const MINIMUM_HEIGHT = 300;
const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 460;
const MAXIMUM_POPUP_SYMBOLS = 250;

interface DialogRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeGesture {
  pointerId: number;
  target: HTMLElement;
  startX: number;
  startY: number;
  rect: DialogRect;
}

export interface PopupPricesDialogProps {
  isOpen: boolean;
  symbols: readonly string[];
  columns?: readonly MarketWatchColumnId[];
  showMilliseconds?: boolean;
  descriptions?: ReadonlyMap<string, string>;
  fallbackPrices?: ReadonlyMap<string, MarketWatchLastPrice>;
  dailyChanges?: ReadonlyMap<string, number>;
  onClose: () => void;
}

const viewportSize = () => ({
  width: typeof window === 'undefined' ? 1_280 : window.innerWidth,
  height: typeof window === 'undefined' ? 720 : window.innerHeight,
});

const clampDialogRect = (rect: DialogRect): DialogRect => {
  const viewport = viewportSize();
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_GAP * 2);
  const availableHeight = Math.max(0, viewport.height - VIEWPORT_GAP * 2);
  const minimumWidth = Math.min(MINIMUM_WIDTH, availableWidth);
  const minimumHeight = Math.min(MINIMUM_HEIGHT, availableHeight);
  const width = Math.min(Math.max(minimumWidth, rect.width), availableWidth);
  const height = Math.min(Math.max(minimumHeight, rect.height), availableHeight);
  const maximumX = Math.max(VIEWPORT_GAP, viewport.width - width - VIEWPORT_GAP);
  const maximumY = Math.max(VIEWPORT_GAP, viewport.height - height - VIEWPORT_GAP);

  return {
    x: Math.max(VIEWPORT_GAP, Math.min(rect.x, maximumX)),
    y: Math.max(VIEWPORT_GAP, Math.min(rect.y, maximumY)),
    width,
    height,
  };
};

const centeredDialogRect = (): DialogRect => {
  const viewport = viewportSize();
  const width = Math.min(DEFAULT_WIDTH, Math.max(0, viewport.width - VIEWPORT_GAP * 2));
  const height = Math.min(DEFAULT_HEIGHT, Math.max(0, viewport.height - VIEWPORT_GAP * 2));
  return clampDialogRect({
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  });
};

const maximizedDialogRect = (): DialogRect => {
  const viewport = viewportSize();
  return {
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  };
};

const cleanSymbols = (symbols: readonly string[]): string[] => {
  const seen = new Set<string>();
  return symbols.flatMap(symbol => {
    const trimmed = String(symbol ?? '').trim();
    const key = trimmed.toUpperCase();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
};

const finiteNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const readSymbolMapValue = <T,>(values: ReadonlyMap<string, T> | undefined, symbol: string): T | undefined => (
  values?.get(symbol) ?? values?.get(symbol.toUpperCase())
);

const tickDigits = (tick: Tick | undefined, symbol: string): number => (
  Number.isInteger(tick?.digits) && Number(tick?.digits) >= 0 && Number(tick?.digits) <= 10
    ? Number(tick?.digits)
    : getSymbolDigits(symbol)
);

const quoteDate = (timestamp: number | undefined): Date | null => {
  if (!Number.isFinite(timestamp) || Number(timestamp) <= 0) return null;
  const milliseconds = Number(timestamp) < 1_000_000_000_000 ? Number(timestamp) * 1_000 : Number(timestamp);
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
};

function PopupPriceCard({
  symbol,
  columns,
  showMilliseconds,
  description,
  fallbackPrice,
  fallbackDailyChange,
}: {
  symbol: string;
  columns: readonly MarketWatchColumnId[];
  showMilliseconds: boolean;
  description?: string;
  fallbackPrice?: MarketWatchLastPrice;
  fallbackDailyChange?: number;
}) {
  const tr = useUiTranslation();
  const tick = useTick(symbol);
  const displayMetadata = useMarketWatchDisplayMetadata(symbol);
  const resolvedDisplayMetadata = resolveMarketWatchDisplayMetadata(tick, displayMetadata);
  const digits = tickDigits(tick, symbol);
  const liveBid = finiteNumber(tick?.bid) ?? 0;
  const liveAsk = finiteNumber(tick?.ask) ?? 0;
  const hasLiveQuote = liveBid > 0 || liveAsk > 0;
  const retainedQuote = !hasLiveQuote && fallbackPrice?.kind === 'quote'
    && (fallbackPrice.bid > 0 || fallbackPrice.ask > 0)
    ? fallbackPrice
    : undefined;
  const retainedClose = !hasLiveQuote && fallbackPrice?.kind === 'close' && fallbackPrice.close > 0
    ? fallbackPrice
    : undefined;
  const bid = hasLiveQuote ? liveBid : retainedQuote?.bid ?? retainedClose?.close ?? 0;
  const ask = hasLiveQuote ? liveAsk : retainedQuote?.ask ?? 0;
  const dailyChange = finiteNumber(resolvedDisplayMetadata.dailyChange) ?? (mayUseClosedDailyChange(resolvedDisplayMetadata) ? finiteNumber(fallbackDailyChange) : null);
  const dailyTitle = (fallbackDailyChange != null && mayUseClosedDailyChange(resolvedDisplayMetadata) ? describeCurrentMarketWatchDailyChange(symbol) : dailyChangeDescription(resolvedDisplayMetadata.daily));
  const dailyAmount = resolvedDisplayMetadata.dailyChangePrice
    ?? (fallbackDailyChange != null && mayUseClosedDailyChange(resolvedDisplayMetadata) ? readCurrentMarketWatchDailyChangePrice(symbol) : undefined);
  const hasBidAskQuote = hasLiveQuote || retainedQuote !== undefined;
  const hasDisplayedPrice = hasBidAskQuote || retainedClose !== undefined;
  const quoteTimestamp = getLatestMarketWatchTimestamp(
    hasLiveQuote ? tick?.sourceTimestamp ?? tick?.timestamp : undefined,
    resolvedDisplayMetadata.timestamp,
  ) ?? retainedQuote?.asOf ?? retainedClose?.asOf;
  const updatedDate = quoteDate(quoteTimestamp);
  const dailyChangeText = formatDailyChange(dailyChange, 2, true);
  const dailyTone = dailyChange === null || dailyChange === 0
    ? 'neutral'
    : dailyChange > 0 ? 'positive' : 'negative';

  return (
    <article className="rtx-popup-prices__card" role="listitem" aria-label={tr('{{value0}} quote', { value0: symbol })}>
      <header className="rtx-popup-prices__card-header">
        <strong title={description || undefined}>{symbol}</strong>
        <span className="rtx-popup-prices__quote-status" data-available={hasDisplayedPrice ? 'true' : 'false'}>
          <span aria-hidden="true" />
          {hasBidAskQuote ? tr('Quote') : retainedClose ? tr('Last close') : tr('Waiting')}
        </span>
      </header>

      <div className="rtx-popup-prices__quote-grid">
        <div
          className="rtx-popup-prices__price rtx-popup-prices__price--bid"
          aria-label={`${symbol} ${tr('Bid')} ${bid > 0 ? bid.toFixed(digits) : tr('unavailable')}`}
        >
          <span>{tr('Bid')}</span>
          <span aria-hidden="true">
            {bid > 0
              ? <PriceDisplay price={bid} symbol={symbol} digits={digits} size="lg" />
              : '—'}
          </span>
        </div>
        <div
          className="rtx-popup-prices__price rtx-popup-prices__price--ask"
          aria-label={`${symbol} ${tr('Ask')} ${ask > 0 ? ask.toFixed(digits) : tr('unavailable')}`}
        >
          <span>{tr('Ask')}</span>
          <span aria-hidden="true">
            {ask > 0
              ? <PriceDisplay price={ask} symbol={symbol} digits={digits} size="lg" />
              : '—'}
          </span>
        </div>
      </div>

      {columns.some(column => !['symbol', 'bid', 'ask'].includes(column)) && (
        <footer className="rtx-popup-prices__card-footer">
          {columns.includes('last') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Last')}</span>
              <strong>{finiteNumber(resolvedDisplayMetadata.last) !== null
                ? <PriceDisplay price={Number(resolvedDisplayMetadata.last)} symbol={symbol} digits={digits} />
                : '—'}</strong>
            </div>
          )}
          {columns.includes('high') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('High')}</span>
              <strong>{finiteNumber(tick?.high ?? tick?.high24h) !== null
                ? <PriceDisplay price={Number(tick?.high ?? tick?.high24h)} symbol={symbol} digits={digits} />
                : '—'}</strong>
            </div>
          )}
          {columns.includes('low') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Low')}</span>
              <strong>{finiteNumber(tick?.low ?? tick?.low24h) !== null
                ? <PriceDisplay price={Number(tick?.low ?? tick?.low24h)} symbol={symbol} digits={digits} />
                : '—'}</strong>
            </div>
          )}
          {columns.includes('volume') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Volume')}</span>
              <strong>{finiteNumber(tick?.volume)?.toLocaleString() ?? '—'}</strong>
            </div>
          )}
          {columns.includes('spread') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Spread')}</span>
              <strong>{hasBidAskQuote ? formatSpreadDisplay(symbol, tick?.spread, bid, ask) : '—'}</strong>
            </div>
          )}
          {columns.includes('time') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Time')}</span>
              <time dateTime={updatedDate?.toISOString()}>
                {formatMarketWatchTime(quoteTimestamp, showMilliseconds)}
              </time>
            </div>
          )}
          {columns.includes('dailyChange') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Change %')}</span>
              <strong title={dailyTitle} data-tone={dailyTone} aria-label={`${tr('Change %')} ${dailyChangeText}`}>{dailyChangeText}</strong>
            </div>
          )}
          {columns.includes('dailyChangePrice') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Change')}</span>
              <strong title={dailyTitle} data-tone={!dailyAmount ? 'neutral' : dailyAmount > 0 ? 'positive' : 'negative'}>{formatDailyChange(dailyAmount, resolveDailyChangeDisplayDigits(symbol, tick?.digits))}</strong>
            </div>
          )}
          {columns.includes('source') && (
            <div className="rtx-popup-prices__metric">
              <span>{tr('Source')}</span>
              <strong title={tick?.lp || undefined}>{tick?.lp || '—'}</strong>
            </div>
          )}
          {columns.filter((col) => !CORE_POPUP_COLUMN_SET.has(col)).map((column) => {
            const resolved = resolveMarketWatchExtendedColumn({
              column,
              tick,
              lastPrice: fallbackPrice,
              displayLast: resolvedDisplayMetadata.last,
              priceDigits: digits,
            });
            return (
              <div key={column} className="rtx-popup-prices__metric">
                <span>{tr(MARKET_WATCH_COLUMN_HEADERS[column])}</span>
                <strong>
                  {resolved.kind === 'price' && resolved.numericValue !== null && resolved.numericValue !== 0 ? (
                    <PriceDisplay price={resolved.numericValue} symbol={symbol} digits={digits} />
                  ) : (
                    resolved.formatted ?? '—'
                  )}
                </strong>
              </div>
            );
          })}
        </footer>
      )}
    </article>
  );
}

function PopupPricesDialogContent({
  symbols,
  columns = DEFAULT_MARKET_WATCH_COLUMNS,
  showMilliseconds = false,
  descriptions,
  fallbackPrices,
  dailyChanges,
  onClose,
}: Omit<PopupPricesDialogProps, 'isOpen'>) {
  const tr = useUiTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRectRef = useRef<DialogRect>(centeredDialogRect());
  const resizeRef = useRef<ResizeGesture | null>(null);
  const [rect, setRect] = useState<DialogRect>(centeredDialogRect);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const allSymbols = useMemo(() => cleanSymbols(symbols), [symbols]);
  const displayedColumns = useMemo(() => normalizeMarketWatchColumns(columns), [columns]);
  const displayedSymbols = allSymbols.slice(0, MAXIMUM_POPUP_SYMBOLS);
  const omittedSymbolCount = Math.max(0, allSymbols.length - displayedSymbols.length);

  const moveDialog = useCallback((position: { x: number; y: number }) => {
    if (isMaximized) return;
    setRect(current => clampDialogRect({ ...current, ...position }));
  }, [isMaximized]);
  const { isDragging, cancelDrag, dragHandleProps } = useFloatingPanelDrag(dialogRef, moveDialog);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const fitToViewport = () => {
      setRect(current => isMaximized ? maximizedDialogRect() : clampDialogRect(current));
    };
    window.addEventListener('resize', fitToViewport);
    return () => window.removeEventListener('resize', fitToViewport);
  }, [isMaximized]);

  const toggleMaximized = useCallback(() => {
    cancelDrag();
    resizeRef.current = null;
    setIsResizing(false);
    if (isMaximized) {
      setRect(clampDialogRect(restoreRectRef.current));
      setIsMaximized(false);
      return;
    }
    restoreRectRef.current = rect;
    setRect(maximizedDialogRect());
    setIsMaximized(true);
  }, [cancelDrag, isMaximized, rect]);

  const startResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (isMaximized || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      rect,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsResizing(true);
  }, [isMaximized, rect]);

  const continueResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    setRect(clampDialogRect({
      ...gesture.rect,
      width: gesture.rect.width + event.clientX - gesture.startX,
      height: gesture.rect.height + event.clientY - gesture.startY,
    }));
  }, []);

  const stopResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (gesture.target.hasPointerCapture?.(gesture.pointerId)) {
      gesture.target.releasePointerCapture(gesture.pointerId);
    }
    setIsResizing(false);
  }, []);

  const resizeFromKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (isMaximized || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 32 : 16;
    setRect(current => clampDialogRect({
      ...current,
      width: current.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      height: current.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
    }));
  }, [isMaximized]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
  };

  const dialogClassName = [
    'rtx-popup-prices',
    isMaximized && 'is-maximized',
    isDragging && 'is-dragging',
    isResizing && 'is-resizing',
  ].filter(Boolean).join(' ');

  return createPortal(
    <div
      className="rtx-popup-prices__backdrop"
    >
      <div
        ref={dialogRef}
        className={dialogClassName}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-shortcut-scope="local"
        tabIndex={-1}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        onKeyDown={handleDialogKeyDown}
        onPointerDown={event => event.stopPropagation()}
      >
        <header
          className="rtx-popup-prices__header"
          {...(!isMaximized ? dragHandleProps : {})}
          onDoubleClick={event => {
            if (!(event.target as Element).closest('button')) toggleMaximized();
          }}
        >
          <div className="rtx-popup-prices__title">
            <span className="rtx-popup-prices__title-icon" aria-hidden="true">
              <Icon name="market-watch" size="sm" />
            </span>
            <div>
              <h2 id={titleId}>{tr('Popup Prices')}</h2>
              <p id={descriptionId}>{tr('Bid, Ask and Daily Change')}</p>
            </div>
          </div>
          <div className="rtx-popup-prices__window-controls">
            <button
              type="button"
              aria-label={isMaximized ? tr('Restore Popup Prices') : tr('Maximize Popup Prices')}
              title={isMaximized ? tr('Restore') : tr('Maximize')}
              aria-pressed={isMaximized}
              onClick={toggleMaximized}
            >
              <Icon name={isMaximized ? 'cascade' : 'template'} size="xs" />
            </button>
            <button type="button" aria-label={tr('Close Popup Prices')} title={tr('Close')} onClick={onClose}>
              <Icon name="x-close" size="xs" />
            </button>
          </div>
        </header>

        <div className="rtx-popup-prices__body">
          {displayedSymbols.length > 0 ? (
            <div className="rtx-popup-prices__cards" role="list" aria-label={tr('Symbol prices')}>
              {displayedSymbols.map(symbol => (
                <PopupPriceCard
                  key={symbol.toUpperCase()}
                  symbol={symbol}
                  columns={displayedColumns}
                  showMilliseconds={showMilliseconds}
                  description={descriptions?.get(symbol.toUpperCase())}
                  fallbackPrice={readSymbolMapValue(fallbackPrices, symbol)}
                  fallbackDailyChange={readSymbolMapValue(dailyChanges, symbol)}
                />
              ))}
            </div>
          ) : (
            <div className="rtx-popup-prices__empty" role="status">
              <Icon name="market-watch" size="lg" aria-hidden="true" />
              <strong>{tr('No symbols to display')}</strong>
              <span>{tr('Add a symbol to Market Watch, then open Popup Prices again.')}</span>
            </div>
          )}
          {omittedSymbolCount > 0 && (
            <div className="rtx-popup-prices__limit-note" role="status">
              {tr('Showing the first {{value0}} symbols. {{value1}} more remain in Market Watch.', {
                value0: MAXIMUM_POPUP_SYMBOLS,
                value1: omittedSymbolCount,
              })}
            </div>
          )}
        </div>

        {!isMaximized && (
          <button
            type="button"
            className="rtx-popup-prices__resize-handle"
            aria-label={tr('Resize Popup Prices dialog')}
            title={tr('Drag or use arrow keys to resize')}
            onPointerDown={startResize}
            onPointerMove={continueResize}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
            onLostPointerCapture={stopResize}
            onKeyDown={resizeFromKeyboard}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

export function PopupPricesDialog({
  isOpen,
  symbols,
  columns,
  showMilliseconds,
  descriptions,
  fallbackPrices,
  dailyChanges,
  onClose,
}: PopupPricesDialogProps) {
  if (!isOpen || typeof document === 'undefined') return null;
  return (
    <PopupPricesDialogContent
      symbols={symbols}
      columns={columns}
      showMilliseconds={showMilliseconds}
      descriptions={descriptions}
      fallbackPrices={fallbackPrices}
      dailyChanges={dailyChanges}
      onClose={onClose}
    />
  );
}

export default PopupPricesDialog;
