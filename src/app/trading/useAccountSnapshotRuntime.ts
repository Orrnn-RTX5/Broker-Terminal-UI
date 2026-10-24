import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { extractAccountMetrics } from '../../services/accountMetrics';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../../services/brokerSession';
import { getRawStoredBrokerServer } from '../../services/brokerServers';
import { getSavedAccountServerIdentities, isSavedAccountInBrokerSession, normalizeSavedAccountServer } from '../../services/savedAccountScope';
import { pickAccountDisplayName } from '../../utils/accountDisplayName';
import { resolveTradingAccountType } from '../../services/tradingAccountType';
import { applyPositionStreamUpdate, decodePositionStreamMessage } from '../../services/tradePositionStream';
import { loadSessionTradeSnapshot } from '../../services/tradeStartupSnapshot';
import { beginPositionsRead, useAppStore, type Position } from '../../store/useAppStore';
import { markPositionsReadSettled, markPositionsReadStarted } from '../../services/positionSnapshotSafety';
import { startPositionsSafetyNet } from './positionsSafetyNet';
import { parsePositiveLogin } from '../session/sessionIdentity';
import type { RefreshPositionsOptions, TradeRestRead } from './tradeRuntimeContracts';
import { applyOpenPositionSnapshot, normalizeAccountSummary, normalizePositions } from './positionRuntime';

// Account metadata can be wrapped by an endpoint envelope or user record. Reject
// explicit conflicting identities before updating the saved account bookmark.
const isAccountMetadataForSession = (value: unknown, login: number, brokerId: string, depth = 0): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 6) return false;
  const record = value as Record<string, unknown>;
  for (const key of ['login', 'account_login']) {
    if (record[key] !== undefined && String(record[key]) !== String(login)) return false;
  }
  for (const key of ['broker_id', 'brokerId']) {
    if (record[key] !== undefined && String(record[key]).trim() !== brokerId) return false;
  }
  for (const key of ['account', 'data', 'user']) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)
      && !isAccountMetadataForSession(nested, login, brokerId, depth + 1)) return false;
  }
  return true;
};

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
        markPositionsReadStarted();
        try {
          const restRead = beginTradeRestRead();
          const positionsReadStartedAt = beginPositionsRead();
          const accountScope = getCommittedBrokerAccountSessionScope();
          if (!accountScope.authenticated || accountScope.accountId !== String(loginId)) return;
          const metricsScope = getCommittedBrokerAccountSessionScopeKey(accountScope);
          const accountServerIdentities = getSavedAccountServerIdentities();
          const storedServer = getRawStoredBrokerServer();
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

            const raw = extractAccountMetrics(accountPayload);
            const store = useAppStore.getState();
            const existingAccount = store.savedAccounts.find((savedAccount) => savedAccount.login === loginId
              && isSavedAccountInBrokerSession(savedAccount, accountScope, accountServerIdentities));
            const accountName = pickAccountDisplayName(raw.name, raw.account_name, raw.display_name, raw.user_name);
            const hasNonEmptyGroup = [raw.group, raw.Group, raw.account_group, raw.accountGroup]
              .some((value) => typeof value === 'string' && Boolean(value.trim()));
            const accountType = resolveTradingAccountType(accountPayload, existingAccount)
              ?? (hasNonEmptyGroup ? 'real' : undefined);
            if ((accountName || accountType) && isAccountMetadataForSession(accountPayload, loginId, accountScope.brokerId)) {
              const serverFromPayload = [raw.broker_server, raw.server, raw.server_name, raw.mt5_server, raw.trade_server]
                .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
                ?.trim();
              store.addSavedAccount({
                login: loginId,
                name: accountName || existingAccount?.name || '',
                server: existingAccount?.server || serverFromPayload
                  || (accountServerIdentities.has(normalizeSavedAccountServer(storedServer)) ? storedServer : '')
                  || accountScope.serverUrl || accountScope.brokerId,
                brokerId: accountScope.brokerId,
                serverUrl: accountScope.serverUrl,
                ...(accountType ? { accountType, isLive: accountType === 'real' } : {}),
                lastUsed: Date.now(),
              });
            }
          }

          if (positionsPayload !== null) {
            const currentPositions = useAppStore.getState().positions;
            const decoded = decodePositionStreamMessage({ data: { positions: positionsPayload } });
            const normalized = decoded
              ? applyPositionStreamUpdate(currentPositions, { ...decoded, source: 'rest' }, (raw) => normalizePositions([raw])[0])
              : normalizePositions(positionsPayload);
            applyOpenPositionSnapshot(reconcileOptimisticClosedPositions(normalized, { clearConfirmedAbsent: true }), {
              readStartedAt: positionsReadStartedAt,
              complete: decoded === null || decoded.kind === 'snapshot',
            });
          }
          activeAccountDataRef.current = loginId;
        } catch (error) {
          if (isInitial) console.error('Failed to fetch account data:', error);
        } finally {
          markPositionsReadSettled();
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

    // Safety net: one complete positions read per interval, so a close frame lost on a live
    // socket is caught. Stopped with this effect (logout, account change) and while hidden.
    const stopPositionsSafetyNet = startPositionsSafetyNet({
      read: () => { void refreshPositions(loginId, { allowWsCommit: true }); },
    });

    const handleTradeStreamRecovery = () => {
      void fetchAccountHeartbeat(false);
      void refreshPositions(loginId, { allowWsCommit: true });
      void refreshOrdersAndHistory(loginId).catch((error) => console.error('[History] Recovery failed:', error));
    };
    window.addEventListener('rtx:trade-stream-recovered', handleTradeStreamRecovery);
    return () => {
      setupActive = false;
      stopPositionsSafetyNet();
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
