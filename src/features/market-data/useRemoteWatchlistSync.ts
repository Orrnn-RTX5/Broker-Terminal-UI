import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError } from '../../api/client';
import { watchlistV2Api } from '../../api/trade';
import { useAppStore } from '../../store/useAppStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import type { WatchlistItem } from '../../types/api';
import { resolveMarketWatchSymbolInput } from '../../utils/marketWatchSource';
import {
  captureApiSession,
  getApiSessionDescriptor,
  getCapturedRequestOptions,
  useBrokerSessionRevision,
  type CapturedApiSession,
} from './marketDataSession';

const normalizeSymbol = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

const uniqueSymbols = (symbols: unknown[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

const sameSymbols = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((symbol, index) => symbol === b[index]);

type RemoteWatchlistPhase = 'idle' | 'loading' | 'hydrated' | 'failed';

type WatchlistOperation =
  | { type: 'add'; symbol: string; index: number }
  | { type: 'remove'; symbol: string }
  | { type: 'move'; symbol: string; index: number };

interface RemoteWatchlistScope {
  key: string;
  storageScopeKey: string;
  session: CapturedApiSession;
  abortController: AbortController;
  phase: RemoteWatchlistPhase;
  revision: number;
  hydrationGeneration: number;
  hydrationPromise: Promise<void> | null;
  hydrationObserved: string[];
  hydrationOperations: WatchlistOperation[];
  confirmedSymbols: string[] | null;
  desiredSymbols: string[] | null;
  writeInFlight: boolean;
  writePromise: Promise<void> | null;
  writeGeneration: number;
  protectAcknowledgedOnNextHydration: boolean;
  saveTimer: number | null;
  activeBindings: number;
  lifecycleGeneration: number;
  catalogSymbols: string[];
  listeners: Set<() => void>;
  error: string | null;
}

interface PendingWatchlistState {
  desiredSymbols: string[] | null;
  hydrationOperations: WatchlistOperation[];
}

const REMOTE_WATCHLIST_SAVE_DELAY_MS = 500;
const REMOTE_WATCHLIST_PENDING_PREFIX = 'rtx5-watchlist-pending:v1:';
const remoteWatchlistScopes = new Map<string, RemoteWatchlistScope>();
const normalizeWatchlistSymbols = (symbols: readonly unknown[], catalog: readonly string[] = []): string[] =>
  uniqueSymbols([...symbols]).map((symbol) => resolveMarketWatchSymbolInput(catalog, symbol) ?? symbol);

export const setRemoteWatchlistCatalog = (
  runtimeKey: string,
  symbols: readonly unknown[],
): void => {
  const scope = remoteWatchlistScopes.get(runtimeKey);
  if (scope) scope.catalogSymbols = normalizeWatchlistSymbols(symbols);
};

const getPendingWatchlistStorageKey = (scopeKey: string): string =>
  `${REMOTE_WATCHLIST_PENDING_PREFIX}${encodeURIComponent(scopeKey)}`;

const parsePendingWatchlistOperations = (value: unknown): WatchlistOperation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WatchlistOperation[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const symbol = normalizeSymbol(record.symbol);
    if (!symbol) return [];
    if (record.type === 'remove') return [{ type: 'remove', symbol }];
    const index = Number(record.index);
    if (!Number.isInteger(index) || index < 0) return [];
    if (record.type === 'add' || record.type === 'move') {
      return [{ type: record.type, symbol, index }];
    }
    return [];
  });
};

const readPendingWatchlist = (scopeKey: string): PendingWatchlistState => {
  try {
    const raw = window.localStorage.getItem(getPendingWatchlistStorageKey(scopeKey));
    if (!raw) return { desiredSymbols: null, hydrationOperations: [] };
    const parsed: unknown = JSON.parse(raw);
    // Backward compatibility for snapshots written before the operation
    // journal was introduced.
    if (Array.isArray(parsed)) {
      return {
        desiredSymbols: normalizeWatchlistSymbols(parsed),
        hydrationOperations: [],
      };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { desiredSymbols: null, hydrationOperations: [] };
    }
    const record = parsed as Record<string, unknown>;
    return {
      desiredSymbols: Array.isArray(record.desiredSymbols)
        ? normalizeWatchlistSymbols(record.desiredSymbols)
        : null,
      hydrationOperations: parsePendingWatchlistOperations(record.hydrationOperations),
    };
  } catch {
    return { desiredSymbols: null, hydrationOperations: [] };
  }
};

const persistPendingWatchlist = (scope: RemoteWatchlistScope): void => {
  try {
    const key = getPendingWatchlistStorageKey(scope.storageScopeKey);
    if (scope.desiredSymbols || scope.hydrationOperations.length > 0) {
      const pending: PendingWatchlistState = {
        desiredSymbols: scope.desiredSymbols,
        hydrationOperations: scope.hydrationOperations,
      };
      window.localStorage.setItem(key, JSON.stringify(pending));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Durable recovery is best-effort; the in-memory intent remains authoritative.
  }
};

const parseRemoteWatchlist = (payload: unknown, catalog: readonly string[]): string[] => {
  if (!Array.isArray(payload)) throw new ApiError(0, 'Invalid watchlist response: expected an array');
  const rows = payload.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ApiError(0, 'Invalid watchlist response item');
    const record = item as Record<string, unknown>;
    const symbol = normalizeSymbol(record.symbol);
    const order = record.sort_order === undefined || record.sort_order === null
      ? index
      : Number(record.sort_order);
    if (!symbol || !Number.isInteger(order) || order < 0) {
      throw new ApiError(0, 'Invalid watchlist response item');
    }
    return { symbol, order, index };
  });
  rows.sort((left, right) => left.order - right.order || left.index - right.index);
  return normalizeWatchlistSymbols(rows.map(({ symbol }) => symbol), catalog);
};

const getRemoteWatchlistScope = (session: CapturedApiSession): RemoteWatchlistScope => {
  const existing = remoteWatchlistScopes.get(session.runtimeKey);
  if (existing) return existing;
  const pending = typeof window === 'undefined'
    ? { desiredSymbols: null, hydrationOperations: [] }
    : readPendingWatchlist(session.storageScopeKey);
  const created: RemoteWatchlistScope = {
    key: session.runtimeKey,
    storageScopeKey: session.storageScopeKey,
    session,
    abortController: new AbortController(),
    phase: 'idle', revision: 0, hydrationGeneration: 0, hydrationPromise: null,
    hydrationObserved: [], hydrationOperations: pending.hydrationOperations,
    confirmedSymbols: null, desiredSymbols: pending.desiredSymbols,
    writeInFlight: false, writePromise: null, writeGeneration: 0, saveTimer: null,
    protectAcknowledgedOnNextHydration: false,
    activeBindings: 0, lifecycleGeneration: 0, catalogSymbols: [], listeners: new Set(), error: null,
  };
  remoteWatchlistScopes.set(session.runtimeKey, created);
  return created;
};

const notifyRemoteWatchlistScope = (scope: RemoteWatchlistScope): void => {
  scope.revision += 1;
  scope.listeners.forEach((listener) => listener());
};

const getWatchlistErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const deriveWatchlistOperations = (previous: string[], next: string[]): WatchlistOperation[] => {
  const operations: WatchlistOperation[] = [];
  const working = [...previous];
  for (const symbol of previous) {
    if (!next.includes(symbol)) {
      operations.push({ type: 'remove', symbol });
      working.splice(working.indexOf(symbol), 1);
    }
  }
  next.forEach((symbol, index) => {
    const currentIndex = working.indexOf(symbol);
    if (currentIndex < 0) {
      operations.push({ type: 'add', symbol, index });
      working.splice(index, 0, symbol);
    } else if (currentIndex !== index) {
      operations.push({ type: 'move', symbol, index });
      working.splice(currentIndex, 1);
      working.splice(index, 0, symbol);
    }
  });
  return operations;
};

const applyWatchlistOperations = (remote: string[], operations: WatchlistOperation[]): string[] => {
  const result = [...remote];
  operations.forEach((operation) => {
    const currentIndex = result.indexOf(operation.symbol);
    if (operation.type === 'remove') {
      if (currentIndex >= 0) result.splice(currentIndex, 1);
      return;
    }
    if (currentIndex >= 0) result.splice(currentIndex, 1);
    result.splice(Math.min(operation.index, result.length), 0, operation.symbol);
  });
  return result;
};

const flushRemoteWatchlist = async (scope: RemoteWatchlistScope): Promise<void> => {
  if (
    scope.abortController.signal.aborted
    || scope.phase !== 'hydrated'
    || scope.activeBindings === 0
    || scope.writeInFlight
    || !scope.desiredSymbols
  ) return;
  const sentSymbols = [...scope.desiredSymbols];
  const generation = ++scope.writeGeneration;
  const lifecycleGeneration = scope.lifecycleGeneration;
  scope.writeInFlight = true;
  scope.error = null;
  notifyRemoteWatchlistScope(scope);
  try {
    await watchlistV2Api.update(sentSymbols, getCapturedRequestOptions(
      scope.session,
      scope.session.v2BaseUrl,
      scope.abortController.signal,
    ));
    if (generation !== scope.writeGeneration || lifecycleGeneration !== scope.lifecycleGeneration) return;
    scope.confirmedSymbols = sentSymbols;
    scope.protectAcknowledgedOnNextHydration = true;
    if (scope.desiredSymbols && sameSymbols(scope.desiredSymbols, sentSymbols)) scope.desiredSymbols = null;
    persistPendingWatchlist(scope);
  } catch (error) {
    if (generation !== scope.writeGeneration || lifecycleGeneration !== scope.lifecycleGeneration) return;
    if (scope.abortController.signal.aborted) return;
    console.warn('[Watchlist Sync] Failed to save remote watchlist:', error);
    scope.error = getWatchlistErrorMessage(error, 'Failed to save watchlist');
  } finally {
    if (generation === scope.writeGeneration) {
      scope.writeInFlight = false;
      scope.writePromise = null;
      notifyRemoteWatchlistScope(scope);
      if (scope.activeBindings > 0 && scope.desiredSymbols && !sameSymbols(scope.desiredSymbols, sentSymbols)) {
        scope.writePromise = flushRemoteWatchlist(scope);
      }
    }
  }
};

const scheduleRemoteWatchlistSave = (scope: RemoteWatchlistScope): void => {
  if (scope.phase !== 'hydrated' || scope.activeBindings === 0 || scope.writeInFlight || !scope.desiredSymbols) return;
  if (scope.saveTimer !== null) window.clearTimeout(scope.saveTimer);
  const generation = scope.writeGeneration;
  const lifecycleGeneration = scope.lifecycleGeneration;
  scope.saveTimer = window.setTimeout(() => {
    scope.saveTimer = null;
    if (
      generation === scope.writeGeneration
      && lifecycleGeneration === scope.lifecycleGeneration
      && scope.activeBindings > 0
    ) {
      scope.writePromise = flushRemoteWatchlist(scope);
    }
  }, REMOTE_WATCHLIST_SAVE_DELAY_MS);
};

const hydrateRemoteWatchlist = (
  scope: RemoteWatchlistScope,
  localSymbols: string[],
  force: boolean,
): Promise<void> => {
  if (scope.abortController.signal.aborted || scope.activeBindings === 0) return Promise.resolve();
  if (force && scope.writePromise) {
    return scope.writePromise.then(() => (
      scope.abortController.signal.aborted || scope.activeBindings === 0
        ? undefined
        : hydrateRemoteWatchlist(scope, localSymbols, true)
    ));
  }
  if (scope.phase === 'loading' && scope.hydrationPromise) return scope.hydrationPromise;
  if (!force && scope.phase === 'hydrated') {
    scheduleRemoteWatchlistSave(scope);
    return Promise.resolve();
  }
  if (scope.phase === 'idle' || scope.phase === 'hydrated') {
    scope.hydrationObserved = [...localSymbols];
  }
  const generation = ++scope.hydrationGeneration;
  const acknowledgedSymbols = force && scope.protectAcknowledgedOnNextHydration
    ? scope.confirmedSymbols
    : null;
  scope.phase = 'loading';
  scope.error = null;
  notifyRemoteWatchlistScope(scope);
  const request = watchlistV2Api.list(getCapturedRequestOptions(
    scope.session,
    scope.session.v2BaseUrl,
    scope.abortController.signal,
  ))
    .then((response: WatchlistItem[]) => {
      if (generation !== scope.hydrationGeneration || scope.abortController.signal.aborted) return;
      const remoteSymbols = parseRemoteWatchlist(response, scope.catalogSymbols);
      const intended = scope.desiredSymbols
        ?? (scope.hydrationOperations.length > 0
          ? applyWatchlistOperations(remoteSymbols, scope.hydrationOperations)
          : acknowledgedSymbols ?? remoteSymbols);
      scope.protectAcknowledgedOnNextHydration = false;
      scope.confirmedSymbols = remoteSymbols;
      scope.desiredSymbols = sameSymbols(intended, remoteSymbols) ? null : intended;
      scope.hydrationOperations = [];
      scope.hydrationObserved = [...intended];
      persistPendingWatchlist(scope);
      scope.phase = 'hydrated';
      scope.error = null;
      notifyRemoteWatchlistScope(scope);
      scheduleRemoteWatchlistSave(scope);
    })
    .catch((error: unknown) => {
      if (generation !== scope.hydrationGeneration) return;
      if (scope.abortController.signal.aborted) return;
      console.warn('[Watchlist Sync] Failed to load remote watchlist:', error);
      scope.phase = 'failed';
      scope.error = getWatchlistErrorMessage(error, 'Failed to load watchlist');
      notifyRemoteWatchlistScope(scope);
    })
    .finally(() => {
      if (generation === scope.hydrationGeneration) scope.hydrationPromise = null;
    });
  scope.hydrationPromise = request;
  return request;
};

const recordLocalWatchlistSnapshot = (scope: RemoteWatchlistScope, symbols: string[]): void => {
  if (scope.phase === 'loading' || scope.phase === 'failed') {
    if (scope.desiredSymbols) {
      scope.desiredSymbols = [...symbols];
      persistPendingWatchlist(scope);
    } else {
      scope.hydrationOperations.push(...deriveWatchlistOperations(scope.hydrationObserved, symbols));
      scope.hydrationObserved = [...symbols];
      persistPendingWatchlist(scope);
    }
    return;
  }
  if (scope.phase !== 'hydrated' || !scope.confirmedSymbols) return;
  scope.desiredSymbols = sameSymbols(symbols, scope.confirmedSymbols) ? null : [...symbols];
  persistPendingWatchlist(scope);
  if (scope.error) {
    scope.error = null;
    notifyRemoteWatchlistScope(scope);
  }
  scheduleRemoteWatchlistSave(scope);
};

export function useRemoteWatchlistSync(watchlistId?: string) {
  const symbols = useWatchlistStore((state) => {
    const active = state.watchlists.find((watchlist) => watchlist.id === (watchlistId || state.activeWatchlistId));
    return active?.symbols ?? [];
  });
  const activeWatchlistId = useWatchlistStore((state) => watchlistId || state.activeWatchlistId);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const accountId = useAppStore((state) => state.accountId);
  const storeAuthToken = useAppStore((state) => state.authToken);
  const storeRefreshToken = useAppStore((state) => state.refreshToken);
  const sessionRevision = useBrokerSessionRevision();
  const sessionDescriptor = useMemo(() => {
    // Broker-session changes can replace the active API context without
    // changing the account id, so the revision intentionally invalidates this
    // memoized descriptor.
    void sessionRevision;
    return isAuthenticated && accountId
      ? getApiSessionDescriptor(accountId)
      : null;
  }, [accountId, isAuthenticated, sessionRevision]);
  const [scope, setScope] = useState<RemoteWatchlistScope | null>(null);
  const [, setRevision] = useState(0);
  const applyingSnapshotRef = useRef<string | null>(null);
  const localSnapshotScopeRef = useRef<string | null>(null);
  const skipInitialLocalSnapshotRef = useRef(false);

  useEffect(() => {
    const scopeKey = scope?.key ?? null;
    if (localSnapshotScopeRef.current === scopeKey) return;
    localSnapshotScopeRef.current = scopeKey;
    skipInitialLocalSnapshotRef.current = Boolean(scope);
  }, [scope]);

  const reload = useCallback(async () => {
    if (!scope || !activeWatchlistId) return;
    const localSymbols = normalizeWatchlistSymbols(
      useWatchlistStore.getState().getWatchlistById(activeWatchlistId)?.symbols ?? [],
      scope.catalogSymbols,
    );
    await hydrateRemoteWatchlist(scope, localSymbols, true);
  }, [activeWatchlistId, scope]);

  useEffect(() => {
    if (!sessionDescriptor || !activeWatchlistId) {
      // This effect owns the lifecycle of the external scope subscription.
      // Clearing the selected scope here keeps render state aligned with it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScope(null);
      return;
    }
    const requestSession = captureApiSession(
      sessionDescriptor,
      storeAuthToken,
      storeRefreshToken,
    );
    if (!requestSession) {
      setScope(null);
      return;
    }
    const committedScope = getRemoteWatchlistScope(requestSession);
    if (committedScope.activeBindings === 0) committedScope.lifecycleGeneration += 1;
    committedScope.activeBindings += 1;
    const onChange = () => setRevision((revision) => revision + 1);
    committedScope.listeners.add(onChange);
    const localSymbols = normalizeWatchlistSymbols(
      useWatchlistStore.getState().getWatchlistById(activeWatchlistId)?.symbols ?? [],
      committedScope.catalogSymbols,
    );
    setScope(committedScope);
    void hydrateRemoteWatchlist(committedScope, localSymbols, false);
    onChange();

    return () => {
      committedScope.listeners.delete(onChange);
      committedScope.activeBindings = Math.max(0, committedScope.activeBindings - 1);
      if (committedScope.activeBindings === 0) {
        committedScope.lifecycleGeneration += 1;
        committedScope.abortController.abort();
        if (committedScope.saveTimer !== null) {
          window.clearTimeout(committedScope.saveTimer);
          committedScope.saveTimer = null;
        }
        if (committedScope.phase === 'loading') {
          committedScope.hydrationGeneration += 1;
          committedScope.hydrationPromise = null;
          committedScope.phase = 'idle';
        }
        persistPendingWatchlist(committedScope);
        remoteWatchlistScopes.delete(committedScope.key);
        committedScope.session.authToken = null;
        committedScope.session.requestContext = null;
      }
      applyingSnapshotRef.current = null;
      // Cleanup synchronizes React state after releasing the external scope.
      setScope((current) => current === committedScope ? null : current);
    };
  }, [
    activeWatchlistId,
    sessionDescriptor,
    storeAuthToken,
    storeRefreshToken,
  ]);

  useEffect(() => {
    if (!scope || scope.phase !== 'hydrated' || !activeWatchlistId) return;
    const snapshot = scope.desiredSymbols ?? scope.confirmedSymbols;
    if (!snapshot) return;

    const current = normalizeWatchlistSymbols(
      useWatchlistStore.getState().getWatchlistById(activeWatchlistId)?.symbols ?? [],
      scope.catalogSymbols,
    );
    if (sameSymbols(current, snapshot)) return;

    applyingSnapshotRef.current = snapshot.join('|');
    useWatchlistStore.getState().reorderSymbols(activeWatchlistId, snapshot);
  }, [activeWatchlistId, scope, scope?.revision]);

  useEffect(() => {
    if (!scope || !activeWatchlistId) return;
    const cleanSymbols = normalizeWatchlistSymbols(symbols, scope.catalogSymbols);
    if (skipInitialLocalSnapshotRef.current) {
      skipInitialLocalSnapshotRef.current = false;
      return;
    }
    if (applyingSnapshotRef.current !== null) {
      if (applyingSnapshotRef.current === cleanSymbols.join('|')) {
        applyingSnapshotRef.current = null;
      }
      return;
    }
    recordLocalWatchlistSnapshot(scope, cleanSymbols);
  }, [activeWatchlistId, scope, symbols]);

  return {
    loading: scope?.phase === 'loading',
    error: scope?.error ?? null,
    reload,
  };
}
