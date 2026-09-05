import { apiClient } from './client';
import type { Account, Position, Trade } from '../store/useAppStore';
import { API_V2_BASE_URL, RTX5_WS_URL } from '../config/api';
import { debugLog, redactUrlForDebugLog } from '../utils/debugLogging';
import { decodeJwtPayload } from '../utils/jwt';
import { resolvePositionOpenTime } from '../services/tradePositionTime';
import { enrichTradesWithCachedLevels } from '../utils/tradeHistoryLevelCache';
import { normalizeCandleApiQueryParams } from '../utils/candleApi';

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
  used_margin?: number;
  margin_used?: number;
  margin_free?: number;
  free_margin?: number;
  margin_available?: number;
  margin_level?: number;
  marginLevel?: number;
  floating?: number;
  floating_pnl?: number;
  profit?: number;
  unrealized_pl?: number;
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
  time_create_msc?: number;
  time_open?: number;
  time_msc?: number;
  time_ms?: number;
  time?: number;
  comment?: string;
};

export type GatewayDeal = {
  ticket?: number;
  deal?: number;
  order_ticket?: number | null;
  order?: number;
  position_ticket?: number;
  position_id?: number;
  position?: number;
  account_login?: number;
  symbol?: string;
  action?: string | number;
  type?: string | number;
  entry?: string | number;
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
  time_open?: number;
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
  price_open?: number;
  open_price?: number;
  price_sl?: number | null;
  price_tp?: number | null;
  status?: string;
  comment?: string;
  time_create?: number;
  time_setup?: number;
  time_done?: number;
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

  // NOTE: this claim is read from an UNVERIFIED token (the client cannot check
  // the signature) and is used only as a best-effort hint. The gateway remains
  // the sole authority for which account a token may act on.
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const parsed = Number.parseInt(
    String(payload.account_login ?? payload.login ?? ''),
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toIsoFromSeconds = (value?: number | string | null): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  return new Date(ms).toISOString();
};

const numberOr = (value: unknown, fallback: number): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const finiteNumberOrUndefined = (value: unknown): number | undefined => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : undefined;
};

const historyTime = (trade: Trade): number => {
  const parsed = Date.parse(trade.closeTime || trade.openTime || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDealEntryKind = (value: unknown): string => {
  const entry = String(value ?? '').trim().toLowerCase();
  if (entry === '0') return 'entry_in';
  if (entry === '1' || entry === '3') return 'entry_out';
  if (entry === '2') return 'entry_inout';
  return entry;
};

const dealEntryKind = (trade: Trade): string =>
  normalizeDealEntryKind(trade.entry) || String(trade.type ?? '').trim().toLowerCase();

const isEntryInDeal = (trade: Trade): boolean => {
  const entry = dealEntryKind(trade);
  return entry === 'entry_in' || entry === 'in' || entry.endsWith('_in');
};

const isEntryOutDeal = (trade: Trade): boolean => {
  const entry = dealEntryKind(trade);
  return entry === 'entry_out' || entry === 'out' || entry.endsWith('_out');
};

const isEntryInOutDeal = (trade: Trade): boolean => {
  const entry = dealEntryKind(trade);
  return entry === 'entry_inout' || entry === 'inout' || entry.endsWith('_inout');
};

const isClosedHistoryTrade = (trade: Trade): boolean => {
  const status = String(trade.status ?? '').toLowerCase();
  const type = String(trade.type ?? '').toLowerCase();
  return (
    status === 'closed' ||
    type === 'closed' ||
    type === 'closed_position' ||
    isEntryOutDeal(trade) ||
    isEntryInOutDeal(trade)
  );
};

const historyPositionKey = (trade: Trade): string | null => {
  const positionId = finiteNumberOrUndefined(trade.positionId);
  if (positionId) return `${trade.symbol}:position:${positionId}`;

  const looksLikePositionRow = trade.type === 'closed_position' || trade.type === 'closed';
  if (looksLikePositionRow && finiteNumberOrUndefined(trade.id)) {
    return `${trade.symbol}:position:${trade.id}`;
  }

  return null;
};

const sortDealsChronologically = (deals: Trade[]): Trade[] =>
  deals
    .map((deal, index) => ({ deal, index }))
    .sort((a, b) => historyTime(a.deal) - historyTime(b.deal) || a.index - b.index)
    .map(({ deal }) => deal);

const asStandaloneClosedDeal = (deal: Trade): Trade => ({
  ...deal,
  status: 'closed',
  historySource: 'deal',
});

const buildClosedDealHistoryTrade = (groupDeals: Trade[], id: number): Trade | null => {
  const sorted = sortDealsChronologically(groupDeals);
  const openingDeal = sorted.find(isEntryInDeal) ?? sorted.find(isEntryInOutDeal);
  const closingDeals = sorted.filter((deal) => isEntryOutDeal(deal) || isEntryInOutDeal(deal));
  const closingDeal = closingDeals.at(-1);
  if (!openingDeal || !closingDeal) return null;

  const profit = sorted.reduce((sum, deal) => sum + Number(deal.profit ?? 0), 0);
  const commission = sorted.reduce((sum, deal) => sum + Number(deal.commission ?? 0), 0);
  const swap = sorted.reduce((sum, deal) => sum + Number(deal.swap ?? 0), 0);
  const closedVolume = closingDeals.reduce((sum, deal) => sum + Number(deal.volume ?? 0), 0);

  return {
    ...openingDeal,
    id,
    type: 'closed',
    status: 'closed',
    side: openingDeal.side || closingDeal.side || '',
    volume: closedVolume || openingDeal.volume || closingDeal.volume || 0,
    openPrice: openingDeal.openPrice,
    closePrice: closingDeal.closePrice ?? closingDeal.openPrice,
    openTime: openingDeal.openTime,
    closeTime: closingDeal.closeTime || closingDeal.openTime,
    profit,
    commission,
    swap,
    historySource: 'deal',
  };
};

const normalizedTradeSymbol = (trade: Trade): string =>
  String(trade.symbol ?? '').trim().toUpperCase();

const areOppositeExecutionSides = (openingDeal: Trade, closingDeal: Trade): boolean => {
  const openingSide = String(openingDeal.side ?? '').trim().toUpperCase();
  const closingSide = String(closingDeal.side ?? '').trim().toUpperCase();
  return (
    (openingSide === 'BUY' && closingSide === 'SELL') ||
    (openingSide === 'SELL' && closingSide === 'BUY')
  );
};

const isCompatibleUnkeyedDealPair = (openingDeal: Trade, closingDeal: Trade): boolean => {
  const openingSymbol = normalizedTradeSymbol(openingDeal);
  const closingSymbol = normalizedTradeSymbol(closingDeal);
  const openingTime = historyTime(openingDeal);
  const closingTime = historyTime(closingDeal);
  const openingVolume = Number(openingDeal.volume);
  const closingVolume = Number(closingDeal.volume);

  return (
    openingSymbol.length > 0 &&
    openingSymbol === closingSymbol &&
    areOppositeExecutionSides(openingDeal, closingDeal) &&
    openingTime > 0 &&
    closingTime > 0 &&
    openingTime <= closingTime &&
    Number.isFinite(openingVolume) &&
    Number.isFinite(closingVolume) &&
    openingVolume > 0 &&
    closingVolume > 0 &&
    openingVolume + 1e-12 >= closingVolume
  );
};

export const collapseDealHistory = (deals: Trade[]): Trade[] => {
  const explicitPositionGroups = new Map<string, Trade[]>();
  const unkeyedEntryDeals: Trade[] = [];
  const closedHistory: Trade[] = [];

  for (const deal of deals) {
    const isMtEntry = isEntryInDeal(deal) || isEntryOutDeal(deal) || isEntryInOutDeal(deal);
    const positionId = finiteNumberOrUndefined(deal.positionId);

    if (isMtEntry && positionId) {
      const key = `${deal.symbol}:position:${positionId}`;
      const existing = explicitPositionGroups.get(key) ?? [];
      existing.push(deal);
      explicitPositionGroups.set(key, existing);
      continue;
    }

    if (isMtEntry) {
      unkeyedEntryDeals.push(deal);
      continue;
    }

    closedHistory.push(deal);
  }

  for (const groupDeals of explicitPositionGroups.values()) {
    const positionId = finiteNumberOrUndefined(groupDeals[0]?.positionId);
    const collapsed = positionId
      ? buildClosedDealHistoryTrade(groupDeals, positionId)
      : null;

    if (collapsed) {
      closedHistory.push(collapsed);
      continue;
    }

    for (const closingDeal of groupDeals.filter(isEntryOutDeal)) {
      closedHistory.push(asStandaloneClosedDeal(closingDeal));
    }
  }

  const unmatchedOpenings: Trade[] = [];
  for (const deal of sortDealsChronologically(unkeyedEntryDeals)) {
    if (isEntryInOutDeal(deal)) {
      const collapsed = buildClosedDealHistoryTrade([deal], deal.id);
      if (collapsed) closedHistory.push(collapsed);
      continue;
    }

    if (isEntryInDeal(deal)) {
      unmatchedOpenings.push(deal);
      continue;
    }

    if (!isEntryOutDeal(deal)) continue;

    let openingIndex = -1;
    for (let index = unmatchedOpenings.length - 1; index >= 0; index -= 1) {
      if (isCompatibleUnkeyedDealPair(unmatchedOpenings[index], deal)) {
        openingIndex = index;
        break;
      }
    }

    if (openingIndex < 0) {
      closedHistory.push(asStandaloneClosedDeal(deal));
      continue;
    }

    const [openingDeal] = unmatchedOpenings.splice(openingIndex, 1);
    const collapsed = buildClosedDealHistoryTrade([openingDeal, deal], openingDeal.id);
    if (collapsed) closedHistory.push(collapsed);
  }

  return closedHistory;
};

export const normalizeAccount = (raw: GatewayAccount, previous?: Account | null): Account => ({
  balance: numberOr(raw?.balance, previous?.balance ?? 0),
  equity: numberOr(raw?.equity ?? raw?.balance, previous?.equity ?? previous?.balance ?? 0),
  margin: numberOr(raw?.used_margin ?? raw?.margin_used ?? raw?.margin, previous?.margin ?? 0),
  freeMargin: numberOr(raw?.margin_free ?? raw?.free_margin ?? raw?.margin_available, previous?.freeMargin ?? 0),
  unrealizedPL: numberOr(raw?.floating_pnl ?? raw?.floating ?? raw?.profit ?? raw?.unrealized_pl, previous?.unrealizedPL ?? 0),
  marginLevel: numberOr(raw?.margin_level ?? raw?.marginLevel, previous?.marginLevel ?? 0),
  currency: raw?.currency ?? previous?.currency ?? 'USD',
  leverage: numberOr(raw?.leverage, previous?.leverage ?? 100),
});

export const normalizePosition = (raw: GatewayPosition): Position => {
  const side = String(raw.side ?? raw.action ?? '').toLowerCase();
  const volume = Number(raw.volume_lots ?? raw.volume ?? 0);
  const openPrice = Number(raw.price_open ?? raw.open_price ?? 0);
  const currentPrice = Number(raw.price_current ?? raw.current_price ?? raw.price_open ?? 0);
  const profit = Number(raw.profit ?? 0);
  return {
    id: Number(raw.ticket ?? raw.position_id ?? 0),
    symbol: (raw.symbol ?? '').toUpperCase(),
    side: side.includes('sell') || side === '1' ? 'SELL' : 'BUY',
    volume,
    openPrice,
    currentPrice,
    openTime: resolvePositionOpenTime(raw),
    sl: Number(raw.price_sl ?? raw.sl ?? 0),
    tp: Number(raw.price_tp ?? raw.tp ?? 0),
    swap: Number(raw.swap ?? raw.storage ?? 0),
    commission: Number(raw.commission ?? 0),
    unrealizedPnL: profit,
    comment: raw.comment ?? '',
    open_price: openPrice,
    current_price: currentPrice,
    profit,
    quantity: volume,
  };
};

export const normalizeDeal = (raw: GatewayDeal, index = 0): Trade => {
  const action = String(raw.action ?? raw.type ?? '').toLowerCase();
  const entry = normalizeDealEntryKind(raw.entry);
  const side = action.includes('sell') || action === '1'
    ? 'SELL'
    : action.includes('buy') || action === '0'
      ? 'BUY'
      : action.toUpperCase();
  const time = raw.time_ms ?? raw.time;
  const dealTicket = finiteNumberOrUndefined(raw.ticket ?? raw.deal ?? index);
  const positionId = finiteNumberOrUndefined(raw.position_ticket ?? raw.position_id ?? raw.position);
  return {
    id: dealTicket ?? positionId ?? index,
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
    positionId,
    orderTicket: finiteNumberOrUndefined(raw.order_ticket ?? raw.order),
    dealTicket,
    entry: entry || undefined,
    historySource: 'deal',
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
    openTime: toIsoFromSeconds(raw.time_open ?? raw.time_create ?? raw.time_ms ?? raw.time),
    closeTime: toIsoFromSeconds(raw.time_close ?? raw.time_ms ?? raw.time),
    profit: Number(raw.profit ?? 0),
    commission: Number(raw.commission ?? 0),
    swap: Number(raw.swap ?? raw.storage ?? 0),
    sl: Number(raw.price_sl ?? raw.sl ?? 0),
    tp: Number(raw.price_tp ?? raw.tp ?? 0),
    status: 'closed',
    historySource: 'closed-position',
  };
};

export const normalizeOrder = (raw: GatewayOrder, index = 0): Trade => {
  const side = String(raw.side ?? raw.type ?? '').toLowerCase();
  const setupTime = raw.time_setup ?? raw.time_create;
  const doneTime = raw.time_done ?? setupTime;
  return {
    id: Number(raw.ticket ?? index),
    symbol: raw.symbol ?? '',
    type: raw.status ?? raw.type ?? 'order',
    side: side.includes('sell') ? 'SELL' : side.includes('buy') ? 'BUY' : side.toUpperCase(),
    volume: Number(raw.volume ?? 0),
    openPrice: Number(raw.price_open ?? raw.open_price ?? raw.price ?? 0),
    closePrice: Number(raw.price ?? raw.price_open ?? raw.open_price ?? 0),
    openTime: toIsoFromSeconds(setupTime),
    closeTime: toIsoFromSeconds(doneTime),
    profit: 0,
    commission: 0,
    swap: 0,
    sl: Number(raw.price_sl ?? 0),
    tp: Number(raw.price_tp ?? 0),
    status: raw.status,
    historySource: 'order',
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
    const params = new URLSearchParams();
    Object.entries(normalizeCandleApiQueryParams({ timeframe, count })).forEach(([key, value]) => {
      params.set(key, String(value));
    });
    return `${API_V2_BASE_URL}/candles/${encodeURIComponent(symbol)}?${params}`;
  },

  async getAccount(login: number): Promise<Account> {
    const data = await apiClient.get<GatewayAccount>(`/account/${login}`, { baseUrl: API_V2_BASE_URL });
    return normalizeAccount(data);
  },

  async getPositions(login: number): Promise<Position[]> {
    const baseUrl = API_V2_BASE_URL;
    const endpoint = `/positions/${login}`;
    const url = `${baseUrl}${endpoint}`;
    debugLog("Calling Toolbox -> Trade API:", redactUrlForDebugLog(url));
    const data = await apiClient.get<GatewayPosition[] | { positions: GatewayPosition[] }>(
      endpoint,
      {
        baseUrl,
        params: { limit: 50, offset: 0 },
        headers: {
          accept: 'application/json',
        },
      }
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
    const [closedPositions, deals] = await Promise.all([
      this.getClosedPositions(login).catch(() => []),
      this.getDeals(login),
    ]);
    const dealHistory = collapseDealHistory(deals);
    // Deals remain the frontend source of truth while the broker's closed-
    // position endpoint is being repaired. If both sources become populated,
    // merging them duplicates every closed trade under unrelated identifiers.
    const merged = (dealHistory.length > 0 ? dealHistory : closedPositions)
      .filter(isClosedHistoryTrade);
    const seen = new Set<string>();
    const history = merged
      .filter((trade) => {
        const key = historyPositionKey(trade) ?? `${trade.type}:${trade.id}:${trade.openTime}:${trade.closeTime ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => historyTime(b) - historyTime(a))
      .slice(0, 500);
    return enrichTradesWithCachedLevels(history, login);
  },

  async getBalanceHistory(login: number, limit = 10) {
    return apiClient.get<Record<string, unknown>[]>(`/accounts/${login}/history`, {
      baseUrl: API_V2_BASE_URL,
      params: { limit, offset: 0 },
    });
  },

  async updateAccount() {
    throw new Error('Account updates are not supported by the trade-facing API contract');
  },
};
