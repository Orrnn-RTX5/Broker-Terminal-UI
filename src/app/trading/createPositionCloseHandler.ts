import { api } from '../../services/api';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../../services/brokerSession';
import { retainPositionCloseQuotes } from '../../services/positionCloseQuoteDemand';
import { dispatchTradeOverlayCloseState } from '../../services/tradeOverlayHistory';
import { getPositionCloseScope, useAppStore, type Position } from '../../store/useAppStore';
import { createSessionScopedTicketKey } from '../../features/trading/session/tradeOperationContext';
import { feedbackLabel, feedbackValue } from '../../utils/uiFeedback';
import { formatOrderError } from '../../utils/orderError';
import { publishOrderFeedback } from './orderFeedback';
import { buildTradeOverlayCloseSnapshots } from './positionRuntime';
import type { RefreshPositionsOptions } from './tradeRuntimeContracts';

interface PositionCloseHandlerOptions {
  getLiveTradingLogin: () => number | null;
  closingTicketsRef: { current: Set<string> };
  isAuthenticatedRef: { current: boolean };
  markLocalTradeMutation: (ticketIds: number[]) => void;
  clearOptimisticClosedTickets: (ticketIds: number[], expectedScope: number) => void;
  refreshPositions: (login?: number, options?: RefreshPositionsOptions) => Promise<void>;
  refreshOrdersAndHistory: (login?: number) => Promise<void>;
}

/** Capture the terminal's refs while keeping close execution independent of App layout. */
export function createPositionCloseHandler({
  getLiveTradingLogin,
  closingTicketsRef,
  isAuthenticatedRef,
  markLocalTradeMutation,
  clearOptimisticClosedTickets,
  refreshPositions,
  refreshOrdersAndHistory,
}: PositionCloseHandlerOptions) {
  const handleClosePosition = async (
    id: number,
    { showFailureFeedback = true }: { showFailureFeedback?: boolean } = {},
  ): Promise<boolean> => {
    const closeLogin = getLiveTradingLogin();
    const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(
      getCommittedBrokerAccountSessionScope(),
    );
    if (!closeLogin) {
      if (showFailureFeedback) {
        publishOrderFeedback(
          [feedbackLabel('Close position'), feedbackValue(` #${id}: `), feedbackLabel('Failed'), feedbackValue(' — No trading account is selected. Please sign in again.')],
          'error',
        );
      }
      return false;
    }
    const closeTicketKey = createSessionScopedTicketKey(closeSessionScope, id);
    // The bounded reader may have stopped while the server outcome is still
    // unknown. Preserve its intent identity instead of issuing another UUID.
    if (useAppStore.getState().positions.some(position => position.id === id && position.closeCommandState === 'awaiting-confirmation')) {
      return false;
    }
    // Guard against double-click: skip if already closing this ticket
    if (closingTicketsRef.current.has(closeTicketKey)) {
      console.log(`[App] Close already in progress for ticket ${id}, skipping duplicate`);
      return false;
    }
    closingTicketsRef.current.add(closeTicketKey);

    const closingPositions = useAppStore.getState().positions.filter((position) => position.id === id) as Position[];
    const closeSnapshots = buildTradeOverlayCloseSnapshots(closingPositions);
    const closeMarkerScope = getPositionCloseScope();
    const isCurrentCloseSession = () => Boolean(
      closeLogin
      && isAuthenticatedRef.current
      && getLiveTradingLogin() === closeLogin
      && getPositionCloseScope() === closeMarkerScope
      && getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()) === closeSessionScope
    );
    const publishSingleCloseFailure = (failureReason: string) => {
      if (!showFailureFeedback) return;
      publishOrderFeedback(
        [feedbackLabel('Close position'), feedbackValue(` #${id}: `), feedbackLabel('Failed'), feedbackValue(failureReason ? ` — ${failureReason}` : '')],
        'error',
      );
    };

    const closingPosition = closingPositions[0];
    if (!closingPosition?.symbol) {
      closingTicketsRef.current.delete(closeTicketKey);
      publishSingleCloseFailure('Position is no longer available. Refresh and try again.');
      return false;
    }
    // Quote validation must retain the position identity after optimistic removal.
    const executionContext = {
      ticketId: id,
      symbol: closingPosition.symbol,
      isCurrent: isCurrentCloseSession,
    };
    // Synchronous chart/store listeners can throw or replace the active session.
    // Neither may abandon an already submitted close or change its outcome.
    const presentClose = (update: () => void) => {
      if (!isCurrentCloseSession()) return;
      try { update(); }
      catch (error) { console.warn('[Trade] Close presentation update failed:', error); }
    };

    let closeQuoteDemand: ReturnType<typeof retainPositionCloseQuotes> | undefined;
    try {
      closeQuoteDemand = retainPositionCloseQuotes(`close:${closeTicketKey}`, [closingPosition.symbol]);
      if (!isCurrentCloseSession()) return false;
      // The API validates the captured scope and live quote, then starts the
      // request synchronously. Do this before chart/React work can age the quote.
      const closePromise = api.positions.closePosition(String(id), {
        account_login: closeLogin,
        executionContext,
        onCloseCommandStatus: ({ status, clientOrderId }) => {
          if (!isCurrentCloseSession()) return;
          if (status === 'awaiting-confirmation') {
            presentClose(() => clearOptimisticClosedTickets([id], closeMarkerScope));
            presentClose(() => {
              const store = useAppStore.getState();
              const current = store.positions.find(position => position.id === id) ?? closingPosition;
              store.setPositions([...store.positions.filter(position => position.id !== id), {
                ...current, closeCommandState: 'awaiting-confirmation', closeClientOrderId: clientOrderId,
              }]);
            });
            presentClose(() => publishOrderFeedback(
              [feedbackLabel('Close position'), feedbackValue(` #${id}: `), feedbackLabel('Awaiting confirmation'), feedbackValue(` (${clientOrderId})`)],
              'warning',
            ));
          } else if (status === 'rejected' || status === 'expired') {
            presentClose(() => {
              const store = useAppStore.getState();
              store.setPositions(store.positions.map(position => position.id === id
                ? { ...position, closeCommandState: undefined, closeClientOrderId: undefined } : position));
            });
          }
        },
      });
      // Hide the pending ticket while retaining its quote demand through the
      // same request's settlement. Each step rechecks ownership after listeners.
      presentClose(() => markLocalTradeMutation([id]));
      presentClose(() => dispatchTradeOverlayCloseState([id], 'pending', { snapshots: closeSnapshots }));
      presentClose(() => useAppStore.getState().setPositions(
        useAppStore.getState().positions.filter((position) => position.id !== id),
        { removedTickets: [id] },
      ));
      await closePromise;
      if (!isCurrentCloseSession()) {
        clearOptimisticClosedTickets([id], closeMarkerScope);
        return false;
      }
      // Backend confirmed: convert the optimistic removal into a tombstone so
      // a lagging position snapshot cannot restore the closed ticket.
      presentClose(() => useAppStore.getState().setPositions(useAppStore.getState().positions, { closedTickets: [id] }));
      presentClose(() => dispatchTradeOverlayCloseState([id], 'confirmed', { snapshots: closeSnapshots }));
      presentClose(() => { import('../../utils/audio').then(m => { if (isCurrentCloseSession()) m.playSystemSound('close'); }); });
      const loginId = closeLogin;
      presentClose(() => { refreshPositions(loginId, { allowWsCommit: true }).catch(err => console.error('[Trade] Failed to refresh positions after close:', err)); });
      presentClose(() => { refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history after close:', err)); });
      return true;
    } catch (err: unknown) {
      console.error('Failed to close position:', err);
      clearOptimisticClosedTickets([id], closeMarkerScope);
      const sessionCurrent = isCurrentCloseSession();
      if (sessionCurrent) {
        const unresolved = Boolean(err && typeof err === 'object' && 'data' in err
          && err.data && typeof err.data === 'object' && 'code' in err.data && err.data.code === 'ORDER_OUTCOME_UNKNOWN');
        if (!unresolved) presentClose(() => dispatchTradeOverlayCloseState([id], 'failed'));
        presentClose(() => {
          const store = useAppStore.getState();
          const existingTickets = new Set(store.positions.map((position) => position.id));
          const restoredPositions = closingPositions.filter((position) => !existingTickets.has(position.id));
          if (restoredPositions.length > 0) store.setPositions([...store.positions, ...restoredPositions]);
        });
        presentClose(() => {
          if (unresolved) publishOrderFeedback(formatOrderError(err), 'warning');
          else publishSingleCloseFailure(formatOrderError(err));
        });
        presentClose(() => { refreshPositions(closeLogin, { allowWsCommit: true }).catch(error => console.error('[Trade] Failed to refresh positions after close:', error)); });
      }
      return false;
    } finally {
      closeQuoteDemand?.release();
      closingTicketsRef.current.delete(closeTicketKey);
    }
  };
  return handleClosePosition;
}
