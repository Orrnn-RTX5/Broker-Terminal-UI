import { create } from 'zustand';

export type BulkCloseType = 'ALL' | 'WINNERS' | 'LOSERS';

export interface BulkClosePreviewPosition {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  pnl: number;
}

interface BulkCloseConfirmState {
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

export const useBulkCloseConfirmStore = create<BulkCloseConfirmState>((set) => ({
  isOpen: false,
  type: 'ALL',
  symbol: undefined,
  positions: [],
  combinedPnL: 0,
  onConfirm: () => { },
  onCancel: () => { },
  showBulkCloseConfirm: ({ type, symbol, positions, combinedPnL }) => {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        type,
        symbol,
        positions,
        combinedPnL,
        onConfirm: () => {
          set({ isOpen: false });
          resolve(true);
        },
        onCancel: () => {
          set({ isOpen: false });
          resolve(false);
        },
      });
    });
  },
  closeBulkCloseConfirm: () => set({ isOpen: false }),
}));
