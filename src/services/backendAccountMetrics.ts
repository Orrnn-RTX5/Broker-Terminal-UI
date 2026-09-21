import type { Account } from '../store/useAppStore';

type RecordValue = Record<string, unknown>;

/** Decode a backend number/Money.amount without deriving or rounding its value. */
export const readBackendNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || typeof value === 'boolean') return undefined;
  if (typeof value === 'object') {
    return 'amount' in value ? readBackendNumber((value as RecordValue).amount) : undefined;
  }
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const number = Number(typeof value === 'string' ? value.replace(/,/g, '') : value);
  return Number.isFinite(number) ? number : undefined;
};

const metricFields = [
  ['balance', 'hasBackendBalance', ['balance_amount', 'balance', 'Balance']],
  ['equity', 'hasBackendEquity', ['equity_amount', 'equity', 'Equity']],
  ['margin', 'hasBackendMargin', ['used_margin', 'margin_used', 'margin', 'marginUsed']],
  ['freeMargin', 'hasBackendFreeMargin', ['free_margin_amount', 'free_margin', 'margin_free', 'freeMargin', 'margin_available']],
  ['unrealizedPL', 'hasBackendUnrealizedPL', ['floating_pnl', 'floating', 'profit', 'unrealizedPL', 'unrealized_pl', 'unrealizedPnL']],
  ['marginLevel', 'hasBackendMarginLevel', ['margin_level', 'marginLevel']],
  ['credit', 'hasBackendCredit', ['credit', 'credit_bonus', 'bonus']],
] as const;

const accountKeys = new Set<string>([
  ...metricFields.flatMap(([, , aliases]) => [...aliases]), 'currency', 'leverage',
]);

const asRecord = (value: unknown): RecordValue | null => {
  if (typeof value === 'string') {
    try { return asRecord(JSON.parse(value)); } catch { return null; }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
};

/** Accept REST summaries and both legacy and nested /ws/v2 account envelopes. */
export const extractBackendAccountRecord = (value: unknown, depth = 0): RecordValue | null => {
  if (depth > 6) return null;
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['account', 'data']) {
    if (record[key] !== undefined) {
      const nested = extractBackendAccountRecord(record[key], depth + 1);
      if (nested) return nested;
    }
  }
  return Object.keys(record).some(key => accountKeys.has(key)) ? record : null;
};

/** Preserve omitted deltas; an explicit null/invalid value is unavailable, never calculated. */
export const normalizeBackendAccount = (value: unknown, previous?: Account | null): Account => {
  const raw = extractBackendAccountRecord(value) ?? {};
  const next: RecordValue = {};
  for (const [field, flag, aliases] of metricFields) {
    const alias = aliases.find(key => Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined);
    const supplied = alias !== undefined;
    const number = readBackendNumber(supplied ? raw[alias] : previous?.[field]);
    const available = supplied
      ? raw[flag] !== false && number !== undefined
      : previous != null && previous[flag] !== false && number !== undefined;
    // Account's numeric storage contract remains stable. The provenance flags
    // make these placeholders unavailable at every Trade display boundary.
    next[field] = available ? number : 0;
    next[flag] = available;
  }
  return {
    ...next,
    currency: String(raw.currency ?? previous?.currency ?? 'USD'),
    leverage: readBackendNumber(raw.leverage) ?? previous?.leverage ?? 100,
  } as unknown as Account;
};

/** Fields a packet actually supplies, including explicit null/unavailable values. */
export const getBackendAccountUpdateKeys = (value: unknown): (keyof Account)[] => {
  const raw = extractBackendAccountRecord(value);
  if (!raw) return [];
  const keys: (keyof Account)[] = [];
  for (const [field, flag, aliases] of metricFields) {
    if (aliases.some(alias => Object.prototype.hasOwnProperty.call(raw, alias) && raw[alias] !== undefined)) {
      keys.push(field, flag);
    }
  }
  if (raw.currency !== undefined) keys.push('currency');
  if (raw.leverage !== undefined) keys.push('leverage');
  return keys;
};

/** Retain only the fields received over WS after this REST request started. */
export const mergeBackendAccountSnapshot = (
  snapshot: unknown,
  current: Account | null,
  newerFields: readonly (keyof Account)[],
): Account => {
  const next = normalizeBackendAccount(snapshot, current);
  if (current) {
    for (const key of newerFields) (next as unknown as RecordValue)[key] = current[key];
  }
  return next;
};

/** Reject conflicting identities even when a valid channel wraps the record. */
export const isBackendAccountForLogin = (value: unknown, login: number, brokerId?: string, depth = 0): boolean => {
  if (depth > 6) return false;
  const raw = asRecord(value);
  if (!raw) return false;
  for (const key of ['login', 'account_login']) {
    if (raw[key] !== undefined && String(raw[key]) !== String(login)) return false;
  }
  if (brokerId && raw.broker_id !== undefined && String(raw.broker_id) !== brokerId) return false;
  for (const key of ['account', 'data']) {
    if (raw[key] !== undefined && asRecord(raw[key]) && !isBackendAccountForLogin(raw[key], login, brokerId, depth + 1)) return false;
  }
  return true;
};
