import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Account, Position } from '../store/useAppStore';
import { getStoredAccountLogin, normalizePosition } from '../api/tradeGateway';
import { buildBrokerWsV2Uri, getAccessToken, getServerUrl } from '../services/brokerSession';
import { useAppStore } from '../store/useAppStore';

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
};

export type ToolboxTradeDebugEvent = {
  at: number;
  source: 'rest' | 'ws' | 'session';
  message: string;
};

type ToolboxTradeState = {
  account: Account | null;
  positions: ToolboxTradePosition[];
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
const RECONNECT_MS = 3000;

const toNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const hasFiniteValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return false;
  return Number.isFinite(Number(value));
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
  const freeMarginRaw = data.free_margin ?? data.margin_free ?? data.freeMargin ?? data.margin_available;
  const marginLevelRaw = data.margin_level ?? data.marginLevel;
  const creditRaw = data.credit ?? data.credit_bonus ?? data.bonus;
  const hasBackendEquity = hasFiniteValue(data.equity);
  const hasBackendFreeMargin = hasFiniteValue(freeMarginRaw);
  const hasBackendMarginLevel = hasFiniteValue(marginLevelRaw);

  return {
    balance: toNumber(data.balance, previous?.balance ?? 0),
    equity: hasBackendEquity
      ? toNumber(data.equity, previous?.equity ?? previous?.balance ?? 0)
      : toNumber(previous?.equity ?? data.balance, previous?.balance ?? 0),
    margin: toNumber(data.used_margin ?? data.margin_used ?? data.margin ?? data.marginUsed, previous?.margin ?? 0),
    freeMargin: hasBackendFreeMargin ? toNumber(freeMarginRaw, previous?.freeMargin ?? 0) : toNumber(previous?.freeMargin, 0),
    unrealizedPL: toNumber(
      data.floating_pnl ?? data.floating ?? data.profit ?? data.unrealized_pl ?? data.unrealizedPL,
      previous?.unrealizedPL ?? 0,
    ),
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
    if (!hasProfitPatch && price !== existing.currentPrice) {
      next.hasBackendProfit = false;
    }
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
  return rawPositions
    .map(normalizeToolboxPosition)
    .filter((position) => position.id > 0)
    .sort((a, b) => b.id - a.id)
    .map((position) => {
      const previous = previousByTicket.get(position.id);
      return previous && positionSignature(previous) === positionSignature(position) ? previous : position;
    });
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

const patchPositionsFromTick = (
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
      hasBackendProfit: false,
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

const extractPositionUpdates = (message: any): any[] => {
  const payload = message?.data ?? message?.payload ?? message;
  const nested = payload?.data ?? payload;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(nested?.positions)) return nested.positions;
  if (payload?.position) return [payload.position];
  if (payload?.closed_position) return [payload.closed_position];
  if (getPositionTicket(payload)) return [payload];
  return [];
};

const getCloseTickets = (message: any): number[] => {
  const payload = message?.data ?? message?.payload ?? message;
  const eventName = String(
    message?.event ?? message?.type ?? payload?.event ?? payload?.type ?? payload?.data?.type ?? '',
  ).toLowerCase();
  const isCloseEvent = ['close', 'closed', 'sl_hit', 'tp_hit', 'stop_out', 'delete'].some((item) => eventName.includes(item));
  if (!isCloseEvent) return [];
  return extractPositionUpdates(message).map(getPositionTicket).filter(Boolean);
};

const openSymbolsFromPositions = (positions: ToolboxTradePosition[]): string[] => (
  Array.from(new Set(positions.map((position) => String(position.symbol ?? '').toUpperCase()).filter(Boolean)))
);

const readLogin = (): number | null => {
  const direct = getStoredAccountLogin();
  if (direct) return direct;
  const storeLogin = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
  return Number.isFinite(storeLogin) && storeLogin > 0 ? storeLogin : null;
};

const getBrokerRestBaseUrl = (): string => {
  const serverUrl = getServerUrl();
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v2` : '';
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
  const [state, setState] = useState<ToolboxTradeState>(INITIAL_STATE);

  const accountRef = useRef<Account | null>(null);
  const positionsRef = useRef<ToolboxTradePosition[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const subscribedChannelsRef = useRef<Set<string>>(new Set());
  const disposedRef = useRef(false);
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

  const sendWsMessage = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }, []);

  const syncTickSubscriptions = useCallback((positions: ToolboxTradePosition[]) => {
    const desired = new Set(openSymbolsFromPositions(positions).map((symbol) => `ticks.${symbol}`));
    const current = subscribedChannelsRef.current;

    desired.forEach((channel) => {
      if (!current.has(channel) && sendWsMessage({ action: 'subscribe', channel })) {
        current.add(channel);
      }
    });

    Array.from(current).forEach((channel) => {
      if (!channel.startsWith('ticks.')) return;
      if (desired.has(channel)) return;
      if (sendWsMessage({ action: 'unsubscribe', channel })) {
        current.delete(channel);
      }
    });
  }, [sendWsMessage]);

  const commitPositions = useCallback((positions: ToolboxTradePosition[]) => {
    const previousSig = positionsSignature(positionsRef.current);
    const nextSig = positionsSignature(positions);
    positionsRef.current = positions;
    syncTickSubscriptions(positions);
    if (previousSig === nextSig) return;
    setState((prev) => ({ ...prev, positions }));
  }, [syncTickSubscriptions]);

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
      const [accountBody, metricsBody, positionsBody] = await Promise.all([
        requestBrokerJson<any>(restBaseUrl, `/account/${login}`, undefined, controller.signal),
        requestBrokerJson<any>(restBaseUrl, `/account/${login}/metrics`, undefined, controller.signal).catch(() => null),
        requestBrokerJson<any>(restBaseUrl, `/positions/${login}`, { limit: 50, offset: 0 }, controller.signal),
      ]);

      if (seq !== refreshSeqRef.current || controller.signal.aborted) return;

      const mergedAccount = normalizeToolboxAccount(
        { ...(unwrapData(accountBody) ?? {}), ...(unwrapData(metricsBody) ?? {}) },
        accountRef.current,
      );
      const rawPositions = arrayFrom(positionsBody, 'positions');
      commitAccount(mergedAccount);
      commitPositions(replaceToolboxPositions(positionsRef.current, rawPositions));

      setState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        lastRestAt: Date.now(),
      }));
      pushDebug({
        at: Date.now(),
        source: 'rest',
        message: `Loaded account ${login}, ${rawPositions.length} open position(s) from ${restBaseUrl}`,
      });
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
    commitPositions(positionsRef.current.filter((position) => position.id !== ticket));
  }, [commitPositions]);

  const removePositionsByMode = useCallback((mode: 'ALL' | 'WINNERS' | 'LOSERS') => {
    const current = positionsRef.current;
    if (mode === 'ALL') {
      commitPositions([]);
      return;
    }
    commitPositions(current.filter((position) => {
      const pnl = toNumber(position.profit ?? position.unrealizedPnL, 0);
      return mode === 'WINNERS' ? pnl <= 0 : pnl >= 0;
    }));
  }, [commitPositions]);

  useEffect(() => {
    disposedRef.current = false;
    void refresh();
    return () => {
      activeRefreshControllerRef.current?.abort();
    };
  }, [refresh, sessionKey]);

  useEffect(() => {
    disposedRef.current = false;
    const handleForceRefresh = () => {
      void refresh();
    };
    window.addEventListener('rtx:force-refresh-positions', handleForceRefresh);
    window.addEventListener('rtx:toolbox-trade-refresh', handleForceRefresh);
    return () => {
      window.removeEventListener('rtx:force-refresh-positions', handleForceRefresh);
      window.removeEventListener('rtx:toolbox-trade-refresh', handleForceRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    const login = readLogin();
    const restBaseUrl = getBrokerRestBaseUrl();
    const token = getAccessToken();

    if (!login || !restBaseUrl || !token) {
      setState((prev) => ({
        ...prev,
        login,
        wsUrl: '',
        wsState: 'idle',
      }));
      return;
    }

    let disposed = false;
    disposedRef.current = false;

    const closeSocket = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Toolbox Trade tab reconnecting');
        } catch {
          // ignore close errors
        }
        wsRef.current = null;
      }
      subscribedChannelsRef.current.clear();
    };

    const subscribeBaseChannels = () => {
      const channels = [`positions.${login}`, `metrics.${login}`, `account.${login}`];
      channels.forEach((channel) => {
        if (sendWsMessage({ action: 'subscribe', channel })) {
          subscribedChannelsRef.current.add(channel);
        }
      });
      syncTickSubscriptions(positionsRef.current);
      pushDebug({ at: Date.now(), source: 'ws', message: `Subscribed ${channels.join(', ')}` });
    };

    const handleMessage = (event: MessageEvent) => {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const channel = String(message?.channel ?? message?.topic ?? '');
      if (!channel || message?.type === 'subscribed' || message?.type === 'pong') return;

      if (channel.startsWith(`positions.${login}`)) {
        const closeTickets = getCloseTickets(message);
        const updates = extractPositionUpdates(message);
        if (closeTickets.length > 0 || updates.length > 0) {
          const next = patchToolboxPositions(positionsRef.current, updates, closeTickets);
          commitPositions(next);
          setState((prev) => ({ ...prev, lastWsAt: Date.now() }));
        }
        return;
      }

      if (channel.startsWith(`metrics.${login}`) || channel.startsWith(`account.${login}`)) {
        const account = normalizeToolboxAccount(message, accountRef.current);
        commitAccount(account);
        setState((prev) => ({ ...prev, lastWsAt: Date.now() }));
        return;
      }

      if (channel.startsWith('ticks.')) {
        const payload = message?.data ?? message?.payload ?? message;
        const tick = { ...payload, symbol: payload?.symbol ?? channel.split('.')[1] };
        const next = patchPositionsFromTick(positionsRef.current, tick);
        if (next !== positionsRef.current) {
          commitPositions(next);
          setState((prev) => ({ ...prev, lastWsAt: Date.now() }));
        }
      }
    };

    const connect = () => {
      if (disposed) return;

      const wsUrl = buildBrokerWsV2Uri(token);
      setState((prev) => ({
        ...prev,
        wsUrl: wsUrl.replace(/token=[^&]+/i, 'token=***'),
        wsState: 'connecting',
      }));

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (disposed) return;
          setState((prev) => ({ ...prev, wsState: 'connected' }));
          pushDebug({ at: Date.now(), source: 'ws', message: `Connected to ${wsUrl.replace(/token=[^&]+/i, 'token=***')}` });
          subscribeBaseChannels();
        };

        ws.onmessage = handleMessage;

        ws.onerror = () => {
          if (disposed) return;
          setState((prev) => ({ ...prev, wsState: 'error' }));
          pushDebug({ at: Date.now(), source: 'ws', message: 'WebSocket error' });
        };

        ws.onclose = () => {
          if (disposed) return;
          subscribedChannelsRef.current.clear();
          setState((prev) => ({ ...prev, wsState: 'disconnected' }));
          reconnectTimerRef.current = window.setTimeout(connect, RECONNECT_MS);
          pushDebug({ at: Date.now(), source: 'ws', message: `Disconnected; reconnecting in ${RECONNECT_MS}ms` });
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'WebSocket connect failed';
        setState((prev) => ({ ...prev, wsState: 'error', error: message }));
        pushDebug({ at: Date.now(), source: 'ws', message });
      }
    };

    closeSocket();
    connect();

    return () => {
      disposed = true;
      closeSocket();
    };
  }, [commitAccount, commitPositions, pushDebug, sendWsMessage, sessionKey, syncTickSubscriptions]);

  return {
    ...state,
    refresh,
    removePosition,
    removePositionsByMode,
  };
}
