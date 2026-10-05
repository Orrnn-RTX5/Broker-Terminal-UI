import type { Position } from '../store/useAppStore';
import { copyPositionDeliveryEvidence } from '../services/positionDeliveryEvidence';
import type { TradeProfitSource } from '../components/BottomDock.trade';
import type { MarketOrderPlacementState } from '../services/marketOrderPlacementEvents';
import { normalizePosition } from '../api/tradeGateway';
import { resolvePositionOpenTime } from '../services/tradePositionTime';
import { readBackendNumber } from '../services/backendAccountMetrics';

export type ToolboxTradePosition = Omit<Position, 'time_create' | 'time_update'> & {
  account_login?: number;
  ticket?: number;
  contractSize?: number;
  contract_size?: number;
  hasBackendProfit?: boolean;
  hasBackendCurrentPrice?: boolean;
  profitSource?: TradeProfitSource;
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
  entryPrice?: number;
  price?: number;
  livePrice?: number;
  time_open?: number | string;
  open_time?: string;
  time?: string | number;
};

export const toNumber = (value: unknown, fallback = 0): number => {
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

export const getPositionTicket = (position: any): number => (
  toNumber(position?.ticket ?? position?.position_id ?? position?.position_ticket ?? position?.id, 0)
);

export const normalizeToolboxPosition = (raw: any): ToolboxTradePosition => {
  const normalized = normalizePosition(raw) as ToolboxTradePosition;
  const ticket = getPositionTicket(raw) || normalized.id;
  const openPrice = toNumber(
    raw?.price_open ?? raw?.open_price ?? raw?.openPrice ?? raw?.entryPrice ?? raw?.chartEntryPrice ?? raw?.price ?? normalized.openPrice,
    normalized.openPrice || 0,
  );
  const rawCurrentPrice = readBackendNumber(
    raw?.price_current ?? raw?.current_price ?? raw?.currentPrice,
  );
  const hasBackendCurrentPrice = raw?.hasBackendCurrentPrice !== false && rawCurrentPrice !== undefined;
  const priceCurrent = hasBackendCurrentPrice ? rawCurrentPrice! : 0;
  const rawProfit = raw?.profit ?? raw?.unrealized_pl ?? raw?.unrealizedPnL;
  const backendProfit = readBackendNumber(rawProfit);
  const hasBackendProfit = raw?.pnl_available !== false && raw?.hasBackendProfit !== false && backendProfit !== undefined;
  const profit = hasBackendProfit ? backendProfit! : 0;
  const openTime = resolvePositionOpenTime(raw, normalized.openTime || (typeof normalized.time_create === 'string' ? normalized.time_create : undefined));

  return copyPositionDeliveryEvidence(raw, {
    ...normalized,
    id: ticket,
    ticket,
    account_login: raw?.account_login ?? raw?.login ?? normalized.account_login,
    contractSize: toNumber(raw?.contractSize ?? raw?.contract_size ?? normalized.contractSize, 0) || undefined,
    contract_size: toNumber(raw?.contract_size ?? raw?.contractSize ?? normalized.contract_size, 0) || undefined,
    openPrice,
    price_open: openPrice,
    open_price: openPrice,
    currentPrice: priceCurrent,
    hasBackendCurrentPrice,
    price_current: priceCurrent,
    current_price: priceCurrent,
    openTime,
    time_create: raw?.time_create ?? normalized.time_create ?? openTime,
    open_time: raw?.open_time ?? openTime,
    time: raw?.time ?? openTime,
    price_sl: toNumber(raw?.price_sl ?? raw?.sl ?? normalized.sl, normalized.sl),
    price_tp: toNumber(raw?.price_tp ?? raw?.tp ?? normalized.tp, normalized.tp),
    profit,
    unrealizedPnL: profit,
    hasBackendProfit,
    swap: toNumber(raw?.swap ?? raw?.storage ?? normalized.swap, normalized.swap),
    commission: toNumber(raw?.commission ?? normalized.commission, normalized.commission),
    time_update: raw?.time_update ?? normalized.time_update,
    clientOrderId: raw?.clientOrderId ?? raw?.client_order_id,
    placementState: raw?.placementState ?? raw?.placement_state,
    placementErrorCode: raw?.placementErrorCode ?? raw?.placement_error_code,
    placementErrorMessage: raw?.placementErrorMessage ?? raw?.placement_error_message,
    comment: raw?.comment ?? normalized.comment ?? '',
  });
};

const positionSignature = (position: ToolboxTradePosition): string => [
  position.id,
  position.account_login ?? '',
  position.symbol,
  position.side,
  position.volume,
  position.contractSize ?? position.contract_size ?? '',
  position.hasBackendProfit ?? '',
  position.hasBackendCurrentPrice ?? '',
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
  position.state_version ?? '',
  position.protection_version ?? '',
  position.price_time_msc ?? '',
].join(':');

export const positionsSignature = (positions: ToolboxTradePosition[]): string => (
  positions.map(positionSignature).join('|')
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
  const pricePatch = readBackendNumber(raw?.price_current ?? raw?.current_price ?? raw?.currentPrice);
  const profitPatch = readBackendNumber(raw?.profit ?? raw?.unrealized_pl ?? raw?.unrealizedPnL);
  const hasPricePatch = raw?.price_current !== undefined || raw?.current_price !== undefined
    || raw?.currentPrice !== undefined || raw?.hasBackendCurrentPrice !== undefined;
  const hasProfitPatch = raw?.profit !== undefined || raw?.unrealized_pl !== undefined
    || raw?.unrealizedPnL !== undefined || raw?.hasBackendProfit !== undefined;

  if (hasPricePatch) {
    const supplied = raw?.hasBackendCurrentPrice !== false && pricePatch !== undefined;
    const price = supplied ? pricePatch! : 0;
    next.currentPrice = price;
    next.price_current = price;
    next.current_price = price;
    next.hasBackendCurrentPrice = supplied;
  }

  if (hasProfitPatch) {
    const supplied = raw?.hasBackendProfit !== false && profitPatch !== undefined;
    const profit = supplied ? profitPatch! : 0;
    next.unrealizedPnL = profit;
    next.profit = profit;
    next.hasBackendProfit = supplied;
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

