import { apiClient } from './client';
import type { Account, Position, Trade } from '../store/useAppStore';
import { API_HISTORY_BASE_URL, API_V2_BASE_URL, RTX5_WS_URL } from '../config/api';

export type GatewayAccount = {
  login?: number;
  name?: string;
  currency?: string;
  leverage?: number;
  group?: string;
  balance?: number;
  credit?: number;
  equity?: number;
  margin?: number;
  margin_free?: number;
  margin_level?: number;
  floating?: number;
  status?: string;
  created_at?: number;
};

export type GatewayPosition = {
  ticket?: number;
  position_id?: number;
  account_login?: number;
  symbol?: string;
  side?: string;
  action?: string | number;
  volume?: number;
  volume_lots?: number;
  price_open?: number;
  open_price?: number;
  price_current?: number;
  current_price?: number;
  price_sl?: number | null;
  sl?: number | null;
  price_tp?: number | null;
  tp?: number | null;
  profit?: number;
  swap?: number;
  storage?: number;
  commission?: number;
  time_create?: number;
  time_ms?: number;
  time?: number;
  comment?: string;
};

export type GatewayDeal = {
  ticket?: number;
  deal?: number;
  order_ticket?: number;
  order?: number;
  position_ticket?: number;
  account_login?: number;
  symbol?: string;
  action?: string;
  type?: string;
  entry?: string;
  volume?: number;
  price?: number;
  profit?: number;
  swap?: number;
  commission?: number;
  fee?: number;
  comment?: string;
  time?: number;
  time_ms?: number;
};

export type GatewayClosedPosition = GatewayPosition & {
  price_close?: number;
  reason?: string;
  duration_seconds?: number;
  time_close?: number;
};

export type GatewayOrder = {
  ticket?: number;
  account_login?: number;
  symbol?: string;
  type?: string;
  side?: string;
  volume?: number;
  price?: number;
  price_sl?: number | null;
  price_tp?: number | null;
  status?: string;
  comment?: string;
  time_create?: number;
  magic?: number;
};

export type TradeGatewaySnapshot = {
  account: Account | null;
  positions: Position[];
  deals: Trade[];
};

export const getStoredAccountLogin = (): number | null => {
  if (typeof window === 'undefined') return null;

  const candidates = [
    localStorage.getItem('rtx_saved_username'),
    localStorage.getItem('rtx_last_login'),
    localStorage.getItem('account_login'),
  ];

  for (const candidate of candidates) {
    const parsed = Number.parseInt(candidate || '', 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const token = localStorage.getItem('auth_token');
  if (!token) return null;

  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    const parsed = Number.parseInt(
      String(payload.account_login ?? payload.login ?? ''),
      10
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const toIsoFromSeconds = (value?: number): string => {
  if (!value) return '';
  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(ms).toISOString();
};

const numberOr = (value: unknown, fallback: number): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

export const normalizeAccount = (raw: GatewayAccount | any, previous?: Account | null): Account => ({
  balance: numberOr(raw?.balance, previous?.balance ?? 0),
  equity: numberOr(raw?.equity ?? raw?.balance, previous?.equity ?? previous?.balance ?? 0),
  margin: numberOr(raw?.margin ?? raw?.margin_used, previous?.margin ?? 0),
  freeMargin: numberOr(raw?.margin_free ?? raw?.free_margin ?? raw?.margin_available, previous?.freeMargin ?? 0),
  unrealizedPL: numberOr(raw?.floating ?? raw?.profit ?? raw?.unrealized_pl, previous?.unrealizedPL ?? 0),
  marginLevel: numberOr(raw?.margin_level ?? raw?.marginLevel, previous?.marginLevel ?? 0),
  currency: raw?.currency ?? previous?.currency ?? 'USD',
  leverage: numberOr(raw?.leverage, previous?.leverage ?? 100),
});

export const normalizePosition = (raw: GatewayPosition): Position => {
  const side = String(raw.side ?? raw.action ?? '').toLowerCase();
  return {
    id: Number(raw.ticket ?? raw.position_id ?? 0),
    symbol: (raw.symbol ?? '').toUpperCase(),
    side: side.includes('sell') || side === '1' ? 'SELL' : 'BUY',
    volume: Number(raw.volume_lots ?? raw.volume ?? 0),
    openPrice: Number(raw.price_open ?? raw.open_price ?? 0),
    currentPrice: Number(raw.price_current ?? raw.current_price ?? raw.price_open ?? 0),
    openTime: toIsoFromSeconds(raw.time_create ?? raw.time_ms ?? raw.time),
    sl: Number(raw.price_sl ?? raw.sl ?? 0),
    tp: Number(raw.price_tp ?? raw.tp ?? 0),
    swap: Number(raw.swap ?? raw.storage ?? 0),
    commission: Number(raw.commission ?? 0),
    unrealizedPnL: Number(raw.profit ?? 0),
    comment: raw.comment ?? '',
  };
};

export const normalizeDeal = (raw: GatewayDeal, index = 0): Trade => {
  const action = String(raw.action ?? raw.type ?? '').toLowerCase();
  const entry = String(raw.entry ?? '').toLowerCase();
  const side = action.includes('sell') ? 'SELL' : action.includes('buy') ? 'BUY' : action.toUpperCase();
  const time = raw.time_ms ?? raw.time;
  return {
    id: Number(raw.ticket ?? raw.deal ?? raw.position_ticket ?? index),
    symbol: raw.symbol ?? '',
    type: entry || action || 'deal',
    side,
    volume: Number(raw.volume ?? 0),
    openPrice: Number(raw.price ?? 0),
    closePrice: Number(raw.price ?? 0),
    openTime: toIsoFromSeconds(time),
    closeTime: toIsoFromSeconds(time),
    profit: Number(raw.profit ?? 0),
    commission: Number(raw.commission ?? 0),
    swap: Number(raw.swap ?? 0),
  };
};

export const normalizeClosedPosition = (raw: GatewayClosedPosition, index = 0): Trade => {
  const side = String(raw.side ?? raw.action ?? '').toLowerCase();
  return {
    id: Number(raw.ticket ?? raw.position_id ?? index),
    symbol: raw.symbol ?? '',
    type: raw.reason ?? 'closed_position',
    side: side.includes('sell') || side === '1' ? 'SELL' : 'BUY',
    volume: Number(raw.volume_lots ?? raw.volume ?? 0),
    openPrice: Number(raw.price_open ?? raw.open_price ?? 0),
    closePrice: Number(raw.price_close ?? raw.price_current ?? raw.current_price ?? 0),
    openTime: toIsoFromSeconds(raw.time_create ?? raw.time_ms ?? raw.time),
    closeTime: toIsoFromSeconds(raw.time_close ?? raw.time_ms ?? raw.time),
    profit: Number(raw.profit ?? 0),
    commission: Number(raw.commission ?? 0),
    swap: Number(raw.swap ?? raw.storage ?? 0),
  };
};

export const normalizeOrder = (raw: GatewayOrder, index = 0): Trade => {
  const side = String(raw.side ?? raw.type ?? '').toLowerCase();
  const time = raw.time_create;
  return {
    id: Number(raw.ticket ?? index),
    symbol: raw.symbol ?? '',
    type: raw.status ?? raw.type ?? 'order',
    side: side.includes('sell') ? 'SELL' : side.includes('buy') ? 'BUY' : side.toUpperCase(),
    volume: Number(raw.volume ?? 0),
    openPrice: Number(raw.price ?? 0),
    closePrice: Number(raw.price ?? 0),
    openTime: toIsoFromSeconds(time),
    closeTime: toIsoFromSeconds(time),
    profit: 0,
    commission: 0,
    swap: 0,
  };
};

const ARRAY_WRAPPER_KEYS = ['data', 'items', 'results'] as const;

const arrayFrom = <T>(data: unknown, key?: string): T[] => {
  const extract = (value: unknown, depth = 0): T[] => {
    if (Array.isArray(value)) return value as T[];
    if (!value || typeof value !== 'object' || depth > ARRAY_WRAPPER_KEYS.length) return [];

    const record = value as Record<string, unknown>;
    if (key && Array.isArray(record[key])) return record[key] as T[];

    for (const wrapperKey of ARRAY_WRAPPER_KEYS) {
      const nested = extract(record[wrapperKey], depth + 1);
      if (nested.length > 0) return nested;
    }

    return [];
  };

  return extract(data);
};

export const tradeGatewayApi = {
  getWsUrl(): string {
    return RTX5_WS_URL;
  },

  getHistoryUrl(symbol: string, timeframe = 'H1', count = 500): string {
    const params = new URLSearchParams({ tf: timeframe, count: String(count) });
    return `${API_HISTORY_BASE_URL}/candles/${encodeURIComponent(symbol)}?${params}`;
  },

  async getAccount(login: number): Promise<Account> {
    const data = await apiClient.get<GatewayAccount>(`/account/${login}`, { baseUrl: API_V2_BASE_URL });
    return normalizeAccount(data);
  },

  async getPositions(login: number): Promise<Position[]> {
    const data = await apiClient.get<GatewayPosition[] | { positions: GatewayPosition[] }>(
      `/positions/${login}`,
      { baseUrl: API_V2_BASE_URL, params: { limit: 500, offset: 0 } }
    );
    return arrayFrom<GatewayPosition>(data, 'positions').map(normalizePosition);
  },

  async getDeals(login?: number): Promise<Trade[]> {
    const endpoint = login ? `/deals/${login}` : '/account/deals';
    const data = await apiClient.get<GatewayDeal[] | { deals: GatewayDeal[] }>(endpoint, {
      baseUrl: API_V2_BASE_URL,
      params: { limit: 500, offset: 0 },
    });
    return arrayFrom<GatewayDeal>(data, 'deals').map(normalizeDeal);
  },

  async getClosedPositions(login: number): Promise<Trade[]> {
    const data = await apiClient.get<GatewayClosedPosition[] | { positions: GatewayClosedPosition[] }>(
      `/positions/${login}/history`,
      { baseUrl: API_V2_BASE_URL, params: { limit: 500, offset: 0 } }
    );
    return arrayFrom<GatewayClosedPosition>(data, 'positions').map(normalizeClosedPosition);
  },

  async getOrders(login?: number): Promise<Trade[]> {
    const endpoint = login ? `/orders/${login}` : '/account/orders';
    const data = await apiClient.get<GatewayOrder[] | { orders: GatewayOrder[] }>(endpoint, {
      baseUrl: API_V2_BASE_URL,
      params: { limit: 500, offset: 0 },
    });
    return arrayFrom<GatewayOrder>(data, 'orders').map(normalizeOrder);
  },

  async getOrderHistory(login: number): Promise<Trade[]> {
    const [closedPositions, deals, orders] = await Promise.all([
      this.getClosedPositions(login).catch(() => []),
      this.getDeals(login).catch(() => []),
      this.getOrders(login).catch(() => []),
    ]);
    const merged = [...closedPositions, ...deals, ...orders];
    const seen = new Set<string>();
    return merged
      .filter((trade) => {
        const key = `${trade.type}:${trade.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Date.parse(b.closeTime ?? b.openTime) - Date.parse(a.closeTime ?? a.openTime))
      .slice(0, 500);
  },

  async getBalanceHistory(login: number, limit = 10) {
    return apiClient.get<any[]>(`/accounts/${login}/history`, {
      baseUrl: API_V2_BASE_URL,
      params: { limit, offset: 0 },
    });
  },

  async updateAccount() {
    throw new Error('Account updates are not supported by the trade-facing API contract');
  },
};
