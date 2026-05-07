import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SimPositionType = 'BUY' | 'SELL';

export interface SimPosition {
  id: string;
  symbol: string;
  side: SimPositionType;
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number | null;
  tp: number | null;
  openTime: number;
  pnl: number;
}

export interface SimTrade {
  id: string;
  symbol: string;
  side: SimPositionType;
  volume: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  openTime: number;
  closeTime: number;
  duration: number; // milliseconds
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

interface TradingSimState {
  // Account state
  startingBalance: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  positions: SimPosition[];
  tradeHistory: SimTrade[];
  equityCurve: EquityPoint[];

  // Settings
  simulationSpeed: number; // 1x, 2x, 5x, 10x
  selectedSymbol: string;

  // Actions
  setStartingBalance: (amount: number) => void;
  openPosition: (symbol: string, side: SimPositionType, volume: number, price: number, sl: number | null, tp: number | null) => void;
  closePosition: (positionId: string, exitPrice: number) => void;
  updatePositionPrices: (priceUpdates: { symbol: string; price: number }[]) => void;
  setSimulationSpeed: (speed: number) => void;
  setSelectedSymbol: (symbol: string) => void;
  resetAccount: () => void;
}

const LEVERAGE = 100; // 1:100 leverage
const MARGIN_PERCENTAGE = 1 / LEVERAGE;

// Calculate margin required for a position
function calculateMargin(volume: number, price: number): number {
  return volume * price * MARGIN_PERCENTAGE;
}

// Calculate P&L for a position
function calculatePnL(side: SimPositionType, volume: number, openPrice: number, currentPrice: number): number {
  const priceDiff = side === 'BUY' ? (currentPrice - openPrice) : (openPrice - currentPrice);
  return priceDiff * volume;
}

const initialState = {
  startingBalance: 10000,
  balance: 10000,
  equity: 10000,
  margin: 0,
  freeMargin: 10000,
  positions: [] as SimPosition[],
  tradeHistory: [] as SimTrade[],
  equityCurve: [{ timestamp: Date.now(), equity: 10000 }] as EquityPoint[],
  simulationSpeed: 1,
  selectedSymbol: 'EURUSD',
};

export const useTradingSimStore = create<TradingSimState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setStartingBalance: (amount: number) => {
        set({
          startingBalance: amount,
          balance: amount,
          equity: amount,
          freeMargin: amount,
          positions: [],
          tradeHistory: [],
          equityCurve: [{ timestamp: Date.now(), equity: amount }],
        });
      },

      openPosition: (symbol: string, side: SimPositionType, volume: number, price: number, sl: number | null, tp: number | null) => {
        const state = get();
        const margin = calculateMargin(volume, price);

        // Check if sufficient free margin
        if (margin > state.freeMargin) {
          console.warn('Insufficient margin');
          return;
        }

        const newPosition: SimPosition = {
          id: `pos-${Date.now()}-${Math.random()}`,
          symbol,
          side,
          volume,
          openPrice: price,
          currentPrice: price,
          sl,
          tp,
          openTime: Date.now(),
          pnl: 0,
        };

        const newPositions = [...state.positions, newPosition];
        const totalMargin = newPositions.reduce((sum, p) => sum + calculateMargin(p.volume, p.openPrice), 0);
        const totalPnL = newPositions.reduce((sum, p) => sum + p.pnl, 0);
        const newEquity = state.balance + totalPnL;
        const newFreeMargin = newEquity - totalMargin;

        set({
          positions: newPositions,
          margin: totalMargin,
          equity: newEquity,
          freeMargin: newFreeMargin,
        });
      },

      closePosition: (positionId: string, exitPrice: number) => {
        const state = get();
        const position = state.positions.find((p) => p.id === positionId);
        if (!position) return;

        const finalPnL = calculatePnL(position.side, position.volume, position.openPrice, exitPrice);
        const newBalance = state.balance + finalPnL;

        const closedTrade: SimTrade = {
          id: `trade-${Date.now()}`,
          symbol: position.symbol,
          side: position.side,
          volume: position.volume,
          entryPrice: position.openPrice,
          exitPrice,
          pnl: finalPnL,
          openTime: position.openTime,
          closeTime: Date.now(),
          duration: Date.now() - position.openTime,
        };

        const newPositions = state.positions.filter((p) => p.id !== positionId);
        const totalMargin = newPositions.reduce((sum, p) => sum + calculateMargin(p.volume, p.openPrice), 0);
        const totalPnL = newPositions.reduce((sum, p) => sum + p.pnl, 0);
        const newEquity = newBalance + totalPnL;
        const newFreeMargin = newEquity - totalMargin;

        const newEquityCurve = [...state.equityCurve, { timestamp: Date.now(), equity: newEquity }];
        // Keep last 100 points
        if (newEquityCurve.length > 100) {
          newEquityCurve.shift();
        }

        set({
          positions: newPositions,
          balance: newBalance,
          equity: newEquity,
          margin: totalMargin,
          freeMargin: newFreeMargin,
          tradeHistory: [closedTrade, ...state.tradeHistory],
          equityCurve: newEquityCurve,
        });
      },

      updatePositionPrices: (priceUpdates: { symbol: string; price: number }[]) => {
        const state = get();
        const priceMap = new Map(priceUpdates.map((u) => [u.symbol, u.price]));

        const updatedPositions = state.positions.map((position) => {
          const newPrice = priceMap.get(position.symbol);
          if (newPrice === undefined) return position;

          const newPnL = calculatePnL(position.side, position.volume, position.openPrice, newPrice);

          // Check SL/TP
          let shouldClose = false;
          if (position.sl !== null) {
            if (position.side === 'BUY' && newPrice <= position.sl) shouldClose = true;
            if (position.side === 'SELL' && newPrice >= position.sl) shouldClose = true;
          }
          if (position.tp !== null) {
            if (position.side === 'BUY' && newPrice >= position.tp) shouldClose = true;
            if (position.side === 'SELL' && newPrice <= position.tp) shouldClose = true;
          }

          if (shouldClose) {
            // Close position via action
            setTimeout(() => get().closePosition(position.id, newPrice), 0);
          }

          return {
            ...position,
            currentPrice: newPrice,
            pnl: newPnL,
          };
        });

        const totalPnL = updatedPositions.reduce((sum, p) => sum + p.pnl, 0);
        const newEquity = state.balance + totalPnL;
        const totalMargin = updatedPositions.reduce((sum, p) => sum + calculateMargin(p.volume, p.openPrice), 0);
        const newFreeMargin = newEquity - totalMargin;

        set({
          positions: updatedPositions,
          equity: newEquity,
          freeMargin: newFreeMargin,
        });
      },

      setSimulationSpeed: (speed: number) => set({ simulationSpeed: speed }),
      setSelectedSymbol: (symbol: string) => set({ selectedSymbol: symbol }),

      resetAccount: () => {
        const startingBalance = get().startingBalance;
        set({
          balance: startingBalance,
          equity: startingBalance,
          margin: 0,
          freeMargin: startingBalance,
          positions: [],
          tradeHistory: [],
          equityCurve: [{ timestamp: Date.now(), equity: startingBalance }],
        });
      },
    }),
    {
      name: 'rtx5-trading-sim-storage',
    }
  )
);
