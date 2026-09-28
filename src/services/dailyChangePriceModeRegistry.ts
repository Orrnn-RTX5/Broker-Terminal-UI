import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
  type CommittedBrokerAccountSessionScope,
} from './brokerSession';
import {
  readDailyChangePriceMode,
  type DailyChangePriceMode,
} from '../utils/dailyChange';

export interface DailyChangePriceModeCatalogRow {
  symbol?: unknown;
  brokerSpecification?: unknown;
  specification?: unknown;
}

let activeScopeKey = '';
let modesBySymbol = new Map<string, DailyChangePriceMode>();

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const scopeKey = (scope: CommittedBrokerAccountSessionScope): string => (
  getCommittedBrokerAccountSessionScopeKey(scope)
);

const isUsableScope = (scope: CommittedBrokerAccountSessionScope): boolean => (
  Boolean(scope.brokerId || scope.serverUrl)
  && (!scope.authenticated || Boolean(scope.accountId))
);

const resetForScope = (scope: CommittedBrokerAccountSessionScope): void => {
  activeScopeKey = isUsableScope(scope) ? scopeKey(scope) : '';
  modesBySymbol = new Map();
};

resetForScope(getCommittedBrokerAccountSessionScope());
onCommittedBrokerAccountSessionScopeChange(resetForScope);

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const hasOwnChartMode = (value: unknown): boolean => {
  const record = asRecord(value);
  return Boolean(record && (
    Object.prototype.hasOwnProperty.call(record, 'chart_mode')
    || Object.prototype.hasOwnProperty.call(record, 'chartMode')
  ));
};

const readCatalogMode = (row: DailyChangePriceModeCatalogRow): DailyChangePriceMode | undefined => {
  const source = asRecord(row.brokerSpecification) ?? row;
  const direct = readDailyChangePriceMode(source);
  if (direct) return direct;

  const nested = asRecord(source.specification);
  return nested ? readDailyChangePriceMode(nested) : undefined;
};

export const getCurrentDailyChangePriceModeScopeKey = (): string => {
  const scope = getCommittedBrokerAccountSessionScope();
  return isUsableScope(scope) ? scopeKey(scope) : '';
};

/**
 * Replace chart modes with one complete, currently published catalog. A late
 * response captured under another broker/account is rejected rather than
 * leaking metadata into the active quote session.
 */
export const registerDailyChangePriceModes = (
  rows: readonly DailyChangePriceModeCatalogRow[],
  expectedScopeKey = getCurrentDailyChangePriceModeScopeKey(),
): boolean => {
  const currentScopeKey = getCurrentDailyChangePriceModeScopeKey();
  if (!currentScopeKey || expectedScopeKey !== currentScopeKey) return false;

  const next = new Map<string, DailyChangePriceMode>();
  rows.forEach((row) => {
    const symbol = normalizeSymbol(row.symbol);
    const mode = readCatalogMode(row);
    if (symbol && mode) next.set(symbol, mode);
  });
  activeScopeKey = currentScopeKey;
  modesBySymbol = next;
  return true;
};

export const readRegisteredDailyChangePriceMode = (
  symbol: unknown,
): DailyChangePriceMode | undefined => {
  const currentScopeKey = getCurrentDailyChangePriceModeScopeKey();
  if (!currentScopeKey || currentScopeKey !== activeScopeKey) return undefined;
  const normalizedSymbol = normalizeSymbol(symbol);
  return normalizedSymbol ? modesBySymbol.get(normalizedSymbol) : undefined;
};

/**
 * Raw quote metadata is authoritative. The nearest normalized quote payload
 * wins over its transport envelope, and either raw layer wins over catalog
 * metadata. An explicit unknown value also wins by blocking every fallback.
 */
export const resolveDailyChangePriceMode = (
  payload: unknown,
  symbol: unknown,
  envelope?: unknown,
  ancestorEnvelopes: readonly unknown[] = [],
): DailyChangePriceMode | undefined => {
  if (hasOwnChartMode(payload)) return readDailyChangePriceMode(payload);
  const envelopes = [envelope, ...ancestorEnvelopes];
  for (const candidate of envelopes) {
    if (hasOwnChartMode(candidate)) return readDailyChangePriceMode(candidate);
  }
  return readRegisteredDailyChangePriceMode(symbol);
};

/** Test-only reset without manufacturing a broker/session owner. */
export const resetDailyChangePriceModeRegistryForTests = (): void => {
  resetForScope(getCommittedBrokerAccountSessionScope());
};
