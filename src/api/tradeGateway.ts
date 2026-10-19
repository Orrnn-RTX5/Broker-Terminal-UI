import { apiClient } from './client';
import { normalizeAccountMetrics } from '../services/accountMetrics';
import type { Account, Position, Trade } from '../store/useAppStore';
import { API_V2_BASE_URL, RTX5_WS_URL } from '../config/api';
import { debugLog, redactUrlForDebugLog } from '../utils/debugLogging';
import { decodeJwtPayload } from '../utils/jwt';
import { resolvePositionOpenTime } from '../services/tradePositionTime';
import { enrichTradesWithCachedLevels } from '../utils/tradeHistoryLevelCache';
import { normalizeCandleApiQueryParams } from '../utils/candleApi';
import { readBackendNumber } from '../services/backendAccountMetrics';
import { getAccessToken } from '../services/brokerSession';

export type GatewayAccount = {
  login?: number;
  name?: string;
  currency?: string;
  /** Canonical account-currency display scale from the gateway (0..18). */
  currency_digits?: number;
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
  state_version_text?: string;
  protection_version?: string | number;
  ticket?: number;
  position_id?: number;
  account_login?: number;
  symbol?: string;
  side?: string;
  action?: string | number;
  /** Canonical account-currency display scale from the gateway (0..18). */
  currency_digits?: number;
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
  unrealized_pl?: number;
  unrealizedPnL?: number;
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
  magic?: number;
  contract_size?: number;
  contractSize?: number;
  state_version?: string | number;
  price_time_msc?: number;
  pnl_available?: boolean;
  hasBackendProfit?: boolean;
  hasBackendCurrentPrice?: boolean;
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
  magic?: number;
  comment?: string;
  contract_size?: number;
  contractSize?: number;
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
  contract_size?: number;
  contractSize?: number;
};

export type TradeHistoryDataSet = {
  positions: Trade[];
  deals: Trade[];
  orders: Trade[];
  errors: {
    positions: string | null;
    deals: string | null;
    orders: string | null;
  };
};

type DealHistoryRead = { deals: Trade[]; error: string | null };

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

  const token = getAccessToken();
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

const finiteNumberOrUndefined = (value: unknown): number | undefined => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : undefined;
};

const finiteValueOrUndefined = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
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
  const openingDeals = sorted.filter(isEntryInDeal);
  const openingDeal = openingDeals[0] ?? sorted.find(isEntryInOutDeal);
  const closingDeals = sorted.filter((deal) => isEntryOutDeal(deal) || isEntryInOutDeal(deal));
  const closingDeal = closingDeals.at(-1);
  if (!openingDeal || !closingDeal) return null;

  const weightedPrice = (deals: Trade[], field: 'openPrice' | 'closePrice'): number | undefined => {
    let weightedTotal = 0;
    let totalVolume = 0;
    for (const deal of deals) {
      const volume = Number(deal.volume);
      const price = Number(deal[field] ?? deal.openPrice);
      if (!Number.isFinite(volume) || volume <= 0 || !Number.isFinite(price) || price <= 0) continue;
      weightedTotal += price * volume;
      totalVolume += volume;
    }
    return totalVolume > 0 ? weightedTotal / totalVolume : undefined;
  };

  const profit = sorted.reduce((sum, deal) => sum + Number(deal.profit ?? 0), 0);
  const commission = sorted.reduce((sum, deal) => sum + Number(deal.commission ?? 0), 0);
  const swap = sorted.reduce((sum, deal) => sum + Number(deal.swap ?? 0), 0);
  const fee = sorted.reduce((sum, deal) => sum + Number(deal.fee ?? 0), 0);
  const closedVolume = closingDeals.reduce((sum, deal) => sum + Number(deal.volume ?? 0), 0);
  const comment = [...sorted].reverse().find((deal) => String(deal.comment ?? '').trim())?.comment;
  const magicNumber = openingDeal.magicNumber ?? closingDeal.magicNumber;
  const contractSize = openingDeal.contractSize ?? closingDeal.contractSize;

  return {
    ...openingDeal,
    id,
    type: 'closed',
    status: 'closed',
    side: openingDeal.side || closingDeal.side || '',
    volume: closedVolume || openingDeal.volume || closingDeal.volume || 0,
    openPrice: weightedPrice(openingDeals.length > 0 ? openingDeals : [openingDeal], 'openPrice') ?? openingDeal.openPrice,
    closePrice: weightedPrice(closingDeals, 'closePrice') ?? closingDeal.closePrice ?? closingDeal.openPrice,
    openTime: openingDeal.openTime,
    closeTime: closingDeal.closeTime || closingDeal.openTime,
    profit,
    commission,
    swap,
    ...(fee !== 0 ? { fee } : {}),
    ...(comment ? { comment } : {}),
    ...(magicNumber === undefined ? {} : { magicNumber }),
    ...(contractSize === undefined ? {} : { contractSize }),
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

// REST account snapshots may omit fields. `partial` preserves the previous
// value for anything absent instead of reporting it as an unavailable zero,
// and cannot roll a value back because it only ever fills gaps.
export const normalizeAccount = (raw: GatewayAccount, previous?: Account | null): Account =>
  normalizeAccountMetrics(raw, previous, { partial: true });

export const normalizePosition = (raw: GatewayPosition): Position => {
  const side = String(raw.side ?? raw.action ?? '').toLowerCase();
  const volume = Number(raw.volume_lots ?? raw.volume ?? (raw as any).quantity ?? 0);
  const openPrice = Number(raw.price_open ?? raw.open_price ?? (raw as any).openPrice ?? (raw as any).entryPrice ?? (raw as any).chartEntryPrice ?? (raw as any).price ?? 0);
  const backendCurrentPrice = readBackendNumber(raw.price_current ?? raw.current_price ?? (raw as any).currentPrice ?? (raw as any).livePrice);
  const backendProfit = readBackendNumber(raw.profit ?? (raw as any).unrealized_pl ?? (raw as any).unrealized_pnl ?? (raw as any).unrealizedPnL);
  const hasBackendCurrentPrice = raw.pnl_available !== false && raw.hasBackendCurrentPrice !== false && backendCurrentPrice !== undefined;
  const hasBackendProfit = raw.pnl_available !== false && raw.hasBackendProfit !== false && backendProfit !== undefined;
  const currentPrice = hasBackendCurrentPrice ? backendCurrentPrice : 0;
  const profit = hasBackendProfit ? backendProfit : 0;
  const openTime = resolvePositionOpenTime(raw);
  return {
    ...raw,
    id: Number(raw.ticket ?? raw.position_id ?? (raw as any).id ?? 0),
    state_version: raw.state_version_text ?? raw.state_version,
    protection_version: raw.protection_version,
    price_time_msc: raw.price_time_msc,
    symbol: (raw.symbol ?? '').toUpperCase(),
    side: side.includes('sell') || side === '1' ? 'SELL' : 'BUY',
    volume,
    openPrice,
    currentPrice,
    hasBackendCurrentPrice,
    hasBackendProfit,
    openTime,
    sl: Number(raw.price_sl ?? raw.sl ?? 0),
    tp: Number(raw.price_tp ?? raw.tp ?? 0),
    swap: Number(raw.swap ?? raw.storage ?? 0),
    commission: Number(raw.commission ?? 0),
    unrealizedPnL: profit,
    comment: raw.comment ?? '',
    open_price: openPrice,
    price_open: openPrice,
    current_price: currentPrice,
    price_current: currentPrice,
    time_create: openTime,
    open_time: openTime,
    time: openTime,
    profit: hasBackendProfit ? profit : undefined,
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
  const fee = finiteValueOrUndefined(raw.fee);
  const magicNumber = finiteValueOrUndefined(raw.magic);
  const contractSize = finiteNumberOrUndefined(raw.contract_size ?? raw.contractSize);
  const comment = String(raw.comment ?? '').trim();
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
    dealType: action,
    entry: entry || undefined,
    ...(fee === undefined ? {} : { fee }),
    ...(magicNumber === undefined ? {} : { magicNumber }),
    ...(comment ? { comment } : {}),
    ...(contractSize === undefined ? {} : { contractSize }),
    historySource: 'deal',
  };
};

export const normalizeClosedPosition = (raw: GatewayClosedPosition, index = 0): Trade => {
  const side = String(raw.side ?? raw.action ?? '').toLowerCase();
  const magicNumber = finiteValueOrUndefined(raw.magic);
  const contractSize = finiteNumberOrUndefined(raw.contract_size ?? raw.contractSize);
  const comment = String(raw.comment ?? '').trim();
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
    ...(magicNumber === undefined ? {} : { magicNumber }),
    ...(comment ? { comment } : {}),
    ...(contractSize === undefined ? {} : { contractSize }),
    historySource: 'closed-position',
  };
};

export const normalizeOrder = (raw: GatewayOrder, index = 0): Trade => {
  const side = String(raw.side ?? raw.type ?? '').toLowerCase();
  const setupTime = raw.time_setup ?? raw.time_create;
  const doneTime = raw.time_done ?? setupTime;
  const ticket = Number(raw.ticket ?? index);
  const orderType = String(raw.type ?? '').trim();
  const magicNumber = finiteValueOrUndefined(raw.magic);
  const contractSize = finiteNumberOrUndefined(raw.contract_size ?? raw.contractSize);
  const comment = String(raw.comment ?? '').trim();
  return {
    id: ticket,
    symbol: raw.symbol ?? '',
    type: orderType || raw.status || 'order',
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
    orderTicket: ticket,
    ...(orderType ? { orderType } : {}),
    ...(magicNumber === undefined ? {} : { magicNumber }),
    ...(comment ? { comment } : {}),
    ...(contractSize === undefined ? {} : { contractSize }),
    historySource: 'order',
  };
};

const sortHistoryRows = (rows: Trade[]): Trade[] => (
  [...rows]
    .sort((a, b) => historyTime(b) - historyTime(a))
);

export const buildClosedPositionHistory = (
  closedPositions: Trade[],
  deals: Trade[],
  login: number,
): Trade[] => {
  const dealHistory = collapseDealHistory(deals).filter(isClosedHistoryTrade);
  const closedPositionHistory = closedPositions.filter(isClosedHistoryTrade);
  // Deals remain the frontend source of truth while the broker's closed-
  // position endpoint is being repaired. If both sources become populated,
  // merging them duplicates every closed trade under unrelated identifiers.
  const merged = dealHistory.length > 0 ? dealHistory : closedPositionHistory;
  const seen = new Set<string>();
  const history = merged
    .filter((trade) => {
      const key = historyPositionKey(trade) ?? `${trade.type}:${trade.id}:${trade.openTime}:${trade.closeTime ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return enrichTradesWithCachedLevels(sortHistoryRows(history), login);
};

const historyRequestError = (error: unknown): string => (
  error instanceof Error ? error.message : 'History request failed'
);

const settledHistoryReads = new Map<string, unknown>();
const inflightHistoryReads = new Map<string, Promise<unknown>>();
let historyReadGeneration = 0;

// History opens again after startup already read the same deals and closed
// positions. Reuse that result until a fill, close, or explicit refresh.
export const clearTradeHistoryRequestCache = (): void => {
  historyReadGeneration += 1;
  settledHistoryReads.clear();
  inflightHistoryReads.clear();
};

const cachedTradeRead = <T>(key: string, force: boolean, load: () => Promise<T>): Promise<T> => {
  const flightKey = force ? `${key}\u0000force` : key;
  if (!force) {
    if (settledHistoryReads.has(key)) return Promise.resolve(settledHistoryReads.get(key) as T);
    const pending = inflightHistoryReads.get(key);
    if (pending) return pending as Promise<T>;
  } else {
    const pending = inflightHistoryReads.get(flightKey);
    if (pending) return pending as Promise<T>;
  }

  const promise = load()
    .then((value) => {
      if (inflightHistoryReads.get(flightKey) === promise) settledHistoryReads.set(key, value);
      return value;
    })
    .finally(() => {
      if (inflightHistoryReads.get(flightKey) === promise) inflightHistoryReads.delete(flightKey);
    });
  inflightHistoryReads.set(flightKey, promise);
  return promise;
};

const composeTradeHistoryDataSet = (
  login: number,
  closedResult: PromiseSettledResult<Trade[]>,
  dealsResult: PromiseSettledResult<DealHistoryRead>,
  ordersResult: PromiseSettledResult<Trade[]> | null,
): TradeHistoryDataSet => {
  const closedPositions = closedResult.status === 'fulfilled' ? closedResult.value : [];
  const dealError = dealsResult.status === 'fulfilled' ? dealsResult.value.error : historyRequestError(dealsResult.reason);
  const deals = dealsResult.status === 'fulfilled' ? sortHistoryRows(dealsResult.value.deals) : [];
  const orders = ordersResult?.status === 'fulfilled' ? sortHistoryRows(ordersResult.value) : [];
  const dealPositions = dealsResult.status === 'fulfilled'
    ? buildClosedPositionHistory([], dealsResult.value.deals, login)
    : [];
  const positions = dealPositions.length > 0
    ? dealPositions
    : closedResult.status === 'fulfilled'
      ? buildClosedPositionHistory(closedPositions, [], login)
      : [];

  return {
    positions,
    deals,
    orders,
    errors: {
      positions: dealsResult.status === 'rejected'
        ? closedResult.status === 'fulfilled' && closedPositions.length > 0
          ? `${historyRequestError(dealsResult.reason)}; showing closed-position fallback`
          : historyRequestError(dealsResult.reason)
        : dealError !== null ? dealError
        : dealPositions.length === 0 && closedResult.status === 'rejected'
          ? historyRequestError(closedResult.reason)
        : null,
      deals: dealError,
      orders: ordersResult === null
        ? null
        : ordersResult.status === 'rejected'
          ? historyRequestError(ordersResult.reason)
          : null,
    },
  };
};

const ARRAY_WRAPPER_KEYS = ['data', 'items', 'results'] as const;

const arrayFrom = <T>(data: unknown, key?: string, requireArray = false): T[] => {
  const extract = (value: unknown, depth = 0): T[] | null => {
    if (Array.isArray(value)) return value as T[];
    if (!value || typeof value !== 'object' || depth > ARRAY_WRAPPER_KEYS.length) return null;

    const record = value as Record<string, unknown>;
    if (key && Array.isArray(record[key])) return record[key] as T[];

    for (const wrapperKey of ARRAY_WRAPPER_KEYS) {
      const nested = extract(record[wrapperKey], depth + 1);
      if (nested !== null) return nested;
    }

    return null;
  };

  const rows = extract(data);
  if (rows === null && requireArray) throw new Error('Deal history response is unavailable');
  return rows ?? [];
};

/** Financial history must include every page, not just the latest 500 deals. */
const loadAllDealPages = async (endpoint: string, login?: number): Promise<DealHistoryRead> => {
  const generation = historyReadGeneration;
  const to = endpoint === '/account/deals' ? Math.floor(Date.now() / 1000) : undefined;
  const rows: GatewayDeal[] = [];
  const seen = new Set<string>();
  const result = (error: string | null): DealHistoryRead => ({ deals: rows.map(normalizeDeal), error });
  const incomplete = (reason: string) => result(`${reason}; showing ${rows.length} available deals. Older history records are unavailable.`);
  for (let offset = 0; offset < 500_000; offset += 500) {
    let page: GatewayDeal[];
    try {
      const data = await apiClient.get<GatewayDeal[] | { deals: GatewayDeal[] }>(endpoint, {
        baseUrl: API_V2_BASE_URL,
        params: { limit: 500, offset, ...(to === undefined ? {} : { to }) },
      });
      if (generation !== historyReadGeneration) throw new Error('History session changed');
      page = arrayFrom<GatewayDeal>(data, 'deals', true);
      if (page.some(row => !row || typeof row !== 'object'
        || (login && row.account_login !== undefined && Number(row.account_login) !== login))) {
        throw new Error('Invalid account deal history record');
      }
    } catch (caught) {
      if (generation !== historyReadGeneration || rows.length === 0) throw caught;
      return incomplete(`Further deal history could not be loaded: ${historyRequestError(caught)}`);
    }
    let added = 0;
    for (const row of page) {
      const identity = String(row.ticket ?? row.deal ?? JSON.stringify(row));
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push(row);
      added += 1;
    }
    if (!added && page.length > 0) return incomplete('Broker repeated a history page');
    if (page.length < 500) return result(null);
  }
  return incomplete('Deal history exceeds the supported page limit');
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

  async getDeals(login?: number, options?: { force?: boolean }): Promise<Trade[]> {
    return (await this.getDealHistory(login, options)).deals;
  },

  async getDealHistory(login?: number, options?: { force?: boolean }): Promise<DealHistoryRead> {
    // The trader route supports limit/offset; the legacy login route on some
    // brokers always repeats its latest 500 rows. JWT claims select a route
    // only; the server authorizes it and each returned account is validated.
    const payload = decodeJwtPayload(getAccessToken());
    const tokenLogin = readBackendNumber(payload?.account_login ?? payload?.login);
    const ownAccount = login === undefined || tokenLogin === login;
    const endpoint = ownAccount ? '/account/deals' : `/deals/${login}`;
    return cachedTradeRead(`deals:${login ?? 'session'}`, options?.force === true, async () => {
      try {
        return await loadAllDealPages(endpoint, login);
      } catch (caught) {
        const status = caught && typeof caught === 'object' && 'status' in caught ? Number(caught.status) : null;
        if (!ownAccount || !login || (status !== 404 && status !== 501)) throw caught;
        return loadAllDealPages(`/deals/${login}`, login);
      }
    });
  },

  async getClosedPositions(login: number, options?: { force?: boolean }): Promise<Trade[]> {
    return cachedTradeRead(`closed:${login}`, options?.force === true, async () => {
      const data = await apiClient.get<GatewayClosedPosition[] | { positions: GatewayClosedPosition[] }>(
        `/positions/${login}/history`,
        { baseUrl: API_V2_BASE_URL, params: { limit: 500, offset: 0 } }
      );
      return arrayFrom<GatewayClosedPosition>(data, 'positions').map(normalizeClosedPosition);
    });
  },

  async getOrders(login?: number, options?: { force?: boolean }): Promise<Trade[]> {
    const endpoint = login ? `/orders/${login}` : '/account/orders';
    return cachedTradeRead(`orders:${login ?? 'session'}`, options?.force === true, async () => {
      const data = await apiClient.get<GatewayOrder[] | { orders: GatewayOrder[] }>(endpoint, {
        baseUrl: API_V2_BASE_URL,
        params: { limit: 500, offset: 0 },
      });
      return arrayFrom<GatewayOrder>(data, 'orders').map(normalizeOrder);
    });
  },

  async getOrderHistory(login: number): Promise<Trade[]> {
    const [closedPositions, deals] = await Promise.all([
      this.getClosedPositions(login).catch(() => []),
      this.getDeals(login),
    ]);
    return buildClosedPositionHistory(closedPositions, deals, login);
  },

  async getHistoryDataSet(login: number, options?: {
    force?: boolean;
    onPartial?: (data: TradeHistoryDataSet) => void;
  }): Promise<TradeHistoryDataSet> {
    const force = options?.force === true;
    // Start every source before waiting so a slow orders response cannot
    // delay the closed-position rows the History tab shows first.
    const closedPromise = this.getClosedPositions(login, { force });
    const dealsPromise = this.getDealHistory(login, { force });
    const ordersPromise = this.getOrders(login, { force });
    const [closedResult, dealsResult] = await Promise.allSettled([closedPromise, dealsPromise]);
    options?.onPartial?.(composeTradeHistoryDataSet(login, closedResult, dealsResult, null));
    const [ordersResult] = await Promise.allSettled([ordersPromise]);
    return composeTradeHistoryDataSet(login, closedResult, dealsResult, ordersResult);
  },

  async getBalanceHistory(login: number, limit = 10, offset = 0) {
    return apiClient.get<Record<string, unknown>[]>(`/accounts/${login}/history`, {
      baseUrl: API_V2_BASE_URL,
      params: { limit, offset },
    });
  },

  async updateAccount() {
    throw new Error('Account updates are not supported by the trade-facing API contract');
  },
};
