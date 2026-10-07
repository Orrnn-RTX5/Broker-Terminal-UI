import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeAccountMetrics } from '../services/accountMetrics';
import type { Account, Position } from '../store/useAppStore';
import { getStoredAccountLogin } from '../api/tradeGateway';
import {
  getAccessToken,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  getServerUrl,
  onSessionChange,
} from '../services/brokerSession';
import { getPositionCloseScope, isConfirmedClosedPosition, useAppStore } from '../store/useAppStore';
import { TRADE_OVERLAY_CLOSE_STATE_EVENT } from '../services/tradeOverlayHistory';
import {
  requestPositionSnapshotRevalidation,
  shouldDeferEmptyPositionSnapshot,
} from '../services/positionSnapshotSafety';
import { getSessionTradeSnapshotRequests } from '../services/tradeStartupSnapshot';
import {
  MARKET_ORDER_PLACEMENT_STATE_EVENT,
  type MarketOrderPlacementStateDetail,
} from '../services/marketOrderPlacementEvents';
import { isConfiguredBrokerEndpoint } from '../config/backendTarget.js';
import {
  getPositionTicket,
  normalizeToolboxPosition,
  patchToolboxPositions,
  positionsSignature,
  replaceToolboxPositions,
  toNumber,
  type ToolboxTradePosition,
} from './toolboxTradePositions';

export {
  normalizeToolboxPosition,
  patchToolboxPositions,
  replaceToolboxPositions,
  type ToolboxTradePosition,
} from './toolboxTradePositions';

type TradeWsState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type ToolboxTradeDebugEvent = {
  at: number;
  source: 'rest' | 'ws' | 'session';
  message: string;
};

type ToolboxTradeState = {
  account: Account | null;
  positions: ToolboxTradePosition[];
  pendingPositions: ToolboxTradePosition[];
  loading: boolean;
  error: string | null;
  login: number | null;
  restBaseUrl: string;
  wsUrl: string;
  wsState: TradeWsState;
  lastRestAt: number | null;
  lastWsAt: number | null;
  debug: ToolboxTradeDebugEvent[];
};

const INITIAL_STATE: ToolboxTradeState = {
  account: null,
  positions: [],
  pendingPositions: [],
  loading: false,
  error: null,
  login: null,
  restBaseUrl: '',
  wsUrl: '',
  wsState: 'idle',
  lastRestAt: null,
  lastWsAt: null,
  debug: [],
};

const DEBUG_LIMIT = 18;
const IMMEDIATE_POSITION_RETENTION_MS = 30_000;
const PENDING_MARKET_ORDER_ORPHAN_MS = 120_000;

// Retained for tests; the production account path normalizes via `applyMetrics`.
// `partial` preserves the previous value for any field a packet omits.
export const normalizeToolboxAccount = (raw: any, previous?: Account | null): Account => (
  normalizeAccountMetrics(raw, previous, { partial: true })
);

const accountSignature = (account: Account | null): string => (
  account
    ? [
      JSON.stringify(account),
      account.balance,
      account.equity,
      account.margin,
      account.freeMargin,
      account.marginLevel,
      account.unrealizedPL,
      account.credit ?? 0,
      account.hasBackendEquity ?? '',
      account.hasBackendBalance ?? '',
      account.hasBackendMargin ?? '',
      account.hasBackendUnrealizedPL ?? '',
      account.hasBackendCredit ?? '',
      account.hasBackendFreeMargin ?? '',
      account.hasBackendMarginLevel ?? '',
      account.currency,
    ].join(':')
    : ''
);

export type ImmediateToolboxPositionDetail = {
  login?: number | string;
  position?: unknown;
  sessionScope?: string;
};

export const applyImmediateToolboxPosition = (
  current: ToolboxTradePosition[],
  detail: ImmediateToolboxPositionDetail | null | undefined,
  activeLogin: number,
  activeSessionScope: string,
): ToolboxTradePosition[] => {
  const eventLogin = toNumber(detail?.login, 0);
  if (
    !detail?.position
    || eventLogin !== activeLogin
    || !detail.sessionScope
    || detail.sessionScope !== activeSessionScope
  ) {
    return current;
  }

  return patchToolboxPositions(current, [detail.position]);
};

export const applyMarketOrderPlacementState = (
  current: ToolboxTradePosition[],
  detail: MarketOrderPlacementStateDetail | null | undefined,
  activeLogin: number,
  activeSessionScope: string,
): ToolboxTradePosition[] => {
  if (
    !detail
    || toNumber(detail.login, 0) !== activeLogin
    || !detail.sessionScope
    || detail.sessionScope !== activeSessionScope
    || !detail.clientOrderId
  ) {
    return current;
  }

  const existingProvisional = current.find((position) => (
    position.clientOrderId === detail.clientOrderId
    || position.id === detail.provisionalTicket
  ));
  const withoutProvisional = current.filter((position) => (
    position.clientOrderId !== detail.clientOrderId
    && position.id !== detail.provisionalTicket
  ));
  const removedProvisional = withoutProvisional.length !== current.length;

  if (detail.status === 'failed') {
    return removedProvisional ? withoutProvisional : current;
  }

  const provisionalStatus = ['pending', 'accepted', 'processing', 'rejected', 'expired']
    .includes(detail.status);
  if (provisionalStatus) {
    const source = detail.position && typeof detail.position === 'object'
      ? detail.position as Record<string, unknown>
      : existingProvisional;
    if (!source) return current;

    const rawPosition: Record<string, unknown> = {
      ...source,
      client_order_id: detail.clientOrderId,
      placementState: detail.status,
      placement_state: detail.status,
      placementErrorCode: detail.errorCode,
      placement_error_code: detail.errorCode,
      placementErrorMessage: detail.errorMessage,
      placement_error_message: detail.errorMessage,
    };
    const ticket = getPositionTicket(rawPosition);
    const volume = toNumber(rawPosition.volume_lots ?? rawPosition.volume ?? rawPosition.quantity, 0);
    if (!ticket || !rawPosition.symbol || !(volume > 0)) {
      return removedProvisional ? withoutProvisional : current;
    }
    return [normalizeToolboxPosition(rawPosition), ...withoutProvisional];
  }

  if (!detail.position || typeof detail.position !== 'object') {
    return removedProvisional ? withoutProvisional : current;
  }

  const rawPosition: Record<string, unknown> = {
    ...(detail.position as Record<string, unknown>),
    client_order_id: detail.clientOrderId,
    placementState: detail.status,
    placement_state: detail.status,
  };

  return patchToolboxPositions(withoutProvisional, [rawPosition]);
};

export type RetainedImmediateToolboxPosition = {
  position: ToolboxTradePosition;
  expiresAt: number;
};

const reconcilePendingMarketOrders = (
  pending: Map<string, RetainedImmediateToolboxPosition>,
  confirmed: ToolboxTradePosition[],
  now = Date.now(),
): boolean => {
  const confirmedIds = new Set(confirmed
    .filter((position) => position.id > 0
      && (!position.placementState || ['filled', 'confirmed'].includes(position.placementState)))
    .map((position) => String(position.clientOrderId ?? '').trim())
    .filter(Boolean));
  let changed = false;
  pending.forEach((entry, clientOrderId) => {
    if (confirmedIds.has(clientOrderId)
      || (entry.expiresAt <= now && ['rejected', 'expired'].includes(entry.position.placementState ?? ''))) {
      pending.delete(clientOrderId);
      changed = true;
    } else if (entry.expiresAt <= now) {
      // A missing result is not a rejection: keep the command visible and never
      // resubmit it. Only an authoritative fill/result can settle this row.
      pending.set(clientOrderId, {
        expiresAt: Number.POSITIVE_INFINITY,
        position: {
          ...entry.position,
          placementErrorCode: 'ORDER_OUTCOME_UNKNOWN',
          placementErrorMessage: `Awaiting confirmation. Check command ${clientOrderId} before placing another order.`,
        },
      });
      changed = true;
    }
  });
  return changed;
};

type OptimisticallyClosedToolboxPosition = {
  position: ToolboxTradePosition;
  status: 'pending' | 'confirmed';
  expiresAt: number;
};

export const mergeRetainedImmediateToolboxPositions = (
  snapshot: ToolboxTradePosition[],
  retained: RetainedImmediateToolboxPosition[],
  now = Date.now(),
): ToolboxTradePosition[] => {
  const byTicket = new Map(snapshot.map((position) => [position.id, position]));
  retained.forEach(({ position, expiresAt }) => {
    if (expiresAt > now && !byTicket.has(position.id)) {
      byTicket.set(position.id, position);
    }
  });
  return Array.from(byTicket.values()).sort((a, b) => {
    const aPending = a.placementState === 'pending';
    const bPending = b.placementState === 'pending';
    if (aPending !== bPending) return aPending ? -1 : 1;
    return b.id - a.id;
  });
};

export const patchPositionsFromTick = (
  current: ToolboxTradePosition[],
  tick: any,
): ToolboxTradePosition[] => {
  const symbol = String(tick?.symbol ?? '').toUpperCase();
  if (!symbol) return current;

  let changed = false;
  const tickTime = toNumber(tick.time ?? tick.timestamp, 0);
  const next = current.map((position) => {
    if (String(position.symbol ?? '').toUpperCase() !== symbol) return position;

    const bid = toNumber(tick.bid, 0);
    const ask = toNumber(tick.ask, bid);
    const currentPrice = position.side === 'SELL' ? ask : bid;
    if (!currentPrice || currentPrice === position.currentPrice) return position;

    changed = true;
    return {
      ...position,
      currentPrice,
      price_current: currentPrice,
      time_update: tickTime || position.time_update,
    };
  });

  return changed ? next : current;
};

const arrayFrom = (payload: any, key?: string): any[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === 'object') return arrayFrom(payload.data, key);
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
};

const readLogin = (): number | null => {
  const storeState = useAppStore.getState();
  const storeLogin = Number.parseInt(String(storeState.accountId ?? ''), 10);
  if (storeState.isAuthenticated && Number.isFinite(storeLogin) && storeLogin > 0) {
    return storeLogin;
  }

  const direct = getStoredAccountLogin();
  if (direct) return direct;
  return Number.isFinite(storeLogin) && storeLogin > 0 ? storeLogin : null;
};

const getBrokerRestBaseUrl = (): string => {
  const serverUrl = getServerUrl();
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v2` : '';
};

type WarmTradeStoreSnapshot = Pick<
  ReturnType<typeof useAppStore.getState>,
  'isAuthenticated' | 'accountId' | 'account' | 'positions'
>;

type WarmTradeSessionScope = {
  authenticated: boolean;
  accountId: string | null;
};

export const selectWarmToolboxTradeSnapshot = (
  storeSnapshot: WarmTradeStoreSnapshot,
  activeLogin: number | null,
  sessionScope: WarmTradeSessionScope,
): Pick<ToolboxTradeState, 'account' | 'positions'> | null => {
  const storeLogin = Number.parseInt(String(storeSnapshot.accountId ?? ''), 10);
  const scopeLogin = Number.parseInt(String(sessionScope.accountId ?? ''), 10);
  if (
    !activeLogin
    || !storeSnapshot.isAuthenticated
    || !sessionScope.authenticated
    || storeLogin !== activeLogin
    || scopeLogin !== activeLogin
  ) {
    return null;
  }

  return {
    account: storeSnapshot.account,
    positions: replaceToolboxPositions([], storeSnapshot.positions as ToolboxTradePosition[]),
  };
};

const createInitialToolboxTradeState = (): ToolboxTradeState => {
  const login = readLogin();
  const restBaseUrl = getBrokerRestBaseUrl();
  const warmSnapshot = selectWarmToolboxTradeSnapshot(
    useAppStore.getState(),
    login,
    getCommittedBrokerAccountSessionScope(),
  );

  return {
    ...INITIAL_STATE,
    login,
    restBaseUrl,
    account: warmSnapshot?.account ?? null,
    positions: warmSnapshot?.positions ?? [],
    loading: Boolean(login && restBaseUrl && !warmSnapshot),
  };
};

const buildUrl = (baseUrl: string, path: string, params?: Record<string, string | number>): string => {
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

async function requestBrokerJson<T>(
  baseUrl: string,
  path: string,
  params: Record<string, string | number> | undefined,
  signal: AbortSignal,
): Promise<T> {
  const token = getAccessToken();
  if (!baseUrl) throw new Error('Missing broker server_url. Trade tab will not fall back to localhost.');
  if (!token) throw new Error('Missing auth token');

  const url = buildUrl(baseUrl, path, params);
  if (!isConfiguredBrokerEndpoint(url)) throw new Error('Trade endpoint does not belong to this broker deployment.');
  const response = await fetch(url, {
    signal,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = body?.message ?? body?.error ?? `HTTP ${response.status}`;
    throw new Error(`${message} (${response.status})`);
  }

  return body as T;
}

export function useToolboxTradeData() {
  const storeAccountId = useAppStore((state) => state.accountId);
  const storeAuthToken = useAppStore((state) => state.authToken);
  const centralAccount = useAppStore((state) => state.account);
  const centralPositions = useAppStore((state) => state.positions);
  const [state, setState] = useState<ToolboxTradeState>(createInitialToolboxTradeState);

  const accountRef = useRef<Account | null>(state.account);
  const positionsRef = useRef<ToolboxTradePosition[]>(state.positions);
  const retainedImmediatePositionsRef = useRef<Map<number, RetainedImmediateToolboxPosition>>(new Map());
  const pendingMarketOrdersRef = useRef<Map<string, RetainedImmediateToolboxPosition>>(new Map());
  const optimisticallyClosedPositionsRef = useRef<Map<number, OptimisticallyClosedToolboxPosition>>(new Map());
  const placementSessionScopeRef = useRef(getCommittedBrokerAccountSessionScopeKey(
    getCommittedBrokerAccountSessionScope(),
  ));
  const placementAuthGenerationRef = useRef(getPositionCloseScope());
  const refreshSeqRef = useRef(0);
  const activeRefreshControllerRef = useRef<AbortController | null>(null);

  const sessionKey = useMemo(() => {
    return [
      storeAccountId ?? '',
      storeAuthToken ?? '',
      getServerUrl(),
      getAccessToken() ?? '',
      readLogin() ?? '',
    ].join('|');
  }, [storeAccountId, storeAuthToken]);
  const stateSessionKeyRef = useRef(sessionKey);

  const pushDebug = useCallback((event: ToolboxTradeDebugEvent) => {
    setState((prev) => ({
      ...prev,
      debug: [event, ...prev.debug].slice(0, DEBUG_LIMIT),
    }));
  }, []);

  const commitAccount = useCallback((account: Account | null) => {
    const previousSig = accountSignature(accountRef.current);
    const nextSig = accountSignature(account);
    accountRef.current = account;
    if (previousSig === nextSig) return;
    setState((prev) => ({ ...prev, account }));
  }, []);

  const commitPositions = useCallback((positions: ToolboxTradePosition[]) => {
    const previousSig = positionsSignature(positionsRef.current);
    positions = positions.filter((position) => !isConfirmedClosedPosition(position.id));
    let nextSig = positionsSignature(positions);
    const storePositions = Array.isArray(useAppStore.getState().positions)
      ? useAppStore.getState().positions as ToolboxTradePosition[]
      : [];
    if (positionsSignature(storePositions) !== nextSig) {
      useAppStore.getState().setPositions(positions as Position[], {
        removedTickets: [...optimisticallyClosedPositionsRef.current.keys()],
      });
      positions = useAppStore.getState().positions as ToolboxTradePosition[];
      nextSig = positionsSignature(positions);
      // Chart subscribers already process this store transition. An immediate
      // refresh here would duplicate structural renders and cancel valuation
      // coalescing. Explicit visibility/history refresh events remain separate.
    }
    positionsRef.current = positions;
    if (previousSig === nextSig) return;
    setState((prev) => ({ ...prev, positions }));
  }, []);

  const refresh = useCallback(async () => {
    const login = readLogin();
    const restBaseUrl = getBrokerRestBaseUrl();
    const seq = ++refreshSeqRef.current;
    activeRefreshControllerRef.current?.abort();
    const controller = new AbortController();
    const metricsScope = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
    const startedPositions = useAppStore.getState().positions;
    const startedAuthToken = useAppStore.getState().authToken;
    activeRefreshControllerRef.current = controller;

    setState((prev) => ({
      ...prev,
      login,
      restBaseUrl,
      loading: positionsRef.current.length === 0,
      error: null,
    }));

    if (!login || !restBaseUrl) {
      const message = !login
        ? 'No account login found for Trade tab'
        : 'Missing broker server_url. Trade tab will not fall back to localhost.';
      setState((prev) => ({ ...prev, loading: false, error: message }));
      pushDebug({ at: Date.now(), source: 'session', message });
      return;
    }

    try {
      // Start every read together, but never hold open-position rows behind
      // account or optional metrics latency.
      const startupRequests = getSessionTradeSnapshotRequests(login);
      const metricsPromise = requestBrokerJson<any>(
        restBaseUrl,
        `/account/${login}/metrics`,
        undefined,
        controller.signal,
      ).catch(() => null);
      const positionsResult = await startupRequests.positionsResultPromise;

      if (seq !== refreshSeqRef.current || controller.signal.aborted) return;
      if (useAppStore.getState().authToken !== startedAuthToken) return;
      if (metricsScope !== getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope())) return;
      if (positionsResult.status === 'rejected') {
        throw positionsResult.reason;
      }
      const positionsBody = positionsResult.value;
      let rawPositions = arrayFrom(positionsBody, 'positions');
      const livePositions = useAppStore.getState().positions;
      if (livePositions !== startedPositions) {
        const currentTickets = new Set(livePositions.map((position) => position.id));
        rawPositions = [...livePositions, ...rawPositions.filter((position) => !currentTickets.has(getPositionTicket(position)))];
      }
      const rawPositionTickets = new Set(rawPositions.map(getPositionTicket).filter(Boolean));
      const now = Date.now();
      reconcilePendingMarketOrders(pendingMarketOrdersRef.current, rawPositions.map(normalizeToolboxPosition), now);
      optimisticallyClosedPositionsRef.current.forEach((entry, ticket) => {
        if (entry.expiresAt <= now || (entry.status === 'confirmed' && !rawPositionTickets.has(ticket))) {
          optimisticallyClosedPositionsRef.current.delete(ticket);
        }
      });
      const visibleRawPositions = rawPositions.filter(
        (position) => !optimisticallyClosedPositionsRef.current.has(getPositionTicket(position)),
      );
      const snapshot = replaceToolboxPositions(positionsRef.current, visibleRawPositions);
      const snapshotTickets = new Set(snapshot.map((position) => position.id));
      retainedImmediatePositionsRef.current.forEach(({ expiresAt }, ticket) => {
        if (expiresAt <= now || snapshotTickets.has(ticket)) {
          retainedImmediatePositionsRef.current.delete(ticket);
        }
      });
      commitPositions(mergeRetainedImmediateToolboxPositions(
        snapshot,
        Array.from(retainedImmediatePositionsRef.current.values()),
        now,
      ));
      setState((prev) => ({
        ...prev,
        pendingPositions: Array.from(pendingMarketOrdersRef.current.values())
          .map(({ position }) => position)
          .sort((a, b) => a.id - b.id),
      }));

      setState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        lastRestAt: Date.now(),
      }));
      pushDebug({
        at: Date.now(),
        source: 'rest',
        message: `Loaded ${rawPositions.length} open position(s) for account ${login} from ${restBaseUrl}`,
      });

      const accountResult = await startupRequests.accountResultPromise;
      if (seq !== refreshSeqRef.current || controller.signal.aborted) return;
      if (accountResult.status === 'rejected') {
        throw accountResult.reason;
      }

      const accountBody = accountResult.value;
      const applyMetrics = (body: unknown) => {
        if (metricsScope !== getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope())) return;
        if (useAppStore.getState().authToken !== startedAuthToken) return;
        const current = useAppStore.getState().account ?? accountRef.current;
        const next = normalizeAccountMetrics(body, current, { partial: true, scope: metricsScope, login });
        commitAccount(next);
        if (next !== current) useAppStore.getState().setAccount(next);
      };
      applyMetrics(accountBody);

      const metricsBody = await metricsPromise;
      if (seq !== refreshSeqRef.current || controller.signal.aborted) return;
      if (metricsBody) {
        applyMetrics(metricsBody);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Failed to load Trade tab data';
      setState((prev) => ({ ...prev, loading: false, error: message }));
      pushDebug({ at: Date.now(), source: 'rest', message });
    } finally {
      if (activeRefreshControllerRef.current === controller) {
        activeRefreshControllerRef.current = null;
      }
    }
  }, [commitAccount, commitPositions, pushDebug]);

  const removePosition = useCallback((ticket: number) => {
    retainedImmediatePositionsRef.current.delete(ticket);
    commitPositions(positionsRef.current.filter((position) => position.id !== ticket));
  }, [commitPositions]);

  const removePositionsByMode = useCallback((mode: 'ALL' | 'WINNERS' | 'LOSERS') => {
    const current = positionsRef.current;
    if (mode === 'ALL') {
      retainedImmediatePositionsRef.current.clear();
      commitPositions([]);
      return;
    }
    const retained = current.filter((position) => {
      if (position.hasBackendProfit === false) return true;
      const raw: unknown = position.profit ?? position.unrealizedPnL;
      if (raw === undefined || raw === null || raw === '') return true;
      const pnl = toNumber(raw, Number.NaN);
      if (!Number.isFinite(pnl)) return true;
      return mode === 'WINNERS' ? pnl <= 0 : pnl >= 0;
    });
    const retainedTickets = new Set(retained.map((position) => position.id));
    retainedImmediatePositionsRef.current.forEach((_value, ticket) => {
      if (!retainedTickets.has(ticket)) retainedImmediatePositionsRef.current.delete(ticket);
    });
    commitPositions(retained);
  }, [commitPositions]);

  useEffect(() => {
    const nextPlacementScope = getCommittedBrokerAccountSessionScopeKey(
      getCommittedBrokerAccountSessionScope(),
    );
    const placementScopeChanged = placementSessionScopeRef.current !== nextPlacementScope
      || placementAuthGenerationRef.current !== getPositionCloseScope();
    const sessionChanged = stateSessionKeyRef.current !== sessionKey;
    if (sessionChanged) {
      stateSessionKeyRef.current = sessionKey;
    }
    // Credential rotation restarts transport reads, not the original trade
    // intents. Only a broker/account/authentication change discards their rows.
    const authenticationLost = !storeAuthToken || !useAppStore.getState().isAuthenticated;
    if (placementScopeChanged || (sessionChanged && authenticationLost)) {
      accountRef.current = null;
      positionsRef.current = [];
      pendingMarketOrdersRef.current.clear();
      retainedImmediatePositionsRef.current.clear();
      optimisticallyClosedPositionsRef.current.clear();
      setState({
        ...INITIAL_STATE,
        login: readLogin(),
        restBaseUrl: getBrokerRestBaseUrl(),
        loading: Boolean(readLogin()),
      });
    }
    if (placementScopeChanged) {
      placementSessionScopeRef.current = nextPlacementScope;
      placementAuthGenerationRef.current = getPositionCloseScope();
      pendingMarketOrdersRef.current.clear();
      setState((prev) => ({ ...prev, pendingPositions: [] }));
    }
    return () => {
      activeRefreshControllerRef.current?.abort();
    };
  }, [sessionKey]);

  useEffect(() => onSessionChange(reason => {
    if (reason === 'token_rotation') return;
    // A new login may target the same account. It still must not retain UI
    // state from the previous authenticated session.
    pendingMarketOrdersRef.current.clear();
    retainedImmediatePositionsRef.current.clear();
    optimisticallyClosedPositionsRef.current.clear();
    accountRef.current = null;
    positionsRef.current = [];
    setState({ ...INITIAL_STATE, login: readLogin(), restBaseUrl: getBrokerRestBaseUrl(), loading: Boolean(readLogin()) });
  }), []);

  useEffect(() => {
    const login = readLogin();
    const storeLogin = Number.parseInt(String(storeAccountId ?? ''), 10);
    if (!login || storeLogin !== login) return;

    commitAccount(centralAccount);
    const nextPositions = mergeRetainedImmediateToolboxPositions(
      replaceToolboxPositions(
        positionsRef.current,
        Array.isArray(centralPositions) ? centralPositions : [],
      ),
      Array.from(retainedImmediatePositionsRef.current.values()),
    ).filter((position) => !isConfirmedClosedPosition(position.id));
    if (shouldDeferEmptyPositionSnapshot(positionsRef.current.filter((position) => !isConfirmedClosedPosition(position.id)), nextPositions)) {
      // Preserve the last REST-confirmed rows while a stale shared-store/WS
      // update is reconciled. The hook's own REST refresh can still clear the
      // list once the account is genuinely flat.
      requestPositionSnapshotRevalidation();
      return;
    }
    const previousSig = positionsSignature(positionsRef.current);
    const nextSig = positionsSignature(nextPositions);
    const pendingChanged = reconcilePendingMarketOrders(pendingMarketOrdersRef.current, nextPositions);
    const reconciledPending = pendingChanged
      ? Array.from(pendingMarketOrdersRef.current.values()).map(({ position }) => position)
      : null;
    positionsRef.current = nextPositions;
    setState((prev) => ({
      ...prev,
      account: centralAccount,
      positions: previousSig === nextSig ? prev.positions : nextPositions,
      pendingPositions: reconciledPending ?? prev.pendingPositions,
      loading: false,
      error: null,
      login,
      restBaseUrl: getBrokerRestBaseUrl(),
      wsState: 'connected',
    }));
  }, [centralAccount, centralPositions, commitAccount, storeAccountId]);

  useEffect(() => {
    const deadline = Math.min(...Array.from(pendingMarketOrdersRef.current.values()).map(({ expiresAt }) => expiresAt));
    if (!Number.isFinite(deadline)) return;
    const timer = window.setTimeout(() => {
      if (!reconcilePendingMarketOrders(pendingMarketOrdersRef.current, positionsRef.current)) return;
      setState((prev) => ({
        ...prev,
        pendingPositions: Array.from(pendingMarketOrdersRef.current.values()).map(({ position }) => position),
      }));
    }, Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state.pendingPositions]);

  useEffect(() => {
    const handleManualRefresh = () => void refresh();
    window.addEventListener('rtx:toolbox-trade-refresh', handleManualRefresh);
    return () => {
      window.removeEventListener('rtx:toolbox-trade-refresh', handleManualRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    const handleMarketOrderPlacement = (event: Event) => {
      const login = readLogin();
      if (!login) return;

      const activeSessionScope = getCommittedBrokerAccountSessionScopeKey(
        getCommittedBrokerAccountSessionScope(),
      );
      const detail = (event as CustomEvent<MarketOrderPlacementStateDetail>).detail;
      if (
        !detail
        || toNumber(detail.login, 0) !== login
        || detail.sessionScope !== activeSessionScope
      ) return;
      if (['pending', 'accepted', 'processing', 'rejected', 'expired'].includes(detail.status)) {
        const currentPending = Array.from(pendingMarketOrdersRef.current.values())
          .map(({ position }) => position);
        const nextPending = applyMarketOrderPlacementState(
          currentPending,
          detail,
          login,
          activeSessionScope,
        );
        if (nextPending === currentPending) return;

        const position = nextPending.find((candidate) => candidate.clientOrderId === detail.clientOrderId);
        if (position) {
          pendingMarketOrdersRef.current.set(detail.clientOrderId, {
            position,
            expiresAt: Date.now() + PENDING_MARKET_ORDER_ORPHAN_MS,
          });
        }
        reconcilePendingMarketOrders(pendingMarketOrdersRef.current, positionsRef.current);
        setState((prev) => ({
          ...prev,
          pendingPositions: Array.from(pendingMarketOrdersRef.current.values())
            .map(({ position: pendingPosition }) => pendingPosition)
            .sort((a, b) => a.id - b.id),
        }));
        return;
      }

      pendingMarketOrdersRef.current.delete(detail.clientOrderId);
      setState((prev) => ({
        ...prev,
        pendingPositions: Array.from(pendingMarketOrdersRef.current.values())
          .map(({ position }) => position)
          .sort((a, b) => a.id - b.id),
      }));
      if (detail.status === 'failed') return;

      const next = applyMarketOrderPlacementState(
        positionsRef.current,
        detail,
        login,
        activeSessionScope,
      );
      if (next === positionsRef.current) return;

      const ticket = getPositionTicket(detail.position);
      const position = next.find((candidate) => candidate.id === ticket);
      if (ticket && position) {
        retainedImmediatePositionsRef.current.set(ticket, {
          position,
          expiresAt: Date.now() + IMMEDIATE_POSITION_RETENTION_MS,
        });
      }
      commitPositions(next);
    };

    window.addEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, handleMarketOrderPlacement);
    return () => window.removeEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, handleMarketOrderPlacement);
  }, [commitPositions]);

  useEffect(() => {
    const handleCloseState = (event: Event) => {
      const detail = (event as CustomEvent<{
        status?: 'pending' | 'confirmed' | 'failed';
        ticketIds?: Array<number | string>;
      }>).detail;
      const ticketIds = Array.isArray(detail?.ticketIds)
        ? detail.ticketIds.map((ticket) => toNumber(ticket, 0)).filter(Boolean)
        : [];
      if (ticketIds.length === 0) return;

      if (detail.status === 'pending') {
        const expiresAt = Date.now() + IMMEDIATE_POSITION_RETENTION_MS;
        ticketIds.forEach((ticket) => {
          const position = positionsRef.current.find((candidate) => candidate.id === ticket);
          if (position) {
            optimisticallyClosedPositionsRef.current.set(ticket, {
              position,
              status: 'pending',
              expiresAt,
            });
          }
          retainedImmediatePositionsRef.current.delete(ticket);
        });
        commitPositions(positionsRef.current.filter((position) => !ticketIds.includes(position.id)));
        return;
      }

      if (detail.status === 'confirmed') {
        // Closes are confirm-first (MT5 behaviour): the row is still listed
        // here, so the backend confirmation is what removes it.
        const expiresAt = Date.now() + IMMEDIATE_POSITION_RETENTION_MS;
        ticketIds.forEach((ticket) => {
          const position = optimisticallyClosedPositionsRef.current.get(ticket)?.position
            ?? positionsRef.current.find((candidate) => candidate.id === ticket);
          if (position) {
            optimisticallyClosedPositionsRef.current.set(ticket, {
              position,
              status: 'confirmed',
              expiresAt,
            });
          }
          retainedImmediatePositionsRef.current.delete(ticket);
        });
        useAppStore.getState().setPositions(useAppStore.getState().positions, { closedTickets: ticketIds });
        const remaining = positionsRef.current.filter((position) => !ticketIds.includes(position.id));
        if (remaining.length !== positionsRef.current.length) commitPositions(remaining);
        return;
      }

      if (detail.status === 'failed') {
        let next = positionsRef.current;
        ticketIds.forEach((ticket) => {
          const existing = optimisticallyClosedPositionsRef.current.get(ticket);
          optimisticallyClosedPositionsRef.current.delete(ticket);
          if (existing) {
            next = patchToolboxPositions(next, [existing.position]);
            retainedImmediatePositionsRef.current.set(ticket, {
              position: existing.position,
              expiresAt: Date.now() + IMMEDIATE_POSITION_RETENTION_MS,
            });
          }
        });
        if (next !== positionsRef.current) commitPositions(next);
      }
    };

    window.addEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleCloseState);
    return () => window.removeEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleCloseState);
  }, [commitPositions]);

  const sameAuthenticatedTradeIdentity = Boolean(storeAuthToken && useAppStore.getState().isAuthenticated)
    && placementAuthGenerationRef.current === getPositionCloseScope()
    && placementSessionScopeRef.current === getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
  const visibleState = stateSessionKeyRef.current === sessionKey || sameAuthenticatedTradeIdentity
    ? state
    : {
      ...INITIAL_STATE,
      login: readLogin(),
      restBaseUrl: getBrokerRestBaseUrl(),
      loading: true,
    };

  return {
    ...visibleState,
    refresh,
    removePosition,
    removePositionsByMode,
  };
}
