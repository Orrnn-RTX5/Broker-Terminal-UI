export type TradeOverlaySide = 'BUY' | 'SELL';
export type TradeOverlayHistorySource = 'closed-position' | 'deal' | 'order';
export type ClosedTradeOverlaySource = 'mt5-history' | 'app-history';
export type TradeOverlayCloseState = 'pending' | 'confirmed' | 'failed';

export const TRADE_OVERLAY_CLOSE_STATE_EVENT = 'rtx:trade-overlay-close-state';
export const TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS = 5 * 60 * 1000;
const TRADE_OVERLAY_OPTIMISTIC_HISTORY_TTL_MS = 30 * 60 * 1000;

export type TradeOverlayHistoryRow = Record<string, unknown> & {
  id?: unknown;
  symbol?: unknown;
  type?: unknown;
  side?: unknown;
  volume?: unknown;
  openPrice?: unknown;
  closePrice?: unknown;
  openTime?: unknown;
  closeTime?: unknown;
  profit?: unknown;
  positionId?: unknown;
  orderTicket?: unknown;
  dealTicket?: unknown;
  entry?: unknown;
  historySource?: unknown;
};

export interface ClosedTradeOverlaySnapshot {
  key: string;
  symbol: string;
  side: TradeOverlaySide;
  volume: number;
  entryPrice: number;
  /** Candle-aligned timestamp used only to place the entry marker on the chart. */
  entryTime: number;
  /** Raw broker execution timestamp used in entry details. */
  entryExecutionTime: number;
  exitPrice: number;
  /** Candle-aligned timestamp used only to place the close marker on the chart. */
  exitTime: number;
  /** Raw broker execution timestamp used in close details. */
  exitExecutionTime: number;
  profit?: number;
  source: ClosedTradeOverlaySource;
}

export interface TradeOverlayCloseSnapshotSeed {
  key: string;
  symbol: string;
  side: TradeOverlaySide;
  volume: number;
  entryPrice: number;
  entryTime: number;
  entryExecutionTime?: number;
  exitPrice: number;
  exitTime: number;
  exitExecutionTime?: number;
  profit?: number;
}

export type TradeOverlayCloseSnapshotPayload = Record<string, unknown> & {
  ticketId?: unknown;
  ticket?: unknown;
  id?: unknown;
  positionId?: unknown;
  key?: unknown;
  symbol?: unknown;
  side?: unknown;
  volume?: unknown;
  entryPrice?: unknown;
  entryTime?: unknown;
  exitPrice?: unknown;
  exitTime?: unknown;
  currentPrice?: unknown;
  closeTime?: unknown;
  profit?: unknown;
};

interface TradeOverlayCloseStateDispatchOptions {
  snapshots?: readonly TradeOverlayCloseSnapshotPayload[];
}

interface TradeOverlayCandleTimeSource {
  time?: unknown;
}

interface DealHistoryGroup {
  ticket: string;
  deals: TradeOverlayHistoryRow[];
}

interface BuildClosedTradeHistorySnapshotsOptions {
  rows: TradeOverlayHistoryRow[];
  symbol: string;
  mapTimestamp: (value: unknown) => number;
  activeTradeKeys?: ReadonlySet<string>;
}

interface TradeOverlayRedrawDecisionOptions {
  lastActiveSignature: string;
  nextActiveSignature: string;
  lastHistorySignature: string;
  nextHistorySignature: string;
  forceActive?: boolean;
  forceHistory?: boolean;
}

interface MissingActiveTradeOverlayOptions {
  tradeKey: string;
  closeSuppressedTradeKeys?: ReadonlySet<string>;
  closedHistoryTradeKeys?: ReadonlySet<string>;
  brokerMarkedClosed?: boolean;
}

interface ClosedTradeSnapshotReplacementOptions {
  existingTrade: ClosedTradeOverlaySnapshot | undefined;
  candidateTrade: ClosedTradeOverlaySnapshot;
  canRenderTradePath: (trade: ClosedTradeOverlaySnapshot) => boolean;
}

interface TradeOverlaySegmentGeometryOptions {
  x1: number | null | undefined;
  y1: number | null | undefined;
  x2: number | null | undefined;
  y2: number | null | undefined;
  minLengthPx?: number;
}

export interface TradeOverlaySegmentGeometry {
  left: number;
  top: number;
  width: number;
  angleDeg: number;
}

interface StoredOptimisticClosedTradeSnapshot {
  snapshot: ClosedTradeOverlaySnapshot;
  expiresAt: number;
}

const optimisticClosedTradeSnapshotStore = new Map<string, StoredOptimisticClosedTradeSnapshot>();

export const getTradeOverlayRedrawDecision = ({
  lastActiveSignature,
  nextActiveSignature,
  lastHistorySignature,
  nextHistorySignature,
  forceActive = false,
  forceHistory = false,
}: TradeOverlayRedrawDecisionOptions) => ({
  activeChanged: forceActive || nextActiveSignature !== lastActiveSignature,
  historyChanged: forceHistory || nextHistorySignature !== lastHistorySignature,
});

export const shouldUseClosedTradeHistorySnapshot = ({
  existingTrade,
  candidateTrade,
  canRenderTradePath,
}: ClosedTradeSnapshotReplacementOptions): boolean => {
  if (!existingTrade) return true;
  if (canRenderTradePath(candidateTrade)) return true;
  return !canRenderTradePath(existingTrade);
};

export const resolveTradeOverlaySegmentGeometry = ({
  x1,
  y1,
  x2,
  y2,
  minLengthPx = 0,
}: TradeOverlaySegmentGeometryOptions): TradeOverlaySegmentGeometry | null => {
  if (
    x1 == null
    || y1 == null
    || x2 == null
    || y2 == null
    || !Number.isFinite(x1)
    || !Number.isFinite(y1)
    || !Number.isFinite(x2)
    || !Number.isFinite(y2)
  ) {
    return null;
  }

  let dx = x2 - x1;
  let dy = y2 - y1;
  let length = Math.sqrt((dx * dx) + (dy * dy));
  const minimumLength = Number.isFinite(minLengthPx) && minLengthPx > 0 ? minLengthPx : 0;

  if (minimumLength > 0 && (!Number.isFinite(length) || length <= 0.5)) {
    dx = minimumLength;
    dy = 0;
    length = minimumLength;
  } else if (minimumLength > 0 && length < minimumLength) {
    const scale = minimumLength / length;
    dx *= scale;
    dy *= scale;
    length = minimumLength;
  }

  if (!Number.isFinite(length) || length <= 0.5) return null;

  return {
    left: x1,
    top: y1,
    width: length,
    angleDeg: Math.atan2(dy, dx) * 180 / Math.PI,
  };
};

const pruneOptimisticClosedTradeSnapshotStore = (now = Date.now()) => {
  optimisticClosedTradeSnapshotStore.forEach((value, key) => {
    if (value.expiresAt <= now) {
      optimisticClosedTradeSnapshotStore.delete(key);
    }
  });
};

// FIX: Position/deal matching must not collapse separate broker contracts such
// as EURUSD and EURUSD.r onto the same chart overlay.
const normalizeSymbol = (value: unknown): string =>
  String(value ?? '').trim().toUpperCase();

const getTicket = (value: unknown): string | null => {
  const ticket = String(value ?? '').trim();
  if (!ticket) return null;
  const numericTicket = Number(ticket);
  if (Number.isFinite(numericTicket) && numericTicket <= 0) return null;
  return ticket;
};

const parseTradeTimestampString = (value: string): number | null => {
  const match = value.trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);

  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return null;
  }

  const timestampMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isNaN(timestampMs) ? null : Math.floor(timestampMs / 1000);
};

const normalizeCloseSnapshotTime = (value: unknown): number => {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && trimmed !== '') {
      return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }
    const tradeTimestamp = parseTradeTimestampString(trimmed);
    if (tradeTimestamp != null) return tradeTimestamp;
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  return 0;
};

const positiveCloseSnapshotNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};

const normalizeCloseSnapshotSide = (value: unknown): TradeOverlaySide => {
  const side = String(value ?? '').trim().toUpperCase();
  return side.includes('SELL') || side === '1' ? 'SELL' : 'BUY';
};

export const getTradeOverlayTicketKey = (value: unknown): string | null => {
  const ticket = getTicket(value);
  return ticket ? `trade:${ticket}` : null;
};

export const getTradeOverlayCloseState = (detail: unknown): TradeOverlayCloseState | null => {
  if (!detail || typeof detail !== 'object') return null;
  const status = String((detail as Record<string, unknown>).status ?? '').trim().toLowerCase();
  if (status === 'pending' || status === 'confirmed' || status === 'failed') return status;
  return null;
};

export const getTradeOverlayCloseTicketKeys = (detail: unknown): string[] => {
  if (!detail || typeof detail !== 'object') return [];

  const record = detail as Record<string, unknown>;
  const values: unknown[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) {
      values.push(...value);
      return;
    }
    values.push(value);
  };

  append(record.ticketIds);
  append(record.tickets);
  append(record.ids);
  append(record.ticket);
  append(record.id);

  const keys = new Set<string>();
  values.forEach((value) => {
    const key = getTradeOverlayTicketKey(value);
    if (key) keys.add(key);
  });

  return Array.from(keys);
};

export const getTradeOverlayCloseSnapshots = (detail: unknown): TradeOverlayCloseSnapshotSeed[] => {
  if (!detail || typeof detail !== 'object') return [];

  const record = detail as Record<string, unknown>;
  const rawSnapshots = Array.isArray(record.snapshots)
    ? record.snapshots
    : Array.isArray(record.positions)
      ? record.positions
      : [];

  return rawSnapshots.flatMap((snapshot): TradeOverlayCloseSnapshotSeed[] => {
    if (!snapshot || typeof snapshot !== 'object') return [];

    const row = snapshot as TradeOverlayCloseSnapshotPayload;
    const key = String(row.key ?? '').startsWith('trade:')
      ? String(row.key)
      : getTradeOverlayTicketKey(row.ticketId ?? row.ticket ?? row.id ?? row.positionId ?? row.position_id ?? row.position_ticket);
    const symbol = normalizeSymbol(row.symbol);
    const entryPrice = positiveCloseSnapshotNumber(row.entryPrice, row.openPrice, row.open_price, row.price_open);
    const entryTime = normalizeCloseSnapshotTime(row.entryTime ?? row.openTime ?? row.open_time ?? row.time_open);
    const exitPrice = positiveCloseSnapshotNumber(row.exitPrice, row.currentPrice, row.closePrice, row.price_current, row.current_price, row.close_price);
    const exitTime = normalizeCloseSnapshotTime(row.exitTime ?? row.closeTime ?? row.close_time);

    if (!key || !symbol || !(entryPrice > 0) || !(entryTime > 0) || !(exitPrice > 0) || !(exitTime > 0)) {
      return [];
    }

    return [{
      key,
      symbol,
      side: normalizeCloseSnapshotSide(row.side ?? row.type),
      volume: Number(row.volume ?? row.quantity ?? row.volume_lots ?? row.lots) || 0,
      entryPrice,
      entryTime,
      entryExecutionTime: entryTime,
      exitPrice,
      exitTime,
      exitExecutionTime: exitTime,
      profit: Number.isFinite(Number(row.profit)) ? Number(row.profit) : undefined,
    }];
  });
};

export const dispatchTradeOverlayCloseState = (
  ticketIds: readonly unknown[],
  status: TradeOverlayCloseState,
  options: TradeOverlayCloseStateDispatchOptions = {},
) => {
  if (typeof window === 'undefined') return;

  const tickets = ticketIds.map(getTicket).filter((ticket): ticket is string => ticket != null);
  if (tickets.length === 0) return;

  const detail = {
    status,
    ticketIds: tickets,
    ...(options.snapshots?.length ? { snapshots: options.snapshots } : {}),
  };

  if (status === 'failed') {
    clearTradeOverlayOptimisticClosedSnapshots(tickets.map((ticket) => `trade:${ticket}`));
  } else {
    rememberTradeOverlayOptimisticClosedSnapshots(detail);
  }

  window.dispatchEvent(new CustomEvent(TRADE_OVERLAY_CLOSE_STATE_EVENT, { detail }));
};

export const filterActiveTradeKeysForHistory = (
  activeTradeKeys: ReadonlySet<string>,
  closeSuppressedTradeKeys: ReadonlySet<string>,
): Set<string> => new Set(
  Array.from(activeTradeKeys).filter((key) => !closeSuppressedTradeKeys.has(key)),
);

export const shouldKeepMissingActiveTradeOverlay = ({
  tradeKey,
  closeSuppressedTradeKeys,
  closedHistoryTradeKeys,
  brokerMarkedClosed,
}: MissingActiveTradeOverlayOptions): boolean => (
  !brokerMarkedClosed
  && !closeSuppressedTradeKeys?.has(tradeKey)
  && !closedHistoryTradeKeys?.has(tradeKey)
);

export const resolveNearestTradeOverlayCandleTime = (
  targetTime: number,
  historicalCandles: readonly TradeOverlayCandleTimeSource[],
  currentCandle?: TradeOverlayCandleTimeSource | null,
  maxDistanceSeconds?: number,
): number | null => {
  if (!Number.isFinite(targetTime) || targetTime <= 0) return null;

  let bestTime: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const hasDistanceLimit = maxDistanceSeconds != null
    && Number.isFinite(maxDistanceSeconds)
    && maxDistanceSeconds >= 0;

  const consider = (source: TradeOverlayCandleTimeSource | null | undefined) => {
    const candidateTime = Number(source?.time);
    if (!Number.isFinite(candidateTime) || candidateTime <= 0) return;

    const distance = Math.abs(candidateTime - targetTime);
    if (hasDistanceLimit && distance > maxDistanceSeconds) return;
    if (
      distance < bestDistance
      || (distance === bestDistance && bestTime != null && candidateTime > bestTime)
      || bestTime == null
    ) {
      bestTime = candidateTime;
      bestDistance = distance;
    }
  };

  historicalCandles.forEach(consider);
  consider(currentCandle);

  return bestTime;
};

export const resolveStableTradeEntryTime = (
  storedEntryTime: number | null | undefined,
  rawEntryTime: number | null | undefined,
  mapTimestamp: (value: number) => number | null,
  fallbackTime: number | null | undefined,
): number => {
  if (storedEntryTime != null && Number.isFinite(storedEntryTime) && storedEntryTime > 0) {
    return storedEntryTime;
  }

  if (rawEntryTime != null && Number.isFinite(rawEntryTime) && rawEntryTime > 0) {
    return mapTimestamp(rawEntryTime) ?? rawEntryTime;
  }

  return fallbackTime != null && Number.isFinite(fallbackTime) && fallbackTime > 0 ? fallbackTime : 0;
};

export const resolveStableTradeEntryPrice = (
  storedEntryPrice: number | null | undefined,
  rawEntryPrice: number | null | undefined,
  fallbackPrice: number | null | undefined,
): number => {
  if (storedEntryPrice != null && Number.isFinite(storedEntryPrice) && storedEntryPrice > 0) {
    return storedEntryPrice;
  }

  if (rawEntryPrice != null && Number.isFinite(rawEntryPrice) && rawEntryPrice > 0) {
    return rawEntryPrice;
  }

  return fallbackPrice != null && Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : 0;
};

export const buildOptimisticClosedTradeSnapshot = ({
  key,
  symbol,
  side,
  volume,
  entryPrice,
  entryTime,
  entryExecutionTime,
  exitPrice,
  exitTime,
  exitExecutionTime,
  profit,
}: TradeOverlayCloseSnapshotSeed): ClosedTradeOverlaySnapshot | null => {
  if (
    !key
    || normalizeSymbol(symbol) === ''
    || !(entryPrice > 0)
    || !(entryTime > 0)
    || !(exitPrice > 0)
    || !(exitTime > 0)
  ) {
    return null;
  }

  return {
    key,
    symbol: normalizeSymbol(symbol),
    side,
    volume: Number(volume) || 0,
    entryPrice,
    entryTime,
    entryExecutionTime: entryExecutionTime && entryExecutionTime > 0 ? entryExecutionTime : entryTime,
    exitPrice,
    exitTime,
    exitExecutionTime: exitExecutionTime && exitExecutionTime > 0 ? exitExecutionTime : exitTime,
    profit,
    source: 'app-history',
  };
};

export const rememberTradeOverlayOptimisticClosedSnapshots = (detail: unknown, now = Date.now()) => {
  const expiresAt = now + TRADE_OVERLAY_OPTIMISTIC_HISTORY_TTL_MS;
  getTradeOverlayCloseSnapshots(detail).forEach((seed) => {
    const snapshot = buildOptimisticClosedTradeSnapshot(seed);
    if (snapshot) {
      optimisticClosedTradeSnapshotStore.set(snapshot.key, { snapshot, expiresAt });
    }
  });
};

export const clearTradeOverlayOptimisticClosedSnapshots = (keys?: readonly string[]) => {
  if (!keys) {
    optimisticClosedTradeSnapshotStore.clear();
    return;
  }

  keys.forEach((key) => optimisticClosedTradeSnapshotStore.delete(key));
};

export const forgetTradeOverlayOptimisticClosedSnapshot = (key: string) => {
  optimisticClosedTradeSnapshotStore.delete(key);
};

export const getTradeOverlayOptimisticClosedSnapshots = (
  symbol: unknown,
  now = Date.now(),
): ClosedTradeOverlaySnapshot[] => {
  pruneOptimisticClosedTradeSnapshotStore(now);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return [];

  return Array.from(optimisticClosedTradeSnapshotStore.values())
    .map((value) => value.snapshot)
    .filter((snapshot) => snapshot.symbol === normalizedSymbol);
};

const getHistorySource = (row: TradeOverlayHistoryRow): TradeOverlayHistorySource | null => {
  const source = String(row.historySource ?? '').trim().toLowerCase();
  if (source === 'closed-position' || source === 'deal' || source === 'order') return source;
  return null;
};

const normalizeDealEntryKind = (value: unknown): string => {
  const entry = String(value ?? '').trim().toLowerCase();
  if (entry === '0') return 'entry_in';
  if (entry === '1' || entry === '3') return 'entry_out';
  if (entry === '2') return 'entry_inout';
  return entry;
};

const getDealEntryKind = (row: TradeOverlayHistoryRow): string =>
  normalizeDealEntryKind(row.entry) || String(row.type ?? '').trim().toLowerCase();

const isEntryInDeal = (row: TradeOverlayHistoryRow): boolean => {
  const entry = getDealEntryKind(row);
  return entry === 'entry_in' || entry === 'in' || entry.endsWith('_in');
};

const isEntryOutDeal = (row: TradeOverlayHistoryRow): boolean => {
  const entry = getDealEntryKind(row);
  return entry === 'entry_out' || entry === 'out' || entry.endsWith('_out');
};

const isEntryInOutDeal = (row: TradeOverlayHistoryRow): boolean => {
  const entry = getDealEntryKind(row);
  return entry === 'entry_inout' || entry === 'inout' || entry.endsWith('_inout');
};

const isMt5DealEntry = (row: TradeOverlayHistoryRow): boolean => {
  const source = getHistorySource(row);
  if (source === 'order' || source === 'closed-position') return false;
  const type = String(row.type ?? '').trim().toLowerCase();
  if (type === 'closed' || type === 'closed_position') return false;
  return isEntryInDeal(row) || isEntryOutDeal(row) || isEntryInOutDeal(row);
};

const isDirectClosedHistoryRow = (row: TradeOverlayHistoryRow): boolean => {
  const source = getHistorySource(row);
  if (source === 'order') return false;
  if (source === 'closed-position') return true;

  const status = String(row.status ?? '').trim().toLowerCase();
  const type = String(row.type ?? '').trim().toLowerCase();
  return status === 'closed' || type === 'closed' || type === 'closed_position';
};

const normalizeSide = (value: unknown): TradeOverlaySide => {
  const side = String(value ?? '').trim().toUpperCase();
  return side.includes('SELL') || side === '1' ? 'SELL' : 'BUY';
};

const pickFirstValue = (...values: unknown[]): unknown | null => {
  for (const value of values) {
    if (value != null && value !== '') return value;
  }
  return null;
};

const pickPositiveNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};

const getEntryPrice = (row: TradeOverlayHistoryRow): number => pickPositiveNumber(
  row.openPrice,
  row.price_open,
  row.open_price,
  row.price,
);

const getExitPrice = (row: TradeOverlayHistoryRow): number => pickPositiveNumber(
  row.closePrice,
  row.price_close,
  row.close_price,
  row.price_current,
  row.current_price,
  row.price,
);

const getOpenTimeValue = (row: TradeOverlayHistoryRow): unknown | null => pickFirstValue(
  row.openTime,
  row.time_open,
  row.time_create,
  row.time_ms,
  row.time,
);

const getCloseTimeValue = (row: TradeOverlayHistoryRow): unknown | null => pickFirstValue(
  row.closeTime,
  row.time_close,
  row.time_ms,
  row.time,
);

const getSortTime = (row: TradeOverlayHistoryRow): number => {
  const value = getCloseTimeValue(row) ?? getOpenTimeValue(row);
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') {
      return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  return 0;
};

const getDirectTicket = (row: TradeOverlayHistoryRow): string | null =>
  getTicket(row.positionId)
  ?? getTicket(row.id)
  ?? getTicket(row.orderTicket)
  ?? getTicket(row.dealTicket);

const getSnapshotSource = (row: TradeOverlayHistoryRow): ClosedTradeOverlaySource =>
  getHistorySource(row) === 'deal' ? 'mt5-history' : 'app-history';

export const buildClosedTradeHistorySnapshots = ({
  rows,
  symbol,
  mapTimestamp,
  activeTradeKeys,
}: BuildClosedTradeHistorySnapshotsOptions): ClosedTradeOverlaySnapshot[] => {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return [];

  const dealGroups = new Map<string, DealHistoryGroup>();
  const directClosedRows: TradeOverlayHistoryRow[] = [];

  rows.forEach((row) => {
    if (normalizeSymbol(row.symbol) !== normalizedSymbol) return;

    if (isMt5DealEntry(row)) {
      const positionTicket = getTicket(row.positionId);
      const orderTicket = getTicket(row.orderTicket);
      const groupTicket = positionTicket ?? orderTicket;
      if (!groupTicket) return;

      const groupKey = positionTicket ? `position:${positionTicket}` : `order:${groupTicket}`;
      const group = dealGroups.get(groupKey) ?? { ticket: groupTicket, deals: [] };
      group.deals.push(row);
      dealGroups.set(groupKey, group);
      return;
    }

    if (isDirectClosedHistoryRow(row)) {
      directClosedRows.push(row);
    }
  });

  const snapshots = new Map<string, ClosedTradeOverlaySnapshot>();
  const addSnapshot = (snapshot: ClosedTradeOverlaySnapshot) => {
    if (
      snapshot.entryPrice > 0 &&
      snapshot.exitPrice > 0 &&
      snapshot.entryTime > 0 &&
      snapshot.exitTime > 0 &&
      !activeTradeKeys?.has(snapshot.key) &&
      !snapshots.has(snapshot.key)
    ) {
      snapshots.set(snapshot.key, snapshot);
    }
  };

  dealGroups.forEach((group) => {
    const sortedDeals = [...group.deals].sort((a, b) => getSortTime(a) - getSortTime(b));
    const openingDeal = sortedDeals.find(isEntryInDeal) ?? sortedDeals.find(isEntryInOutDeal);
    const closingDeals = sortedDeals.filter((row) => isEntryOutDeal(row) || isEntryInOutDeal(row));
    const closingDeal = closingDeals[closingDeals.length - 1];
    if (!openingDeal || !closingDeal) return;

    const groupTicket = getTicket(openingDeal.positionId)
      ?? getTicket(closingDeal.positionId)
      ?? group.ticket;
    const closingVolume = closingDeals.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
    const rawEntryTime = getOpenTimeValue(openingDeal);
    const rawExitTime = getCloseTimeValue(closingDeal);
    const entryTime = mapTimestamp(rawEntryTime);
    const exitTime = mapTimestamp(rawExitTime);

    addSnapshot({
      key: `trade:${groupTicket}`,
      symbol: normalizedSymbol,
      side: normalizeSide(openingDeal.side),
      volume: closingVolume || Number(openingDeal.volume) || Number(closingDeal.volume) || 0,
      entryPrice: getEntryPrice(openingDeal),
      entryTime,
      entryExecutionTime: normalizeCloseSnapshotTime(rawEntryTime) || entryTime,
      exitPrice: getExitPrice(closingDeal),
      exitTime,
      exitExecutionTime: normalizeCloseSnapshotTime(rawExitTime) || exitTime,
      profit: sortedDeals.reduce((sum, row) => sum + (Number(row.profit) || 0), 0),
      source: 'mt5-history',
    });
  });

  directClosedRows.forEach((row) => {
    const ticket = getDirectTicket(row);
    if (!ticket) return;
    const rawEntryTime = getOpenTimeValue(row);
    const rawExitTime = getCloseTimeValue(row);
    const entryTime = mapTimestamp(rawEntryTime);
    const exitTime = mapTimestamp(rawExitTime);

    addSnapshot({
      key: `trade:${ticket}`,
      symbol: normalizedSymbol,
      side: normalizeSide(row.side),
      volume: Number(row.volume) || 0,
      entryPrice: getEntryPrice(row),
      entryTime,
      entryExecutionTime: normalizeCloseSnapshotTime(rawEntryTime) || entryTime,
      exitPrice: getExitPrice(row),
      exitTime,
      exitExecutionTime: normalizeCloseSnapshotTime(rawExitTime) || exitTime,
      profit: Number(row.profit ?? 0),
      source: getSnapshotSource(row),
    });
  });

  return Array.from(snapshots.values());
};
