import { normalizeBrokerTimestampMs, readBrokerTimestampMs } from '../utils/brokerStreamSemantics';
import { shouldDeferEmptyPositionSnapshot } from './positionSnapshotSafety';
import { readPositionStateVersion } from './positionStateVersion';

const toFinite = (v: unknown, fallback = 0): number => {
  // FIX: Partial account packets may carry omitted/null fields or Money-like
  // `{ amount }` values. Neither may silently erase a known metric with zero.
  if (v === undefined || v === null || v === '') return fallback;
  const candidate = typeof v === 'object' && v !== null && 'amount' in v
    ? (v as { amount?: unknown }).amount
    : v;
  const n = Number(String(candidate).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const hasOwnValue = (record: any, keys: readonly string[]): boolean => (
  !!record
  && typeof record === 'object'
  && keys.some((key) => (
    Object.prototype.hasOwnProperty.call(record, key)
    && record[key] !== undefined
    && record[key] !== null
    && record[key] !== ''
  ))
);

const stopLossAliases = ['price_sl', 'sl', 'stopLoss', 'stop_loss'] as const;
const takeProfitAliases = ['price_tp', 'tp', 'takeProfit', 'take_profit'] as const;

const readProtectionLevel = (record: any, keys: readonly string[]): number | undefined => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)
      && record[key] !== undefined && record[key] !== '') {
      // Explicit null/zero removes a level; an omitted value leaves it intact.
      return toFinite(record[key], 0);
    }
  }
  return undefined;
};

const firstDefined = (record: any, keys: readonly string[]): unknown => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const timestampToIso = (v: unknown): string => {
  const timestamp = normalizeBrokerTimestampMs(v);
  return timestamp === undefined ? '' : new Date(timestamp).toISOString();
};

export function normalizePosition(raw: any) {
  // FIX: Position event time accepts every broker precision/ISO alias without
  // multiplying a millisecond/microsecond/nanosecond epoch a second time.
  const openTimestamp = readBrokerTimestampMs([raw], [
    'time_create', 'time_create_ms', 'time_create_msc',
    'time_open', 'time_open_ms', 'time_open_msc',
    'opened_at', 'open_time', 'openTime',
    'time_ms', 'time_msc', 'timestamp_ms', 'timestamp', 'time',
  ]);
  const openTime = openTimestamp === undefined ? '' : timestampToIso(openTimestamp);

  const id = getPositionId(raw);
  const volume = toFinite(raw.volume_lots ?? raw.volume ?? raw.quantity, 0);
  const openPrice = toFinite(raw.price_open ?? raw.open_price ?? raw.openPrice ?? raw.price, 0);
  const currentPrice = toFinite(raw.price_current ?? raw.current_price ?? raw.currentPrice, 0);
  const unrealizedPnL = toFinite(raw.profit ?? raw.unrealized_pl ?? raw.unrealizedPnL, 0);
  const sl = readProtectionLevel(raw, stopLossAliases) ?? 0;
  const tp = readProtectionLevel(raw, takeProfitAliases) ?? 0;

  return {
    ...raw,
    state_version: positionVersion(raw),
    id,
    symbol: raw.symbol || '',
    side: Number(raw.action) === 1 || ['sell', 'short'].includes(String(raw.side).toLowerCase()) ? 'SELL' as const : 'BUY' as const,
    volume,
    volume_lots: volume,
    openPrice,
    currentPrice,
    openTime,
    sl,
    price_sl: sl,
    stopLoss: sl,
    stop_loss: sl,
    tp,
    price_tp: tp,
    takeProfit: tp,
    take_profit: tp,
    swap: toFinite(raw.storage ?? raw.swap, 0),
    commission: toFinite(raw.commission, 0),
    unrealizedPnL,
    hasBackendProfit: raw.pnl_available !== false && raw.hasBackendProfit !== false && hasOwnValue(raw, ['profit', 'unrealized_pl', 'unrealizedPnL']),
    comment: raw.comment,
    // FIX: Keep wire aliases synchronized with the canonical fields. Several
    // trade-table consumers still read these defensive aliases first.
    open_price: openPrice,
    price_open: openPrice,
    current_price: currentPrice,
    price_current: currentPrice,
    quantity: volume,
    unrealized_pl: unrealizedPnL,
    profit: unrealizedPnL,
    time_create: openTime,
  };
}

export const getPositionId = (raw: any): number => (
  toFinite(raw?.position_id ?? raw?.ticket ?? raw?.id ?? raw?.position_ticket, 0)
);

export const isClosedPositionRecord = (raw: any): boolean => {
  const lifecycle = String(raw?.event ?? raw?.status ?? raw?.state ?? '').trim().toLowerCase();
  if (raw?.closed === true || ['close', 'closed', 'sl_hit', 'tp_hit', 'stop_out'].includes(lifecycle)) {
    return true;
  }
  const closedAt = readBrokerTimestampMs([raw], [
    'time_close', 'time_close_ms', 'time_close_msc',
    'closed_at', 'close_time', 'closeTime',
  ]);
  if (
    closedAt !== undefined
    && closedAt > 0
  ) return true;
  const volumeKeys = ['volume_lots', 'volume', 'quantity'] as const;
  return hasOwnValue(raw, volumeKeys) && toFinite(firstDefined(raw, volumeKeys), 0) <= 0;
};

export const mergePositionRecord = (raw: any, existing?: any): any => {
  if (existing && isOlderPositionVersion(raw, existing)) return existing;
  if (existing && raw?.update_kind === 'pnl') {
    const incomingTime = Number(raw.price_time_msc);
    const previousTime = Number(existing.price_time_msc);
    if (Number.isFinite(incomingTime) && Number.isFinite(previousTime) && incomingTime < previousTime) return existing;
    // Display messages are never allowed to modify volume, side or protection,
    // even if a legacy publisher accidentally includes those fields.
    const profit = firstDefined(raw, ['profit', 'unrealized_pl', 'unrealizedPnL']);
    const price = firstDefined(raw, ['price_current', 'current_price', 'currentPrice']);
    return {
      ...existing,
      pnl_available: true,
      ...(price !== undefined ? { currentPrice: toFinite(price), current_price: toFinite(price), price_current: toFinite(price), hasBackendCurrentPrice: true } : {}),
      ...(profit !== undefined ? { profit: toFinite(profit), unrealizedPnL: toFinite(profit), unrealized_pl: toFinite(profit), hasBackendProfit: true } : {}),
      ...(raw.margin !== undefined ? { margin: raw.margin } : {}),
      ...(Number.isFinite(incomingTime) ? { price_time_msc: incomingTime } : {}),
    };
  }
  const normalized = normalizePosition(raw) as any;
  if (!existing) return normalized;
  const duplicatePricedSnapshot = raw.pnl_available === false
    && positionVersion(raw) !== undefined && positionVersion(raw) === positionVersion(existing)
    && existing.pnl_available !== false && existing.hasBackendProfit !== false;
  if (positionVersion(existing) !== undefined && positionVersion(raw) === positionVersion(existing)
    && Number(existing.price_time_msc) > (Number(raw.price_time_msc) || 0)) {
    normalized.currentPrice = existing.currentPrice;
    normalized.unrealizedPnL = existing.unrealizedPnL;
    normalized.price_time_msc = existing.price_time_msc;
  }

  const volume = hasOwnValue(raw, ['volume_lots', 'volume', 'quantity']) ? normalized.volume : existing.volume;
  const openPrice = hasOwnValue(raw, ['price_open', 'open_price', 'openPrice', 'price'])
    ? normalized.openPrice
    : existing.openPrice;
  const hasCurrentPrice = hasOwnValue(raw, ['price_current', 'current_price', 'currentPrice']);
  const currentPrice = hasCurrentPrice ? normalized.currentPrice : existing.currentPrice;
  const openTime = hasOwnValue(raw, [
    'time_create', 'time_create_ms', 'time_create_msc',
    'time_ms', 'time_msc', 'time', 'timestamp', 'timestamp_ms',
    'time_open', 'time_open_ms', 'time_open_msc', 'opened_at', 'open_time', 'openTime',
  ])
    ? normalized.openTime
    : existing.openTime;
  const hasProfit = hasOwnValue(raw, ['profit', 'unrealized_pl', 'unrealizedPnL']);
  const unrealizedPnL = hasProfit ? normalized.unrealizedPnL : existing.unrealizedPnL;
  const sl = readProtectionLevel(raw, stopLossAliases) ?? existing.sl;
  const tp = readProtectionLevel(raw, takeProfitAliases) ?? existing.tp;

  return {
    ...existing,
    ...normalized,
    pnl_available: duplicatePricedSnapshot ? true : (raw.pnl_available ?? existing.pnl_available),
    state_version: positionVersion(raw) ?? positionVersion(existing),
    state_version_text: positionVersion(raw) ?? positionVersion(existing),
    symbol: hasOwnValue(raw, ['symbol']) ? normalized.symbol : existing.symbol,
    side: hasOwnValue(raw, ['action', 'side']) ? normalized.side : existing.side,
    volume,
    volume_lots: volume,
    quantity: volume,
    openPrice,
    open_price: openPrice,
    price_open: openPrice,
    currentPrice,
    current_price: currentPrice,
    price_current: currentPrice,
    openTime,
    time_create: openTime,
    sl,
    tp,
    price_sl: sl,
    stopLoss: sl,
    stop_loss: sl,
    price_tp: tp,
    takeProfit: tp,
    take_profit: tp,
    swap: hasOwnValue(raw, ['storage', 'swap']) ? normalized.swap : existing.swap,
    commission: hasOwnValue(raw, ['commission']) ? normalized.commission : existing.commission,
    unrealizedPnL,
    unrealized_pl: unrealizedPnL,
    profit: unrealizedPnL,
    // Rows admitted from an order fill have no backend price/P&L yet and are
    // flagged unavailable. A frame that supplies them must clear those flags,
    // or the Trade tab keeps showing dashes until a REST reload. A duplicate
    // snapshot of an already priced version keeps its flags.
    ...(hasCurrentPrice && !duplicatePricedSnapshot
      ? { hasBackendCurrentPrice: raw.hasBackendCurrentPrice !== false && raw.pnl_available !== false }
      : {}),
    hasBackendProfit: duplicatePricedSnapshot ? existing.hasBackendProfit : raw.pnl_available === false ? false
      : hasProfit ? normalized.hasBackendProfit : existing.hasBackendProfit,
    comment: hasOwnValue(raw, ['comment']) ? normalized.comment : existing.comment,
  };
};

const positionVersion = (raw: any): string | undefined => (
  readPositionStateVersion(raw?.state_version_text ?? raw?.state_version) ?? undefined
);

// Do not coerce version strings to Number: PostgreSQL bigint exceeds JS's
// exact integer range. Unversioned legacy messages remain compatible.
export const isOlderPositionVersion = (incoming: any, existing: any): boolean => {
  const next = positionVersion(incoming);
  const current = positionVersion(existing);
  return next !== undefined && current !== undefined
    && (next.length < current.length || (next.length === current.length && next < current));
};

export type PositionStreamBatch = {
  positions: any[];
  mode: 'delta' | 'snapshot';
};

export const POSITION_CLOSED_EVENTS = new Set([
  'close', 'closed', 'position_closed', 'sl_hit', 'tp_hit', 'stop_out',
]);

export const readPositionStreamEvent = (message: any): { event: string; position: any } => {
  const envelopes = [message?.data?.data, message?.data, message];
  const event = envelopes.flatMap((value) => [value?.event, value?.type])
    .map((value) => String(value ?? '').trim().toLowerCase())
    .find((value) => value && value !== 'channel_message') ?? '';
  const position = envelopes.flatMap((value) => [value?.position, value?.closed_position, value])
    .find((value) => getPositionId(value) > 0);
  return { event, position };
};

/** Account channels carry symbol-scoped P&L batches as well as snapshots.
 * Inspect the broker event inside either /ws/v2 or channel_message envelopes.
 * An array alone does not establish that omitted tickets have been closed.
 */
export const readPositionStreamBatch = (message: any): PositionStreamBatch | null => {
  const envelopes = [message, message?.data, message?.data?.data];
  const positions = envelopes.flatMap((value) => (
    Array.isArray(value) ? [value] : Array.isArray(value?.positions) ? [value.positions] : []
  ))[0];
  if (!positions) return null;

  const events = envelopes.flatMap((value) => [value?.event, value?.type])
    .map((value) => String(value ?? '').toLowerCase());
  const isDelta = events.some((event) => ['position_update', 'positions_update', 'pnl_update'].includes(event))
    || envelopes.some((value) => value?.symbol || value?.partial === true || value?.snapshot === false);
  const isSnapshot = !isDelta && (
    events.some((event) => ['snapshot', 'positions_snapshot', 'mt5_positions'].includes(event))
    || envelopes.some((value) => value?.snapshot === true)
  );
  return { positions, mode: isSnapshot ? 'snapshot' : 'delta' };
};

export const reconcilePositionStreamBatch = <T extends { id: number }>(
  current: T[],
  batch: PositionStreamBatch,
): { positions: T[]; needsRevalidation: boolean; closedTickets: number[] } => {
  const currentById = new Map(current.map((position) => [Number(position.id), position]));
  // Stream snapshots merge like deltas: they upsert the rows they carry and never remove the
  // tickets they omit (no backend marks a stream snapshot as complete-account). Removal comes
  // from explicit close records, or from a complete REST read that confirmed the ticket.
  const nextById = new Map(currentById);
  let needsRevalidation = false;
  const closedTickets = new Set<number>();
  for (const raw of batch.positions) {
    const ticket = getPositionId(raw);
    if (!Number.isFinite(ticket) || ticket <= 0) continue;
    const existing = currentById.get(ticket);
    if (!existing && (raw.display_only === true || raw.update_kind === 'pnl')) {
      needsRevalidation = true;
      continue;
    }
    if (existing && raw.update_kind === 'pnl' && positionVersion(raw) !== undefined
      && positionVersion(existing) !== undefined && positionVersion(raw) !== positionVersion(existing)) {
      if (!isOlderPositionVersion(raw, existing)) needsRevalidation = true;
      nextById.set(ticket, existing);
      continue;
    }
    if (existing && isOlderPositionVersion(raw, existing)) {
      nextById.set(ticket, existing);
      continue;
    }
    if (isClosedPositionRecord(raw)) {
      nextById.delete(ticket);
      closedTickets.add(ticket);
      continue;
    }
    const merged = mergePositionRecord(raw, existing);
    if (!existing && (!merged.symbol || !(merged.volume > 0))) {
      // A price-only update cannot create a valid row. Recover its identity
      // from REST without discarding any of the already visible positions.
      needsRevalidation = true;
      continue;
    }
    nextById.set(ticket, merged);
  }

  const positions = Array.from(nextById.values());
  const retained = current.filter((position) => !closedTickets.has(position.id));
  if (shouldDeferEmptyPositionSnapshot(retained, positions)) {
    return { positions: retained, needsRevalidation: true, closedTickets: [...closedTickets] };
  }
  return {
    positions,
    closedTickets: [...closedTickets],
    needsRevalidation: needsRevalidation || (batch.positions.length === 0 && retained.length > 0),
  };
};
