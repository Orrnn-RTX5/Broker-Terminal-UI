import { resolveDailyChangeDisplayDigits } from '../../services/dailyChangePriceModeRegistry';
import { useState, type CSSProperties, type FC, type ReactNode } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import { useTick } from '../../store/useAppStore';
import {
  getChartDirectionalQuoteColors,
  selectChartPropertiesForQuote,
  useChartSettingsStore,
} from '../../store/useChartSettingsStore';
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

function useLastQuoteDirection(symbol: string, value: number): 'up' | 'down' | null {
  const [directionState, setDirectionState] = useState<{
    symbol: string;
    value: number;
    direction: 'up' | 'down' | null;
  }>(() => ({ symbol, value, direction: null }));

  if (directionState.symbol !== symbol) {
    setDirectionState({ symbol, value, direction: null });
    return null;
  }

  if (value !== directionState.value) {
    const nextDirection = value > 0 && directionState.value > 0
      ? (value > directionState.value ? 'up' : 'down')
      : directionState.direction;
    setDirectionState({
      symbol,
      value,
      direction: nextDirection,
    });
    return nextDirection;
  }

  return directionState.direction;
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
  const chartQuoteProperties = useChartSettingsStore((state) => selectChartPropertiesForQuote(state, symbol));
  const { upColor, downColor, isDefaultPalette } = getChartDirectionalQuoteColors(chartQuoteProperties, {
    isAdvancedUntitledLight: isLightSkin,
  });
  const quoteUpColor = isDefaultPalette ? MARKET_WATCH_QUOTE_UP_COLOR : upColor;
  const quoteDownColor = isDefaultPalette ? MARKET_WATCH_QUOTE_DOWN_COLOR : downColor;
  const directionDownColor = isDefaultPalette ? 'var(--color-loss)' : downColor;
  const displayMetadata = useMarketWatchDisplayMetadata(symbol);
  const resolvedDisplayMetadata = resolveMarketWatchDisplayMetadata(tick, displayMetadata);
  const hasTickQuote = hasMarketWatchQuote(tick);
  const fallbackPrice = hasTickQuote ? undefined : lastPrice;
  const quote = hasTickQuote ? tick : fallbackPrice?.kind === 'quote' ? fallbackPrice : undefined;
  const lastClose = fallbackPrice?.kind === 'close' ? fallbackPrice : undefined;
  const lastPriceTitle = fallbackPrice
    ? `${tr(fallbackPrice.kind === 'close' ? 'Last close' : 'Last quote')} · ${formatLastPriceTime(fallbackPrice.asOf)}`
    : undefined;
  const bidDirection = hasTickQuote ? tick?.bidDirection ?? 'none' : 'none';
  const askDirection = hasTickQuote ? tick?.askDirection ?? 'none' : 'none';
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? 0;
  const rawQuoteSides = quote as { rawBid?: unknown; rawAsk?: unknown } | undefined;
  // Broker data only (catalog row, registered spec, live tick); unknown renders raw.
  const priceDigits = resolveMarketWatchPriceDigits(
    symbol,
    catalogPriceDigits,
    tick?.digits,
    bid,
    ask,
    rawQuoteSides?.rawBid,
    rawQuoteSides?.rawAsk,
  ) ?? undefined;
  const dailyPct = readFiniteDailyChange(resolvedDisplayMetadata.dailyChange)
    ?? (mayUseClosedDailyChange(resolvedDisplayMetadata) ? readFiniteDailyChange(closedDailyChange) : null);

  const hasData = hasMarketWatchQuote(quote);
  const hasDailyData = dailyPct !== null;
  const dailyAmount = readFiniteDailyChange(resolvedDisplayMetadata.dailyChangePrice)
    ?? (closedDailyChange != null && mayUseClosedDailyChange(resolvedDisplayMetadata) ? readFiniteDailyChange(readCurrentMarketWatchDailyChangePrice(symbol)) : null);
  const showSeparateDailyChangePrice = columns.includes('dailyChangePrice');
  const referenceCurrentPrice = bid > 0 ? bid : (lastClose && lastClose.close > 0 ? lastClose.close : 0);
  const tickPreviousClose = readFiniteDailyChange(tick?.close);
  const inlineDailyAmount = !showSeparateDailyChangePrice && hasDailyData
    ? (dailyAmount
      ?? (tickPreviousClose !== null && tickPreviousClose > 0 && bid > 0
        ? bid - tickPreviousClose
        : (referenceCurrentPrice > 0 && 100 + dailyPct > 0
          ? referenceCurrentPrice - referenceCurrentPrice / (1 + dailyPct / 100)
          : null)))
    : null;
  const baseDailyDigits = resolveDailyChangeDisplayDigits(symbol, tick?.digits ?? priceDigits);
  const effectiveDailyDigits = (() => {
    const candidateAmount = inlineDailyAmount ?? dailyAmount;
    if (
      baseDailyDigits !== null
      && candidateAmount !== null
      && Number.isFinite(candidateAmount)
      && Math.abs(candidateAmount) > 0
      && Number(Math.abs(candidateAmount).toFixed(baseDailyDigits)) === 0
    ) {
      return Math.min(6, Math.max(baseDailyDigits, Math.ceil(-Math.log10(Math.abs(candidateAmount))) + 1));
    }
    return baseDailyDigits;
  })();
  const dailyTitle = (closedDailyChange != null && mayUseClosedDailyChange(resolvedDisplayMetadata) ? describeCurrentMarketWatchDailyChange(symbol) : dailyChangeDescription(resolvedDisplayMetadata.daily));
  const bidLastDirection = useLastQuoteDirection(symbol, bid);
  const askLastDirection = useLastQuoteDirection(symbol, ask);
  const rawBidDirection = hasTickQuote ? (bidDirection !== 'none' ? bidDirection : bidLastDirection) : null;
  const rawAskDirection = hasTickQuote ? (askDirection !== 'none' ? askDirection : askLastDirection) : null;
  const dailyPositive = hasDailyData && dailyPct > 0;
  const dailyNegative = hasDailyData && dailyPct < 0;
  const fallbackRowDirection: 'up' | 'down' | null = hasTickQuote
    ? (dailyNegative
      ? 'down'
      : dailyPositive
        ? 'up'
        : (tickPreviousClose !== null && tickPreviousClose > 0 && bid > 0 && bid < tickPreviousClose ? 'down' : 'up'))
    : null;
  const resolvedBidDirection = rawBidDirection ?? rawAskDirection;
  const resolvedAskDirection = rawAskDirection ?? rawBidDirection;
  const resolvedRowDirection = resolvedBidDirection ?? fallbackRowDirection;
  const bidToneClass = resolvedBidDirection;
  const askToneClass = resolvedAskDirection;
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
          ...(!isDefaultPalette ? {
            '--rtx-quote-up': quoteUpColor,
            '--rtx-quote-down': quoteDownColor,
            '--rtx-light-quote-up': quoteUpColor,
            '--rtx-light-quote-down': quoteDownColor,
            '--color-profit': quoteUpColor,
            '--color-loss': quoteDownColor,
          } : {}),
        } as CSSProperties}
        className={`${!isSelected ? 'mw-row ' : ''}rtx-market-watch__row${isSelected ? ' rtx-market-watch__row--selected' : ''}${!isLive ? ' rtx-market-watch__row--stale' : ''}`}
        data-custom-quote-palette={!isDefaultPalette ? 'true' : undefined}
        aria-selected={isSelected}
        aria-disabled={!isChartOpenable}
        title={!isChartOpenable ? tr('{{value0}} chart is currently unavailable', { value0: displaySymbol }) : undefined}
      >
        <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', maxWidth: 0 }}>
          <div className="rtx-market-watch__symbol-content" style={{ display: 'flex', alignItems: 'center', columnGap: 3, minWidth: 0 }}>
            {hasData && resolvedRowDirection === 'up' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--up" width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, color: quoteUpColor, opacity: quoteDataOpacity }}>
                <path d="M2 8L8 2M3.5 2H8V6.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {hasData && resolvedRowDirection === 'down' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--down" width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, color: directionDownColor, opacity: quoteDataOpacity }}>
                <path d="M2 2L8 8M3.5 8H8V3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {(!hasData || !resolvedRowDirection) && (
              <span style={{ width: 10, flexShrink: 0, display: 'inline-block' }} />
            )}
            <span aria-label={displaySymbol} className="rtx-market-watch__symbol" style={{
              flex: '1 1 auto',
              minWidth: 0,
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
          <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center', opacity: 1 }}>
            <span className="rtx-market-watch__last-close" style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'baseline', flexWrap: 'wrap', gap: '0 6px', color: 'var(--text-primary)' }}>
              <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                <PriceDisplay price={lastClose.close} symbol={symbol} digits={priceDigits} />
              </span>
            </span>
          </td>
          {showAsk && (
            <td style={{ padding: '3px 4px', textAlign: 'center', opacity: 1 }}>
              <span className="rtx-market-watch__price rtx-market-watch__price--ask rtx-market-watch__price--empty" style={{ fontSize: 13, color: '#36363e', opacity: 0.45 }}>—</span>
            </td>
          )}
        </> : <>
          <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center', opacity: 1 }}>
            <span className={`rtx-market-watch__price rtx-market-watch__price--bid${bidToneClass ? ` rtx-market-watch__price--${bidToneClass}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
              display: 'inline-block',
              fontSize: 13,
              fontWeight: 500,
              color: hasData
                ? (resolvedBidDirection ?? 'down') === 'up' ? quoteUpColor : quoteDownColor
                : '#36363e',
              opacity: hasData ? 1 : quoteDataOpacity,
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
            <td title={lastPriceTitle} style={{ padding: '3px 4px', textAlign: 'center', opacity: 1 }}>
              <span className={`rtx-market-watch__price rtx-market-watch__price--ask${askToneClass ? ` rtx-market-watch__price--${askToneClass}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
                display: 'inline-block',
                fontSize: 13,
                fontWeight: 500,
                color: hasData
                  ? (resolvedAskDirection ?? 'up') === 'down' ? quoteDownColor : quoteUpColor
                  : '#36363e',
                opacity: hasData ? 1 : quoteDataOpacity,
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
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: 1 }}>
            <span className="rtx-market-watch__last" style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', opacity: isLive ? 1 : 0.72 }}>
              {renderNumber(resolvedDisplayMetadata.last)}
            </span>
          </td>
        )}
        {showHigh && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: 1 }}>
            <span className="rtx-market-watch__high" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: isLive ? 1 : 0.72 }}>
              {renderNumber(tick?.high ?? tick?.high24h)}
            </span>
          </td>
        )}
        {showLow && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: 1 }}>
            <span className="rtx-market-watch__low" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: isLive ? 1 : 0.72 }}>
              {renderNumber(tick?.low ?? tick?.low24h)}
            </span>
          </td>
        )}
        {showVolume && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: 1 }}>
            <span className="rtx-market-watch__volume" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: isLive ? 1 : 0.72 }}>
              {Number.isFinite(Number(tick?.volume)) ? Number(tick?.volume).toLocaleString() : '—'}
            </span>
          </td>
        )}
        {showSpread && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: 1 }}>
            <span className="rtx-market-watch__spread" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: isLive ? 1 : 0.72 }}>
              {hasData ? formatSpreadDisplay(symbol, tick?.spread, bid, ask, tick?.digits) : '—'}
            </span>
          </td>
        )}
        {showTime && (
          <td style={{ padding: '3px 5px', textAlign: 'right', opacity: 1 }}>
            <span className="rtx-market-watch__time" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', opacity: isLive ? 1 : 0.72 }}>
              {formatMarketWatchTime(quoteTimestamp, showMilliseconds)}
            </span>
          </td>
        )}
        {columns.includes('dailyChangePrice') && (
          <td title={dailyTitle} data-status={resolvedDisplayMetadata.daily?.status} data-field="daily-change-price" style={{ padding: '3px 4px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: dailyAmount === null || dailyAmount === 0 ? 'var(--text-primary)' : dailyAmount > 0 ? quoteUpColor : quoteDownColor, opacity: 1 }}>
            <span style={{ opacity: isLive && resolvedDisplayMetadata.daily?.status !== 'stale' ? 1 : 0.72 }}>
              {formatDailyChange(dailyAmount, effectiveDailyDigits)}
            </span>
          </td>
        )}
        {showDailyChange && (
          <td title={dailyTitle} data-status={resolvedDisplayMetadata.daily?.status} data-field="daily-change-percent" style={{ padding: '3px 4px', textAlign: 'center', opacity: 1 }}>
            <span className={`rtx-market-watch__daily${!hasDailyData ? ' rtx-market-watch__daily--empty' : ''}${dailyPositive ? ' rtx-market-watch__daily--up' : ''}${dailyNegative ? ' rtx-market-watch__daily--down' : ''}`} style={{
              fontSize: 13,
              fontWeight: 500,
              color: !hasDailyData
                ? '#50505a'
                : dailyPositive
                  ? quoteUpColor
                  : dailyNegative
                    ? quoteDownColor
                    : 'var(--text-primary)',
              opacity: resolvedDisplayMetadata.daily?.status === 'stale' ? 0.72 : hasDailyData ? 1 : dailyDataOpacity,
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasDailyData
                ? (inlineDailyAmount !== null
                  ? `${formatDailyChange(inlineDailyAmount, effectiveDailyDigits)} (${formatDailyChange(dailyPct, 2, true)})`
                  : formatDailyChange(dailyPct, 2, true))
                : <span style={{ color: '#50505a' }}>{!tick && !displayMetadata ? '…' : '—'}</span>}
            </span>
          </td>
        )}
        {showSource && (
          <td className="rtx-market-watch__source-cell" title={tick?.lp || ''} style={{ padding: '3px 5px', textAlign: 'left', opacity: 1 }}>
            <span className="rtx-market-watch__source" style={{ display: 'block', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, opacity: isLive ? 1 : 0.72 }}>
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
              style={{ padding: '3px 5px', textAlign: 'right', opacity: 1 }}
            >
              <span className={`rtx-market-watch__${column}`} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: isLive ? 1 : 0.72 }}>
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
