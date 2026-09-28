import { useEffect, useMemo, useState } from 'react';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useTick } from '../../store/useAppStore';
import {
  resolveMarketWatchDisplayMetadata,
  useMarketWatchDisplayMetadata,
} from '../../store/useMarketWatchDisplayMetadataStore';
import { getMarketWatchSymbolLabel } from '../../utils/marketWatchSource';
import { formatLastPriceTime, hasMarketWatchQuote } from './marketWatchPanelModel';
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
  onSymbolChange: (symbol: string) => void;
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

const DirectionMarker = ({ direction }: { direction: DetailRow['direction'] }) => (
  <span className="rtx-market-watch-details__marker" data-direction={direction} aria-hidden="true">
    {direction === 'up' || direction === 'down' ? (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {direction === 'up'
          ? <path d="M2 8L8 2M4 2h4v4" />
          : <path d="M2 2l6 6M8 4v4H4" />}
      </svg>
    ) : (
      <svg width="10" height="10" viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="1.6" fill="currentColor" />
      </svg>
    )}
  </span>
);

/** MT5 Market Watch "Details" tab: live quote extremes and contract terms for one symbol. */
export function MarketWatchSymbolDetails({
  symbol,
  symbols,
  symbolUniverse,
  descriptions,
  isLive,
  lastPrice,
  closedDailyChange,
  instrumentSources,
  specificationScopeKey,
  loadSpecification,
  onSymbolChange,
}: MarketWatchSymbolDetailsProps) {
  const tr = useUiTranslation();
  const tick = useTick(symbol);
  const displayMetadata = useMarketWatchDisplayMetadata(symbol);
  const brokerSpecification = useBrokerSymbolSpecification(symbol, specificationScopeKey, loadSpecification);
  const specification = useMemo(
    () => readMarketWatchSymbolSpecification(brokerSpecification, ...instrumentSources),
    [brokerSpecification, instrumentSources],
  );
  const details = buildMarketWatchSymbolDetails({
    tick,
    lastPrice,
    displayDailyChange: resolveMarketWatchDisplayMetadata(tick, displayMetadata).dailyChange,
    closedDailyChange,
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

  if (!symbol) {
    return (
      <section className="rtx-market-watch-details rtx-market-watch-details--empty" role="status">
        {tr('No live symbols')}
      </section>
    );
  }

  const displaySymbol = getMarketWatchSymbolLabel(symbol, symbolUniverse);
  const options = symbols.includes(symbol) ? symbols : [symbol, ...symbols];
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
    { field: 'dailyChange', label: tr('Daily Change'), value: formatMarketWatchDetailsPercent(details.dailyChange), direction: dailyDirection },
    { field: 'open', label: tr('Open Price'), value: price(details.open), direction: 'static' },
    { field: 'close', label: tr('Close Price'), value: price(details.close), direction: 'static' },
  ];

  return (
    <section
      className="rtx-market-watch-details"
      aria-label={`${displaySymbol} ${tr('Details')}`}
      data-live={isLive}
    >
      <div className="rtx-market-watch-details__header">
        <select
          className="rtx-market-watch-details__symbol"
          aria-label={tr('Symbol')}
          value={symbol}
          onChange={(event) => onSymbolChange(event.target.value)}
        >
          {options.map((option) => {
            const label = getMarketWatchSymbolLabel(option, symbolUniverse);
            const description = descriptions.get(option);
            return (
              <option key={option} value={option}>
                {description ? `${label}, ${description}` : label}
              </option>
            );
          })}
        </select>
      </div>
      {/* A description list, not a table: both skins restyle every Market
          Watch td/th with !important for the quote grid. */}
      <div className="rtx-market-watch-details__scroll mw-scrollbar">
        <dl className="rtx-market-watch-details__list">
          {rows.map((row) => (
            <div key={row.field} className="rtx-market-watch-details__row" data-field={row.field}>
              <dt className="rtx-market-watch-details__label">
                <DirectionMarker direction={row.direction} />
                {row.label}
              </dt>
              <dd
                className="rtx-market-watch-details__value"
                data-tone={row.value === null || row.direction === 'static' ? undefined : row.direction}
                title={row.value === null ? undefined : row.title}
              >
                {row.value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export default MarketWatchSymbolDetails;
