export type PendingOrderLifecycleStatus =
  | 'filled'
  | 'triggered'
  | 'limit_activated'
  | 'expired'
  | 'rejected';

export interface PendingOrderLifecycleNotice {
  dedupeKey: string;
  login: string;
  ticket: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  volume: number;
  price: number;
  status: PendingOrderLifecycleStatus;
  errorCode?: string;
  reason?: string;
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
);

const normalizeStatus = (rawStatus: unknown, rawEvent: unknown): PendingOrderLifecycleStatus | null => {
  const status = String(rawStatus ?? '').trim().toLowerCase();
  const event = String(rawEvent ?? '').trim().toLowerCase();

  if (status === 'filled' || event === 'order_filled' || event === 'pending_order_filled') {
    return 'filled';
  }
  if (status === 'triggered' || event === 'order_triggered' || event === 'pending_order_triggered') {
    return 'triggered';
  }
  if (status === 'limit_activated' || event === 'pending_order_limit_activated' || event === 'stop_limit_activated') {
    return 'limit_activated';
  }
  if (status === 'expired' || event === 'order_expired' || event === 'pending_order_expired') {
    return 'expired';
  }
  if (status === 'rejected' || event === 'order_rejected' || event === 'pending_order_rejected') {
    return 'rejected';
  }
  return null;
};

const formatOrderTypeLabel = (rawOrderType: unknown, fallbackSide: 'BUY' | 'SELL'): string => {
  const cleaned = String(rawOrderType ?? '').trim().toUpperCase().replace(/_/g, ' ');
  if (cleaned) return cleaned;
  return `${fallbackSide} ORDER`;
};

export function parsePendingOrderLifecycleFrame(
  topic: string,
  payload: unknown,
  previousOrders?: ReadonlyArray<Record<string, unknown>>,
): PendingOrderLifecycleNotice | null {
  const channel = String(topic ?? '').trim();
  if (!channel.startsWith('orders.') && !channel.startsWith('rtx5.pending_orders.')) {
    return null;
  }
  const parts = channel.split('.');
  const login = String(parts[parts.length - 1] ?? '').trim();

  const root = asRecord(payload);
  if (!root) return null;
  const nested = asRecord(root.data) ?? asRecord(root.order) ?? root;

  const ticketRaw = nested.ticket ?? nested.order_ticket ?? nested.id ?? root.ticket ?? root.order_ticket ?? root.id;
  const ticket = String(ticketRaw ?? '').trim();
  if (!ticket || ticket === '0') return null;

  const status = normalizeStatus(
    nested.status ?? root.status,
    nested.event ?? nested.type ?? root.event ?? root.type,
  );
  if (!status) return null;

  const prevMatch = Array.isArray(previousOrders)
    ? previousOrders.find((ord) => String(ord.ticket ?? ord.id ?? '') === ticket)
    : undefined;

  const symbol = String(nested.symbol ?? root.symbol ?? prevMatch?.symbol ?? '').trim().toUpperCase();
  const rawOrderType = nested.order_type ?? nested.orderType ?? nested.type ?? prevMatch?.order_type ?? prevMatch?.type ?? '';
  const rawSide = String(nested.side ?? nested.action ?? rawOrderType ?? prevMatch?.side ?? prevMatch?.type ?? '').toUpperCase();
  const side: 'BUY' | 'SELL' = rawSide.includes('SELL') ? 'SELL' : 'BUY';
  const orderType = formatOrderTypeLabel(rawOrderType, side);
  const volume = Number(nested.volume ?? nested.lots ?? prevMatch?.volume ?? prevMatch?.lots ?? 0);
  const price = Number(
    nested.fill_price
      ?? nested.price_open
      ?? nested.price_current
      ?? nested.price_limit
      ?? nested.price_trigger
      ?? nested.price
      ?? prevMatch?.price_trigger
      ?? prevMatch?.price
      ?? 0,
  );
  const stateVersion = nested.state_version ?? root.state_version ?? '';
  const errorCode = typeof (nested.error_code ?? root.error_code) === 'string'
    ? String(nested.error_code ?? root.error_code)
    : undefined;
  const reason = typeof (nested.reason ?? nested.error ?? root.reason ?? root.error) === 'string'
    ? String(nested.reason ?? nested.error ?? root.reason ?? root.error)
    : errorCode;

  return {
    dedupeKey: `${login}:${ticket}:${status}:${String(stateVersion)}`,
    login,
    ticket,
    symbol: symbol || 'UNKNOWN',
    side,
    orderType,
    volume: Number.isFinite(volume) ? volume : 0,
    price: Number.isFinite(price) ? price : 0,
    status,
    ...(errorCode ? { errorCode } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function createPendingLifecycleDeduper(maxEntries = 256) {
  const seen = new Set<string>();
  return {
    shouldEmit(dedupeKey: string): boolean {
      const baseKey = dedupeKey.split(':').slice(0, 3).join(':');
      if (seen.has(dedupeKey) || seen.has(baseKey)) {
        return false;
      }
      seen.add(dedupeKey);
      seen.add(baseKey);
      while (seen.size > maxEntries * 2) {
        const oldest = seen.values().next().value;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
      return true;
    },
    clear(): void {
      seen.clear();
    },
  };
}
