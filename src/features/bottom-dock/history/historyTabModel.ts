import type { Trade } from '../../../store/useAppStore';

export type HistoryViewMode = 'positions' | 'deals' | 'orders' | 'orders-and-deals';
export type HistoryVolumeMode = 'lots' | 'amounts';
export type HistorySymbolFilter =
  | { mode: 'all' }
  | { mode: 'current' }
  | { mode: 'symbol'; symbol: string };

export type HistoryColumnKey =
  | 'ticket'
  | 'status'
  | 'marketValue'
  | 'commission'
  | 'swap'
  | 'fee'
  | 'changePercent'
  | 'magicNumber'
  | 'comment';

export type CanonicalHistoryOrderStatus = 'FILLED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED' | 'PENDING';

export function resolveHistoryRowStatus(trade: Trade): CanonicalHistoryOrderStatus {
  const raw = String(trade.status ?? '').trim().toLowerCase();
  if (raw === 'cancelled' || raw === 'canceled') return 'CANCELLED';
  if (raw === 'expired') return 'EXPIRED';
  if (raw === 'rejected') return 'REJECTED';
  if (raw === 'pending' || raw === 'placed' || raw === 'open') return 'PENDING';
  return 'FILLED';
}

export function getHistoryStatusBadgeClass(status: CanonicalHistoryOrderStatus): string {
  switch (status) {
    case 'CANCELLED':
      return 'rtx-history-status-label inline-flex items-center text-[11px] font-normal text-zinc-400';
    case 'EXPIRED':
      return 'rtx-history-status-label inline-flex items-center text-[11px] font-normal text-amber-400';
    case 'REJECTED':
      return 'rtx-history-status-label inline-flex items-center text-[11px] font-normal text-rose-400';
    case 'PENDING':
      return 'rtx-history-status-label inline-flex items-center text-[11px] font-normal text-sky-400';
    case 'FILLED':
    default:
      return 'rtx-history-status-label inline-flex items-center text-[11px] font-normal text-emerald-400';
  }
}

export type HistoryColumnVisibility = Record<HistoryColumnKey, boolean>;
export type HistoryContextMenuState = { x: number; y: number; trade?: Trade };

export const HISTORY_COLUMN_STORAGE_KEY = 'rtx5_history_columns_v2';
export const HISTORY_VOLUME_MODE_STORAGE_KEY = 'rtx5_history_volume_mode';
export const HISTORY_SHOW_MILLISECONDS_STORAGE_KEY = 'rtx5_history_show_milliseconds';
export const HISTORY_AUTO_ARRANGE_STORAGE_KEY = 'rtx5_history_auto_arrange';
export const HISTORY_GRID_STORAGE_KEY = 'rtx5_history_grid';

// v1 was written as false on every mount by the old Trade-style History menu,
// so it cannot distinguish a user choice from that obsolete default.
export const HISTORY_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY = 'rtx5_history_show_on_charts_auto_update_v2';

export const HISTORY_COLUMN_DEFS: Array<{ key: HistoryColumnKey; label: string }> = [
  { key: 'ticket', label: 'Ticket' },
  { key: 'status', label: 'Status' },
  { key: 'marketValue', label: 'Market Value' },
  { key: 'commission', label: 'Commission' },
  { key: 'swap', label: 'Swap' },
  { key: 'fee', label: 'Fee' },
  { key: 'changePercent', label: 'Change %' },
  { key: 'magicNumber', label: 'Magic Number' },
  { key: 'comment', label: 'Comment' },
];

export const DEFAULT_HISTORY_COLUMNS: HistoryColumnVisibility = {
  ticket: true,
  status: true,
  marketValue: false,
  commission: false,
  swap: false,
  fee: false,
  changePercent: true,
  magicNumber: false,
  comment: false,
};
