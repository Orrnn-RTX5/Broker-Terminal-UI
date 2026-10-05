import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiClient, ApiError } from '../../api/client';
import { getAccessToken, getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey,
  getServerUrl, onCommittedBrokerAccountSessionScopeChange, onSessionChange } from '../../services/brokerSession';
import { getTerminalQuoteSession, getNewerLiveTerminalQuoteEvidence, readQuoteFreshnessMetadata,
  subscribeTerminalQuoteFreshness, terminalQuoteFreshnessEnabled, type TerminalQuoteMetadata } from '../../services/terminalQuoteFreshness';
import { recordBrokerServerTime } from '../../services/brokerServerClock';
import { quoteDiagnosticsEnabled, recordQuoteDiagnostic } from '../../services/quoteDiagnostics';
import { INSTRUMENT_CATALOGUE_REFRESHED_EVENT } from '../../services/instrumentCatalogueEvents';
import {
  getApiRootBaseUrl,
  useBrokerSessionRevision,
} from './marketDataSession';
import {
  MARKET_SYMBOLS_STALE_EVENT,
  normalizeSymbol,
  parseBooleanish,
  readSourceTimestamp,
  toNumber,
  toOptionalNumber,
  uniqueSymbols,
} from './marketDataNormalization';
import type { ActiveMarketSymbolsCache } from './marketDataTypes';

interface MarketSymbolsStaleEventDetail {
  symbols: string[];
}

export const ACTIVE_MARKET_SYMBOLS_STORAGE_KEY_PREFIX = 'rtx5-active-market-symbols:v1';

const getBrowserLocalStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const normalizeStorageScope = (value: unknown): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'default';
};

const getActiveMarketSymbolsStorageScope = (): string => {
  const storage = getBrowserLocalStorage();
  const brokerId = storage?.getItem('broker_id') || storage?.getItem('rtx_broker_id');
  if (brokerId) return normalizeStorageScope(brokerId);

  const serverUrl = getServerUrl();
  if (!serverUrl) return 'default';

  try {
    return normalizeStorageScope(new URL(serverUrl).hostname);
  } catch {
    return normalizeStorageScope(serverUrl);
  }
};

export const getActiveMarketSymbolsStorageKey = (scope?: string): string =>
  `${ACTIVE_MARKET_SYMBOLS_STORAGE_KEY_PREFIX}:${normalizeStorageScope(scope || getActiveMarketSymbolsStorageScope())}`;

const extractSymbolList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return uniqueSymbols(value.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    if (!item || typeof item !== 'object') return '';
    const record = item as Record<string, unknown>;
    return String(record.symbol ?? record.name ?? record.id ?? '');
  }));
};

const hasPositiveQuoteValue = (value: unknown): boolean => toNumber(value) > 0;

const STALE_QUOTE_STATES = new Set([
  'stale',
  'silent',
  'no_data',
  'no_quote',
  'quote_stale',
  'unavailable',
]);

const normalizeStatusValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';

const rowHasLiveMarketData = (row: Record<string, unknown>): boolean => {
  const hasData = parseBooleanish(row?.has_data ?? row?.hasData);
  if (hasData === false) return false;

  const hasQuote = parseBooleanish(row?.has_quote ?? row?.hasQuote);
  if (hasQuote === false) return false;

  const fresh = parseBooleanish(row?.fresh ?? row?.is_fresh ?? row?.isFresh);
  if (fresh === false) return false;

  const stale = parseBooleanish(row?.stale ?? row?.is_stale ?? row?.isStale);
  if (stale === true) return false;

  const quoteStatus = normalizeStatusValue(
    row?.quote_status ?? row?.quoteStatus ?? row?.feed_status ?? row?.feedStatus ?? row?.status
  );
  if (STALE_QUOTE_STATES.has(quoteStatus)) return false;

  const age = toOptionalNumber(row?.last_tick_age_sec ?? row?.lastTickAgeSec ?? row?.age_sec ?? row?.ageSec);
  if (age !== undefined) return age >= 0 && age <= 90;

  // Respect fresh ticks from WS data by checking timestamp age
  // FIX: Feed-status freshness uses the same gateway timestamp vocabulary as
  // quote ingestion, including millisecond and server-time aliases.
  const tickTimestamp = readSourceTimestamp({
    ...row,
    timestamp: row?.timestamp ?? row?.last_tick_time ?? row?.lastTickTime,
  });
  if (tickTimestamp !== undefined) {
    const tickAge = (Date.now() - tickTimestamp) / 1000;
    if (tickAge > 300 || tickAge < 0) return false;
  }

  const silent = parseBooleanish(row?.silent);
  if (silent !== undefined) return silent === false;

  const time = toOptionalNumber(row?.time ?? row?.timestamp ?? row?.last_tick_time ?? row?.lastTickTime);
  if (time !== undefined && time <= 0) return false;

  if (hasQuote === true) return true;
  return hasPositiveQuoteValue(row?.bid) || hasPositiveQuoteValue(row?.ask);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

export const hasAuthoritativeMarketSymbolStatus = (response: unknown): boolean => {
  const record = asRecord(response);
  return Array.isArray(record.symbol_status)
    || (Array.isArray(record.available_symbols) && Array.isArray(record.silent_symbols));
};

export const extractActiveMarketSymbols = (response: unknown): string[] => {
  const record = asRecord(response);
  const hasStatusRows = Array.isArray(record.symbol_status);
  const statusRows = hasStatusRows ? record.symbol_status as unknown[] : [];
  const activeFromStatus = uniqueSymbols(statusRows
    .map(asRecord)
    .filter((row) => {
      const symbol = normalizeSymbol(row.symbol ?? row.name ?? row.id);
      if (!symbol) return false;
      return rowHasLiveMarketData(row);
    })
    .map((row) => row.symbol ?? row.name ?? row.id));

  // Per-symbol rows are the canonical freshness source. An empty result is an
  // authoritative "zero fresh symbols" response and must never fall through
  // to a broader availability list that can contain stale quotes.
  if (hasStatusRows) {
    return activeFromStatus;
  }

  const available = extractSymbolList(record.available_symbols ?? record.symbols ?? record.data);
  const hasSilentList = Array.isArray(record.silent_symbols);
  const silent = new Set(extractSymbolList(record.silent_symbols));

  if (available.length > 0 && hasSilentList) {
    return available.filter((symbol) => !silent.has(symbol));
  }

  return activeFromStatus;
};

export const MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT = 'rtx:market-symbols-refresh-requested';

export interface MarketSymbolFreshness {
  symbol: string;
  ageSec: number | null;
  fresh: boolean;
  stale: boolean;
  silent: boolean;
  observedAt: number;
}

const latestMarketSymbolFreshness = new Map<string, MarketSymbolFreshness>();

const recordMarketSymbolStatusRows = (response: unknown): void => {
  const record = asRecord(response);
  if (!Array.isArray(record.symbol_status)) return;
  const observedAt = Date.now();
  for (const entry of record.symbol_status) {
    const row = asRecord(entry);
    const symbol = normalizeSymbol(row.symbol ?? row.name ?? row.id);
    if (!symbol) continue;
    const age = toOptionalNumber(row.last_tick_age_sec ?? row.lastTickAgeSec);
    latestMarketSymbolFreshness.set(symbol, {
      symbol,
      ageSec: age !== undefined && age >= 0 ? Math.round(age) : null,
      fresh: row.fresh === true,
      stale: row.stale === true,
      silent: row.silent === true,
      observedAt,
    });
  }
};

export const getMarketSymbolFreshness = (symbol: string): MarketSymbolFreshness | null => {
  const key = normalizeSymbol(symbol);
  return key ? latestMarketSymbolFreshness.get(key) ?? null : null;
};

const refreshSettlers = new Set<() => void>();
let refreshFallbackTimer: number | undefined;

const notifyMarketSymbolsRefreshed = (): void => {
  if (refreshFallbackTimer !== undefined) {
    clearTimeout(refreshFallbackTimer);
    refreshFallbackTimer = undefined;
  }
  const settlers = Array.from(refreshSettlers);
  refreshSettlers.clear();
  settlers.forEach((settle) => settle());
};

export const requestMarketSymbolsRefresh = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    refreshSettlers.add(resolve);
    window.dispatchEvent(new Event(MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT));
    if (refreshFallbackTimer === undefined) {
      refreshFallbackTimer = window.setTimeout(() => {
        refreshFallbackTimer = undefined;
        notifyMarketSymbolsRefreshed();
      }, 4000);
    }
  });
};

export const readCachedActiveMarketSymbols = (scope?: string): ActiveMarketSymbolsCache => {
  const storage = getBrowserLocalStorage();
  if (!storage) return { symbols: [], updatedAt: 0 };

  try {
    const raw = storage.getItem(getActiveMarketSymbolsStorageKey(scope));
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      symbols: extractSymbolList(parsed?.symbols),
      updatedAt: toNumber(parsed?.updatedAt),
      availableCount: toOptionalNumber(parsed?.availableCount),
      silentCount: toOptionalNumber(parsed?.silentCount),
    };
  } catch {
    return { symbols: [], updatedAt: 0 };
  }
};

const writeCachedActiveMarketSymbols = (cache: ActiveMarketSymbolsCache, scope?: string): void => {
  const storage = getBrowserLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(getActiveMarketSymbolsStorageKey(scope), JSON.stringify({
      ...cache,
      symbols: uniqueSymbols(cache.symbols),
    }));
  } catch {
    // Browser storage can be unavailable or full; live status still drives this session.
  }
};

export const LIVE_QUOTES_REST_BATCH_SIZE = 50;
export const ACTIVE_MARKET_SYMBOLS_REFRESH_INTERVAL_MS = 30000;

const MAX_STALE_STATUS_RECOVERY_SYMBOLS = 4096;
const recoveryOwner = () => ({ token: getAccessToken(), server: getServerUrl(), storage: getActiveMarketSymbolsStorageScope(),
  account: getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()) });
const ownsRecovery = (owner: ReturnType<typeof recoveryOwner>) => {
  const current = recoveryOwner();
  return owner.token === current.token && owner.server === current.server && owner.storage === current.storage && owner.account === current.account;
};
const staleStatusRecoveryCandidates = (response: unknown): Map<string, TerminalQuoteMetadata> => {
  const candidates = new Map<string, TerminalQuoteMetadata>();
  const rows = asRecord(response).symbol_status;
  if (!terminalQuoteFreshnessEnabled() || !Array.isArray(rows)) return candidates;
  // Match the Bridge's stale-only state explicitly. Unknown, silent, missing,
  // wrong-source, and fresh-but-not-tradable rows cannot grant membership.
  for (const entry of rows) {
    const row = asRecord(entry); const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    candidates.delete(symbol);
    if (row.has_data !== true || row.fresh !== false || row.stale !== true || row.silent !== false
      || row.source_mismatch !== false || row.tradable !== false) continue;
    const metadata = readQuoteFreshnessMetadata(row);
    if (!metadata.source || metadata.source.trim() !== metadata.source || metadata.provider_timestamp === undefined
      || (row.expected_source !== undefined && row.expected_source !== '' && row.expected_source !== metadata.source)
      || typeof metadata.sequence !== 'string' || !/^\d{1,20}$/.test(metadata.sequence)
      || BigInt(metadata.sequence) > 18446744073709551615n) continue;
    if (candidates.size < MAX_STALE_STATUS_RECOVERY_SYMBOLS) candidates.set(symbol, metadata);
  }
  return candidates;
};

export const getLiveQuoteRestBatches = (
  symbols: string[],
  batchSize = LIVE_QUOTES_REST_BATCH_SIZE
): string[][] => {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: string[][] = [];

  for (let index = 0; index < symbols.length; index += size) {
    batches.push(symbols.slice(index, index + size));
  }

  return batches;
};


export function useActiveMarketSymbols() {
  // Do not paint a cached symbol before its current feed freshness has been
  // verified. The cache remains a network-failure fallback only.
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const [current, setCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const recoveryOwnerGenerationRef = useRef(0);
  const recoveryRef = useRef<{ owner: ReturnType<typeof recoveryOwner>; quoteSession: number;
    baseSymbols: string[]; candidates: Map<string, TerminalQuoteMetadata>; restored: Set<string> } | null>(null);
  const unsubscribeRecoveryRef = useRef<(() => void) | null>(null);
  const clearRecovery = useCallback((restoreBase = false) => {
    const previous = recoveryRef.current;
    recoveryRef.current = null;
    unsubscribeRecoveryRef.current?.(); unsubscribeRecoveryRef.current = null;
    if (restoreBase && previous?.restored.size) setSymbols(previous.baseSymbols);
  }, []);
  const reconcileRecovery = useCallback((changedSymbol?: string) => {
    const snapshot = recoveryRef.current;
    if (!snapshot) return;
    if (changedSymbol && !snapshot.candidates.has(changedSymbol)) return;
    if (snapshot.quoteSession !== getTerminalQuoteSession() || !ownsRecovery(snapshot.owner)) { clearRecovery(true); return; }
    let changed = false;
    const candidates = changedSymbol ? [[changedSymbol, snapshot.candidates.get(changedSymbol)!] as const] : snapshot.candidates;
    for (const [symbol, metadata] of candidates) {
      const live = getNewerLiveTerminalQuoteEvidence(symbol, metadata, snapshot.quoteSession);
      if (live && !snapshot.restored.has(symbol)) {
        snapshot.restored.add(symbol); changed = true;
        if (quoteDiagnosticsEnabled()) {
          // Adjacent records identify the exact old status and accepted quote;
          // neither exports account ownership or changes quote ingestion.
          for (const [phase, evidence] of [['status', metadata], ['quote', live]] as const) {
            recordQuoteDiagnostic({ kind: 'feed-status', reason: 'stale-status-superseded', phase, symbol,
              source: evidence.source, providerTimestamp: evidence.provider_timestamp,
              hubSequence: evidence.sequence, browserGeneration: snapshot.quoteSession });
          }
        }
      }
      else if (!live && snapshot.restored.delete(symbol)) changed = true;
    }
    if (changed) setSymbols(uniqueSymbols([...snapshot.baseSymbols, ...snapshot.restored]));
  }, [clearRecovery]);
  const installRecovery = useCallback((response: unknown, baseSymbols: string[], owner: ReturnType<typeof recoveryOwner>, quoteSession: number) => {
    if (!ownsRecovery(owner)) return;
    clearRecovery(); setSymbols(baseSymbols);
    if (quoteSession !== getTerminalQuoteSession()) return;
    const candidates = staleStatusRecoveryCandidates(response);
    if (!candidates.size) return;
    recoveryRef.current = { owner, quoteSession, baseSymbols, candidates, restored: new Set() };
    unsubscribeRecoveryRef.current = subscribeTerminalQuoteFreshness(reconcileRecovery);
    reconcileRecovery();
  }, [clearRecovery, reconcileRecovery]);
  useEffect(() => {
    const revoke = () => { recoveryOwnerGenerationRef.current++; clearRecovery(true); };
    const unsubscribeSession = onSessionChange(revoke);
    const unsubscribeAccount = onCommittedBrokerAccountSessionScopeChange(revoke);
    return () => { unsubscribeSession(); unsubscribeAccount(); clearRecovery(); };
  }, [clearRecovery]);
  const sessionRevision = useBrokerSessionRevision();
  // FIX: Capture routing/cache ownership per broker session so an old request
  // cannot commit into a newly selected broker after dynamic URLs change.
  const apiRootBaseUrl = useMemo(() => {
    void sessionRevision;
    return getApiRootBaseUrl();
  }, [sessionRevision]);
  const storageScope = useMemo(() => {
    void sessionRevision;
    return getActiveMarketSymbolsStorageScope();
  }, [sessionRevision]);

  const reload = useCallback(async () => {
    const owner = recoveryOwner();
    const ownerGeneration = recoveryOwnerGenerationRef.current;
    const quoteSession = getTerminalQuoteSession();
    const requestGeneration = ++requestGenerationRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const requestStartedAt = Date.now();
      const response = await apiClient.get<Record<string, unknown>>('/ws/feed/status', {
        baseUrl: apiRootBaseUrl,
        skipAuth: true,
        skipDynamicUrl: true,
        signal: controller.signal,
      });
      if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted
        || ownerGeneration !== recoveryOwnerGenerationRef.current || !ownsRecovery(owner)) return;
      recordBrokerServerTime(response.server_time, requestStartedAt);
      const nextSymbols = extractActiveMarketSymbols(response);
      recordMarketSymbolStatusRows(response);

      if (nextSymbols.length > 0 || hasAuthoritativeMarketSymbolStatus(response)) {
        writeCachedActiveMarketSymbols({
          symbols: nextSymbols,
          updatedAt: Date.now(),
          availableCount: Array.isArray(response.available_symbols)
            ? response.available_symbols.length
            : undefined,
          silentCount: Array.isArray(response.silent_symbols)
            ? response.silent_symbols.length
            : undefined,
        }, storageScope);
        installRecovery(response, nextSymbols, owner, quoteSession);
        if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'feed-status', reason: 'authoritative-status',
          feedCurrent: true, activeSymbolCount: nextSymbols.length });
        setCurrent(true);
        return;
      }

      const cached = readCachedActiveMarketSymbols(storageScope);
      clearRecovery();
      setSymbols(cached.symbols);
      if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'feed-status', reason: 'non-authoritative-status',
        feedCurrent: false, activeSymbolCount: 0 });
      setCurrent(false);
      setError('No active feed symbols returned');
    } catch (err) {
      if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted
        || ownerGeneration !== recoveryOwnerGenerationRef.current || !ownsRecovery(owner)) return;
      const cached = readCachedActiveMarketSymbols(storageScope);
      clearRecovery();
      setSymbols(cached.symbols);
      if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'feed-status', reason: 'status-request-failed',
        feedCurrent: false, activeSymbolCount: 0, httpStatus: err instanceof ApiError ? err.status : undefined });
      setCurrent(false);
      setError(err instanceof ApiError ? err.message : 'Failed to load active feed symbols');
    } finally {
      if (requestGeneration === requestGenerationRef.current && !controller.signal.aborted
        && ownerGeneration === recoveryOwnerGenerationRef.current && ownsRecovery(owner)) {
        requestAbortRef.current = null;
        setSettled(true);
        setLoading(false);
        notifyMarketSymbolsRefreshed();
      }
    }
  }, [apiRootBaseUrl, storageScope, clearRecovery, installRecovery]);

  useEffect(() => {
    const handleRefreshRequested = () => { void reload(); };
    window.addEventListener(MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT, handleRefreshRequested);
    window.addEventListener(INSTRUMENT_CATALOGUE_REFRESHED_EVENT, handleRefreshRequested);
    return () => {
      window.removeEventListener(MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT, handleRefreshRequested);
      window.removeEventListener(INSTRUMENT_CATALOGUE_REFRESHED_EVENT, handleRefreshRequested);
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    const handleStaleSymbols = (event: Event) => {
      const detail = (event as CustomEvent<MarketSymbolsStaleEventDetail>).detail;
      const staleSymbols = uniqueSymbols(detail?.symbols ?? []);

      if (staleSymbols.length > 0) {
        clearRecovery(true);
        const staleSet = new Set(staleSymbols);
        setSymbols((current) => current.filter((symbol) => !staleSet.has(symbol)));
        const cached = readCachedActiveMarketSymbols(storageScope);
        writeCachedActiveMarketSymbols({
          ...cached,
          symbols: cached.symbols.filter((symbol) => !staleSet.has(symbol)),
          updatedAt: Date.now(),
        }, storageScope);
      }

      void reload();
    };

    window.addEventListener(MARKET_SYMBOLS_STALE_EVENT, handleStaleSymbols);
    void reload();
    const interval = window.setInterval(() => {
      if (!cancelled && document.visibilityState !== 'hidden') void reload();
    }, ACTIVE_MARKET_SYMBOLS_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!cancelled && document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      window.clearInterval(interval);
      window.removeEventListener(MARKET_SYMBOLS_STALE_EVENT, handleStaleSymbols);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reload, storageScope, clearRecovery]);

  return useMemo(() => ({ symbols, loading, settled, current, error, reload }),
    [symbols, loading, settled, current, error, reload]);
}
