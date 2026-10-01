import { create } from 'zustand';
import { advanceDailyChange, type DailyChangeSnapshot } from '../utils/dailyChangeSession';
import type { DailyChangeInput } from '../utils/dailyChange';
import { useWebSocketStore } from './useWebSocketStore';

import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
} from '../services/brokerSession';
import {
  areCanonicalUpstreamTicksEqual,
  compareCanonicalTickFreshness,
  getCanonicalTickTimestamp,
} from '../utils/liveTickSemantics';

export interface MarketWatchDisplayMetadata {
  symbol: string;
  /** Exchange Last; display-only and never an executable Bid or Ask. */
  last?: number;
  /** Broker event time that supplied Last, independent of the newest carrier. */
  lastSourceTimestamp?: number;
  dailyChange?: number;
  /** Broker event time that supplied Daily Change, independent of the newest carrier. */
  dailyChangeSourceTimestamp?: number;
  timestamp: number;
  sourceTimestamp?: number;
  /** Shared, session-owned state for both daily measures. Never executable. */
  daily?: DailyChangeSnapshot;
  dailyChangeInput?: DailyChangeInput;
}

export interface ResolvedMarketWatchDisplayMetadata {
  last?: number;
  lastSourceTimestamp?: number;
  dailyChange?: number;
  dailyChangeSourceTimestamp?: number;
  timestamp?: number;
  dailyChangePrice?: number;
  daily?: DailyChangeSnapshot;
}

/** A historical pair must never fill one half of a newer quote's measures. */
export const mayUseClosedDailyChange = (display: ResolvedMarketWatchDisplayMetadata): boolean => (
  display.dailyChange === undefined && display.dailyChangePrice === undefined
  && (!display.daily?.issue || ['reference-unavailable', 'session-unavailable', 'price-mode-unavailable', 'price-unavailable'].includes(display.daily.issue))
);

interface MarketWatchDisplayMetadataState {
  scopeKey: string;
  bySymbol: Record<string, MarketWatchDisplayMetadata>;
  revision: number;
}

const currentScopeKey = (): string => {
  const scope = getCommittedBrokerAccountSessionScope();
  const identified = scope.authenticated
    ? Boolean(scope.accountId)
    : Boolean(scope.brokerId || scope.serverUrl);
  return identified ? getCommittedBrokerAccountSessionScopeKey(scope) : '';
};

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const finiteNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

const UTC_QUOTE_DAY_MS = 24 * 60 * 60 * 1_000;

const sharesUtcQuoteDay = (left: unknown, right: unknown): boolean => {
  const leftTime = getCanonicalTickTimestamp(left);
  const rightTime = getCanonicalTickTimestamp(right);
  return leftTime !== null && rightTime !== null
    && Math.floor(leftTime / UTC_QUOTE_DAY_MS) === Math.floor(rightTime / UTC_QUOTE_DAY_MS);
};

export const useMarketWatchDisplayMetadataStore = create<MarketWatchDisplayMetadataState>(() => ({
  scopeKey: currentScopeKey(),
  bySymbol: {},
  revision: 0,
}));
const pendingMetadata = new Map<string, MarketWatchDisplayMetadata>();

export const flushMarketWatchDisplayMetadata = (): void => {
  if (pendingMetadata.size === 0) return;
  const batch = Object.fromEntries(pendingMetadata);
  pendingMetadata.clear();
  useMarketWatchDisplayMetadataStore.setState((state) => ({
    bySymbol: { ...state.bySymbol, ...batch }, revision: state.revision + 1,
  }));
};
const writeMetadata = (symbol: string, value: MarketWatchDisplayMetadata, deferred: boolean): void => {
  if (deferred) { pendingMetadata.set(symbol, value); return; }
  useMarketWatchDisplayMetadataStore.setState((state) => ({
    bySymbol: { ...state.bySymbol, [symbol]: value }, revision: state.revision + 1,
  }));
};

const ensureCurrentScope = (): string => {
  const scopeKey = currentScopeKey();
  if (useMarketWatchDisplayMetadataStore.getState().scopeKey !== scopeKey) {
    pendingMetadata.clear();
    useMarketWatchDisplayMetadataStore.setState((state) => ({
      scopeKey,
      bySymbol: {},
      revision: state.revision + 1,
    }));
  }
  return scopeKey;
};

/**
 * Publishes non-executable quote metadata for Market Watch only. The exact
 * broker symbol and committed session own each value, and source-time ordering
 * prevents delayed Last events from regressing the display.
 */
export const publishMarketWatchDisplayMetadata = (
  symbol: unknown,
  metadata: Omit<
    MarketWatchDisplayMetadata,
    'symbol' | 'lastSourceTimestamp' | 'dailyChangeSourceTimestamp'
  >,
  deferred = false,
): boolean => {
  ensureCurrentScope();
  if (!currentScopeKey()) return false;
  const normalizedSymbol = normalizeSymbol(symbol);
  const last = finiteNumber(metadata.last);
  const dailyChange = finiteNumber(metadata.dailyChange);
  const timestamp = finiteNumber(metadata.timestamp);
  const sourceTimestamp = finiteNumber(metadata.sourceTimestamp);
  if (!normalizedSymbol || timestamp === undefined || timestamp <= 0) return false;
  if (!(last !== undefined && last > 0) && dailyChange === undefined && !metadata.dailyChangeInput) return false;

  const incoming: MarketWatchDisplayMetadata = {
    symbol: normalizedSymbol,
    last: last !== undefined && last > 0 ? last : undefined,
    dailyChange,
    timestamp,
    sourceTimestamp: sourceTimestamp !== undefined && sourceTimestamp > 0
      ? sourceTimestamp
      : undefined,
  };
  const incomingTime = getCanonicalTickTimestamp(incoming);
  if (incomingTime === null) return false;
  incoming.lastSourceTimestamp = incoming.last !== undefined ? incomingTime : undefined;
  incoming.dailyChangeSourceTimestamp = incoming.dailyChange !== undefined
    ? incomingTime
    : undefined;

  const state = useMarketWatchDisplayMetadataStore.getState();
  const existing = pendingMetadata.get(normalizedSymbol) ?? state.bySymbol[normalizedSymbol];
  const daily = metadata.dailyChangeInput
    ? advanceDailyChange(existing?.daily, metadata.dailyChangeInput, incomingTime)
    : existing?.daily;
  if (daily) incoming.daily = daily;
  if (!existing) {
    writeMetadata(normalizedSymbol, incoming, deferred);
    return true;
  }

  const freshness = compareCanonicalTickFreshness(existing, incoming);
  const sameQuoteDay = sharesUtcQuoteDay(existing, incoming);
  if (freshness < 0 && !sameQuoteDay) return false;

  const existingTime = getCanonicalTickTimestamp(existing);
  const existingFieldTimes = {
    last: existing.lastSourceTimestamp
      ?? (existing.last !== undefined ? existingTime ?? undefined : undefined),
    dailyChange: existing.dailyChangeSourceTimestamp
      ?? (existing.dailyChange !== undefined ? existingTime ?? undefined : undefined),
  };
  const nextFieldTimes: { last?: number; dailyChange?: number } = sameQuoteDay
    ? { ...existingFieldTimes }
    : {};
  let nextLast = sameQuoteDay ? existing.last : undefined;
  let nextDailyChange = sameQuoteDay ? existing.dailyChange : undefined;

  if (incoming.last !== undefined
    && (nextFieldTimes.last === undefined || incomingTime >= nextFieldTimes.last)) {
    nextLast = incoming.last;
    nextFieldTimes.last = incomingTime;
  }
  if (incoming.dailyChange !== undefined
    && (nextFieldTimes.dailyChange === undefined || incomingTime >= nextFieldTimes.dailyChange)) {
    nextDailyChange = incoming.dailyChange;
    nextFieldTimes.dailyChange = incomingTime;
  }

  const carrier = freshness >= 0 ? incoming : existing;
  const merged: MarketWatchDisplayMetadata = {
    symbol: normalizedSymbol,
    last: nextLast,
    lastSourceTimestamp: nextFieldTimes.last,
    dailyChange: nextDailyChange,
    dailyChangeSourceTimestamp: nextFieldTimes.dailyChange,
    timestamp: carrier.timestamp,
    sourceTimestamp: carrier.sourceTimestamp,
    ...(daily ? { daily } : {}),
  };
  if (areCanonicalUpstreamTicksEqual(existing, merged)) return false;

  writeMetadata(normalizedSymbol, merged, deferred);
  return true;
};

export const getMarketWatchDisplayMetadata = (
  symbol: unknown,
): MarketWatchDisplayMetadata | undefined => {
  const scopeKey = currentScopeKey();
  const state = useMarketWatchDisplayMetadataStore.getState();
  if (!scopeKey || state.scopeKey !== scopeKey) return undefined;
  const normalizedSymbol = normalizeSymbol(symbol);
  return normalizedSymbol
    ? pendingMetadata.get(normalizedSymbol) ?? state.bySymbol[normalizedSymbol]
    : undefined;
};

export const useMarketWatchDisplayMetadata = (
  symbol: unknown,
): MarketWatchDisplayMetadata | undefined => {
  const normalizedSymbol = normalizeSymbol(symbol);
  return useMarketWatchDisplayMetadataStore((state) => {
    const scopeKey = currentScopeKey();
    return scopeKey && state.scopeKey === scopeKey && normalizedSymbol
      ? state.bySymbol[normalizedSymbol]
      : undefined;
  });
};

export const useMarketWatchDisplayMetadataRevision = (enabled = true): number => (
  useMarketWatchDisplayMetadataStore((state) => enabled ? state.revision : 0)
);

interface TimedDisplayField {
  value?: number;
  authority?: number;
}

const fieldAuthority = (
  value: number | undefined,
  explicitAuthority: unknown,
  carrierTime: number | null,
): number | null => {
  if (value === undefined) return null;
  const explicit = finiteNumber(explicitAuthority);
  if (explicit !== undefined && explicit > 0) return explicit;
  return carrierTime !== null && carrierTime > 0 ? carrierTime : null;
};

const selectDisplayField = (
  tickValue: number | undefined,
  tickAuthority: number | null,
  metadataValue: number | undefined,
  metadataAuthority: number | null,
  currentQuoteTime: number | null,
): TimedDisplayField => {
  const isCurrentDay = (authority: number | null): authority is number => (
    authority !== null
    && currentQuoteTime !== null
    && Math.floor(authority / UTC_QUOTE_DAY_MS)
      === Math.floor(currentQuoteTime / UTC_QUOTE_DAY_MS)
  );
  const tickIsCurrent = tickValue !== undefined && isCurrentDay(tickAuthority);
  const metadataIsCurrent = metadataValue !== undefined && isCurrentDay(metadataAuthority);

  // The executable/App tick wins an equal-time tie. Display-only metadata may
  // replace it only with strictly newer field authority.
  if (metadataIsCurrent && (!tickIsCurrent || metadataAuthority > tickAuthority)) {
    return { value: metadataValue, authority: metadataAuthority };
  }
  if (tickIsCurrent) return { value: tickValue, authority: tickAuthority };
  return {};
};

/** Merge display-only fields by per-field event authority, never quote sides. */
export const resolveMarketWatchDisplayMetadata = (
  tick: {
    dailyChangeInput?: DailyChangeInput;
    last?: number;
    lastSourceTimestamp?: number;
    dailyChange?: number;
    dailyChangeSourceTimestamp?: number;
    timestamp?: number;
    sourceTimestamp?: number;
  } | null | undefined,
  metadata: MarketWatchDisplayMetadata | null | undefined,
): ResolvedMarketWatchDisplayMetadata => {
  const tickTime = getCanonicalTickTimestamp(tick);
  const metadataTime = getCanonicalTickTimestamp(metadata);
  const tickLast = finiteNumber(tick?.last);
  const tickDailyChange = finiteNumber(tick?.dailyChange);
  const metadataLast = finiteNumber(metadata?.last);
  const metadataDailyChange = finiteNumber(metadata?.dailyChange);
  const tickLastAuthority = fieldAuthority(tickLast, tick?.lastSourceTimestamp, tickTime);
  const tickDailyAuthority = fieldAuthority(
    tickDailyChange,
    tick?.dailyChangeSourceTimestamp,
    tickTime,
  );
  const metadataLastAuthority = fieldAuthority(
    metadataLast,
    metadata?.lastSourceTimestamp,
    metadataTime,
  );
  const metadataDailyAuthority = fieldAuthority(
    metadataDailyChange,
    metadata?.dailyChangeSourceTimestamp,
    metadataTime,
  );
  const carrierTimes = [tickTime, metadataTime].filter(
    (value): value is number => value !== null && value > 0,
  );
  const fieldTimes = [
    tickLastAuthority,
    tickDailyAuthority,
    metadataLastAuthority,
    metadataDailyAuthority,
  ].filter((value): value is number => value !== null && value > 0);
  const currentQuoteTime = carrierTimes.length > 0
    ? Math.max(...carrierTimes)
    : fieldTimes.length > 0 ? Math.max(...fieldTimes) : null;
  const resolvedLast = selectDisplayField(
    tickLast,
    tickLastAuthority,
    metadataLast,
    metadataLastAuthority,
    currentQuoteTime,
  );
  const resolvedDailyChange = selectDisplayField(
    tickDailyChange,
    tickDailyAuthority,
    metadataDailyChange,
    metadataDailyAuthority,
    currentQuoteTime,
  );
  const selectedAuthorities = [resolvedLast.authority, resolvedDailyChange.authority]
    .filter((value): value is number => value !== undefined);

  return {
    last: resolvedLast.value,
    lastSourceTimestamp: resolvedLast.authority,
    dailyChange: metadata?.daily
      ? (!metadata.daily.reference && !tick?.dailyChangeInput && tickDailyChange !== undefined && tickDailyAuthority !== null
        && tickDailyAuthority >= (metadata.daily.valuesAsOf ?? metadata.daily.asOf)
        ? tickDailyChange : metadata.daily.percent)
      : resolvedDailyChange.value,
    dailyChangePrice: metadata?.daily?.change,
    daily: metadata?.daily,
    dailyChangeSourceTimestamp: resolvedDailyChange.authority,
    timestamp: selectedAuthorities.length > 0 ? Math.max(...selectedAuthorities) : undefined,
  };
};

export const clearMarketWatchDisplayMetadata = (): void => {
  pendingMetadata.clear();
  useMarketWatchDisplayMetadataStore.setState((state) => ({
    scopeKey: currentScopeKey(),
    bySymbol: {},
    revision: state.revision + 1,
  }));
};

export const resetMarketWatchDisplayMetadataForTests = clearMarketWatchDisplayMetadata;

// Connection changes retain the broker quote/reference and original value
// timestamp. A new quote or reconnect snapshot clears transient stale status.
useWebSocketStore.subscribe((connection, previous) => {
  if (connection.fixConnectionState === previous.fixConnectionState && connection.isStale === previous.isStale) return;
  if (connection.fixConnectionState === previous.fixConnectionState && !connection.isStale) return;
  if (previous.fixConnectionState !== 'connected' && connection.fixConnectionState !== 'connected' && !connection.isStale) return;
  flushMarketWatchDisplayMetadata();
  const status = connection.fixConnectionState === 'connected' ? 'stale' : 'disconnected';
  useMarketWatchDisplayMetadataStore.setState(state => {
    const bySymbol = { ...state.bySymbol };
    let changed = false;
    Object.entries(bySymbol).forEach(([symbol, metadata]) => {
      if (!metadata.daily || metadata.daily.status === 'closed' || metadata.daily.status === status) return;
      bySymbol[symbol] = { ...metadata, daily: { ...metadata.daily, status } };
      changed = true;
    });
    return changed ? { bySymbol, revision: state.revision + 1 } : state;
  });
});

onCommittedBrokerAccountSessionScopeChange((scope) => {
  pendingMetadata.clear();
  const identified = scope.authenticated
    ? Boolean(scope.accountId)
    : Boolean(scope.brokerId || scope.serverUrl);
  useMarketWatchDisplayMetadataStore.setState((state) => ({
    scopeKey: identified ? getCommittedBrokerAccountSessionScopeKey(scope) : '',
    bySymbol: {},
    revision: state.revision + 1,
  }));
});
