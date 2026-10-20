import { memo, useCallback, useMemo, useState } from 'react';
import api from '../../../services/api';
import { useAppStore } from '../../../store/useAppStore';
import { useConfirmStore } from '../../../store/useConfirmStore';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import { formatPrice, resolveSpecDigits } from '../../../utils/symbolUtils';

export type PendingOrderView = {
  ticket: number;
  symbol: string;
  orderType: string;
  side: 'BUY' | 'SELL';
  volume: number;
  price: number;
  sl: number;
  tp: number;
  expiry: number | null;
  timeSetup: number | null;
  status: string;
};

const toFiniteNumber = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// Map one backend pending row (GET /api/v2/orders/pending/{login} shape:
// ticket, symbol, type, volume, price, price_sl/price_tp/sl_decimal,
// time_expiry, time_setup, status) to the row view. Side is derived from the
// order-type prefix (buy_*/sell_*); the list endpoint carries no side field.
export const toPendingOrderView = (row: Record<string, any>): PendingOrderView | null => {
  const ticket = toFiniteNumber(row.ticket ?? row.id);
  const symbol = String(row.symbol ?? '').trim();
  const orderType = String(row.type ?? '').trim();
  if (!ticket || ticket <= 0 || !symbol || !orderType) return null;
  const lowerType = orderType.toLowerCase();
  const side: 'BUY' | 'SELL' = lowerType.startsWith('sell') ? 'SELL' : 'BUY';
  const volume = toFiniteNumber(row.volume ?? row.quantity) ?? 0;
  const price = toFiniteNumber(row.price ?? row.price_decimal) ?? 0;
  const sl = toFiniteNumber(row.price_sl ?? row.sl ?? row.sl_decimal) ?? 0;
  const tp = toFiniteNumber(row.price_tp ?? row.tp ?? row.tp_decimal) ?? 0;
  const expiry = toFiniteNumber(row.time_expiry ?? row.expiry ?? row.expiration);
  const timeSetup = toFiniteNumber(row.time_setup ?? row.time_create);
  return {
    ticket: Math.trunc(ticket),
    symbol,
    orderType,
    side,
    volume,
    price,
    sl,
    tp,
    expiry,
    timeSetup,
    status: String(row.status ?? 'pending'),
  };
};

const currentLoginId = (): number | null => {
  const login = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
  return Number.isFinite(login) && login > 0 ? login : null;
};

const refreshPendingOrders = async (loginId: number): Promise<void> => {
  const latest = await api.orders.getPendingOrders(loginId);
  useAppStore.getState().setOrders(latest as any);
};

type PendingOrdersPanelProps = {
  onModifyOrder: (order: PendingOrderView) => void;
  onCancelOrder: (ticket: number) => Promise<void> | void;
  // Bulk handler with ONE confirm owned by the handler (SUI-T5). When wired,
  // bulk cancel delegates to it (no panel-local confirm, no per-ticket loop);
  // otherwise the panel falls back to the per-ticket no-confirm core with one
  // confirm — never through the confirming single path.
  onCancelBulkOrders?: (tickets: number[]) => Promise<void> | void;
  onCancelOrderWithoutConfirm?: (ticket: number) => Promise<void> | void;
};

export const PendingOrdersPanel = memo(function PendingOrdersPanel({
  onModifyOrder,
  onCancelOrder,
  onCancelBulkOrders,
  onCancelOrderWithoutConfirm,
}: PendingOrdersPanelProps) {
  const tr = useUiTranslation();
  const storeOrders = useAppStore((s) => s.orders);
  const storeTicks = useAppStore((s) => s.ticks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orders = useMemo(() => {
    const views: PendingOrderView[] = [];
    for (const row of storeOrders ?? []) {
      const view = toPendingOrderView(row as unknown as Record<string, any>);
      if (view) views.push(view);
    }
    return views.sort((a, b) => a.ticket - b.ticket);
  }, [storeOrders]);

  // Single-row cancel with the same bulk-style handling: user-visible error
  // plus backend refresh (ds-19 U2 review gap). The outer handler may also
  // refresh, but the panel never relies on which handler is wired.
  const cancelOne = useCallback(async (ticket: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCancelOrder(ticket);
      const loginId = currentLoginId();
      if (loginId) await refreshPendingOrders(loginId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }, [busy, onCancelOrder]);

  const cancelMany = useCallback(async (mode: 'ALL' | 'BUY' | 'SELL') => {
    const targets = orders.filter((o) => mode === 'ALL' || o.side === mode);
    if (targets.length === 0 || busy) return;
    if (onCancelBulkOrders) {
      // Single-confirm bulk path (SUI-T5): the handler owns the ONE confirm,
      // sequential per-ticket keys, refresh and rethrow.
      setBusy(true);
      setError(null);
      try {
        await onCancelBulkOrders(targets.map((o) => o.ticket));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Bulk cancel failed');
      } finally {
        setBusy(false);
      }
      return;
    }
    const confirmed = await useConfirmStore.getState().showConfirm(
      tr('Cancel'),
      mode === 'ALL'
        ? `${tr('Cancel all pending orders?')} (${targets.length})`
        : `${tr('Cancel all pending side orders?')} (${mode}, ${targets.length})`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      // Fallback path: never through the confirming single path — use the
      // no-confirm core when wired, else the single handler (degraded: its
      // own confirm fires per ticket).
      const cancelOne = onCancelOrderWithoutConfirm ?? onCancelOrder;
      for (const order of targets) {
        await cancelOne(order.ticket);
      }
      const loginId = currentLoginId();
      if (loginId) await refreshPendingOrders(loginId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk cancel failed');
    } finally {
      setBusy(false);
    }
  }, [orders, busy, onCancelOrder, onCancelBulkOrders, onCancelOrderWithoutConfirm, tr]);

  if (orders.length === 0) {
    return (
      <div className="text-xs text-zinc-500 text-center py-4">
        {error ? <span className="text-red-400">{error}</span> : tr('No pending orders')}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-xs text-zinc-400">{tr('Pending')} ({orders.length})</span>
        <span className="flex-1" />
        <button type="button" disabled={busy} onClick={() => void cancelMany('BUY')}
          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50">
          {tr('Cancel Buys')}
        </button>
        <button type="button" disabled={busy} onClick={() => void cancelMany('SELL')}
          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50">
          {tr('Cancel Sells')}
        </button>
        <button type="button" disabled={busy} onClick={() => void cancelMany('ALL')}
          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50">
          {tr('Cancel All')}
        </button>
      </div>
      {error && (
        <div className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded p-2 mx-2 mb-1">
          {error}
        </div>
      )}
      <div className="overflow-auto min-h-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="text-zinc-500 text-left">
              <th className="px-2 py-1 font-normal">{tr('Ticket')}</th>
              <th className="px-2 py-1 font-normal">{tr('Symbol')}</th>
              <th className="px-2 py-1 font-normal">{tr('Type')}</th>
              <th className="px-2 py-1 font-normal">{tr('Side')}</th>
              <th className="px-2 py-1 font-normal text-right">{tr('Volume')}</th>
              <th className="px-2 py-1 font-normal text-right">{tr('Price')}</th>
              <th className="px-2 py-1 font-normal text-right">{tr('SL')}</th>
              <th className="px-2 py-1 font-normal text-right">{tr('TP')}</th>
              <th className="px-2 py-1 font-normal text-right">{tr('Expiry')}</th>
              <th className="px-2 py-1 font-normal text-right">{tr('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              // Spec digits only (live tick); unknown renders raw downstream.
              const orderTick = (storeTicks ?? {})[order.symbol]
                ?? (storeTicks ?? {})[order.symbol.toUpperCase()];
              const digits = resolveSpecDigits(orderTick?.digits);
              return (
                <tr key={order.ticket} className="border-t border-zinc-800 hover:bg-zinc-800/40" data-ticket={order.ticket}>
                  <td className="px-2 py-1 text-zinc-300">{order.ticket}</td>
                  <td className="px-2 py-1 text-zinc-300">{order.symbol}</td>
                  <td className="px-2 py-1 text-zinc-400">{order.orderType}</td>
                  <td className={`px-2 py-1 font-semibold ${order.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {order.side}
                  </td>
                  <td className="px-2 py-1 text-right text-zinc-300">{order.volume}</td>
                  <td className="px-2 py-1 text-right text-zinc-300">{formatPrice(order.price, digits)}</td>
                  <td className="px-2 py-1 text-right text-red-400">{order.sl > 0 ? formatPrice(order.sl, digits) : '—'}</td>
                  <td className="px-2 py-1 text-right text-emerald-400">{order.tp > 0 ? formatPrice(order.tp, digits) : '—'}</td>
                  <td className="px-2 py-1 text-right text-zinc-400">
                    {order.expiry && order.expiry > 0 ? new Date(order.expiry * 1000).toLocaleString() : '—'}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <button type="button" disabled={busy}
                      onClick={() => onModifyOrder(order)}
                      className="text-sky-400 hover:text-sky-300 disabled:opacity-50 mr-2">
                      {tr('Modify')}
                    </button>
                    <button type="button" disabled={busy}
                      onClick={() => void cancelOne(order.ticket)}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50">
                      {tr('Cancel')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
