import { getPublicBackendTarget } from '../config/backendTarget.js';
import { loadPublicMarketCatalog } from './publicMarketCatalog';
import { readDailyChangeInput, type DailyChangeInput } from '../utils/dailyChange';
import { resolveDailyChangePriceMode } from './dailyChangePriceModeRegistry';
import { readBrokerTimestampMs } from '../utils/brokerStreamSemantics';

export interface PublicQuote {
  dailyChangeInput?: DailyChangeInput;
  symbol: string;
  bid?: number;
  ask?: number;
  time?: number;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export async function loadPublicQuotes(signal: AbortSignal): Promise<PublicQuote[]> {
  const data = await loadPublicMarketCatalog(getPublicBackendTarget(), signal);
  const rows = Array.isArray(data) ? data : record(data).symbols;
  if (!Array.isArray(rows)) throw new Error('The broker returned an invalid market catalog.');
  return rows.map(value => {
    const row = record(value);
    const timestamp = readBrokerTimestampMs([row]);
    return {
      symbol: String(row.symbol || '').trim(),
      bid: finite(row.bid) ? row.bid : undefined,
      ask: finite(row.ask) ? row.ask : undefined,
      time: timestamp === undefined ? undefined : timestamp / 1_000,
      dailyChangeInput: readDailyChangeInput(row, resolveDailyChangePriceMode(row, row.symbol)),
    };
  }).filter(row => row.symbol).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

