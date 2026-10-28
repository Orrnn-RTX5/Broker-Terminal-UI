import { resolveDailyChangeDisplayDigits } from '../../services/dailyChangePriceModeRegistry';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import { useUiTranslation } from '../../hooks/useUiTranslation';
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
import { getMarketWatchSymbolLabel } from '../../utils/marketWatchSource';
import { resolveSymbolDescription } from '../../utils/symbolDescription';
import { formatDailyChange } from '../../utils/dailyChange';
import { dailyChangeDescription } from '../../utils/dailyChangeSession';
import { readCurrentMarketWatchDailyChangePrice, describeCurrentMarketWatchDailyChange } from '../../services/marketWatchDailyChangeCache';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { formatLastPriceTime, hasMarketWatchQuote, readInstrumentDescription } from './marketWatchPanelModel';

import {
  buildMarketWatchSymbolDetails,
  formatMarketWatchDetailsNumber,
  formatMarketWatchDetailsPercent,
  formatMarketWatchDetailsPrice,
  readMarketWatchSymbolSpecification,
} from './marketWatchSymbolDetailsModel';
import './market-watch-views.css';

type Direction = 'up' | 'down' | 'none';
type LoadSymbolSpecification = (
  symbol: string,
  signal?: AbortSignal,
) => Promise<Readonly<Record<string, unknown>> | null>;

interface DetailRow {
  field: string;
  label: string;
  value: string | null;
  /** `static` marks contract terms and session anchors that do not tick. */
  direction: Direction | 'static';
  title?: string;
}

export interface MarketWatchSymbolDetailsProps {
  symbol: string;
  symbols: readonly string[];
  symbolUniverse: readonly string[];
  descriptions: ReadonlyMap<string, string>;
  isLive: boolean;
  lastPrice?: MarketWatchLastPrice;
  closedDailyChange?: number | null;
  /** Catalogue rows for the symbol, most authoritative first. */
  instrumentSources: readonly unknown[];
  specificationScopeKey: string;
  loadSpecification?: LoadSymbolSpecification;
  onSymbolChange?: (symbol: string) => void;
  onOpenSpecification?: (symbol: string) => void;
  isSpecificationOpen?: boolean;
  showGrid?: boolean;
  contextMenuItems?: ContextMenuItemConfig[];
  onRowDoubleClick?: () => void;
}

/** Direction of the most recent change of a value, held until it changes again. */
const useLastChangeDirection = (
  identity: string,
  value: number | null,
  initial: Direction = 'none',
): Direction => {
  const [state, setState] = useState(() => ({ identity, value, direction: initial }));
  if (state.identity !== identity) {
    setState({ identity, value, direction: initial });
    return initial;
  }
  if (value !== state.value) {
    const direction: Direction = value !== null && state.value !== null
      ? value > state.value ? 'up' : 'down'
      : state.direction;
    setState({ identity, value, direction });
    return direction;
  }
  return state.direction;
};

/**
 * The account specification refreshes Tick Value at request time, so it is
 * loaded while Details is open. Catalogue values cover the request and any
 * failure.
 */
const useBrokerSymbolSpecification = (
  symbol: string,
  scopeKey: string,
  load: LoadSymbolSpecification | undefined,
): Readonly<Record<string, unknown>> | null => {
  const requestKey = load && symbol ? `${scopeKey}\u0000${symbol}` : null;
  const [loaded, setLoaded] = useState<{
    key: string;
    instrument: Readonly<Record<string, unknown>> | null;
  } | null>(null);

  useEffect(() => {
    if (!requestKey || !load) return undefined;
    const controller = new AbortController();
    load(symbol, controller.signal)
      .then((instrument) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, instrument });
      })
      .catch(() => {
        // Keep the catalogue terms; Specification reports request failures.
      });
    return () => controller.abort();
  }, [load, requestKey, symbol]);

  return loaded?.key === requestKey ? loaded.instrument : null;
};

const DirectionMarker = ({ direction }: { direction: DetailRow['direction'] }) => {
  if (direction !== 'up' && direction !== 'down') return null;
  return (
    <span className="rtx-market-watch-details__marker" data-direction={direction} aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {direction === 'up'
          ? <path d="M2 8L8 2M4 2h4v4" />
          : <path d="M2 2l6 6M8 4v4H4" />}
      </svg>
    </span>
  );
};

/** MT5 Market Watch "Details" tab: live quote extremes and contract terms for one symbol. */
export function MarketWatchSymbolDetails({
  symbol,
  symbolUniverse,
  descriptions,
  isLive,
  lastPrice,
  closedDailyChange,
  instrumentSources,
  specificationScopeKey,
  loadSpecification,
  onOpenSpecification,
  isSpecificationOpen = false,
  showGrid = true,
  contextMenuItems,
  onRowDoubleClick,
}: MarketWatchSymbolDetailsProps) {
  const tr = useUiTranslation();
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [activatedSymbol, setActivatedSymbol] = useState<string | null>(null);
  const [isLightSkin, setIsLightSkin] = useState(false);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const tick = useTick(symbol);
  const chartQuoteProperties = useChartSettingsStore((state) => selectChartPropertiesForQuote(state, symbol));
  const { upColor, downColor, isDefaultPalette } = getChartDirectionalQuoteColors(chartQuoteProperties, {
    isAdvancedUntitledLight: isLightSkin,
  });
  const displayMetadata = useMarketWatchDisplayMetadata(symbol);
  const dailyDisplay = resolveMarketWatchDisplayMetadata(tick, displayMetadata);
  const dailyTitle = (closedDailyChange != null && mayUseClosedDailyChange(dailyDisplay) ? describeCurrentMarketWatchDailyChange(symbol) : dailyChangeDescription(dailyDisplay.daily));
  const dailyAmount = dailyDisplay.dailyChangePrice
    ?? (closedDailyChange != null && mayUseClosedDailyChange(dailyDisplay) ? readCurrentMarketWatchDailyChangePrice(symbol) : undefined);
  const brokerSpecification = useBrokerSymbolSpecification(symbol, specificationScopeKey, loadSpecification);
  const specification = useMemo(
    () => readMarketWatchSymbolSpecification(brokerSpecification, ...instrumentSources),
    [brokerSpecification, instrumentSources],
  );
  const details = buildMarketWatchSymbolDetails({
    tick,
    lastPrice,
    displayDailyChange: dailyDisplay.dailyChange,
    closedDailyChange: mayUseClosedDailyChange(dailyDisplay) ? closedDailyChange : undefined,
    specification,
  });
  const hasLiveQuote = hasMarketWatchQuote(tick);
  // A historical fallback is replaced, not moved, by the first live quote.
  const quoteIdentity = `${symbol}\u0000${hasLiveQuote ? 'live' : 'fallback'}`;
  const bidDirection = useLastChangeDirection(
    quoteIdentity,
    details.bid,
    hasLiveQuote ? tick?.bidDirection : 'none',
  );
  const askDirection = useLastChangeDirection(
    quoteIdentity,
    details.ask,
    hasLiveQuote ? tick?.askDirection : 'none',
  );
  const bidHighDirection = useLastChangeDirection(quoteIdentity, details.bidHigh);
  const bidLowDirection = useLastChangeDirection(quoteIdentity, details.bidLow);
  const askHighDirection = useLastChangeDirection(quoteIdentity, details.askHigh);
  const askLowDirection = useLastChangeDirection(quoteIdentity, details.askLow);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (!symbol) {
    return (
      <section className="rtx-market-watch-details rtx-market-watch-details--empty" role="status">
        {tr('No live symbols')}
      </section>
    );
  }

  const displaySymbol = getMarketWatchSymbolLabel(symbol, symbolUniverse);
  const rawDescription = descriptions.get(symbol)
    || readInstrumentDescription(brokerSpecification, symbol)
    || instrumentSources.map((source) => readInstrumentDescription(source, symbol)).find(Boolean)
    || '';
  const symbolDescription = resolveSymbolDescription(symbol, rawDescription)
    || resolveSymbolDescription(displaySymbol);
  const symbolHeaderLabel = symbolDescription ? `${displaySymbol}, ${symbolDescription}` : displaySymbol;

  const isSymbolActive = isSpecificationOpen || activatedSymbol === symbol;
  const quoteTitle = details.fallbackQuoteAsOf === null
    ? undefined
    : `${tr('Last quote')} · ${formatLastPriceTime(details.fallbackQuoteAsOf)}`;
  const price = (value: number | null) => formatMarketWatchDetailsPrice(value, details.digits);
  const dailyDirection: Direction = details.dailyChange === null || details.dailyChange === 0
    ? 'none'
    : details.dailyChange > 0 ? 'up' : 'down';
  const rows: DetailRow[] = [
    { field: 'tickSize', label: tr('Tick Size'), value: formatMarketWatchDetailsNumber(details.tickSize), direction: 'static' },
    { field: 'tickValue', label: tr('Tick Value'), value: formatMarketWatchDetailsNumber(details.tickValue), direction: 'static' },
    { field: 'bid', label: tr('Bid'), value: price(details.bid), direction: bidDirection, title: quoteTitle },
    { field: 'bidHigh', label: tr('Bid High'), value: price(details.bidHigh), direction: bidHighDirection },
    { field: 'bidLow', label: tr('Bid Low'), value: price(details.bidLow), direction: bidLowDirection },
    { field: 'ask', label: tr('Ask'), value: price(details.ask), direction: askDirection, title: quoteTitle },
    { field: 'askHigh', label: tr('Ask High'), value: price(details.askHigh), direction: askHighDirection },
    { field: 'askLow', label: tr('Ask Low'), value: price(details.askLow), direction: askLowDirection },
    { field: 'dailyChangePrice', label: tr('Change'), value: formatDailyChange(dailyAmount, details.digits ?? resolveDailyChangeDisplayDigits(symbol, tick?.digits)), direction: !dailyAmount ? 'none' : dailyAmount > 0 ? 'up' : 'down', title: dailyTitle },
    { field: 'dailyChange', label: tr('Change %'), value: formatMarketWatchDetailsPercent(details.dailyChange), direction: dailyDirection, title: dailyTitle },
    { field: 'open', label: tr('Open Price'), value: price(details.open), direction: 'static' },
    { field: 'close', label: tr('Close Price'), value: price(details.close), direction: 'static' },
  ];

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    let targetIndex: number | null = null;
    if (event.key === 'ArrowDown') {
      targetIndex = Math.min(index + 1, rows.length - 1);
    } else if (event.key === 'ArrowUp') {
      targetIndex = Math.max(index - 1, 0);
    } else if (event.key === 'Home') {
      targetIndex = 0;
    } else if (event.key === 'End') {
      targetIndex = rows.length - 1;
    }
    if (targetIndex !== null) {
      event.preventDefault();
      const nextField = rows[targetIndex].field;
      setActivatedSymbol(null);
      setSelectedField(nextField);
      rowRefs.current.get(nextField)?.focus();
    }
  };

  const scrollContent = (
    <div className="rtx-market-watch-details__scroll mw-scrollbar">
      <dl className="rtx-market-watch-details__list">
        {rows.map((row, index) => {
          const isRowSelected = selectedField === row.field;
          return (
            <div
              key={row.field}
              ref={(node) => {
                if (node) rowRefs.current.set(row.field, node);
                else rowRefs.current.delete(row.field);
              }}
              className="rtx-market-watch-details__row"
              data-field={row.field}
              data-selected={isRowSelected ? 'true' : undefined}
              aria-selected={isRowSelected}
              tabIndex={isRowSelected || (selectedField === null && index === 0) ? 0 : -1}
              onClick={(event) => {
                setActivatedSymbol(null);
                setSelectedField(row.field);
                event.currentTarget.focus();
              }}
              onContextMenu={(event) => {
                setActivatedSymbol(null);
                setSelectedField(row.field);
                event.currentTarget.focus();
              }}
              onDoubleClick={onRowDoubleClick}
              onKeyDown={(event) => handleRowKeyDown(event, index)}
            >
              <dt className="rtx-market-watch-details__label">
                <DirectionMarker direction={row.direction} />
                {row.label}
              </dt>
              <dd
                className="rtx-market-watch-details__value"
                data-tone={
                  row.value === null || row.direction === 'static'
                    ? undefined
                    : !isDefaultPalette && row.direction === 'none'
                      ? (row.field === 'bid'
                        ? 'down'
                        : row.field === 'ask'
                          ? 'up'
                          : row.direction)
                      : row.direction
                }
                title={row.value === null ? undefined : row.title}
              >
                {row.value ?? '—'}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );

  return (
    <section
      className="rtx-market-watch-details"
      aria-label={`${displaySymbol} ${tr('Details')}`}
      data-live={isLive}
      data-grid={showGrid}
      style={!isDefaultPalette ? {
        '--rtx-market-details-up': upColor,
        '--rtx-market-details-down': downColor,
        '--rtx-market-details-rise': upColor,
        '--rtx-market-details-fall': downColor,
      } as CSSProperties : undefined}
    >
      <div className="rtx-market-watch-details__header">
        <button
          type="button"
          className="rtx-market-watch-details__symbol"
          data-testid="market-watch-details-symbol"
          data-active={isSymbolActive ? 'true' : undefined}
          title={symbolHeaderLabel}
          onClick={() => {
            setActivatedSymbol(symbol);
            onOpenSpecification?.(symbol);
          }}
        >
          {symbolHeaderLabel}
        </button>
        {!isLive && (
          <span className="rtx-market-watch-details__availability-status" role="status">
            {tr('Symbol unavailable')}
          </span>
        )}
      </div>
      {/* A description list, not a table: both skins restyle every Market
          Watch td/th with !important for the quote grid. */}
      {contextMenuItems && contextMenuItems.length > 0 ? (
        <ContextMenu
          items={contextMenuItems}
          variant={isLightSkin ? 'mt5-light' : 'mt5-dark'}
          density="compact"
        >
          {scrollContent}
        </ContextMenu>
      ) : scrollContent}
    </section>
  );
}

export default MarketWatchSymbolDetails;
