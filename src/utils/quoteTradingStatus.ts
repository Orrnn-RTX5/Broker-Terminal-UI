import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../services/brokerSession';

export interface QuoteTradingStatus {
  tradable: boolean;
  authority: string;
  brokerId: string;
  stale: boolean | undefined;
  sourceMismatch: boolean | undefined;
  receivedAt: number;
  sessionScope: string;
}

export interface QuoteTradingStatusFields {
  tradingStatus?: QuoteTradingStatus;
}

const readFlag = (value: unknown): boolean | undefined => {
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  return undefined;
};

/** Keep explicit broker permission separate from the mere presence of prices. */
export const readQuoteTradingStatus = (record: Record<string, unknown>): QuoteTradingStatus | undefined => {
  const tradable = readFlag(record.tradable);
  if (tradable === undefined) return undefined;
  return {
    tradable,
    authority: String(record.authority ?? '').trim().toLowerCase(),
    brokerId: String(record.broker_id ?? '').trim().toLowerCase(),
    stale: readFlag(record.stale),
    sourceMismatch: readFlag(record.source_mismatch),
    receivedAt: Date.now(),
    sessionScope: getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()),
  };
};

export const QUOTE_TRADING_STATUS_TTL_MS = 10_000;

export const isCurrentQuoteTradingStatus = (
  status: QuoteTradingStatus | undefined,
  brokerId: string,
  sourceTimestamp: number | undefined,
  now: number,
  brokerNow: number,
): boolean => Boolean(
  status && status.authority === 'rtx5_hub'
  && status.brokerId && status.brokerId === brokerId.trim().toLowerCase()
  && status.stale === false && status.sourceMismatch !== true
  && now >= status.receivedAt && now - status.receivedAt < QUOTE_TRADING_STATUS_TTL_MS
  && sourceTimestamp !== undefined && Number.isFinite(sourceTimestamp)
  && Math.abs(brokerNow - sourceTimestamp) < QUOTE_TRADING_STATUS_TTL_MS,
);
