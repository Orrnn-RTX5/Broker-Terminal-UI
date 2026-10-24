import { extractAccountMetrics, normalizeAccountMetrics } from '../../services/accountMetrics';
import { readBackendNumber } from '../../services/backendAccountMetrics';
import { getTradeEntryPriceFromQuote } from '../../services/chartPriceGuards';
import { readBackendPositionProfit } from '../../components/BottomDock.trade';
import { readPositionStreamEvent } from '../../services/positionStream';
import { resolveOptionalPositionTime, resolvePositionOpenTime } from '../../services/tradePositionTime';
import { resolveTickFromLookup, shouldReplaceOpenPositionSnapshot, useAppStore, type Position } from '../../store/useAppStore';
import { toNumber, type NormalizedRealtimeTick as Tick } from '../../features/trading/runtime/marketTickNormalization';
import type { TradeOverlayCloseSnapshotPayload } from '../../services/tradeOverlayHistory';

type RawRecord = Record<string, unknown>;

const asStringOrNumber = (value: unknown): string | number | undefined => (
  typeof value === 'string' || typeof value === 'number' ? value : undefined
);

export const normalizePositions = (payload: unknown): Position[] => {
  const source: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as RawRecord | undefined)?.positions)
      ? (payload as RawRecord).positions as unknown[]
      : [];

  return source.flatMap((raw: RawRecord): Position[] => {
    const parsedId = Number.parseInt(String(
      raw.ticket ?? raw.position_id ?? raw.position_ticket ?? raw.id ?? '',
    ), 10);
    if (!Number.isFinite(parsedId) || parsedId <= 0) return [];

    const openPrice = toNumber(raw.price_open ?? raw.open_price ?? raw.openPrice ?? raw.entryPrice ?? raw.chartEntryPrice ?? raw.price, 0);
    const backendCurrentPrice = readBackendNumber(raw.price_current ?? raw.current_price ?? raw.currentPrice ?? raw.livePrice);
    const currentPrice = backendCurrentPrice ?? 0;
    const rawSide = String(raw.side ?? '').toLowerCase();
    const chartEntryTime = resolveOptionalPositionTime(raw.chartEntryTime ?? raw.chart_entry_time);
    const openTime = resolvePositionOpenTime(raw, chartEntryTime);
    const volume = toNumber(raw.volume_lots ?? raw.quantity ?? raw.volume, 0);
    const backendProfit = readBackendNumber(raw.profit ?? raw.unrealized_pl ?? raw.unrealizedPnL);
    const profit = backendProfit ?? 0;

    return [{
      id: parsedId,
      protection_version: raw.protection_version as string | number | undefined,
      symbol: String(raw.symbol ?? ''),
      side: rawSide === 'sell' || rawSide === 'short' || Number(raw.action) === 1 ? 'SELL' : 'BUY',
      volume,
      openPrice,
      currentPrice,
      openTime,
      sl: toNumber(raw.price_sl ?? raw.sl, 0),
      tp: toNumber(raw.price_tp ?? raw.tp, 0),
      swap: toNumber(raw.swap, 0),
      commission: toNumber(raw.commission, 0),
      unrealizedPnL: profit,
      hasBackendProfit: raw.hasBackendProfit !== false && raw.pnl_available !== false && backendProfit !== undefined,
      hasBackendCurrentPrice: raw.hasBackendCurrentPrice !== false && raw.pnl_available !== false && backendCurrentPrice !== undefined,
      state_version: asStringOrNumber(raw.state_version_text ?? raw.state_version),
      price_time_msc: asStringOrNumber(raw.price_time_msc),
      pnl_available: typeof raw.pnl_available === 'boolean' ? raw.pnl_available : undefined,
      chartEntryPrice: toNumber(raw.chartEntryPrice, 0) || undefined,
      chartEntryTime,
      open_price: openPrice,
      price_open: openPrice,
      current_price: currentPrice,
      price_current: currentPrice,
      time_create: openTime,
      open_time: openTime,
      time: openTime,
      profit,
      quantity: volume,
    }];
  });
};

export const getChartEntryPriceForSymbol = (symbol: string, side: 'BUY' | 'SELL'): number | undefined => {
  const state = useAppStore.getState();
  const tick = resolveTickFromLookup(state.ticks, state.tickLookup, symbol);
  return getTradeEntryPriceFromQuote(tick, side) ?? undefined;
};

export const upsertImmediatePosition = (position: Position): void => {
  const store = useAppStore.getState();
  const positions = store.positions as unknown as Position[];
  const existingIndex = positions.findIndex((existing) => existing.id === position.id);
  const nextPositions = existingIndex >= 0
    ? positions.map((existing, index) => index === existingIndex ? { ...existing, ...position } : existing)
    : [position, ...positions];

  store.setPositions(nextPositions, { touchedTickets: [position.id] });
};

/**
 * Applies a positions read. A complete read decides closure for the tickets it omits,
 * by its start stamp (see setPositions). A partial read only merges and closes nothing.
 */
export const applyOpenPositionSnapshot = (
  incoming: Position[],
  read: { readStartedAt: number; complete: boolean },
): void => {
  const store = useAppStore.getState();
  if (read.complete) {
    store.setPositions(incoming, { readStartedAt: read.readStartedAt });
    return;
  }
  if (shouldReplaceOpenPositionSnapshot(incoming, store.positions as unknown as Position[])) {
    store.setPositions(incoming);
  }
};

export const backendCloseProfit = (position: Position): number | null => readBackendPositionProfit(position);

const getTradeExitPriceFromQuote = (tick: Tick | undefined, side: 'BUY' | 'SELL'): number | null => {
  if (!tick) return null;

  const bid = Number(tick.bid);
  const ask = Number(tick.ask);
  const last = Number(tick.last);
  if (side === 'BUY') {
    if (Number.isFinite(bid) && bid > 0) return bid;
    if (Number.isFinite(ask) && ask > 0) return ask;
    return Number.isFinite(last) && last > 0 ? last : null;
  }
  if (Number.isFinite(ask) && ask > 0) return ask;
  if (Number.isFinite(bid) && bid > 0) return bid;
  return Number.isFinite(last) && last > 0 ? last : null;
};

export const buildTradeOverlayCloseSnapshots = (positions: readonly Position[]): TradeOverlayCloseSnapshotPayload[] => {
  if (positions.length === 0) return [];

  const { ticks, tickLookup } = useAppStore.getState();
  const closeTime = Date.now();
  return positions.flatMap((position): TradeOverlayCloseSnapshotPayload[] => {
    const side = String(position.side ?? '').trim().toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
    const tick = resolveTickFromLookup(ticks, tickLookup, position.symbol);
    const entryPrice = Number(position.chartEntryPrice || position.openPrice || 0);
    const entryTime = position.chartEntryTime || position.openTime;
    const exitPrice = getTradeExitPriceFromQuote(tick, side)
      ?? (Number(position.currentPrice) > 0 ? Number(position.currentPrice) : 0);
    if (!position.id || !position.symbol || !(entryPrice > 0) || !entryTime || !(exitPrice > 0)) return [];

    return [{
      ticketId: position.id,
      symbol: position.symbol,
      side,
      volume: position.volume,
      entryPrice,
      entryTime,
      exitPrice,
      exitTime: closeTime,
      currentPrice: exitPrice,
      closeTime,
      profit: backendCloseProfit(position),
    }];
  });
};

export const normalizeAccountSummary = normalizeAccountMetrics;
export { extractAccountMetrics };

export const toV2Timeframe = (value: string | undefined): string => {
  const normalized = String(value || 'M1').trim().toUpperCase();
  const map: Record<string, string> = {
    '1M': 'M1', '5M': 'M5', '15M': 'M15', '30M': 'M30',
    '1H': 'H1', '4H': 'H4', '1D': 'D1', '1W': 'W1',
  };
  return map[normalized] || normalized;
};

export const getPositionEventName = (message: unknown): string => readPositionStreamEvent(message).event;

export const getPositionEventTicket = (message: unknown): number | null => {
  const payload = (readPositionStreamEvent(message).position ?? {}) as RawRecord;
  const envelope = (message ?? {}) as RawRecord;
  const ticket = Number.parseInt(String(
    payload?.ticket
      ?? payload?.position_id
      ?? payload?.position_ticket
      ?? payload?.id
      ?? envelope.ticket
      ?? '',
  ), 10);
  return Number.isFinite(ticket) && ticket > 0 ? ticket : null;
};
