const DERIVED_APP_TICK_KEYS = new Set([
  'prevBid',
  'prevAsk',
  'bidDirection',
  'askDirection',
]);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
);

const getFiniteNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

/** Broker event time is authoritative. Local receipt time is the fallback. */
export const getCanonicalTickTimestamp = (tick: unknown): number | null => {
  const record = asRecord(tick);
  if (!record) return null;
  return getFiniteNumber(record.sourceTimestamp) ?? getFiniteNumber(record.timestamp);
};

const areCanonicalValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areCanonicalValuesEqual(value, right[index]));
  }

  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && areCanonicalValuesEqual(leftRecord[key], rightRecord[key])
    ));
};

/** Compares every upstream field while excluding AppStore-only derived fields. */
export const areCanonicalUpstreamTicksEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) return false;

  const leftKeys = Object.keys(leftRecord)
    .filter(key => !DERIVED_APP_TICK_KEYS.has(key))
    .sort();
  const rightKeys = Object.keys(rightRecord)
    .filter(key => !DERIVED_APP_TICK_KEYS.has(key))
    .sort();

  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && areCanonicalValuesEqual(leftRecord[key], rightRecord[key])
    ));
};

/** Positive means incoming is fresher; zero is the same broker event time. */
export const compareCanonicalTickFreshness = (current: unknown, incoming: unknown): number => {
  const currentTimestamp = getCanonicalTickTimestamp(current);
  const incomingTimestamp = getCanonicalTickTimestamp(incoming);
  if (incomingTimestamp === null) return currentTimestamp === null ? 0 : -1;
  if (currentTimestamp === null) return 1;
  return incomingTimestamp === currentTimestamp
    ? 0
    : incomingTimestamp > currentTimestamp ? 1 : -1;
};

export type CanonicalTickEntry<T> = readonly [symbol: string, tick: T];

/**
 * Keeps the freshest event per exact symbol. Equal-time corrections use the
 * later arrival; exact replays retain the existing object.
 */
export const upsertFreshestTick = <T>(
  target: Map<string, T>,
  symbol: string,
  tick: T,
): boolean => {
  const existing = target.get(symbol);
  if (existing === undefined) {
    if (getCanonicalTickTimestamp(tick) === null) return false;
    target.set(symbol, tick);
    return true;
  }

  const freshness = compareCanonicalTickFreshness(existing, tick);
  if (freshness < 0) return false;
  if (freshness === 0 && areCanonicalUpstreamTicksEqual(existing, tick)) return false;
  target.set(symbol, tick);
  return true;
};

export const coalesceFreshestTickEntries = <T>(
  entries: readonly CanonicalTickEntry<T>[],
  onInvalid?: (symbol: string, error: unknown) => void,
): CanonicalTickEntry<T>[] => {
  const latestBySymbol = new Map<string, T>();
  entries.forEach(([symbol, tick]) => {
    try {
      if (!symbol || !upsertFreshestTick(latestBySymbol, symbol, tick)) return;
    } catch (error) {
      onInvalid?.(symbol, error);
    }
  });
  return Array.from(latestBySymbol.entries());
};
