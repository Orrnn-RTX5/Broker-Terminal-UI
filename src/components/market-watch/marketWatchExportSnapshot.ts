import { resolveDailyChangeDisplayDigits } from '../../services/dailyChangePriceModeRegistry';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import type { Tick } from '../../store/useAppStore';
import {
  getMarketWatchDisplayMetadata,
  resolveMarketWatchDisplayMetadata,
  mayUseClosedDailyChange,
} from '../../store/useMarketWatchDisplayMetadataStore';
import { formatSpreadDisplay } from '../../utils/spread';
import { formatDailyChange } from '../../utils/dailyChange';
import { readCurrentMarketWatchDailyChangePrice } from '../../services/marketWatchDailyChangeCache';
import {
  escapeMarketWatchCsvCell,
  escapeMarketWatchTsvCell,
  formatMarketWatchTime,
  MARKET_WATCH_COLUMN_HEADERS,
  type MarketWatchColumnId,
} from '../../utils/marketWatchView';
import type { MarketWatchExportResult } from '../../utils/marketWatchExport';
import {
  formatMarketWatchExportPrice,
  getLatestMarketWatchTimestamp,
  getMarketWatchPriceDigits,
  hasMarketWatchQuote,
  readFiniteDailyChange,
} from './marketWatchPanelModel';
import { resolveMarketWatchExtendedColumn } from './marketWatchSymbolDetailsModel';

type Translate = (source: string, values?: Record<string, unknown>) => string;

interface MarketWatchExportSnapshotOptions {
  symbols: readonly string[];
  columns: readonly MarketWatchColumnId[];
  closedDailyChanges: ReadonlyMap<string, number>;
  lastPrices: ReadonlyMap<string, MarketWatchLastPrice>;
  showMilliseconds: boolean;
  getTick: (symbol: string) => Tick | undefined;
  getInstrumentSources?: (symbol: string) => readonly unknown[];
  translate: Translate;
  now?: Date;
}

export interface MarketWatchExportSnapshot {
  clipboardPayload: string;
  result: Readonly<Omit<MarketWatchExportResult, 'destination'>>;
}

const COLUMN_LABELS: Record<MarketWatchColumnId, string> = {
  ...MARKET_WATCH_COLUMN_HEADERS,
  dailyChange: 'Change %',
};

export const createMarketWatchExportSnapshot = ({
  symbols,
  columns,
  closedDailyChanges,
  lastPrices,
  showMilliseconds,
  getTick,
  getInstrumentSources,
  translate,
  now = new Date(),
}: MarketWatchExportSnapshotOptions): MarketWatchExportSnapshot => {
  const cells = symbols.map((symbol) => {
    const tick = getTick(symbol);
    const hasLiveQuote = hasMarketWatchQuote(tick);
    const display = resolveMarketWatchDisplayMetadata(
      tick,
      getMarketWatchDisplayMetadata(symbol),
    );
    const dailyChange = readFiniteDailyChange(display.dailyChange)
      ?? (mayUseClosedDailyChange(display) ? readFiniteDailyChange(closedDailyChanges.get(symbol)) : null);
    const dailyAmount = display.dailyChangePrice
      ?? (closedDailyChanges.has(symbol) && mayUseClosedDailyChange(display) ? readCurrentMarketWatchDailyChangePrice(symbol) : undefined);
    const fallback = hasLiveQuote ? undefined : lastPrices.get(symbol);
    const quote = hasLiveQuote ? tick : fallback?.kind === 'quote' ? fallback : undefined;

    return columns.map((column) => {
      switch (column) {
        case 'symbol': return symbol;
        case 'bid': return quote?.bid !== undefined
          ? formatMarketWatchExportPrice(symbol, quote.bid)
          : fallback?.kind === 'close'
            ? `${translate('Last close')}: ${formatMarketWatchExportPrice(symbol, fallback.close)}`
            : '-';
        case 'ask': return formatMarketWatchExportPrice(symbol, quote?.ask);
        case 'last': return formatMarketWatchExportPrice(symbol, display.last);
        case 'high': return formatMarketWatchExportPrice(symbol, tick?.high ?? tick?.high24h);
        case 'low': return formatMarketWatchExportPrice(symbol, tick?.low ?? tick?.low24h);
        case 'volume': return tick?.volume ?? '-';
        case 'spread': return hasMarketWatchQuote(quote)
          ? formatSpreadDisplay(symbol, tick?.spread, quote?.bid, quote?.ask)
          : '-';
        case 'time': return formatMarketWatchTime(
          getLatestMarketWatchTimestamp(
            hasLiveQuote ? tick?.sourceTimestamp ?? tick?.timestamp : undefined,
            display.timestamp,
          ) ?? fallback?.asOf,
          showMilliseconds,
        );
        case 'dailyChange': return dailyChange !== null ? formatDailyChange(dailyChange, 2, true) : '-';
        case 'dailyChangePrice': return dailyAmount != null ? formatDailyChange(dailyAmount, resolveDailyChangeDisplayDigits(symbol, tick?.digits)) : '-';
        case 'source': return tick?.lp ?? '-';
        default: {
          const resolved = resolveMarketWatchExtendedColumn({
            column,
            tick,
            lastPrice: fallback,
            displayLast: display.last,
            instrumentSources: getInstrumentSources?.(symbol),
            priceDigits: getMarketWatchPriceDigits(symbol),
          });
          return resolved.formatted ?? '-';
        }
      }
    });
  });
  const headers = columns.map((column) => translate(COLUMN_LABELS[column]));
  const clipboardPayload = `${headers.map(escapeMarketWatchTsvCell).join('\t')}\n${cells
    .map((row) => row.map(escapeMarketWatchTsvCell).join('\t'))
    .join('\n')}`;
  const csv = `${headers.map(escapeMarketWatchCsvCell).join(',')}\n${cells
    .map((row) => row.map(escapeMarketWatchCsvCell).join(','))
    .join('\n')}`;
  const fileName = `market-watch-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;

  return {
    clipboardPayload,
    result: Object.freeze({
      symbolCount: symbols.length,
      columnCount: columns.length,
      fileName,
      csv,
    }),
  };
};
