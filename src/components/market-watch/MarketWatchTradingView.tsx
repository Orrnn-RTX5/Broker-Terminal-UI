import { useMemo } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useSymbolMarketStatus } from '../../hooks/useSymbolMarketStatus';
import { useAppStore } from '../../store/useAppStore';
import { normalizeExactBrokerSymbol, resolveExactBrokerSymbolValue } from '../../utils/exactBrokerSymbol';
import { formatMarketWatchTime } from '../../utils/marketWatchView';
import { formatSpreadDisplayWithUnit } from '../../utils/spread';
import { getInstrumentSymbolName } from '../../utils/symbolEligibility';
import type { TradeVolumeMetadata } from '../../utils/tradeVolume';
import { OneClickTrading } from '../OneClickTrading';
import {
  buildMarketWatchSymbolDetails,
  formatMarketWatchDetailsPrice,
  readMarketWatchSymbolSpecification,
} from './marketWatchSymbolDetailsModel';
import './market-watch-trading.css';

export interface MarketWatchTradingViewProps {
  symbols: readonly string[];
  /** Shared account-catalog / active-feed trading eligibility, not display quotes. */
  tradeSymbols: readonly string[];
  /** Public terms first, followed by the authoritative account catalogue. */
  instrumentCatalog?: readonly unknown[];
}

interface TradingInstrument {
  sources: unknown[];
  volume: TradeVolumeMetadata;
  tradingEnabled?: boolean;
}

const readPositive = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const EMPTY_CATALOG: readonly unknown[] = [];

function MarketWatchTradingCard({
  symbol,
  tradeAllowed,
  instrument,
}: {
  symbol: string;
  tradeAllowed: boolean;
  instrument: TradingInstrument | undefined;
}) {
  const tr = useUiTranslation();
  // Match the execution control's exact lookup: suffixes are broker identities.
  const tick = useAppStore((state) => resolveExactBrokerSymbolValue(state.ticks, symbol));
  const marketStatus = useSymbolMarketStatus(symbol, { enabled: tradeAllowed });
  const specification = readMarketWatchSymbolSpecification(...(instrument?.sources ?? []));
  const details = buildMarketWatchSymbolDetails({ tick, specification });
  const sourceTime = tick?.sourceTimestamp ?? tick?.timestamp;
  const timestamp = formatMarketWatchTime(sourceTime, false);
  const hasQuote = details.bid !== null && details.ask !== null;
  const spread = hasQuote
    ? formatSpreadDisplayWithUnit(symbol, tick?.spread, details.bid, details.ask, details.digits)
    : '\u2014';

  return (
    <article className="rtx-market-watch-trading__card" aria-label={`${symbol} ${tr('Trading')}`} data-has-quote={hasQuote}>
      <header className="rtx-market-watch-trading__header">
        <span className="rtx-market-watch-trading__symbol" title={symbol}>{symbol}</span>
        <time className="rtx-market-watch-trading__time" title={tr('Last quote')}>
          {timestamp === '-' ? '\u2014' : timestamp}
        </time>
      </header>
      <div className="rtx-market-watch-trading__controls">
        {/* Preserve the chart's order transport, auth/stale/session gates and lot grid. */}
        <OneClickTrading
          symbol={symbol}
          timeframe="M1"
          visible
          tradeAllowed={tradeAllowed}
          marketStatus={marketStatus}
          minVolume={instrument?.volume.minVolume}
          maxVolume={instrument?.volume.maxVolume}
          volumeStep={instrument?.volume.volumeStep}
        />
      </div>
      <dl className="rtx-market-watch-trading__stats">
        <div>
          <dt>{tr('LOW')}</dt>
          <dd>{formatMarketWatchDetailsPrice(details.bidLow, details.digits) ?? '\u2014'}</dd>
        </div>
        <div>
          <dt>{tr('Spread')}</dt>
          <dd>{spread}</dd>
        </div>
        <div>
          <dt>{tr('HIGH')}</dt>
          <dd>{formatMarketWatchDetailsPrice(details.bidHigh, details.digits) ?? '\u2014'}</dd>
        </div>
      </dl>
    </article>
  );
}

/** MT5's Trading tab: one live, independently editable quote card per watched symbol. */
export function MarketWatchTradingView({
  symbols,
  tradeSymbols,
  instrumentCatalog = EMPTY_CATALOG,
}: MarketWatchTradingViewProps) {
  const tr = useUiTranslation();
  const eligible = useMemo(
    () => new Set(tradeSymbols.map(normalizeExactBrokerSymbol)),
    [tradeSymbols],
  );
  const instruments = useMemo(() => {
    const map = new Map<string, TradingInstrument>();
    instrumentCatalog.forEach((instrument) => {
      const symbol = getInstrumentSymbolName(instrument);
      if (!symbol || !instrument || typeof instrument !== 'object') return;
      const record = instrument as Record<string, unknown>;
      const previous = map.get(symbol);
      map.set(symbol, {
        // Account sources occur last in the input and take precedence here.
        sources: [instrument, ...(previous?.sources ?? [])],
        volume: {
          minVolume: readPositive(record.minVolume ?? record.volume_min) ?? previous?.volume.minVolume,
          maxVolume: readPositive(record.maxVolume ?? record.volume_max) ?? previous?.volume.maxVolume,
          volumeStep: readPositive(record.volumeStep ?? record.volume_step) ?? previous?.volume.volumeStep,
        },
        tradingEnabled: typeof record.tradingEnabled === 'boolean'
          ? record.tradingEnabled
          : previous?.tradingEnabled,
      });
    });
    return map;
  }, [instrumentCatalog]);
  const watchedSymbols = useMemo(
    () => Array.from(new Set(symbols.map(normalizeExactBrokerSymbol).filter(Boolean))),
    [symbols],
  );

  return (
    <section className="rtx-market-watch-trading mw-scrollbar" aria-label={tr('Market Watch Trading')}>
      {watchedSymbols.length === 0 ? (
        <div className="rtx-market-watch-trading__empty" role="status">{tr('No live symbols')}</div>
      ) : (
        <div className="rtx-market-watch-trading__grid">
          {watchedSymbols.map((symbol) => {
            const instrument = instruments.get(symbol);
            return (
              <MarketWatchTradingCard
                key={symbol}
                symbol={symbol}
                instrument={instrument}
                tradeAllowed={eligible.has(symbol) && instrument?.tradingEnabled !== false}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export default MarketWatchTradingView;
