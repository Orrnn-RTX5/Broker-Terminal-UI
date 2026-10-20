import { useEffect, useRef } from 'react';
import { formatPrice } from '../../utils/symbolUtils';
import { readRegisteredSymbolPriceSpec } from '../../services/dailyChangePriceModeRegistry';
import { extractBackendAccountRecord, isBackendAccountForLogin, isOtherBrokerId } from '../../services/backendAccountMetrics';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../../services/brokerSession';
import { createStateInvalidator } from '../../services/stateInvalidation';
import { enqueueLiveTick } from '../../services/liveTickDispatcher';
import { isEnhancedStoreHandledTickFrame, type WebSocketMessage } from '../../services/websocket-enhanced';
import { isTradeSubscriptionControlFrame } from '../../services/tradeStreamMessage';
import { decodePositionStreamMessage } from '../../services/tradePositionStream';
import { requestPositionSnapshotRevalidation } from '../../services/positionSnapshotSafety';
import { POSITION_CLOSED_EVENTS, readPositionStreamBatch, readPositionStreamEvent, reconcilePositionStreamBatch } from '../../services/positionStream';
import { dispatchTradeOverlayCloseState } from '../../services/tradeOverlayHistory';
import { markPositionsClosed, useAppStore, type Account, type Position } from '../../store/useAppStore';
import { useAlertStore } from '../../store/useAlertStore';
import { useMarketDataStore, type CandleUpdate } from '../../store/useMarketDataStore';
import { useNotificationStore } from '../../store/useNotificationStore';
import { normalizeRealtimeTick, parseTickPayloadContexts, toNumber, WS_DEBUG } from '../../features/trading/runtime/marketTickNormalization';
import {
  extractAccountMetrics,
  getPositionEventName,
  getPositionEventTicket,
  normalizeAccountSummary,
} from './positionRuntime';

type Subscribe = (channel: string, callback: (data: unknown) => void) => () => void;
type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null => (
  value !== null && typeof value === 'object' ? value as UnknownRecord : null
);

interface UseTradeStreamRuntimeOptions {
  isAuthenticated: boolean;
  subscribe: Subscribe;
  isSessionActive: () => boolean;
  getAcceptedChannelLogin: (channel?: string) => number | null;
  getLiveTradingLogin: () => number | null;
  incrementPositionsStreamVersion: () => void;
  hasServerClosedTicket: (ticket: number) => boolean;
  markServerClosedTickets: (ticketIds?: number[]) => void;
  markTradeWsMessage: () => void;
  reconcileOptimisticClosedPositions: (positions: Position[]) => Position[];
  refreshOrdersAndHistory: (login?: number) => Promise<void>;
  reloadMarketSymbols: () => void | Promise<unknown>;
}

const playAlertSound = (): void => {
  const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZUQ0PVKvn77BfGAg+ltvy0H0pBSl+zPLaizsIGGS56+OZUQ4OUKXi8LaHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsI');
  audio.volume = 0.3;
  void audio.play().catch(() => undefined);
};

export const useTradeStreamRuntime = ({
  isAuthenticated,
  subscribe,
  isSessionActive,
  getAcceptedChannelLogin,
  getLiveTradingLogin,
  incrementPositionsStreamVersion,
  hasServerClosedTicket,
  markServerClosedTickets,
  markTradeWsMessage,
  reconcileOptimisticClosedPositions,
  refreshOrdersAndHistory,
  reloadMarketSymbols,
}: UseTradeStreamRuntimeOptions): void => {
  const historyRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let configurationChanged = false;
    const changedEntities = new Set<string>();
    const invalidator = createStateInvalidator((login) => {
      if (!isSessionActive() || getLiveTradingLogin() !== login) return;
      window.dispatchEvent(new Event('rtx:trade-stream-recovered'));
      window.dispatchEvent(new CustomEvent('rtx:state-changed', { detail: { entities: [...changedEntities] } }));
      changedEntities.clear();
      if (configurationChanged) {
        configurationChanged = false;
        void reloadMarketSymbols();
      }
    });

    const unsubscribe = subscribe('*', (message: unknown) => {
      try {
        const data = (asRecord(message) ?? {}) as WebSocketMessage;
        const isTickLikeUpdate = data.type === 'update' && (
          Number.isFinite(Number(data?.bid))
          || Number.isFinite(Number(data?.ask))
          || Number.isFinite(Number(data?.price))
          || Number.isFinite(Number(data?.last))
          || Number.isFinite(Number(data?.lastPrice))
        );
        const isLiveQuote = data.channel?.startsWith('quotes.');

        if (data.channel?.startsWith('state.')) {
          const login = getAcceptedChannelLogin(data.channel);
          const entityData = asRecord(asRecord(data.data)?.data);
          const entity = typeof entityData?.entity === 'string' ? entityData.entity : '*';
          changedEntities.add(entity);
          if (['groups', 'group_symbol_settings', 'accounts', 'instruments', 'brokers'].includes(entity)) {
            configurationChanged = true;
          }
          if (login) invalidator.invalidate(login);
          return;
        }

        if (data.channel?.startsWith('account.') || data.channel?.startsWith('metrics.')) {
          const acceptedLogin = getAcceptedChannelLogin(data.channel);
          if (!acceptedLogin || !isBackendAccountForLogin(data, acceptedLogin, getCommittedBrokerAccountSessionScope().brokerId)) return;
          if (!extractBackendAccountRecord(data)) return;
          markTradeWsMessage();
          const accountData = extractAccountMetrics(data);
          const previousAccount = useAppStore.getState().account as Account | null | undefined;
          const next = normalizeAccountSummary(accountData, previousAccount, {
            partial: !accountData.publication_token,
            login: acceptedLogin,
            scope: getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()),
          });
          if (!isSessionActive() || getLiveTradingLogin() !== acceptedLogin) return;
          useAppStore.getState().setAccount(next);
          return;
        }

        if (data.channel?.startsWith('positions.')) {
          const acceptedLogin = getAcceptedChannelLogin(data.channel);
          if (!acceptedLogin) return;
          const decoded = decodePositionStreamMessage(data);
          if (!decoded) return;
          if (decoded.rows.some((row) => row.account_login !== undefined && String(row.account_login) !== String(acceptedLogin))) return;
          const brokerId = getCommittedBrokerAccountSessionScope().brokerId;
          if (decoded.rows.some((row) => isOtherBrokerId(row.broker_id, brokerId))) return;
          if (!isSessionActive() || getLiveTradingLogin() !== acceptedLogin) return;

          markTradeWsMessage();
          incrementPositionsStreamVersion();
          try {
            markPositionsClosed(decoded.closedTickets);
            const batch = readPositionStreamBatch(data);
            const eventName = getPositionEventName(data);
            const ticket = getPositionEventTicket(data);
            if (!isSessionActive() || getLiveTradingLogin() !== acceptedLogin) return;

            if (POSITION_CLOSED_EVENTS.has(eventName) && ticket) {
              const { position } = readPositionStreamEvent(data);
              const closeResult = reconcilePositionStreamBatch(useAppStore.getState().positions, {
                mode: 'delta',
                positions: [{ ...position, closed: true }],
              });
              if (!closeResult.closedTickets.includes(ticket)) return;
              markServerClosedTickets([ticket]);
              dispatchTradeOverlayCloseState([ticket], 'confirmed');
              useAppStore.getState().setPositions(
                useAppStore.getState().positions.filter((position) => position.id !== ticket),
                { closedTickets: [ticket] },
              );
              void refreshOrdersAndHistory(acceptedLogin).catch((error) => console.error('[WS POSITIONS HISTORY REFRESH ERROR]', error));
            } else if (batch) {
              const result = reconcilePositionStreamBatch(useAppStore.getState().positions, batch);
              markPositionsClosed(result.closedTickets);
              const normalized = reconcileOptimisticClosedPositions(result.positions as Position[]);
              if (!isSessionActive() || getLiveTradingLogin() !== acceptedLogin) return;
              useAppStore.getState().setPositions(normalized, { closedTickets: result.closedTickets });
              if (result.needsRevalidation) requestPositionSnapshotRevalidation();
            } else {
              const { position } = readPositionStreamEvent(data);
              if (!position) return;
              const result = reconcilePositionStreamBatch(useAppStore.getState().positions, {
                mode: 'delta',
                positions: [position],
              });
              markPositionsClosed(result.closedTickets);
              useAppStore.getState().setPositions(
                reconcileOptimisticClosedPositions(result.positions as Position[]),
                { closedTickets: result.closedTickets },
              );
              if (result.needsRevalidation || eventName === 'position_partial_close') requestPositionSnapshotRevalidation();
            }

            const openTickets = new Set((useAppStore.getState().positions as Position[]).map((position) => position.id));
            const confirmedClosedTickets = decoded.closedTickets.filter((closedTicket) => (
              !hasServerClosedTicket(closedTicket) && !openTickets.has(closedTicket)
            ));
            if (confirmedClosedTickets.length) {
              markServerClosedTickets(confirmedClosedTickets);
              dispatchTradeOverlayCloseState(confirmedClosedTickets, 'confirmed');
              void refreshOrdersAndHistory(acceptedLogin).catch((error) => console.error('[WS POSITIONS HISTORY REFRESH ERROR]', error));
            }
          } catch (error) {
            console.error('[WS POSITIONS ERROR]', error);
          }
          return;
        }

        if (data.channel?.startsWith('orders.') || data.channel?.startsWith('deals.')) {
          const login = getAcceptedChannelLogin(data.channel);
          if (!login || isTradeSubscriptionControlFrame(data)) return;
          markTradeWsMessage();
          if (historyRefreshTimerRef.current === null) {
            historyRefreshTimerRef.current = window.setTimeout(() => {
              historyRefreshTimerRef.current = null;
              void refreshOrdersAndHistory(login).catch((error) => console.error('[WS HISTORY REFRESH ERROR]', error));
            }, 50);
          }
          return;
        }

        if (data.type === 'tick' || isTickLikeUpdate || isLiveQuote || data.channel?.startsWith('ticks.') || data.channel === 'prices') {
          const alreadyEnqueuedBySocketService = isEnhancedStoreHandledTickFrame(data);
          const tickPayload: unknown = (isLiveQuote || data.channel?.startsWith('ticks.') || data.channel === 'prices') && data.data
            ? data.data
            : data;
          const payloadContexts = alreadyEnqueuedBySocketService ? [] : parseTickPayloadContexts(tickPayload);
          if (!alreadyEnqueuedBySocketService && payloadContexts.length === 0) return;
          const currentStore = useAppStore.getState().ticks;

          payloadContexts.forEach(({ payload: parsedTickData, envelopes }) => {
            const tickData = parsedTickData;
            const channelSymbol = data.channel?.startsWith('ticks.') ? data.channel.slice('ticks.'.length).trim() : '';
            const envelopeSymbol = envelopes.find((candidate) => (
              typeof candidate.symbol === 'string' && candidate.symbol.trim()
            ))?.symbol;
            const rawSymbol = channelSymbol
              || (typeof tickData.symbol === 'string' ? tickData.symbol.trim() : '')
              || (typeof envelopeSymbol === 'string' ? envelopeSymbol.trim() : '');
            if (!rawSymbol) return;
            const exactSymbol = rawSymbol.toUpperCase();
            const envelopeLayers = [...envelopes];
            if (data !== parsedTickData && !envelopeLayers.some((candidate) => candidate === data)) {
              envelopeLayers.push(data);
            }
            const normalizedTick = normalizeRealtimeTick(
              { ...tickData, symbol: exactSymbol },
              currentStore[exactSymbol],
              envelopeLayers[0],
              envelopeLayers.slice(1),
            );
            if (normalizedTick) enqueueLiveTick(normalizedTick.symbol, normalizedTick);
            else if (WS_DEBUG) console.log(`[DEBUG WS] normalizeRealtimeTick returned null for ${exactSymbol}`, tickData);
          });

          const alertState = useAlertStore.getState();
          if (!alertState.alerts.some((alert) => alert.enabled && alert.status === 'active')) return;
          const priceMap: Record<string, { bid: number; ask: number; last?: number }> = {};
          Object.entries(useAppStore.getState().ticks).forEach(([symbol, tick]) => {
            if (!Number.isFinite(tick?.bid) || !Number.isFinite(tick?.ask)) return;
            priceMap[symbol] = { bid: tick.bid, ask: tick.ask, last: tick.last };
          });
          alertState.checkAlerts(priceMap).forEach((alert) => {
            const message = alert.message || `${alert.symbol} ${alert.condition.replace('_', ' ')} ${formatPrice(alert.price, readRegisteredSymbolPriceSpec(alert.symbol).digits)}`;
            useNotificationStore.getState().addNotification({
              type: 'trading',
              severity: 'warning',
              title: 'Price Alert Triggered',
              message,
            });
            if (alert.notifyMethod === 'sound' || alert.notifyMethod === 'both') playAlertSound();
          });
          return;
        }

        const candle = asRecord(data.candle);
        if (data.type === 'update' && candle && typeof data.symbol === 'string') {
          const rawTime = Number(candle?.time ?? candle?.Time ?? data?.time ?? data?.timestamp);
          const normalizedTime = Number.isFinite(rawTime) && rawTime > 0
            ? (rawTime > 1_000_000_000_000 ? Math.floor(rawTime / 1000) : rawTime)
            : Math.floor(Date.now() / 1000);
          useMarketDataStore.getState().updateCandle({
            symbol: data.symbol,
            timeframe: String(data?.timeframe || 'M1'),
            open: toNumber(candle?.open ?? candle?.Open, 0),
            high: toNumber(candle?.high ?? candle?.High, 0),
            low: toNumber(candle?.low ?? candle?.Low, 0),
            close: toNumber(candle?.close ?? candle?.Close, 0),
            volume: toNumber(candle?.volume ?? candle?.Volume, 0),
            time: normalizedTime,
            source: 'server',
            sourceTimestamp: toNumber(
              candle?.sourceTimestamp ?? candle?.source_timestamp ?? candle?.updated_at
                ?? data?.sourceTimestamp ?? data?.source_timestamp ?? data?.event_timestamp ?? data?.server_timestamp,
              Number.NaN,
            ),
          });
          return;
        }

        if (data.type === 'candle_update') {
          const candleUpdate = data as unknown as Omit<CandleUpdate, 'source' | 'sourceTimestamp'>;
          useMarketDataStore.getState().updateCandle({
            ...candleUpdate,
            source: 'server',
            sourceTimestamp: toNumber(
              data?.sourceTimestamp ?? data?.source_timestamp ?? data?.event_timestamp ?? data?.server_timestamp,
              Number.NaN,
            ),
          });
        }
      } catch (error) {
        console.error('[WS] Parse error:', error);
      }
    });

    return () => {
      invalidator.dispose();
      unsubscribe();
      if (historyRefreshTimerRef.current !== null) {
        window.clearTimeout(historyRefreshTimerRef.current);
        historyRefreshTimerRef.current = null;
      }
    };
  }, [
    getAcceptedChannelLogin,
    getLiveTradingLogin,
    hasServerClosedTicket,
    incrementPositionsStreamVersion,
    isAuthenticated,
    isSessionActive,
    markServerClosedTickets,
    markTradeWsMessage,
    reconcileOptimisticClosedPositions,
    refreshOrdersAndHistory,
    reloadMarketSymbols,
    subscribe,
  ]);
};
