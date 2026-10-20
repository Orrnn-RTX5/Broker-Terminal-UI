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
import { resolveSpecDigits } from '../utils/symbolUtils';

export interface DailyChangePriceModeCatalogRow {
  symbol?: unknown;
  brokerSpecification?: unknown;
  specification?: unknown;
  /** Normalized catalog fields (MarketInstrument), read when no spec row carries them. */
  digits?: unknown;
  tickSize?: unknown;
}

let activeScopeKey = '';
let modesBySymbol = new Map<string, DailyChangePriceMode>();
let digitsBySymbol = new Map<string, number>();
let tickSizeBySymbol = new Map<string, number>();

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
  digitsBySymbol = new Map();
  tickSizeBySymbol = new Map();
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

const readPositiveNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Broker tick size: the normalized catalog field first, then the raw spec row. */
const readCatalogTickSize = (
  row: DailyChangePriceModeCatalogRow,
  specification: Record<string, unknown> | undefined,
): number | null => {
  const normalized = readPositiveNumber(row.tickSize);
  if (normalized !== null) return normalized;
  const nested = asRecord(specification?.specification);
  for (const source of [specification, nested]) {
    const value = readPositiveNumber(source?.tick_size ?? source?.tickSize);
    if (value !== null) return value;
  }
  return null;
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
  const nextDigits = new Map<string, number>();
  const nextTickSizes = new Map<string, number>();
  rows.forEach((row) => {
    const symbol = normalizeSymbol(row.symbol);
    const mode = readCatalogMode(row);
    if (symbol && mode) next.set(symbol, mode);
    const specification = asRecord(row.brokerSpecification) ?? asRecord(row.specification) ?? asRecord(row);
    const digits = specification?.digits ?? asRecord(specification?.specification)?.digits;
    if (symbol && typeof digits === 'number' && Number.isInteger(digits) && digits >= 0 && digits <= 12) nextDigits.set(symbol, digits);
    const tickSize = readCatalogTickSize(row, specification);
    if (symbol && tickSize !== null) nextTickSizes.set(symbol, tickSize);
  });
  activeScopeKey = currentScopeKey;
  modesBySymbol = next;
  digitsBySymbol = nextDigits;
  tickSizeBySymbol = nextTickSizes;
  return true;
};

export interface RegisteredSymbolPriceSpec {
  /** Broker quote precision, or null when the catalog did not publish it. */
  digits: number | null;
  /** Broker tick size, or null when the catalog did not publish it. */
  tickSize: number | null;
}

/**
 * Broker-published price geometry for one symbol in the committed
 * broker/account scope. Spec data only: unknown values stay null and are
 * never guessed from the symbol name (SL/TP rounding and grid checks must
 * send the typed value unrounded when precision is unknown).
 */
export const readRegisteredSymbolPriceSpec = (symbol: unknown): RegisteredSymbolPriceSpec => {
  const currentScopeKey = getCurrentDailyChangePriceModeScopeKey();
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!currentScopeKey || currentScopeKey !== activeScopeKey || !normalizedSymbol) {
    return { digits: null, tickSize: null };
  }
  return {
    digits: digitsBySymbol.get(normalizedSymbol) ?? null,
    tickSize: tickSizeBySymbol.get(normalizedSymbol) ?? null,
  };
};

/** Broker precision first (registered catalog, then quote); null when no spec digits are in scope. Never guessed from the symbol name. */
export const resolveDailyChangeDisplayDigits = (symbol: string, quoteDigits?: unknown): number | null => {
  const registered = getCurrentDailyChangePriceModeScopeKey() === activeScopeKey ? digitsBySymbol.get(normalizeSymbol(symbol)) : undefined;
  return resolveSpecDigits(registered, quoteDigits);
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
