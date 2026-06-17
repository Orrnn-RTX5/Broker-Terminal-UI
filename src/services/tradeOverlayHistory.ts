export type TradeOverlaySide = 'BUY' | 'SELL';
export type TradeOverlayHistorySource = 'closed-position' | 'deal' | 'order';
export type ClosedTradeOverlaySource = 'mt5-history' | 'app-history';
export type TradeOverlayCloseState = 'pending' | 'confirmed' | 'failed';

export const TRADE_OVERLAY_CLOSE_STATE_EVENT = 'rtx:trade-overlay-close-state';
export const TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS = 5 * 60 * 1000;

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
  entryTime: number;
  exitPrice: number;
  exitTime: number;
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
  exitPrice: number;
  exitTime: number;
  profit?: number;
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
}

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

const normalizeSymbol = (value: unknown): string =>
  String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const getTicket = (value: unknown): string | null => {
  const ticket = String(value ?? '').trim();
  if (!ticket) return null;
  const numericTicket = Number(ticket);
  if (Number.isFinite(numericTicket) && numericTicket <= 0) return null;
  return ticket;
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

export const dispatchTradeOverlayCloseState = (
  ticketIds: readonly unknown[],
  status: TradeOverlayCloseState,
) => {
  if (typeof window === 'undefined') return;

  const tickets = ticketIds.map(getTicket).filter((ticket): ticket is string => ticket != null);
  if (tickets.length === 0) return;

  window.dispatchEvent(new CustomEvent(TRADE_OVERLAY_CLOSE_STATE_EVENT, {
    detail: { status, ticketIds: tickets },
  }));
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
}: MissingActiveTradeOverlayOptions): boolean => (
  !closeSuppressedTradeKeys?.has(tradeKey)
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

export const buildOptimisticClosedTradeSnapshot = ({
  key,
  symbol,
  side,
  volume,
  entryPrice,
  entryTime,
  exitPrice,
  exitTime,
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
    exitPrice,
    exitTime,
    profit,
    source: 'app-history',
  };
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

    addSnapshot({
      key: `trade:${groupTicket}`,
      symbol: normalizedSymbol,
      side: normalizeSide(openingDeal.side),
      volume: closingVolume || Number(openingDeal.volume) || Number(closingDeal.volume) || 0,
      entryPrice: getEntryPrice(openingDeal),
      entryTime: mapTimestamp(getOpenTimeValue(openingDeal)),
      exitPrice: getExitPrice(closingDeal),
      exitTime: mapTimestamp(getCloseTimeValue(closingDeal)),
      profit: sortedDeals.reduce((sum, row) => sum + (Number(row.profit) || 0), 0),
      source: 'mt5-history',
    });
  });

  directClosedRows.forEach((row) => {
    const ticket = getDirectTicket(row);
    if (!ticket) return;

    addSnapshot({
      key: `trade:${ticket}`,
      symbol: normalizedSymbol,
      side: normalizeSide(row.side),
      volume: Number(row.volume) || 0,
      entryPrice: getEntryPrice(row),
      entryTime: mapTimestamp(getOpenTimeValue(row)),
      exitPrice: getExitPrice(row),
      exitTime: mapTimestamp(getCloseTimeValue(row)),
      profit: Number(row.profit ?? 0),
      source: getSnapshotSource(row),
    });
  });

  return Array.from(snapshots.values());
};
