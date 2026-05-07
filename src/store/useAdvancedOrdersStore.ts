import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type OrderSide = 'BUY' | 'SELL';
export type TimeInForce = 'GTC' | 'GTD' | 'IOC' | 'FOK';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';

// OCO Order State
export interface OCOOrder {
  symbol: string;
  volume: number;
  order1: {
    type: OrderType;
    side: OrderSide;
    price: number;
  };
  order2: {
    type: OrderType;
    side: OrderSide;
    price: number;
  };
}

// Trailing Stop Order State
export interface TrailingStopOrder {
  symbol: string;
  volume: number;
  side: OrderSide;
  trailingDistance: number; // in pips
  stopLoss?: number;
  takeProfit?: number;
}

// Time-based Order State
export interface TimeBasedOrder {
  symbol: string;
  volume: number;
  type: OrderType;
  side: OrderSide;
  price?: number;
  timeInForce: TimeInForce;
  expiryDate?: string; // ISO date string for GTD
}

// Bracket Order State
export interface BracketOrder {
  symbol: string;
  volume: number;
  side: OrderSide;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
}

// Scaled Order State
export interface ScaledOrder {
  symbol: string;
  totalVolume: number;
  side: OrderSide;
  numberOfOrders: number;
  startPrice: number;
  endPrice: number;
  priceIncrement: number;
}

export interface ScaledOrderPreview {
  orderNumber: number;
  price: number;
  volume: number;
}

interface AdvancedOrdersState {
  // OCO
  ocoOrder: OCOOrder;
  setOCOOrder: (order: Partial<OCOOrder>) => void;

  // Trailing Stop
  trailingStopOrder: TrailingStopOrder;
  setTrailingStopOrder: (order: Partial<TrailingStopOrder>) => void;

  // Time-based
  timeBasedOrder: TimeBasedOrder;
  setTimeBasedOrder: (order: Partial<TimeBasedOrder>) => void;

  // Bracket
  bracketOrder: BracketOrder;
  setBracketOrder: (order: Partial<BracketOrder>) => void;

  // Scaled
  scaledOrder: ScaledOrder;
  setScaledOrder: (order: Partial<ScaledOrder>) => void;
  calculateScaledOrderPreview: () => ScaledOrderPreview[];

  // Actions
  submitOCOOrder: () => Promise<void>;
  submitTrailingStopOrder: () => Promise<void>;
  submitTimeBasedOrder: () => Promise<void>;
  submitBracketOrder: () => Promise<void>;
  submitScaledOrder: () => Promise<void>;

  resetAllOrders: () => void;

  // Price fetching
  fetchCurrentPrice: (symbol: string) => Promise<number>;
  initializeWithRealPrices: () => Promise<void>;
}

const DEFAULT_SYMBOL = 'EURCAD';

const DEFAULT_OCO_ORDER = (price: number): OCOOrder => ({
  symbol: DEFAULT_SYMBOL,
  volume: 1.0,
  order1: { type: 'LIMIT', side: 'BUY', price },
  order2: { type: 'STOP', side: 'SELL', price: price - 0.0050 },
});

const DEFAULT_TRAILING_STOP: TrailingStopOrder = {
  symbol: DEFAULT_SYMBOL,
  volume: 1.0,
  side: 'BUY',
  trailingDistance: 20,
};

const DEFAULT_TIME_BASED = (price: number): TimeBasedOrder => ({
  symbol: DEFAULT_SYMBOL,
  volume: 1.0,
  type: 'LIMIT',
  side: 'BUY',
  price,
  timeInForce: 'GTC',
});

const DEFAULT_BRACKET = (price: number): BracketOrder => ({
  symbol: DEFAULT_SYMBOL,
  volume: 1.0,
  side: 'BUY',
  entryPrice: price,
  takeProfitPrice: price + 0.0050,
  stopLossPrice: price - 0.0050,
});

const DEFAULT_SCALED = (price: number): ScaledOrder => ({
  symbol: DEFAULT_SYMBOL,
  totalVolume: 5.0,
  side: 'BUY',
  numberOfOrders: 5,
  startPrice: price,
  endPrice: price + 0.0020,
  priceIncrement: 0.0005,
});

// Fetch current price from API
async function fetchCurrentPrice(symbol: string): Promise<number> {
  try {
    const response = await fetch(`/api/quotes/${symbol}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch price for ${symbol}: ${response.statusText}`);
    }
    const data = await response.json();
    // Assuming API returns { bid: number, ask: number } or { price: number }
    return data.price ?? data.bid ?? data.ask ?? 0;
  } catch (error) {
    console.error('[AdvancedOrders] Error fetching price:', error);
    return 0;
  }
}

export const useAdvancedOrdersStore = create<AdvancedOrdersState>()(
  devtools(
    (set, get) => ({
      // Initial states - will be updated with real prices
      ocoOrder: DEFAULT_OCO_ORDER(1.1000),
      trailingStopOrder: DEFAULT_TRAILING_STOP,
      timeBasedOrder: DEFAULT_TIME_BASED(1.1000),
      bracketOrder: DEFAULT_BRACKET(1.1000),
      scaledOrder: DEFAULT_SCALED(1.1000),

      // Price fetching
      fetchCurrentPrice: async (symbol: string) => {
        return fetchCurrentPrice(symbol);
      },

      initializeWithRealPrices: async () => {
        const price = await fetchCurrentPrice(DEFAULT_SYMBOL);
        if (price > 0) {
          set({
            ocoOrder: DEFAULT_OCO_ORDER(price),
            timeBasedOrder: DEFAULT_TIME_BASED(price),
            bracketOrder: DEFAULT_BRACKET(price),
            scaledOrder: DEFAULT_SCALED(price),
          });
        }
      },

      // Setters
      setOCOOrder: (order) =>
        set((state) => ({
          ocoOrder: { ...state.ocoOrder, ...order },
        })),

      setTrailingStopOrder: (order) =>
        set((state) => ({
          trailingStopOrder: { ...state.trailingStopOrder, ...order },
        })),

      setTimeBasedOrder: (order) =>
        set((state) => ({
          timeBasedOrder: { ...state.timeBasedOrder, ...order },
        })),

      setBracketOrder: (order) =>
        set((state) => ({
          bracketOrder: { ...state.bracketOrder, ...order },
        })),

      setScaledOrder: (order) =>
        set((state) => ({
          scaledOrder: { ...state.scaledOrder, ...order },
        })),

      // Calculate scaled order preview
      calculateScaledOrderPreview: () => {
        const { scaledOrder } = get();
        const preview: ScaledOrderPreview[] = [];
        const volumePerOrder = scaledOrder.totalVolume / scaledOrder.numberOfOrders;

        for (let i = 0; i < scaledOrder.numberOfOrders; i++) {
          preview.push({
            orderNumber: i + 1,
            price: scaledOrder.startPrice + i * scaledOrder.priceIncrement,
            volume: parseFloat(volumePerOrder.toFixed(2)),
          });
        }

        return preview;
      },

      // Submit actions (mock API calls)
      submitOCOOrder: async () => {
        const { ocoOrder } = get();
        console.log('[AdvancedOrders] Submitting OCO Order:', ocoOrder);
        // TODO: Replace with actual API call
        await new Promise((resolve) => setTimeout(resolve, 500));
        alert('OCO Order submitted successfully!');
      },

      submitTrailingStopOrder: async () => {
        const { trailingStopOrder } = get();
        console.log('[AdvancedOrders] Submitting Trailing Stop:', trailingStopOrder);
        await new Promise((resolve) => setTimeout(resolve, 500));
        alert('Trailing Stop Order submitted successfully!');
      },

      submitTimeBasedOrder: async () => {
        const { timeBasedOrder } = get();
        console.log('[AdvancedOrders] Submitting Time-based Order:', timeBasedOrder);
        await new Promise((resolve) => setTimeout(resolve, 500));
        alert('Time-based Order submitted successfully!');
      },

      submitBracketOrder: async () => {
        const { bracketOrder } = get();
        console.log('[AdvancedOrders] Submitting Bracket Order:', bracketOrder);
        await new Promise((resolve) => setTimeout(resolve, 500));
        alert('Bracket Order submitted successfully!');
      },

      submitScaledOrder: async () => {
        const { scaledOrder } = get();
        console.log('[AdvancedOrders] Submitting Scaled Order:', scaledOrder);
        await new Promise((resolve) => setTimeout(resolve, 500));
        alert('Scaled Order submitted successfully!');
      },

      resetAllOrders: () => {
        const resetPrice = 1.1000;
        set({
          ocoOrder: DEFAULT_OCO_ORDER(resetPrice),
          trailingStopOrder: DEFAULT_TRAILING_STOP,
          timeBasedOrder: DEFAULT_TIME_BASED(resetPrice),
          bracketOrder: DEFAULT_BRACKET(resetPrice),
          scaledOrder: DEFAULT_SCALED(resetPrice),
        });
      },
    }),
    { name: 'AdvancedOrdersStore' }
  )
);
