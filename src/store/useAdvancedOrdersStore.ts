import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import api from '../services/api';
import apiClient from '../api/client';
import { tradeApi, type Tick } from '../api/trade';
import { API_V2_BASE_URL } from '../config/api';

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

const getLogin = (): number => {
  const raw = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
  const login = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(login) || login <= 0) throw new Error('Missing account login for order submission');
  return login;
};

const assertOrderInputs = (symbol: string, volume: number) => {
  if (!symbol.trim()) throw new Error('Missing symbol');
  if (!Number.isFinite(volume) || volume <= 0) throw new Error('Volume must be greater than zero');
};

const toPendingType = (side: OrderSide, type: OrderType) => {
  if (type === 'MARKET') return null;
  return `${side.toLowerCase()}_${type.toLowerCase()}` as 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop';
};

const submitBasicOrder = async (order: {
  symbol: string;
  volume: number;
  side: OrderSide;
  type: OrderType;
  price?: number;
  price_sl?: number;
  price_tp?: number;
  expiration?: number;
  trailing_stop?: number;
}) => {
  assertOrderInputs(order.symbol, order.volume);
  const login = getLogin();
  const pendingType = toPendingType(order.side, order.type);
  if (!pendingType) {
    await api.orders.placeMarketOrder({
      login,
      symbol: order.symbol,
      side: order.side,
      volume: order.volume,
      price_sl: order.price_sl,
      price_tp: order.price_tp,
      trailing_stop: order.trailing_stop,
    });
    return;
  }
  if (!Number.isFinite(order.price) || Number(order.price) <= 0) throw new Error('Pending order price must be greater than zero');
  await api.orders.placePendingOrder({
    login,
    symbol: order.symbol,
    side: order.side,
    volume: order.volume,
    type: pendingType,
    price: Number(order.price),
    price_sl: order.price_sl,
    price_tp: order.price_tp,
    expiration: order.expiration,
    trailing_stop: order.trailing_stop,
  });
};

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

const getQuotePrice = (quote?: Partial<Tick> & { price?: number; last?: number }): number => {
  if (!quote) return 0;
  const price = quote.price ?? quote.last;
  if (Number.isFinite(price) && Number(price) > 0) return Number(price);
  if (Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.bid && quote.ask) {
    return (quote.bid + quote.ask) / 2;
  }
  return quote.bid ?? quote.ask ?? quote.close ?? 0;
};

type QuoteResponse = Tick[] | Tick | { quotes?: Tick[] };

const isQuoteEnvelope = (value: QuoteResponse): value is { quotes?: Tick[] } =>
  !Array.isArray(value) && 'quotes' in value;

// Fetch current price from v2 quotes API
async function fetchCurrentPrice(symbol: string): Promise<number> {
  try {
    const quotes = await tradeApi.market.getQuotes(symbol.trim().toUpperCase()) as QuoteResponse;
    const quote = Array.isArray(quotes)
      ? quotes[0]
      : isQuoteEnvelope(quotes)
        ? quotes.quotes[0]
        : quotes;
    return getQuotePrice(quote);
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
        assertOrderInputs(ocoOrder.symbol, ocoOrder.volume);
        const order1Type = toPendingType(ocoOrder.order1.side, ocoOrder.order1.type);
        const order2Type = toPendingType(ocoOrder.order2.side, ocoOrder.order2.type);
        if (!order1Type || !order2Type) throw new Error('OCO orders must use limit or stop legs');
        await apiClient.post('/orders/oco', {
          account_login: getLogin(),
          symbol: ocoOrder.symbol.trim().toUpperCase(),
          volume: ocoOrder.volume,
          side: ocoOrder.order1.side.toLowerCase(),
          order1: {
            type: order1Type,
            price: ocoOrder.order1.price,
          },
          order2: {
            type: order2Type,
            price: ocoOrder.order2.price,
          },
        }, { baseUrl: API_V2_BASE_URL });
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        alert('OCO order submitted successfully.');
      },

      submitTrailingStopOrder: async () => {
        const { trailingStopOrder } = get();
        console.log('[AdvancedOrders] Submitting Trailing Stop:', trailingStopOrder);
        await submitBasicOrder({
          symbol: trailingStopOrder.symbol,
          volume: trailingStopOrder.volume,
          side: trailingStopOrder.side,
          type: 'MARKET',
          price_sl: trailingStopOrder.stopLoss,
          price_tp: trailingStopOrder.takeProfit,
          trailing_stop: trailingStopOrder.trailingDistance,
        });
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        alert('Trailing stop order submitted successfully.');
      },

      submitTimeBasedOrder: async () => {
        const { timeBasedOrder } = get();
        console.log('[AdvancedOrders] Submitting Time-based Order:', timeBasedOrder);
        await submitBasicOrder({
          symbol: timeBasedOrder.symbol,
          volume: timeBasedOrder.volume,
          side: timeBasedOrder.side,
          type: timeBasedOrder.type,
          price: timeBasedOrder.price,
          expiration: timeBasedOrder.timeInForce === 'GTD' && timeBasedOrder.expiryDate
            ? Math.floor(new Date(timeBasedOrder.expiryDate).getTime() / 1000)
            : undefined,
        });
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        alert('Time-based order submitted successfully.');
      },

      submitBracketOrder: async () => {
        const { bracketOrder } = get();
        console.log('[AdvancedOrders] Submitting Bracket Order:', bracketOrder);
        await submitBasicOrder({
          symbol: bracketOrder.symbol,
          volume: bracketOrder.volume,
          side: bracketOrder.side,
          type: 'LIMIT',
          price: bracketOrder.entryPrice,
          price_sl: bracketOrder.stopLossPrice,
          price_tp: bracketOrder.takeProfitPrice,
        });
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        alert('Bracket order submitted successfully.');
      },

      submitScaledOrder: async () => {
        const { scaledOrder } = get();
        console.log('[AdvancedOrders] Submitting Scaled Order:', scaledOrder);
        assertOrderInputs(scaledOrder.symbol, scaledOrder.totalVolume);
        const preview = get().calculateScaledOrderPreview();
        await Promise.all(preview.map((order) => submitBasicOrder({
          symbol: scaledOrder.symbol,
          volume: order.volume,
          side: scaledOrder.side,
          type: 'LIMIT',
          price: order.price,
        })));
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        alert('Scaled orders submitted successfully.');
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
