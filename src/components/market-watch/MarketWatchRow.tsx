import { resolveDailyChangeDisplayDigits } from '../../services/dailyChangePriceModeRegistry';
import { useEffect, useState, type CSSProperties, type FC, type ReactNode } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import { useTick } from '../../store/useAppStore';
import {
  resolveMarketWatchDisplayMetadata,
  mayUseClosedDailyChange,
  useMarketWatchDisplayMetadata,
} from '../../store/useMarketWatchDisplayMetadataStore';
import { formatSpreadDisplay } from '../../utils/spread';
import { formatDailyChange } from '../../utils/dailyChange';
import { dailyChangeDescription } from '../../utils/dailyChangeSession';
import { readCurrentMarketWatchDailyChangePrice, describeCurrentMarketWatchDailyChange } from '../../services/marketWatchDailyChangeCache';
import { formatMarketWatchTime, type MarketWatchColumnId } from '../../utils/marketWatchView';
import { getMarketWatchSymbolLabel } from '../../utils/marketWatchSource';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { PriceDisplay } from '../ui/PriceDisplay';
import {
  formatLastPriceTime,
  getLatestMarketWatchTimestamp,
  hasMarketWatchQuote,
  readFiniteDailyChange,
  resolveMarketWatchPriceDigits,
} from './marketWatchPanelModel';
import { resolveMarketWatchExtendedColumn } from './marketWatchSymbolDetailsModel';

const MARKET_WATCH_QUOTE_UP_COLOR = 'var(--color-quote-up)';
const MARKET_WATCH_QUOTE_DOWN_COLOR = '#ff5858';
const CORE_MARKET_WATCH_COLUMN_SET = new Set<MarketWatchColumnId>([
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

function usePriceFlash(value: number): 'up' | 'down' | null {
  const [flashState, setFlashState] = useState<{
    value: number;
    direction: 'up' | 'down' | null;
  }>(() => ({ value, direction: null }));

  if (value !== flashState.value) {
    setFlashState({
      value,
      direction: value > flashState.value ? 'up' : 'down',
    });
  }

  useEffect(() => {
    if (!flashState.direction) return undefined;
    const timer = window.setTimeout(() => {
      setFlashState((current) => (
        current.value === flashState.value
          ? { ...current, direction: null }
          : current
      ));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [flashState.direction, flashState.value]);

  return flashState.direction;
}

interface MarketWatchRowProps {
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
  instrumentSources?: readonly unknown[];
  /** Broker catalog price digits for this symbol; null when the catalog publishes none. */
  catalogPriceDigits?: number | null;
  symbolUniverse: readonly string[];
  rowRef?: (node: HTMLTableRowElement | null) => void;
}

export const MarketWatchRow: FC<MarketWatchRowProps> = ({
  symbol,
  isSelected,
  isLive,
  isChartOpenable,
  onClick,
  onContextSelect,
  onDoubleClick,
  contextMenuItems,
  columns,
  showMilliseconds,
  isLightSkin,
  closedDailyChange,
  lastPrice,
  instrumentSources,
  catalogPriceDigits,
  symbolUniverse,
  rowRef,
}) => {
  const tr = useUiTranslation();
  const displaySymbol = getMarketWatchSymbolLabel(symbol, symbolUniverse);
  const tick = useTick(symbol);
  const displayMetadata = useMarketWatchDisplayMetadata(symbol);
  const resolvedDisplayMetadata = resolveMarketWatchDisplayMetadata(tick, displayMetadata);
  const hasTickQuote = hasMarketWatchQuote(tick);
  const fallbackPrice = hasTickQuote ? undefined : lastPrice;
  const quote = hasTickQuote ? tick : fallbackPrice?.kind === 'quote' ? fallbackPrice : undefined;
  const lastClose = fallbackPrice?.kind === 'close' ? fallbackPrice : undefined;
  const lastPriceTitle = fallbackPrice
    ? `${tr(fallbackPrice.kind === 'close' ? 'Last close' : 'Last quote')} · ${formatLastPriceTime(fallbackPrice.asOf)}`
    : undefined;
  // Broker data only (catalog row, registered spec, live tick); unknown renders raw.
  const priceDigits = resolveMarketWatchPriceDigits(symbol, catalogPriceDigits, tick?.digits) ?? undefined;
  const bidDirection = hasTickQuote ? tick?.bidDirection ?? 'none' : 'none';
  const askDirection = hasTickQuote ? tick?.askDirection ?? 'none' : 'none';
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? 0;
  const dailyPct = readFiniteDailyChange(resolvedDisplayMetadata.dailyChange)
    ?? (mayUseClosedDailyChange(resolvedDisplayMetadata) ? readFiniteDailyChange(closedDailyChange) : null);

  const hasData = hasMarketWatchQuote(quote);
  const hasDailyData = dailyPct !== null;
  const dailyAmount = readFiniteDailyChange(resolvedDisplayMetadata.dailyChangePrice)
    ?? (closedDailyChange != null && mayUseClosedDailyChange(resolvedDisplayMetadata) ? readFiniteDailyChange(readCurrentMarketWatchDailyChangePrice(symbol)) : null);
  const dailyTitle = (closedDailyChange != null && mayUseClosedDailyChange(resolvedDisplayMetadata) ? describeCurrentMarketWatchDailyChange(symbol) : dailyChangeDescription(resolvedDisplayMetadata.daily));
  const bidFlash = usePriceFlash(bid);
  const askFlash = usePriceFlash(ask);
  const bidPriceDirection = hasTickQuote ? bidFlash ?? (bidDirection !== 'none' ? bidDirection : null) : null;
  const askPriceDirection = hasTickQuote ? askFlash ?? (askDirection !== 'none' ? askDirection : null) : null;
  const dailyPositive = hasDailyData && dailyPct > 0;
  const dailyNegative = hasDailyData && dailyPct < 0;
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
  const extendedColumns = columns.filter((col) => !CORE_MARKET_WATCH_COLUMN_SET.has(col));
  const renderNumber = (value: unknown, digits = priceDigits): ReactNode => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed !== 0
      ? <PriceDisplay price={parsed} symbol={symbol} digits={digits} />
      : <span style={{ color: '#50505a' }}>—</span>;
  };
  // Time follows the newest market event that supplies a displayed value. A
  // Last/Daily-only exchange event is still a real Market Watch update even
  // though it must never be promoted to an executable Bid or Ask.
  const quoteTimestamp = getLatestMarketWatchTimestamp(
    hasTickQuote ? tick?.sourceTimestamp ?? tick?.timestamp : undefined,
    resolvedDisplayMetadata.timestamp,
  ) ?? fallbackPrice?.asOf;

  return (
    <ContextMenu items={contextMenuItems} variant={isLightSkin ? 'mt5-light' : 'mt5-dark'} density="compact">
      <tr
        ref={rowRef}
        draggable={isChartOpenable}
        onDragStart={(event) => {
          if (!isChartOpenable) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData('text/plain', symbol);
          event.dataTransfer.effectAllowed = 'copyMove';
        }}
        tabIndex={isSelected ? 0 : -1}
        onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onClick(); }}
        onContextMenu={(event) => { event.currentTarget.focus({ preventScroll: true }); onContextSelect(); }}
        onDoubleClick={(event) => { event.preventDefault(); onDoubleClick(); }}
        style={{
          height: 20,
          cursor: 'pointer',
          borderBottom: 'none',
          background: isSelected ? 'var(--bg-quaternary)' : 'var(--bg-secondary)',
          boxShadow: 'none',
        }}
        className={`${!isSelected ? 'mw-row ' : ''}rtx-market-watch__row${isSelected ? ' rtx-market-watch__row--selected' : ''}${!isLive ? ' rtx-market-watch__row--stale' : ''}`}
        aria-selected={isSelected}
        aria-disabled={!isChartOpenable}
        title={!isChartOpenable ? tr('{{value0}} chart is currently unavailable', { value0: displaySymbol }) : undefined}
      >
        <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', maxWidth: 0 }}>
          <div className="rtx-market-watch__symbol-content" style={{ display: 'flex', alignItems: 'center', columnGap: 5, minWidth: 0 }}>
            {hasData && bidDirection === 'up' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--up" width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, color: MARKET_WATCH_QUOTE_UP_COLOR, opacity: quoteDataOpacity }}>
                <path d="M2 8L8 2M3.5 2H8V6.5" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
            {hasData && bidDirection === 'down' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--down" width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, color: 'var(--color-loss)', opacity: quoteDataOpacity }}>
                <path d="M2 2L8 8M3.5 8H8V3.5" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
            {(!hasData || bidDirection === 'none') && (
              <span style={{ width: 10, flexShrink: 0, display: 'inline-block' }} />
            )}
            <span aria-label={displaySymbol} className="rtx-market-watch__symbol" style={{
              flexShrink: 0,
              maxWidth: 'calc(100% - 15px)',
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
          <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center', opacity: hasData ? 1 : quoteDataOpacity }}>
            <span className={`rtx-market-watch__price rtx-market-watch__price--bid${bidPriceDirection ? ` rtx-market-watch__price--${bidPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
              display: 'inline-block',
              fontSize: 13,
              fontWeight: 500,
              color: hasData
                ? bidPriceDirection === 'up' ? MARKET_WATCH_QUOTE_UP_COLOR : MARKET_WATCH_QUOTE_DOWN_COLOR
                : '#36363e',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'transparent',
              transition: 'color 0.25s',
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
              tabularNums: true,
            } as CSSProperties}>
              {hasData ? <PriceDisplay price={bid} symbol={symbol} digits={priceDigits} /> : '—'}
            </span>
          </td>

          {showAsk && (
            <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center', opacity: hasData ? 1 : quoteDataOpacity }}>
              <span className={`rtx-market-watch__price rtx-market-watch__price--ask${askPriceDirection ? ` rtx-market-watch__price--${askPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
                display: 'inline-block',
                fontSize: 13,
                fontWeight: 500,
                color: hasData
                  ? askPriceDirection === 'down' ? MARKET_WATCH_QUOTE_DOWN_COLOR : MARKET_WATCH_QUOTE_UP_COLOR
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
              {renderNumber(resolvedDisplayMetadata.last)}
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
              {hasData ? formatSpreadDisplay(symbol, tick?.spread, bid, ask, tick?.digits) : '—'}
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
        {columns.includes('dailyChangePrice') && (
          <td title={dailyTitle} data-status={resolvedDisplayMetadata.daily?.status} data-field="daily-change-price" style={{ padding: '3px 4px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: dailyAmount === null || dailyAmount === 0 ? 'var(--text-primary)' : dailyAmount > 0 ? MARKET_WATCH_QUOTE_UP_COLOR : MARKET_WATCH_QUOTE_DOWN_COLOR, opacity: isLive && resolvedDisplayMetadata.daily?.status !== 'stale' ? 1 : 0.72 }}>
            {formatDailyChange(dailyAmount, resolveDailyChangeDisplayDigits(symbol, tick?.digits))}
          </td>
        )}
        {showDailyChange && (
          <td title={dailyTitle} data-status={resolvedDisplayMetadata.daily?.status} data-field="daily-change-percent" style={{ padding: '3px 4px', textAlign: 'center', opacity: resolvedDisplayMetadata.daily?.status === 'stale' ? 0.72 : hasDailyData ? 1 : dailyDataOpacity }}>
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
              {hasDailyData ? formatDailyChange(dailyPct, 2, true) : <span style={{ color: '#50505a' }}>{!tick && !displayMetadata ? '…' : '—'}</span>}
            </span>
          </td>
        )}
        {showSource && (
          <td className="rtx-market-watch__source-cell" title={tick?.lp || ''} style={{ padding: '3px 5px', textAlign: 'left', opacity: isLive ? 1 : 0.72 }}>
            <span className="rtx-market-watch__source" style={{ display: 'block', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
              {tick?.lp || '—'}
            </span>
          </td>
        )}
        {extendedColumns.map((column) => {
          const resolved = resolveMarketWatchExtendedColumn({
            column,
            tick,
            lastPrice,
            displayLast: resolvedDisplayMetadata.last,
            instrumentSources,
            priceDigits,
          });
          return (
            <td
              key={column}
              data-field={column}
              style={{ padding: '3px 5px', textAlign: 'right', opacity: isLive ? 1 : 0.72 }}
            >
              <span className={`rtx-market-watch__${column}`} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                {resolved.kind === 'price' && resolved.numericValue !== null && resolved.numericValue !== 0 ? (
                  <PriceDisplay price={resolved.numericValue} symbol={symbol} digits={priceDigits} />
                ) : resolved.formatted !== null ? (
                  resolved.formatted
                ) : (
                  <span style={{ color: '#50505a' }}>—</span>
                )}
              </span>
            </td>
          );
        })}
      </tr>
    </ContextMenu>
  );
};
