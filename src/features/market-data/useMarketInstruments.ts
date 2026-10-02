import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiClient, ApiError } from '../../api/client';
import { marketV2Api } from '../../api/trade';
import { loadSharedAuthenticatedInstruments } from '../../services/authenticatedInstruments';
import {
  getCurrentDailyChangePriceModeScopeKey,
  registerDailyChangePriceModes,
} from '../../services/dailyChangePriceModeRegistry';
import { loadPublicMarketCatalog } from '../../services/publicMarketCatalog';
import {
  clearAccountSpreadMarkups,
  setAccountSpreadMarkups,
} from '../../services/accountSpreadMarkup';
import { useAppStore } from '../../store/useAppStore';
import {
  mergeAccountCatalogWithPublic,
  type AccountCatalogStatus,
} from '../../utils/accountSymbolUniverse';
import {
  captureApiSession,
  getApiSessionDescriptor,
  getCapturedRequestOptions,
  getStoredBrokerId,
  useBrokerSessionRevision,
  type CapturedApiSession,
} from './marketDataSession';
import {
  buildAccountSpreadMarkupMap,
  extractInstrumentRows,
  normalizeInstrument,
  normalizeSymbol,
  snapshotBrokerSpecification,
  uniqueSymbols,
  upsertInstrumentTickSnapshots,
} from './marketDataNormalization';
import type {
  MarketInstrument,
  MarketInstrumentsSnapshot,
} from './marketDataTypes';
import { setRemoteWatchlistCatalog } from './useRemoteWatchlistSync';
import {
  INSTRUMENT_CATALOGUE_CHANGED_EVENT,
  INSTRUMENT_CATALOGUE_REFRESHED_EVENT,
} from '../../services/instrumentCatalogueEvents';

interface ScopedValue<T> {
  scope: string | null;
  value: T;
}

const EMPTY_MARKET_INSTRUMENTS: MarketInstrument[] = [];

export function useMarketInstruments(enabled = true): MarketInstrumentsSnapshot {
  // Every published list/status is tagged with the catalog scope that produced
  // it, so a login, logout or account switch never renders the previous universe.
  const [symbolsState, setSymbolsState] = useState<ScopedValue<MarketInstrument[]>>(
    { scope: null, value: EMPTY_MARKET_INSTRUMENTS },
  );
  const [authorizedInstruments, setAuthorizedInstruments] = useState<MarketInstrument[]>([]);
  const [authorizedSymbols, setAuthorizedSymbols] = useState<string[]>([]);
  const [disabledSymbols, setDisabledSymbols] = useState<string[]>([]);
  const [authorizationSettled, setAuthorizationSettled] = useState(false);
  const [completedCatalogScope, setCompletedCatalogScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const [accountCatalogState, setAccountCatalogState] = useState<ScopedValue<AccountCatalogStatus>>(
    { scope: null, value: 'none' },
  );
  const accountId = useAppStore((state) => state.accountId);
  const storeAuthToken = useAppStore((state) => state.authToken);
  const storeRefreshToken = useAppStore((state) => state.refreshToken);
  const sessionRevision = useBrokerSessionRevision();
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const catalogueRevisionRef = useRef<string | null>(null);
  const sessionDescriptor = useMemo(
    () => {
      void sessionRevision;
      return isAuthenticated && accountId
        ? getApiSessionDescriptor(accountId)
        : null;
    },
    [accountId, isAuthenticated, sessionRevision],
  );
  const requestSession = useMemo(
    () => sessionDescriptor
      ? captureApiSession(sessionDescriptor, storeAuthToken, storeRefreshToken)
      : null,
    [sessionDescriptor, storeAuthToken, storeRefreshToken],
  );
  const publicApiRootBaseUrl = useMemo(
    () => {
      void sessionRevision;
      return getApiSessionDescriptor(accountId || 'public').apiRootBaseUrl;
    },
    [accountId, sessionRevision],
  );
  // Quote display survives a refresh of the same catalog. Never reuse another
  // broker/account's catalog, and keep trade authorization independently gated.
  const catalogScope = `${publicApiRootBaseUrl}|${getStoredBrokerId()}|${isAuthenticated ? accountId || 'authenticated' : 'public'}`;
  const retainedCatalogRef = useRef<{
    scope: string;
    symbols: MarketInstrument[];
    source: 'public' | 'account';
  } | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const dailyChangePriceModeScopeKey = getCurrentDailyChangePriceModeScopeKey();
    const setSymbols = (value: MarketInstrument[]) => setSymbolsState({ scope: catalogScope, value });
    const setAccountCatalogStatus = (value: AccountCatalogStatus) => (
      setAccountCatalogState({ scope: catalogScope, value })
    );
    const requestGeneration = ++requestGenerationRef.current;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;

    const controller = new AbortController();
    requestAbortRef.current = controller;
    const retained = retainedCatalogRef.current?.scope === catalogScope
      ? retainedCatalogRef.current
      : null;
    const retainedCatalog = retained?.symbols ?? [];
    if (retainedCatalog.length === 0) {
      retainedCatalogRef.current = null;
      setSymbols([]);
    }
    const loadsAccountCatalog = isAuthenticated && Boolean(requestSession);
    setLoading(retainedCatalog.length === 0);
    setError(null);
    // A logged-in account's symbol universe is its own catalogue. Until it is
    // known the universe stays empty (or the same account's retained catalogue)
    // so the public broker list is never flashed to the account.
    setAccountCatalogStatus(
      !isAuthenticated
        ? 'none'
        : retained?.source === 'public' ? 'failed' : 'loading',
    );
    // Never retain trade authorization from the previous request/session while
    // the current authenticated catalog is still being verified.
    setAuthorizedSymbols([]);
    setDisabledSymbols([]);
    setAuthorizedInstruments([]);
    setAuthorizationSettled(false);
    setCompletedCatalogScope(null);

    const isCurrentRequest = () => requestGeneration === requestGenerationRef.current
      && !controller.signal.aborted;
    // The public catalogue carries prices/specifications. For a logged-in
    // account it only enriches the account rows; its failure must not block
    // the account catalogue.
    let publicCatalog: MarketInstrument[] = [];
    let publicCatalogError: unknown = null;
    // Assigned by the concurrent requests below (a plain `null` initializer
    // would make TypeScript narrow it to null after the await).
    let authenticatedCatalog = null as MarketInstrument[] | null;
    let accountCatalogError: unknown = null;

    const publishPublicCatalog = (catalog: MarketInstrument[]) => {
      registerDailyChangePriceModes(catalog, dailyChangePriceModeScopeKey);
      retainedCatalogRef.current = { scope: catalogScope, symbols: catalog, source: 'public' };
      setSymbols(catalog);
      upsertInstrumentTickSnapshots(catalog);
      setLoading(false);
    };
    const publishAccountUniverse = (authorizedCatalog: MarketInstrument[], session: CapturedApiSession) => {
      // The backend already filters this list by the account's group and
      // returns it in the group's order: it is the account symbol universe.
      const accountUniverse = mergeAccountCatalogWithPublic(authorizedCatalog, publicCatalog);
      // Publish the group's spread markup before seeding quotes so the seed
      // and every later tick are widened; a changed markup (new catalogue
      // revision) re-widens the already cached quotes.
      setAccountSpreadMarkups(
        session.accountId,
        buildAccountSpreadMarkupMap(authorizedCatalog, accountUniverse),
      );
      registerDailyChangePriceModes(accountUniverse, dailyChangePriceModeScopeKey);
      retainedCatalogRef.current = { scope: catalogScope, symbols: accountUniverse, source: 'account' };
      setSymbols(accountUniverse);
      upsertInstrumentTickSnapshots(accountUniverse);
      setLoading(false);
    };

    // Neither catalog depends on the other. Start both together so a slow or
    // unavailable public endpoint cannot delay the broker's authorized list.
    const publicRequest = (async () => {
      try {
        const response = await loadPublicMarketCatalog(publicApiRootBaseUrl, controller.signal);
        if (!isCurrentRequest()) return;

        const catalog = extractInstrumentRows(response)
          .map(normalizeInstrument)
          .filter(Boolean) as MarketInstrument[];
        if (catalog.length === 0) {
          throw new ApiError(0, 'No symbols returned by the configured public market API');
        }
        publicCatalog = catalog;

        if (!loadsAccountCatalog) {
          // Guests (and an authenticated state without a usable session) never
          // carry an account's spread markup.
          clearAccountSpreadMarkups();
          publishPublicCatalog(catalog);
          if (!isAuthenticated) {
            setCompletedCatalogScope(catalogScope);
          } else {
            // Authenticated without a usable session: read-only public fallback,
            // trading stays disabled (no authorized symbols).
            setAccountCatalogStatus('failed');
          }
        } else if (authenticatedCatalog && requestSession) {
          // The account universe arrived first: enrich it with the public
          // prices/specifications without widening it to the public list.
          publishAccountUniverse(authenticatedCatalog, requestSession);
        }
      } catch (err) {
        if (!isCurrentRequest()) return;
        publicCatalogError = err;
      } finally {
        if (isCurrentRequest() && !loadsAccountCatalog) {
          setAuthorizationSettled(true);
        }
      }
    })();

    const authorizationRequest = (async () => {
      if (!loadsAccountCatalog || !requestSession) return;
      const session = requestSession;
      try {
        const authorizedResponse = await loadSharedAuthenticatedInstruments(
          {
            ...getCapturedRequestOptions(session, session.v2BaseUrl, controller.signal),
            params: { include_revision: true },
          },
          session,
        );
        if (!isCurrentRequest()) return;
        const authorizedCatalog = extractInstrumentRows(authorizedResponse)
          .map(normalizeInstrument)
          .filter(Boolean) as MarketInstrument[];
        authenticatedCatalog = authorizedCatalog;
        const revision = (authorizedResponse as { revision?: unknown })?.revision;
        catalogueRevisionRef.current = typeof revision === 'string' ? revision : null;
        publishAccountUniverse(authorizedCatalog, session);
        // FIX: Retain authenticated broker specifications, not only their names,
        // so order controls can enforce each exact symbol's volume grid.
        setAuthorizedInstruments(authorizedCatalog);
        const disabled = authorizedCatalog
          .filter((instrument) => instrument.tradingEnabled === false)
          .map((instrument) => instrument.symbol);
        const tradable = authorizedCatalog
          .filter((instrument) => instrument.tradingEnabled !== false)
          .map((instrument) => instrument.symbol);
        setRemoteWatchlistCatalog(
          session.runtimeKey,
          authorizedCatalog.map((instrument) => instrument.symbol),
        );
        setAuthorizedSymbols(uniqueSymbols(tradable));
        setDisabledSymbols(uniqueSymbols(disabled));
        setAccountCatalogStatus('loaded');
      } catch (err) {
        if (!isCurrentRequest()) return;
        accountCatalogError = err;
        // Trading actions stay disabled until the authenticated catalog can
        // prove that a symbol is authorized.
        setAuthorizedSymbols([]);
        setDisabledSymbols([]);
        setAuthorizedInstruments([]);
      } finally {
        if (isCurrentRequest()) {
          setAuthorizationSettled(true);
        }
      }
    })();

    try {
      await Promise.all([publicRequest, authorizationRequest]);
      if (!isCurrentRequest()) return;
      if (loadsAccountCatalog) {
        if (authenticatedCatalog) {
          // Authorization can succeed while public specifications are unavailable.
          // Retry that missing data at the next revision poll even when the
          // authenticated catalogue itself has not changed.
          if (publicCatalogError) catalogueRevisionRef.current = null;
          window.dispatchEvent(new Event(INSTRUMENT_CATALOGUE_REFRESHED_EVENT));
          // Preserve saved pane selections until both sources settle before
          // allowing reconciliation against the account universe.
          setCompletedCatalogScope(catalogScope);
        } else if (retained?.source === 'account') {
          // Keep this account's last known universe; never widen it to the
          // public list. Trading stays disabled until authorization succeeds.
          setSymbols(retained.symbols);
          setAccountCatalogStatus('loaded');
        } else if (publicCatalog.length > 0) {
          // Fallback: read-only public catalogue. Trading actions stay disabled
          // until the authenticated catalog can prove that a symbol is authorized.
          publishPublicCatalog(publicCatalog);
          setAccountCatalogStatus('failed');
        } else {
          const err = publicCatalogError ?? accountCatalogError;
          setSymbols(retainedCatalog);
          setAccountCatalogStatus('failed');
          setError(err instanceof Error ? err.message : 'Failed to load symbols');
        }
      } else if (publicCatalogError) {
        setSymbols(retainedCatalog);
        if (isAuthenticated) {
          setAccountCatalogStatus(retained?.source === 'account' ? 'loaded' : 'failed');
        }
        setError(publicCatalogError instanceof Error ? publicCatalogError.message : 'Failed to load symbols');
      }
    } finally {
      if (isCurrentRequest()) {
        requestAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [catalogScope, enabled, isAuthenticated, publicApiRootBaseUrl, requestSession]);

  const loadSymbolSpecification = useCallback(async (
    symbol: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>> | null> => {
    const normalized = normalizeSymbol(symbol);
    if (!enabled || !normalized || !requestSession) return null;
    const instrument = await marketV2Api.getInstrumentSpecification(
      normalized,
      requestSession.accountId,
      getCapturedRequestOptions(requestSession, requestSession.v2BaseUrl, signal),
    );
    return snapshotBrokerSpecification(instrument);
  }, [enabled, requestSession]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    let disposed = false;
    let checking = false;
    const refresh = () => { void reload(); };
    const checkRevision = async () => {
      if (disposed || checking || !requestSession || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await apiClient.get<{ revision?: unknown }>('/instruments/revision',
          getCapturedRequestOptions(requestSession, requestSession.v2BaseUrl));
        if (disposed) return;
        const revision = response?.revision;
        if (typeof revision !== 'string' || revision !== catalogueRevisionRef.current) await reload();
      } catch {
        if (!disposed) {
          catalogueRevisionRef.current = null;
          setAuthorizedSymbols([]);
          setCompletedCatalogScope(null);
          setError('Trading configuration unavailable. Retrying automatically.');
        }
      } finally {
        checking = false;
      }
    };
    window.addEventListener(INSTRUMENT_CATALOGUE_CHANGED_EVENT, refresh);
    const timer = window.setInterval(() => { void checkRevision(); }, 5000);
    return () => {
      disposed = true;
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener(INSTRUMENT_CATALOGUE_CHANGED_EVENT, refresh);
    };
  }, [enabled, reload, requestSession]);

  // Derive synchronously so a login/logout/account switch never renders one
  // frame with the previous session's symbols or universe classification.
  const effectiveAccountCatalogStatus: AccountCatalogStatus = !isAuthenticated
    ? 'none'
    : accountCatalogState.scope === catalogScope && accountCatalogState.value !== 'none'
      ? accountCatalogState.value
      : 'loading';
  const visibleSymbols = symbolsState.scope === catalogScope
    ? symbolsState.value
    : EMPTY_MARKET_INSTRUMENTS;

  return useMemo(() => ({
    symbols: visibleSymbols,
    authorizedInstruments: enabled ? authorizedInstruments : [],
    authorizedSymbols: enabled ? authorizedSymbols : [],
    disabledSymbols: enabled ? disabledSymbols : [],
    authorizationSettled: enabled && authorizationSettled,
    chartCatalogCurrent: enabled && completedCatalogScope === catalogScope && authorizationSettled,
    accountCatalogStatus: effectiveAccountCatalogStatus,
    loading: !enabled || loading || (effectiveAccountCatalogStatus === 'loading' && visibleSymbols.length === 0),
    error,
    reload,
    loadSymbolSpecification,
  }), [visibleSymbols, enabled, authorizedInstruments, authorizedSymbols, disabledSymbols,
    authorizationSettled, completedCatalogScope, catalogScope, effectiveAccountCatalogStatus,
    loading, error, reload, loadSymbolSpecification]);
}
