import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Account, Position } from '../store/useAppStore';
import { getStoredAccountLogin, normalizePosition } from '../api/tradeGateway';
import {
  getAccessToken,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  getServerUrl,
} from '../services/brokerSession';
import { useAppStore } from '../store/useAppStore';
import { TRADE_OVERLAY_CLOSE_STATE_EVENT } from '../services/tradeOverlayHistory';
import { getSessionTradeSnapshotRequests } from '../services/tradeStartupSnapshot';
import {
  MARKET_ORDER_PLACEMENT_STATE_EVENT,
  type MarketOrderPlacementState,
  type MarketOrderPlacementStateDetail,
} from '../services/marketOrderPlacementEvents';

type TradeWsState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type ToolboxTradePosition = Omit<Position, 'time_create' | 'time_update'> & {
  account_login?: number;
  ticket?: number;
  contractSize?: number;
  contract_size?: number;
  hasBackendProfit?: boolean;
  price_open?: number;
  price_current?: number;
  price_sl?: number;
  price_tp?: number;
  profit?: number;
  time_create?: number | string;
  time_update?: number | string;
  clientOrderId?: string;
  placementState?: MarketOrderPlacementState;
  placementErrorCode?: string;
  placementErrorMessage?: string;
};

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

const toNumber = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined) return fallback;
  // calc-v2 Money: { amount, currency, scale } — Number(object) is NaN → false zero balance.
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.amount !== undefined && record.amount !== null) {
      return toNumber(record.amount, fallback);
    }
  }
  const cleanStr = String(value).replace(/,/g, '');
  const next = Number(cleanStr);
  return Number.isFinite(next) ? next : fallback;
};

const hasFiniteValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.amount !== undefined && record.amount !== null) {
      return hasFiniteValue(record.amount);
    }
  }
  const cleanStr = String(value).replace(/,/g, '');
  return Number.isFinite(Number(cleanStr));
};

const unwrapData = (value: any): any => {
  if (!value || typeof value !== 'object') return value;
  if (value.account) return value.account;
  if (value.data?.account) return value.data.account;
  if (value.data?.data && typeof value.data.data === 'object' && !Array.isArray(value.data.data)) {
    return value.data.data;
  }
  if (value.data && typeof value.data === 'object' && !Array.isArray(value.data)) return value.data;
  return value;
};

export const normalizeToolboxAccount = (raw: any, previous?: Account | null): Account => {
  const data = unwrapData(raw) ?? {};
  const freeMarginRaw =
    data.free_margin_amount ?? data.free_margin ?? data.margin_free ?? data.freeMargin ?? data.margin_available;
  const marginLevelRaw = data.margin_level ?? data.marginLevel;
  const creditRaw = data.credit ?? data.credit_bonus ?? data.bonus;
  const balanceRaw = data.balance_amount ?? data.balance ?? data.Balance;
  const equityRaw = data.equity_amount ?? data.equity ?? data.Equity;
  // Prefer scalars; unwrap Money.amount. Never replace a known funded balance with packet 0.
  const incomingBalance = balanceRaw !== undefined && balanceRaw !== null ? toNumber(balanceRaw, 0) : undefined;
  const rejectZeroBalance = Boolean(previous && previous.balance > 0 && incomingBalance === 0);

  // A packet claiming balance 0 for a known-funded account is bogus (partial/mid-flight metrics).
  // We keep the last known-good balance, but every other figure carried by that SAME packet —
  // equity, free margin, margin level — is equally untrustworthy. They are therefore marked as
  // NOT backend-supplied so the resolver reports them as `unavailable` and the UI renders a dash.
  // We never reconstruct equity locally (balance + floating P/L): a fabricated number presented
  // as backend truth is exactly the misleading value this account panel must not show.
  // Unknown must look unknown.
  const hasBackendEquity = !rejectZeroBalance && hasFiniteValue(equityRaw);
  const hasBackendFreeMargin = !rejectZeroBalance && hasFiniteValue(freeMarginRaw);
  const hasBackendMarginLevel = !rejectZeroBalance && hasFiniteValue(marginLevelRaw);

  const balance = rejectZeroBalance
    ? previous!.balance
    : (incomingBalance !== undefined ? incomingBalance : (previous?.balance ?? 0));
  const floatingPnL = toNumber(
    data.floating_pnl ?? data.floating ?? data.profit ?? data.unrealized_pl ?? data.unrealizedPL,
    previous?.unrealizedPL ?? 0,
  );
  const equity = hasBackendEquity
    ? toNumber(equityRaw, previous?.equity ?? previous?.balance ?? balance)
    : toNumber(previous?.equity ?? balance, balance);

  return {
    balance,
    equity,
    margin: toNumber(data.used_margin ?? data.margin_used ?? data.margin ?? data.marginUsed, previous?.margin ?? 0),
    freeMargin: hasBackendFreeMargin ? toNumber(freeMarginRaw, previous?.freeMargin ?? 0) : toNumber(previous?.freeMargin, 0),
    unrealizedPL: floatingPnL,
    marginLevel: hasBackendMarginLevel ? toNumber(marginLevelRaw, previous?.marginLevel ?? 0) : toNumber(previous?.marginLevel, 0),
    credit: toNumber(creditRaw, previous?.credit ?? 0),
    hasBackendEquity,
    hasBackendFreeMargin,
    hasBackendMarginLevel,
    currency: String(data.currency ?? previous?.currency ?? 'USD'),
    leverage: toNumber(data.leverage, previous?.leverage ?? 100),
  };
};

const getPositionTicket = (position: any): number => (
  toNumber(position?.ticket ?? position?.position_id ?? position?.position_ticket ?? position?.id, 0)
);

export const normalizeToolboxPosition = (raw: any): ToolboxTradePosition => {
  const normalized = normalizePosition(raw) as ToolboxTradePosition;
  const ticket = getPositionTicket(raw) || normalized.id;
  const priceCurrent = toNumber(raw?.price_current ?? raw?.current_price ?? normalized.currentPrice, normalized.currentPrice);
  const rawProfit = raw?.profit ?? raw?.unrealized_pl ?? raw?.unrealizedPnL;
  const hasBackendProfit = rawProfit !== undefined && rawProfit !== null && rawProfit !== '' && Number.isFinite(Number(rawProfit));
  const profit = hasBackendProfit ? toNumber(rawProfit, 0) : normalized.unrealizedPnL;

  return {
    ...normalized,
    id: ticket,
    ticket,
    account_login: raw?.account_login ?? raw?.login ?? normalized.account_login,
    contractSize: toNumber(raw?.contractSize ?? raw?.contract_size ?? normalized.contractSize, 0) || undefined,
    contract_size: toNumber(raw?.contract_size ?? raw?.contractSize ?? normalized.contract_size, 0) || undefined,
    price_open: toNumber(raw?.price_open ?? raw?.open_price ?? normalized.openPrice, normalized.openPrice),
    price_current: priceCurrent,
    price_sl: toNumber(raw?.price_sl ?? raw?.sl ?? normalized.sl, normalized.sl),
    price_tp: toNumber(raw?.price_tp ?? raw?.tp ?? normalized.tp, normalized.tp),
    currentPrice: priceCurrent,
    profit,
    unrealizedPnL: profit,
    hasBackendProfit,
    swap: toNumber(raw?.swap ?? raw?.storage ?? normalized.swap, normalized.swap),
    commission: toNumber(raw?.commission ?? normalized.commission, normalized.commission),
    time_create: raw?.time_create ?? normalized.time_create,
    time_update: raw?.time_update ?? normalized.time_update,
    clientOrderId: raw?.clientOrderId ?? raw?.client_order_id,
    placementState: raw?.placementState ?? raw?.placement_state,
    placementErrorCode: raw?.placementErrorCode ?? raw?.placement_error_code,
    placementErrorMessage: raw?.placementErrorMessage ?? raw?.placement_error_message,
    comment: raw?.comment ?? normalized.comment ?? '',
  };
};

const positionSignature = (position: ToolboxTradePosition): string => [
  position.id,
  position.account_login ?? '',
  position.symbol,
  position.side,
  position.volume,
  position.contractSize ?? position.contract_size ?? '',
  position.hasBackendProfit ?? '',
  position.price_open ?? position.openPrice,
  position.price_current ?? position.currentPrice,
  position.price_sl ?? position.sl,
  position.price_tp ?? position.tp,
  position.swap,
  position.commission,
  position.profit ?? position.unrealizedPnL,
  position.time_create ?? '',
  position.time_update ?? '',
  position.clientOrderId ?? '',
  position.placementState ?? '',
  position.placementErrorCode ?? '',
  position.placementErrorMessage ?? '',
  position.comment ?? '',
].join(':');

const positionsSignature = (positions: ToolboxTradePosition[]): string => (
  positions.map(positionSignature).join('|')
);

const accountSignature = (account: Account | null): string => (
  account
    ? [
      account.balance,
      account.equity,
      account.margin,
      account.freeMargin,
      account.marginLevel,
      account.unrealizedPL,
      account.credit ?? 0,
      account.hasBackendEquity ?? '',
      account.hasBackendFreeMargin ?? '',
      account.hasBackendMarginLevel ?? '',
      account.currency,
    ].join(':')
    : ''
);

const isFullPosition = (raw: any): boolean => (
  Boolean(raw?.symbol) &&
  toNumber(raw?.volume_lots ?? raw?.volume ?? raw?.quantity, 0) > 0 &&
  toNumber(raw?.price_open ?? raw?.open_price ?? raw?.openPrice, 0) > 0
);

const mergePatchIntoPosition = (
  existing: ToolboxTradePosition,
  raw: any,
): ToolboxTradePosition => {
  const next: ToolboxTradePosition = { ...existing };
  const hasPricePatch = raw?.price_current !== undefined || raw?.current_price !== undefined || raw?.currentPrice !== undefined;
  const hasProfitPatch = raw?.profit !== undefined || raw?.unrealized_pl !== undefined || raw?.unrealizedPnL !== undefined;

  if (hasPricePatch) {
    const price = toNumber(raw.price_current ?? raw.current_price ?? raw.currentPrice, existing.currentPrice);
    next.currentPrice = price;
    next.price_current = price;
  }

  if (hasProfitPatch) {
    const profit = toNumber(raw.profit ?? raw.unrealized_pl ?? raw.unrealizedPnL, existing.unrealizedPnL);
    next.unrealizedPnL = profit;
    next.profit = profit;
    next.hasBackendProfit = true;
  }

  if (raw?.swap !== undefined || raw?.storage !== undefined) {
    next.swap = toNumber(raw.swap ?? raw.storage, existing.swap);
  }

  if (raw?.commission !== undefined) {
    next.commission = toNumber(raw.commission, existing.commission);
  }

  if (raw?.price_sl !== undefined || raw?.sl !== undefined) {
    const sl = toNumber(raw.price_sl ?? raw.sl, existing.sl);
    next.sl = sl;
    next.price_sl = sl;
  }

  if (raw?.price_tp !== undefined || raw?.tp !== undefined) {
    const tp = toNumber(raw.price_tp ?? raw.tp, existing.tp);
    next.tp = tp;
    next.price_tp = tp;
  }

  if (raw?.time_update !== undefined || raw?.time !== undefined) {
    next.time_update = raw.time_update ?? raw.time;
  }

  return next;
};

export const replaceToolboxPositions = (
  current: ToolboxTradePosition[],
  rawPositions: any[],
): ToolboxTradePosition[] => {
  const previousByTicket = new Map(current.map((position) => [position.id, position]));
  const nextByTicket = new Map<number, ToolboxTradePosition>();

  rawPositions.forEach((raw) => {
    const ticket = getPositionTicket(raw);
    if (ticket <= 0) return;

    const previous = previousByTicket.get(ticket);
    const normalized = normalizeToolboxPosition(raw);
    const hasRenderableIdentity = Boolean(
      String(normalized.symbol ?? '').trim()
      && toNumber(normalized.volume, 0) > 0,
    );

    // Sparse updates may patch a known row, but cannot create a blank row.
    // This keeps the Trade footer stable while REST and WS snapshots race.
    const candidate = hasRenderableIdentity
      ? normalized
      : previous
        ? mergePatchIntoPosition(previous, raw)
        : null;
    if (
      !candidate
      || !String(candidate.symbol ?? '').trim()
      || !(toNumber(candidate.volume, 0) > 0)
    ) return;

    nextByTicket.set(
      ticket,
      previous && positionSignature(previous) === positionSignature(candidate)
        ? previous
        : candidate,
    );
  });

  return Array.from(nextByTicket.values()).sort((a, b) => b.id - a.id);
};

export const patchToolboxPositions = (
  current: ToolboxTradePosition[],
  rawUpdates: any[],
  closeTickets: number[] = [],
): ToolboxTradePosition[] => {
  let next = current;
  const closeSet = new Set(closeTickets.filter(Boolean));

  if (closeSet.size > 0) {
    next = next.filter((position) => !closeSet.has(position.id));
  }

  for (const raw of rawUpdates) {
    const ticket = getPositionTicket(raw);
    if (!ticket) continue;

    const index = next.findIndex((position) => position.id === ticket);
    if (index < 0) {
      if (isFullPosition(raw)) {
        const created = normalizeToolboxPosition(raw);
        next = [created, ...next];
      }
      continue;
    }

    const patched = mergePatchIntoPosition(next[index], raw);
    if (positionSignature(patched) !== positionSignature(next[index])) {
      next = next.map((position, itemIndex) => itemIndex === index ? patched : position);
    }
  }

  return next;
};

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
      placement_state: detail.status,
      placement_error_code: detail.errorCode,
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
    placement_state: detail.status,
  };

  return patchToolboxPositions(withoutProvisional, [rawPosition]);
};

export type RetainedImmediateToolboxPosition = {
  position: ToolboxTradePosition;
  expiresAt: number;
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

  const response = await fetch(buildUrl(baseUrl, path, params), {
    signal,
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
    const nextSig = positionsSignature(positions);
    positionsRef.current = positions;
    const storePositions = Array.isArray(useAppStore.getState().positions)
      ? useAppStore.getState().positions as ToolboxTradePosition[]
      : [];
    if (positionsSignature(storePositions) !== nextSig) {
      useAppStore.getState().setPositions(positions as Position[]);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
      }
    }
    if (previousSig === nextSig) return;
    setState((prev) => ({ ...prev, positions }));
  }, []);

  const refresh = useCallback(async () => {
    const login = readLogin();
    const restBaseUrl = getBrokerRestBaseUrl();
    const seq = ++refreshSeqRef.current;
    activeRefreshControllerRef.current?.abort();
    const controller = new AbortController();
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
      if (positionsResult.status === 'rejected') {
        throw positionsResult.reason;
      }
      const positionsBody = positionsResult.value;
      const rawPositions = arrayFrom(positionsBody, 'positions');
      const rawPositionTickets = new Set(rawPositions.map(getPositionTicket).filter(Boolean));
      const now = Date.now();
      const confirmedClientOrderIds = new Set(rawPositions
        .map((position) => String(position?.client_order_id ?? position?.clientOrderId ?? '').trim())
        .filter(Boolean));
      pendingMarketOrdersRef.current.forEach(({ expiresAt }, clientOrderId) => {
        if (expiresAt <= now || confirmedClientOrderIds.has(clientOrderId)) {
          pendingMarketOrdersRef.current.delete(clientOrderId);
        }
      });
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
      commitAccount(normalizeToolboxAccount(unwrapData(accountBody), accountRef.current));

      const metricsBody = await metricsPromise;
      if (seq !== refreshSeqRef.current || controller.signal.aborted) return;
      if (metricsBody) {
        commitAccount(normalizeToolboxAccount(
          { ...(unwrapData(accountBody) ?? {}), ...(unwrapData(metricsBody) ?? {}) },
          accountRef.current,
        ));
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
      const pnl = toNumber(position.profit ?? position.unrealizedPnL, 0);
      return mode === 'WINNERS' ? pnl <= 0 : pnl >= 0;
    });
    const retainedTickets = new Set(retained.map((position) => position.id));
    retainedImmediatePositionsRef.current.forEach((_value, ticket) => {
      if (!retainedTickets.has(ticket)) retainedImmediatePositionsRef.current.delete(ticket);
    });
    commitPositions(retained);
  }, [commitPositions]);

  useEffect(() => {
    const sessionChanged = stateSessionKeyRef.current !== sessionKey;
    if (sessionChanged) {
      stateSessionKeyRef.current = sessionKey;
      accountRef.current = null;
      positionsRef.current = [];
      pendingMarketOrdersRef.current.clear();
      setState({
        ...INITIAL_STATE,
        login: readLogin(),
        restBaseUrl: getBrokerRestBaseUrl(),
        loading: Boolean(readLogin()),
      });
    }
    retainedImmediatePositionsRef.current.clear();
    optimisticallyClosedPositionsRef.current.clear();
    const nextPlacementScope = getCommittedBrokerAccountSessionScopeKey(
      getCommittedBrokerAccountSessionScope(),
    );
    if (placementSessionScopeRef.current !== nextPlacementScope) {
      placementSessionScopeRef.current = nextPlacementScope;
      pendingMarketOrdersRef.current.clear();
      setState((prev) => ({ ...prev, pendingPositions: [] }));
    }
    return () => {
      activeRefreshControllerRef.current?.abort();
    };
  }, [sessionKey]);

  useEffect(() => {
    const login = readLogin();
    const storeLogin = Number.parseInt(String(storeAccountId ?? ''), 10);
    if (!login || storeLogin !== login) return;

    commitAccount(centralAccount);
    const nextPositions = replaceToolboxPositions(
      positionsRef.current,
      Array.isArray(centralPositions) ? centralPositions : [],
    );
    const previousSig = positionsSignature(positionsRef.current);
    const nextSig = positionsSignature(nextPositions);
    positionsRef.current = nextPositions;
    setState((prev) => ({
      ...prev,
      account: centralAccount,
      positions: previousSig === nextSig ? prev.positions : nextPositions,
      loading: false,
      error: null,
      login,
      restBaseUrl: getBrokerRestBaseUrl(),
      wsState: 'connected',
    }));
  }, [centralAccount, centralPositions, commitAccount, storeAccountId]);

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
        ticketIds.forEach((ticket) => {
          const existing = optimisticallyClosedPositionsRef.current.get(ticket);
          if (existing) {
            optimisticallyClosedPositionsRef.current.set(ticket, {
              ...existing,
              status: 'confirmed',
              expiresAt: Date.now() + IMMEDIATE_POSITION_RETENTION_MS,
            });
          }
          retainedImmediatePositionsRef.current.delete(ticket);
        });
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

  const visibleState = stateSessionKeyRef.current === sessionKey
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
