/**
 * brokerOperationalConfig — white-label broker operating values.
 *
 * Every broker-specific operating value (display name, liquidity-provider tag,
 * execution mode, default leverage/balance, margin mode, tick retention) is
 * owned by the broker's own `/api/v2/broker/config` document. This module is
 * the single place that reads that document into neutral, fully-populated
 * state — no caller embeds per-broker literals.
 *
 * It extends the existing broker-config/branding mechanism (snake_case support
 * for `broker_name` / `server_name`): each key is accepted in the camelCase
 * form the endpoint serves today and in the snake_case form broker rows use,
 * with camelCase winning when both are present. Anything missing or
 * malformed resolves to a neutral default (`''` / `0`) so a new broker with
 * an empty config gets generic behavior, never another broker's values.
 */

export interface BrokerOperationalConfig {
  brokerName: string;
  priceFeedLP: string;
  executionMode: string;
  defaultLeverage: number;
  defaultBalance: number;
  marginMode: string;
  maxTicksPerSymbol: number;
}

type RawRecord = Record<string, unknown>;

/** Neutral defaults for a broker with no config yet. Never tenant-specific. */
export const NEUTRAL_BROKER_OPERATIONAL_CONFIG: BrokerOperationalConfig = Object.freeze({
  brokerName: '',
  priceFeedLP: '',
  executionMode: '',
  defaultLeverage: 0,
  defaultBalance: 0,
  marginMode: '',
  maxTicksPerSymbol: 0,
});

const asRecord = (payload: unknown): RawRecord => (
  payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as RawRecord)
    : {}
);

const readText = (record: RawRecord, ...keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
};

const readCount = (record: RawRecord, ...keys: string[]): number => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.trim().replace(/,/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

/**
 * Normalize a raw `/api/v2/broker/config` payload. Values the broker
 * configured flow through untouched (existing brokers keep their behavior);
 * anything absent flows through as the neutral default.
 */
export const normalizeBrokerOperationalConfig = (payload: unknown): BrokerOperationalConfig => {
  const record = asRecord(payload);
  return {
    brokerName: readText(record, 'brokerName', 'broker_name', 'name'),
    priceFeedLP: readText(record, 'priceFeedLP', 'price_feed_lp'),
    executionMode: readText(record, 'executionMode', 'execution_mode'),
    defaultLeverage: readCount(record, 'defaultLeverage', 'default_leverage'),
    defaultBalance: readCount(record, 'defaultBalance', 'default_balance'),
    marginMode: readText(record, 'marginMode', 'margin_mode'),
    maxTicksPerSymbol: readCount(record, 'maxTicksPerSymbol', 'max_ticks_per_symbol'),
  };
};
