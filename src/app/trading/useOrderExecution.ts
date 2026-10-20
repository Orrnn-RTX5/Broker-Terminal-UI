import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { api } from '../../services/api';
import type { DepthOrderRequest } from '../../components/DepthOfMarket';
import type { SymbolMarketStatusState } from '../../hooks/useSymbolMarketStatus';
import { getCachedSymbolMarketStatus } from '../../hooks/useSymbolMarketStatus';
import { captureTradeOrderIntent } from '../../services/orderLatencyTelemetry';
import { requireTradingAuth } from '../../services/tradingAuthGate';
import { useAppStore } from '../../store/useAppStore';
import { formatOrderError } from '../../utils/orderError';
import {
  createUnavailableMarketStatus,
  getMarketStatusTradeBlockMessage,
  shouldBlockSymbolTrading,
} from '../../utils/marketStatus';
import { normalizeSymbolName } from '../../utils/symbolEligibility';
import { feedbackLabel, feedbackSymbol, feedbackValue } from '../../utils/uiFeedback';
import {
  commitIfCurrentTradeOperation,
  type TradeOperationContext,
} from '../../features/trading/session/tradeOperationContext';
import {
  getChartEntryPriceForSymbol,
  normalizePositions,
  upsertImmediatePosition,
} from './positionRuntime';
import type { RefreshPositionsOptions } from './tradeRuntimeContracts';
import { publishOrderFeedback } from './orderFeedback';

export interface OrderPanelSubmission {
  type: 'buy' | 'sell';
  volume: number;
  symbol: string;
  orderType?: 'Market Execution' | 'Limit Order' | 'Stop Order' | 'Stop Limit Order' | 'Buy Limit' | 'Sell Limit' | 'Buy Stop' | 'Sell Stop' | 'Buy Stop Limit' | 'Sell Stop Limit';
  price?: number;
  stopLimitPrice?: number;
  priceSl?: number;
  priceTp?: number;
  fillPolicy?: 'Fill or Kill' | 'Immediate or Cancel' | 'Return';
  expiration?: string;
  expirationTimestamp?: number;
  comment?: string;
}

export interface OrderProtection {
  priceSl?: number;
  priceTp?: number;
}

export type PlaceOrder = (
  side: 'BUY' | 'SELL',
  requestedSymbol?: string,
  requestedVolume?: number,
  protection?: OrderProtection,
) => Promise<void>;

interface UseOrderExecutionOptions {
  selectedMarketStatus: SymbolMarketStatusState;
  selectedSymbol: string;
  volume: number;
  setVolume: Dispatch<SetStateAction<number>>;
  domSymbol: string;
  orderPanelSymbol: string;
  getAllowedSymbol: (symbol: unknown) => string;
  getLiveTradingLogin: () => number | null;
  captureTradeOperationContext: (expectedLogin?: number) => TradeOperationContext | null;
  isTradeOperationContextCurrent: (expected: TradeOperationContext) => boolean;
  refreshPositions: (login?: number, options?: RefreshPositionsOptions) => Promise<void>;
  refreshOrdersAndHistory: (login?: number) => Promise<void>;
}

interface OrderExecutionController {
  placeOrder: PlaceOrder;
  handleDepthOrder: (request: DepthOrderRequest) => Promise<void>;
  handleOrderPanelSubmit: (order: OrderPanelSubmission) => Promise<void>;
}

export const useOrderExecution = ({
  selectedMarketStatus,
  selectedSymbol,
  volume,
  setVolume,
  domSymbol,
  orderPanelSymbol,
  getAllowedSymbol,
  getLiveTradingLogin,
  captureTradeOperationContext,
  isTradeOperationContextCurrent,
  refreshPositions,
  refreshOrdersAndHistory,
}: UseOrderExecutionOptions): OrderExecutionController => {
  const ensureMarketOpenForOrder = useCallback((symbol: string): boolean => {
    const normalizedSymbol = normalizeSymbolName(symbol);
    const marketStatus = normalizeSymbolName(selectedMarketStatus.symbol) === normalizedSymbol
      ? selectedMarketStatus
      : getCachedSymbolMarketStatus(normalizedSymbol) ?? createUnavailableMarketStatus(normalizedSymbol);

    if (shouldBlockSymbolTrading(marketStatus, symbol)) {
      publishOrderFeedback(getMarketStatusTradeBlockMessage(marketStatus, symbol));
      return false;
    }
    return true;
  }, [selectedMarketStatus]);

  const placeOrder = useCallback<PlaceOrder>(async (
    side,
    requestedSymbol,
    requestedVolume,
    protection,
  ) => {
    const authSymbol = normalizeSymbolName(requestedSymbol || selectedSymbol);
    const authTick = useAppStore.getState().ticks[authSymbol];
    if (!requireTradingAuth({
      source: 'quick-trade',
      side,
      symbol: authSymbol,
      volume: requestedVolume ?? volume,
      bid: authTick?.bid,
      ask: authTick?.ask,
    })) return;

    const intentAtMs = captureTradeOrderIntent();
    try {
      const loginId = getLiveTradingLogin();
      if (!loginId) {
        window.dispatchEvent(new Event('rtx:requestTradeLogin'));
        publishOrderFeedback('No trading account is selected. Please sign in again.');
        return;
      }
      const operationContext = captureTradeOperationContext(loginId);
      if (!operationContext) return;
      const requestedOrderSymbol = normalizeSymbolName(requestedSymbol || selectedSymbol);
      const submitSymbol = getAllowedSymbol(requestedOrderSymbol);
      if (!submitSymbol) {
        publishOrderFeedback([
          feedbackSymbol(requestedOrderSymbol),
          feedbackValue(': '),
          feedbackLabel('Live tradable quote unavailable - order not sent'),
        ]);
        return;
      }
      if (!ensureMarketOpenForOrder(submitSymbol)) return;

      const orderPromise = api.orders.placeMarketOrder({
        symbol: submitSymbol,
        side,
        volume: requestedVolume ?? volume,
        login: loginId,
        ...(protection?.priceSl ? { price_sl: protection.priceSl } : {}),
        ...(protection?.priceTp ? { price_tp: protection.priceTp } : {}),
      }, { intentAtMs });
      const chartEntryPrice = getChartEntryPriceForSymbol(submitSymbol, side);
      const chartEntryTime = new Date().toISOString();
      const result = await orderPromise;
      const resultCommitted = commitIfCurrentTradeOperation(
        operationContext,
        () => captureTradeOperationContext(),
        () => {
          console.log('[Trade] Order executed via trading API:', result);
          const [immediatePosition] = normalizePositions([{ ...result, chartEntryPrice, chartEntryTime }]);
          if (immediatePosition) upsertImmediatePosition(immediatePosition);
        },
      );
      if (!resultCommitted) return;
      void refreshPositions(loginId);
      void refreshOrdersAndHistory(loginId).catch((error) => {
        console.error('[Trade] Failed to refresh orders/history:', error);
      });
    } catch (error) {
      publishOrderFeedback(formatOrderError(error));
    }
  }, [
    captureTradeOperationContext,
    ensureMarketOpenForOrder,
    getAllowedSymbol,
    getLiveTradingLogin,
    refreshOrdersAndHistory,
    refreshPositions,
    selectedSymbol,
    volume,
  ]);

  const handleDepthOrder = useCallback(async (request: DepthOrderRequest) => {
    if (!requireTradingAuth({
      source: 'order-panel',
      side: request.side,
      symbol: domSymbol,
      volume: request.volume,
    })) return;
    setVolume(request.volume);
    console.log(
      `[DOM] ${request.execution === 'limit' ? 'Pending' : 'Market'} order: ${request.side} ${request.volume} @ ${request.price}`,
    );

    if (request.execution === 'market') {
      await placeOrder(request.side, domSymbol, request.volume, {
        priceSl: request.priceSl,
        priceTp: request.priceTp,
      });
      return;
    }

    try {
      const loginId = getLiveTradingLogin();
      if (!loginId) {
        window.dispatchEvent(new Event('rtx:requestTradeLogin'));
        publishOrderFeedback('No trading account is selected. Please sign in again.');
        return;
      }
      const operationContext = captureTradeOperationContext(loginId);
      if (!operationContext) return;
      const submitSymbol = getAllowedSymbol(normalizeSymbolName(domSymbol));
      if (!submitSymbol) {
        publishOrderFeedback([
          feedbackSymbol(domSymbol),
          feedbackValue(': '),
          feedbackLabel('Live tradable quote unavailable - order not sent'),
        ]);
        return;
      }
      if (!Number.isFinite(request.price) || request.price <= 0) {
        publishOrderFeedback([
          feedbackLabel('Invalid price'),
          feedbackValue(`: ${request.price} · `),
          feedbackLabel('Order failed'),
        ]);
        return;
      }
      if (!Number.isFinite(request.volume) || request.volume <= 0) {
        publishOrderFeedback([
          feedbackLabel('Invalid volume'),
          feedbackValue(`: ${request.volume} · `),
          feedbackLabel('Order failed'),
        ]);
        return;
      }
      if (!ensureMarketOpenForOrder(submitSymbol)) return;

      const side = request.side.toLowerCase() as 'buy' | 'sell';
      const pendingKind = (request.execution as string) === 'stop' ? 'stop' : 'limit';
      await api.orders.placePendingOrder({
        login: loginId,
        symbol: submitSymbol,
        side,
        volume: request.volume,
        type: `${side}_${pendingKind}` as 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop',
        price: request.price,
        ...(request.priceSl ? { price_sl: request.priceSl } : {}),
        ...(request.priceTp ? { price_tp: request.priceTp } : {}),
      });
      if (!isTradeOperationContextCurrent(operationContext)) return;
      publishOrderFeedback([
        feedbackLabel(side === 'buy' ? (pendingKind === 'stop' ? 'Buy Stop' : 'Buy Limit') : (pendingKind === 'stop' ? 'Sell Stop' : 'Sell Limit')),
        feedbackValue(` · ${submitSymbol} · `),
        feedbackLabel('Volume'),
        feedbackValue(`: ${request.volume} · `),
        feedbackLabel('Price'),
        feedbackValue(`: ${request.price} · `),
        feedbackLabel('request submitted successfully!'),
      ], 'success');
      void refreshOrdersAndHistory(loginId).catch((error) => {
        console.error('[DOM] Failed to refresh pending orders/history:', error);
      });
    } catch (error) {
      publishOrderFeedback(formatOrderError(error));
    }
  }, [
    captureTradeOperationContext,
    domSymbol,
    ensureMarketOpenForOrder,
    getAllowedSymbol,
    getLiveTradingLogin,
    isTradeOperationContextCurrent,
    placeOrder,
    refreshOrdersAndHistory,
    setVolume,
  ]);

  const handleOrderPanelSubmit = useCallback(async (order: OrderPanelSubmission) => {
    const authSymbol = normalizeSymbolName(order.symbol || orderPanelSymbol);
    const authTick = useAppStore.getState().ticks[authSymbol];
    if (!requireTradingAuth({
      source: 'order-panel',
      side: order.type.toUpperCase() as 'BUY' | 'SELL',
      symbol: authSymbol,
      volume: order.volume,
      bid: authTick?.bid,
      ask: authTick?.ask,
    })) return;

    const intentAtMs = captureTradeOrderIntent();
    try {
      const side = order.type.toUpperCase() as 'BUY' | 'SELL';
      const lowerSide = order.type.toLowerCase() as 'buy' | 'sell';
      const requestedOrderPanelSymbol = normalizeSymbolName(order.symbol || orderPanelSymbol);
      const submitSymbol = getAllowedSymbol(requestedOrderPanelSymbol);
      if (!submitSymbol) {
        publishOrderFeedback([
          feedbackSymbol(requestedOrderPanelSymbol),
          feedbackValue(': '),
          feedbackLabel('Live tradable quote unavailable - order not sent'),
        ]);
        return;
      }
      const loginId = getLiveTradingLogin();
      if (!loginId) {
        window.dispatchEvent(new Event('rtx:requestTradeLogin'));
        publishOrderFeedback('No trading account is selected. Please sign in again.');
        return;
      }
      const operationContext = captureTradeOperationContext(loginId);
      if (!operationContext || !ensureMarketOpenForOrder(submitSymbol)) return;

      const isPendingOrder = Boolean(
        order.orderType && order.orderType !== 'Market Execution',
      );

      if (isPendingOrder) {
        const orderPrice = Number(order.price);
        if (!Number.isFinite(orderPrice) || orderPrice <= 0) {
          publishOrderFeedback([
            feedbackLabel('Invalid price'),
            feedbackValue(`: ${order.price ?? 0} · `),
            feedbackLabel('Order failed'),
          ]);
          return;
        }
        const orderTypeName = String(order.orderType || '').toLowerCase();
        const isStopLimitOrder = orderTypeName.includes('stop') && orderTypeName.includes('limit');
        const pendingKind = isStopLimitOrder
          ? 'stop_limit'
          : (orderTypeName.includes('stop') ? 'stop' : 'limit');
        const pendingType = `${lowerSide}_${pendingKind}` as 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop' | 'buy_stop_limit' | 'sell_stop_limit';
        let stopLimitPrice: number | undefined;
        if (isStopLimitOrder) {
          stopLimitPrice = Number(order.stopLimitPrice);
          if (!Number.isFinite(stopLimitPrice) || stopLimitPrice <= 0) {
            publishOrderFeedback([
              feedbackLabel('Invalid stop limit price'),
              feedbackValue(`: ${order.stopLimitPrice ?? 0} · `),
              feedbackLabel('Order failed'),
            ]);
            return;
          }
        }
        // The dialog sends `expiration` as a display string ('GTC', date text)
        // while other callers send `expirationTimestamp` (epoch seconds or ms).
        // Normalize to whole epoch SECONDS; empty/invalid is omitted (never 0/NaN).
        const toPendingExpirySeconds = (value: unknown): number | undefined => {
          if (value === undefined || value === null) return undefined;
          const text = typeof value === 'string' ? value.trim() : value;
          if (text === '') return undefined;
          const numeric = typeof text === 'number' ? text : Number(text);
          if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
          const seconds = numeric >= 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
          return seconds > 0 ? seconds : undefined;
        };
        const pendingExpiry = toPendingExpirySeconds(order.expirationTimestamp ?? order.expiration);
        await api.orders.placePendingOrder({
          login: loginId,
          symbol: submitSymbol,
          side: lowerSide,
          volume: order.volume,
          type: pendingType,
          price: orderPrice,
          // Backend wire name is `price_limit`. No fill_policy is sent: the
          // gateway REST decoder has no fill-policy concept (IOC/FOK refused).
          ...(stopLimitPrice !== undefined ? { price_limit: stopLimitPrice } : {}),
          ...(order.priceSl && order.priceSl > 0 ? { price_sl: order.priceSl } : {}),
          ...(order.priceTp && order.priceTp > 0 ? { price_tp: order.priceTp } : {}),
          ...(pendingExpiry !== undefined ? { expiration: pendingExpiry } : {}),
          ...(order.comment ? { comment: order.comment } : {}),
        });
        if (!isTradeOperationContextCurrent(operationContext)) return;
        const labelText = pendingKind === 'stop_limit'
          ? (side === 'BUY' ? 'Buy Stop Limit' : 'Sell Stop Limit')
          : pendingKind === 'stop'
            ? (side === 'BUY' ? 'Buy Stop' : 'Sell Stop')
            : (side === 'BUY' ? 'Buy Limit' : 'Sell Limit');
        publishOrderFeedback([
          feedbackLabel(labelText),
          feedbackValue(` · ${submitSymbol} · `),
          feedbackLabel('Volume'),
          feedbackValue(`: ${order.volume} · `),
          feedbackLabel('Price'),
          feedbackValue(`: ${orderPrice} · `),
          feedbackLabel('request submitted successfully!'),
        ], 'success');
        void refreshOrdersAndHistory(loginId).catch((error) => {
          console.error('[Trade] Failed to refresh pending orders/history:', error);
        });
        return;
      }

      const orderPromise = api.orders.placeMarketOrder({
        symbol: submitSymbol,
        side,
        volume: order.volume,
        login: loginId,
        ...(order.priceSl && order.priceSl > 0 ? { price_sl: order.priceSl } : {}),
        ...(order.priceTp && order.priceTp > 0 ? { price_tp: order.priceTp } : {}),
        ...(order.comment ? { comment: order.comment } : {}),
      }, { intentAtMs });
      const chartEntryPrice = getChartEntryPriceForSymbol(submitSymbol, side);
      const chartEntryTime = new Date().toISOString();
      const result = await orderPromise;
      const resultCommitted = commitIfCurrentTradeOperation(
        operationContext,
        () => captureTradeOperationContext(),
        () => {
          console.log('[Trade] Order executed from dialog via trading API:', result);
          const [immediatePosition] = normalizePositions([{ ...result, chartEntryPrice, chartEntryTime }]);
          if (immediatePosition) upsertImmediatePosition(immediatePosition);
        },
      );
      if (!resultCommitted) return;
      void refreshPositions(loginId);
      void refreshOrdersAndHistory(loginId).catch((error) => {
        console.error('[Trade] Failed to refresh orders/history:', error);
      });
    } catch (error) {
      const failureMessage = formatOrderError(error);
      publishOrderFeedback(failureMessage);
      throw new Error(failureMessage, { cause: error });
    }
  }, [
    captureTradeOperationContext,
    ensureMarketOpenForOrder,
    getAllowedSymbol,
    getLiveTradingLogin,
    isTradeOperationContextCurrent,
    orderPanelSymbol,
    refreshOrdersAndHistory,
    refreshPositions,
  ]);

  return { placeOrder, handleDepthOrder, handleOrderPanelSubmit };
};
