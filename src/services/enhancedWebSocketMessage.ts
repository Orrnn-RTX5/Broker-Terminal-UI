import {
  composeDailyChangeQuoteContext,
  readDailyChangeLastPrice,
} from '../utils/dailyChange';
import { resolveDailyChangePriceMode } from './dailyChangePriceModeRegistry';

export interface WebSocketMessage {
  type?: string;
  action?: string;
  symbol?: string;
  channel?: string;
  data?: unknown;
  timestamp?: number;
  [key: string]: unknown;
}

const asMessageRecord = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
);

const HANDLED_TICK_CONTAINER_KEYS = [
  'data', 'tick', 'quote', 'price', 'payload', 'message', 'prices', 'ticks',
] as const;

const hasNestedHandledTickPayload = (record: Record<string, unknown>): boolean => (
  HANDLED_TICK_CONTAINER_KEYS.some((key) => {
    const candidate = record[key];
    return Array.isArray(candidate)
      || (candidate !== null && typeof candidate === 'object');
  })
);

const hasHandledTickPrice = (value: unknown, symbol: unknown, envelope?: unknown): boolean => {
  const record = asMessageRecord(value);
  if (!record) return false;
  // Ownership is intentionally leaf-only. A wrapper may repeat summary sides
  // while carrying the authoritative quote below a supported container key.
  if (hasNestedHandledTickPayload(record)) return false;
  const bid = Number(record.bid);
  const ask = Number(record.ask);
  if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) return true;
  return resolveDailyChangePriceMode(record, symbol, envelope) === 'last'
    && readDailyChangeLastPrice(composeDailyChangeQuoteContext(record, envelope)) !== undefined;
};

/**
 * Shared ownership rule for /ws/v2 tick frames. App's wildcard listener uses
 * this same predicate to avoid writing a valid tick twice while retaining its
 * legacy normalizer for malformed, price-only, quotes.*, and prices frames.
 */
export const isEnhancedStoreHandledTickFrame = (message: WebSocketMessage): boolean => {
  if (message.type === 'tick') {
    return Boolean(String(message.symbol ?? '').trim())
      && hasHandledTickPrice(message, message.symbol);
  }
  const channelSymbol = typeof message.channel === 'string' && message.channel.toLowerCase().startsWith('ticks.')
    ? message.channel.slice('ticks.'.length)
    : '';
  return message.type === 'channel_message'
    && Boolean(channelSymbol)
    && hasHandledTickPrice(message.data, channelSymbol, message);
};

export const isExactAccountStreamChannel = (
  channel: unknown,
  namespace: 'account' | 'positions',
  activeLogin: unknown,
): boolean => {
  // Account-scoped streams use the exact login encoded by the channel; never
  // accept a missing, partial, or previous-account identifier.
  if (typeof channel !== 'string') return false;
  const prefix = `${namespace}.`;
  if (!channel.startsWith(prefix)) return false;
  const channelLogin = channel.slice(prefix.length).trim();
  const expectedLogin = String(activeLogin ?? '').trim();
  return channelLogin.length > 0 && expectedLogin.length > 0 && channelLogin === expectedLogin;
};
