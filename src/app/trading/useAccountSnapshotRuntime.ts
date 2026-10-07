import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../../services/brokerSession';
import { getStoredBrokerServer } from '../../services/brokerServers';
import { pickAccountDisplayName } from '../../utils/accountDisplayName';
import { applyPositionStreamUpdate, decodePositionStreamMessage } from '../../services/tradePositionStream';
import { loadSessionTradeSnapshot } from '../../services/tradeStartupSnapshot';
import { useAppStore, type Position } from '../../store/useAppStore';
import { parsePositiveLogin } from '../session/sessionIdentity';
import type { RefreshPositionsOptions, TradeRestRead } from './tradeRuntimeContracts';
import { applyOpenPositionSnapshot, normalizeAccountSummary, normalizePositions } from './positionRuntime';

interface UseAccountSnapshotRuntimeOptions {
  isAuthenticated: boolean;
  accountId: string;
  accountIdRef: MutableRefObject<string>;
  isAuthenticatedRef: MutableRefObject<boolean>;
  activeAccountDataRef: MutableRefObject<number | null>;
  optimisticClosedTicketsRef: MutableRefObject<Set<number>>;
  serverClosedTicketsRef: MutableRefObject<Set<number>>;
  positionsStreamVersionRef: MutableRefObject<number>;
  beginTradeRestRead: () => TradeRestRead;
  isStaleTradeRestRead: (request: TradeRestRead, options?: RefreshPositionsOptions) => boolean;
  reconcileOptimisticClosedPositions: (
    positions: Position[],
    options?: { clearConfirmedAbsent?: boolean },
  ) => Position[];
  refreshOrdersAndHistory: (login?: number) => Promise<void>;
  refreshPositions: (login?: number, options?: RefreshPositionsOptions) => Promise<void>;
  setInitialTradeSnapshotSettledFor: Dispatch<SetStateAction<string>>;
}

export const useAccountSnapshotRuntime = ({
  isAuthenticated,
  accountId,
  accountIdRef,
  isAuthenticatedRef,
  activeAccountDataRef,
  optimisticClosedTicketsRef,
  serverClosedTicketsRef,
  positionsStreamVersionRef,
  beginTradeRestRead,
  isStaleTradeRestRead,
  reconcileOptimisticClosedPositions,
  refreshOrdersAndHistory,
  refreshPositions,
  setInitialTradeSnapshotSettledFor,
}: UseAccountSnapshotRuntimeOptions): void => {
  const accountPollInFlightRef = useRef<Promise<void> | null>(null);
  const accountPollInFlightLoginRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accountId) return undefined;
    const loginId = parsePositiveLogin(accountId);
    if (!loginId) return undefined;

    let setupActive = true;
    let heartbeatPending = false;
    const fetchAccountHeartbeat = async (isInitial = false): Promise<void> => {
      if (accountPollInFlightRef.current) {
        const inFlightLogin = accountPollInFlightLoginRef.current;
        if (inFlightLogin === loginId) heartbeatPending = true;
        await accountPollInFlightRef.current;
        if (inFlightLogin === loginId) {
          if (isInitial && setupActive && isAuthenticatedRef.current && accountIdRef.current === String(loginId)) {
            setInitialTradeSnapshotSettledFor(String(loginId));
          }
          return;
        }
        const activeLogin = parsePositiveLogin(useAppStore.getState().accountId || accountIdRef.current || undefined);
        if (!isAuthenticatedRef.current || activeLogin !== loginId) return;
      }

      const request = (async () => {
        try {
          const restRead = beginTradeRestRead();
          const positionsVersion = positionsStreamVersionRef.current;
          const metricsScope = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
          const isAccountSwitch = activeAccountDataRef.current !== loginId;
          if (isInitial && isAccountSwitch) {
            optimisticClosedTicketsRef.current.clear();
            serverClosedTicketsRef.current.clear();
            const store = useAppStore.getState();
            store.setAccount(null);
            store.setPositions([]);
            store.setOrders([]);
            store.setTrades([]);
          }

          const startedSessionToken = useAppStore.getState().authToken;
          const { accountResult, positionsResult } = await loadSessionTradeSnapshot(loginId);
          const activeLogin = parsePositiveLogin(useAppStore.getState().accountId || accountIdRef.current || undefined);
          if (useAppStore.getState().authToken !== startedSessionToken) return;
          if (!isAuthenticatedRef.current
            || activeLogin !== loginId
            || metricsScope !== getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope())) return;

          const accountPayload = accountResult.status === 'fulfilled' ? accountResult.value : null;
          const positionsPayload = positionsResult.status === 'fulfilled' ? positionsResult.value : null;
          if (isInitial) {
            if (accountResult.status === 'rejected') console.error('[REST Error] getAccountSummary failed:', accountResult.reason);
            if (positionsResult.status === 'rejected') console.error('[REST Error] getPositions failed:', positionsResult.reason);
          }
          if (isStaleTradeRestRead(restRead, { allowWsCommit: true })) return;

          if (accountPayload) {
            const normalizedAccount = normalizeAccountSummary(accountPayload, useAppStore.getState().account, {
              login: loginId,
              scope: metricsScope,
            });
            useAppStore.getState().setAccount(normalizedAccount);

            const raw = accountPayload as unknown as Record<string, unknown>;
            const accountName = pickAccountDisplayName(raw.name, raw.account_name, raw.display_name, raw.user_name);
            if (accountName) {
              const store = useAppStore.getState();
              const existingAccount = store.savedAccounts.find((savedAccount) => savedAccount.login === loginId);
              const serverFromPayload = [raw.broker_server, raw.server, raw.server_name, raw.mt5_server, raw.trade_server]
                .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
                ?.trim();
              store.addSavedAccount({
                login: loginId,
                name: accountName,
                server: existingAccount?.server || serverFromPayload || getStoredBrokerServer(),
                isLive: true,
                lastUsed: Date.now(),
              });
            }
          }

          if (positionsPayload !== null) {
            const currentPositions = useAppStore.getState().positions;
            const decoded = decodePositionStreamMessage({ data: { positions: positionsPayload } });
            const normalized = decoded
              ? applyPositionStreamUpdate(currentPositions, {
                ...decoded,
                source: 'rest',
                kind: positionsStreamVersionRef.current > positionsVersion ? 'patch' : 'snapshot',
              }, (raw) => normalizePositions([raw])[0])
              : normalizePositions(positionsPayload);
            applyOpenPositionSnapshot(reconcileOptimisticClosedPositions(normalized, { clearConfirmedAbsent: true }));
          }
          activeAccountDataRef.current = loginId;
        } catch (error) {
          if (isInitial) console.error('Failed to fetch account data:', error);
        } finally {
          if (isInitial && setupActive && isAuthenticatedRef.current && accountIdRef.current === String(loginId)) {
            setInitialTradeSnapshotSettledFor(String(loginId));
          }
          if (accountPollInFlightLoginRef.current === loginId) {
            accountPollInFlightRef.current = null;
            accountPollInFlightLoginRef.current = null;
          }
          if (heartbeatPending && setupActive) {
            heartbeatPending = false;
            queueMicrotask(() => { if (setupActive) void fetchAccountHeartbeat(false); });
          }
        }
      })();

      accountPollInFlightLoginRef.current = loginId;
      accountPollInFlightRef.current = request;
      await request;
    };

    queueMicrotask(() => {
      if (!setupActive) return;
      void fetchAccountHeartbeat(true);
      void refreshOrdersAndHistory(loginId).catch((error) => {
        console.error('[History] Failed to refresh initial orders/history:', error);
      });
    });

    const handleTradeStreamRecovery = () => {
      void fetchAccountHeartbeat(false);
      void refreshPositions(loginId, { allowWsCommit: true });
      void refreshOrdersAndHistory(loginId).catch((error) => console.error('[History] Recovery failed:', error));
    };
    window.addEventListener('rtx:trade-stream-recovered', handleTradeStreamRecovery);
    return () => {
      setupActive = false;
      window.removeEventListener('rtx:trade-stream-recovered', handleTradeStreamRecovery);
    };
  }, [
    accountId,
    accountIdRef,
    activeAccountDataRef,
    beginTradeRestRead,
    isAuthenticated,
    isAuthenticatedRef,
    isStaleTradeRestRead,
    optimisticClosedTicketsRef,
    positionsStreamVersionRef,
    reconcileOptimisticClosedPositions,
    refreshOrdersAndHistory,
    refreshPositions,
    serverClosedTicketsRef,
    setInitialTradeSnapshotSettledFor,
  ]);
};
