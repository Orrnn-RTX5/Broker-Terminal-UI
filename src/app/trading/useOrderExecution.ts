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
      await api.orders.placePendingOrder({
        login: loginId,
        symbol: submitSymbol,
        side,
        volume: request.volume,
        type: `${side}_limit`,
        price: request.price,
        ...(request.priceSl ? { price_sl: request.priceSl } : {}),
        ...(request.priceTp ? { price_tp: request.priceTp } : {}),
      });
      if (!isTradeOperationContextCurrent(operationContext)) return;
      publishOrderFeedback([
        feedbackLabel(request.side === 'BUY' ? 'Buy Limit' : 'Sell Limit'),
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
        const pendingKind = order.orderType?.toLowerCase().includes('stop') && !order.orderType?.toLowerCase().includes('limit')
          ? 'stop'
          : 'limit';
        const pendingType = `${lowerSide}_${pendingKind}` as 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop';
        await api.orders.placePendingOrder({
          login: loginId,
          symbol: submitSymbol,
          side: lowerSide,
          volume: order.volume,
          type: pendingType,
          price: orderPrice,
          ...(order.priceSl && order.priceSl > 0 ? { price_sl: order.priceSl } : {}),
          ...(order.priceTp && order.priceTp > 0 ? { price_tp: order.priceTp } : {}),
          ...(order.expirationTimestamp && order.expirationTimestamp > 0 ? { expiration: order.expirationTimestamp } : {}),
          ...(order.comment ? { comment: order.comment } : {}),
        });
        if (!isTradeOperationContextCurrent(operationContext)) return;
        const labelText = pendingKind === 'stop'
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
      publishOrderFeedback(formatOrderError(error));
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
