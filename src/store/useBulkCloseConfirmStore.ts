import { create } from 'zustand';
import type { BulkCloseMode } from '../contracts/tradeActions';

export type BulkCloseType = BulkCloseMode;

export interface BulkClosePreviewPosition {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  pnl: number;
}

interface BulkCloseConfirmState {
  requestId: number;
  isOpen: boolean;
  type: BulkCloseType;
  symbol: string | undefined;
  positions: BulkClosePreviewPosition[];
  combinedPnL: number;
  onConfirm: () => void;
  onCancel: () => void;
  showBulkCloseConfirm: (params: {
    type: BulkCloseType;
    symbol?: string;
    positions: BulkClosePreviewPosition[];
    combinedPnL: number;
  }) => Promise<boolean>;
  closeBulkCloseConfirm: () => void;
}

let nextBulkCloseConfirmationId = 0;

export const useBulkCloseConfirmStore = create<BulkCloseConfirmState>((set, get) => ({
  requestId: 0,
  isOpen: false,
  type: 'ALL',
  symbol: undefined,
  positions: [],
  combinedPnL: 0,
  onConfirm: () => { },
  onCancel: () => { },
  showBulkCloseConfirm: ({ type, symbol, positions, combinedPnL }) => {
    const previous = get();
    if (previous.isOpen) previous.onCancel();

    return new Promise((resolve) => {
      const requestId = ++nextBulkCloseConfirmationId;
      let settled = false;
      const settle = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        if (get().requestId === requestId) set({ isOpen: false });
        resolve(confirmed);
      };

      set({
        requestId,
        isOpen: true,
        type,
        symbol,
        positions,
        combinedPnL,
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
      });
    });
  },
  closeBulkCloseConfirm: () => {
    const current = get();
    if (current.isOpen) {
      current.onCancel();
      return;
    }
    set({ isOpen: false });
  },
}));
