import type { Account } from '../store/useAppStore';

export const ACCOUNT_METRICS_MAX_AGE_MS = 30_000;

const aliases = {
  balance: ['balance_amount', 'balance', 'Balance'],
  equity: ['equity_amount', 'equity', 'Equity'],
  margin: ['used_margin', 'margin_used', 'margin', 'marginUsed'],
  freeMargin: ['free_margin_amount', 'freeMargin', 'free_margin', 'margin_free', 'margin_available'],
  unrealizedPL: ['floating_pnl', 'floating', 'profit', 'unrealizedPL', 'unrealized_pl', 'unrealizedPnL'],
  marginLevel: ['marginLevel', 'margin_level'],
  credit: ['credit_amount', 'credit', 'credit_bonus', 'bonus'],
} as const;

export type AccountMetric = keyof typeof aliases;
const flags = {
  balance: 'hasBackendBalance', equity: 'hasBackendEquity', margin: 'hasBackendMargin',
  freeMargin: 'hasBackendFreeMargin', unrealizedPL: 'hasBackendFloatingPnL',
  marginLevel: 'hasBackendMarginLevel', credit: 'hasBackendCredit',
} as const;

export function accountMetricNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'object') return accountMetricNumber((value as { amount?: unknown }).amount);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

// Keep metadata from every envelope while unwrapping account/metrics channel frames.
export function extractAccountMetrics(payload: unknown): Record<string, any> {
  let value = payload;
  let result: Record<string, any> = {};
  for (let depth = 0; depth < 6; depth++) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { break; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) break;
    const record = value as Record<string, any>;
    result = { ...result, ...record };
    value = record.account ?? record.data;
  }
  return result;
}

export function normalizeAccountMetrics(
  payload: unknown,
  previous?: Account | null,
  options: { partial?: boolean; scope?: string; login?: number; now?: number } = {},
): Account {
  const raw = extractAccountMetrics(payload);
  const now = options.now ?? Date.now();
  const scope = options.scope ?? previous?.metricsScope;
  const current = previous?.metricsScope && previous.metricsScope !== scope ? null : previous;
  const incomingLogin = raw.login ?? raw.account_login;
  if (options.login && incomingLogin !== undefined && Number(incomingLogin) !== options.login) {
    return current ?? normalizeAccountMetrics({}, null, { ...options, login: undefined });
  }
  const token = raw.publication_token;
  const validToken = typeof token === 'string' && /^[0-9]{20}$/.test(token) && !/^0+$/.test(token);
  if (current?.publicationToken && (!validToken || token <= current.publicationToken)) {
    // The profile endpoint may finish after a newer metrics event. It can
    // supply account identity, but must not roll back any financial value.
    if (token === undefined) {
      const currency = typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency : current.currency;
      const leverageValue = accountMetricNumber(raw.leverage);
      const leverage = leverageValue !== null && leverageValue > 0 ? leverageValue : current.leverage;
      if (currency !== current.currency || leverage !== current.leverage) return { ...current, currency, leverage };
    }
    return current;
  }
  if (token !== undefined && !validToken && current) return current;

  const next: Account = {
    balance: 0, equity: 0, margin: 0, freeMargin: 0, unrealizedPL: 0, marginLevel: 0, credit: 0,
    currency: String(raw.currency ?? current?.currency ?? 'USD'),
    leverage: accountMetricNumber(raw.leverage) ?? current?.leverage ?? 100,
    metricsScope: scope,
    publicationToken: validToken ? token : current?.publicationToken,
    calculationVersion: raw.calculation_version ?? current?.calculationVersion,
    marginCalculationVersion: raw.margin_calculation_version ?? current?.marginCalculationVersion,
    configurationVersion: raw.configuration_version ?? current?.configurationVersion,
    metricsStatus: String(raw.status ?? (raw.valid === false ? 'unavailable' : raw.stale === true ? 'stale' : 'valid')),
    marketClosed: raw.market_closed === true || raw.market_status === 'closed',
    metricUpdatedAt: {},
  };
  const calculatedAt = accountMetricNumber(raw.calculated_at ?? raw.as_of);
  const calculationTimestamp = calculatedAt === null ? now : calculatedAt < 100_000_000_000 ? calculatedAt * 1000 : calculatedAt;
  const invalidCalculationTime = (raw.calculated_at !== undefined || raw.as_of !== undefined)
    && (calculatedAt === null || !Number.isSafeInteger(calculationTimestamp) || calculationTimestamp <= 0 || calculationTimestamp > now + 5_000);
  const hasSourceTime = raw.source_as_of !== undefined;
  const sourceAsOf = accountMetricNumber(raw.source_as_of);
  const invalidSourceTime = hasSourceTime && (sourceAsOf === null || !Number.isSafeInteger(sourceAsOf) || sourceAsOf <= 0 || sourceAsOf > now + 5_000);
  // Recalculation must not extend the life of the oldest quote/FX dependency.
  const timestamp = hasSourceTime && !invalidSourceTime ? Math.min(calculationTimestamp, sourceAsOf!) : calculationTimestamp;
  const invalid = raw.valid === false || raw.stale === true || ['stale', 'unavailable', 'invalid'].includes(next.metricsStatus!)
    || (token !== undefined && !validToken)
    || invalidCalculationTime
    || invalidSourceTime
    || (options.login !== undefined && incomingLogin !== undefined && Number(incomingLogin) !== options.login);
  if (invalid) next.metricsStatus = 'unavailable';
  for (const field of Object.keys(aliases) as AccountMetric[]) {
    const keys = aliases[field];
    const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(raw, candidate));
    const value = key ? accountMetricNumber(raw[key]) : null;
    const preserve = options.partial && key === undefined && current;
    next[field] = value ?? (preserve ? current[field] ?? 0 : 0);
    next[flags[field]] = !invalid && (value !== null || Boolean(preserve && current[flags[field]] !== false && Number.isFinite(current[field])));
    next.metricUpdatedAt![field] = value !== null ? timestamp : preserve ? current.metricUpdatedAt?.[field] ?? 0 : 0;
  }
  if (next.margin < 0) next.hasBackendMargin = false;
  return next;
}

export function accountMetricAvailable(
  account: Partial<Account> | null | undefined,
  field: AccountMetric,
  now = Date.now(),
  maxAgeMs = ACCOUNT_METRICS_MAX_AGE_MS,
): boolean {
  if (!account || account[flags[field]] === false || ['stale', 'unavailable', 'invalid'].includes(account.metricsStatus ?? '')) return false;
  const at = account.metricUpdatedAt?.[field];
  if (at !== undefined && (at <= 0 || now - at > maxAgeMs || at - now > 5_000)) return false;
  return accountMetricNumber(account[field]) !== null;
}
