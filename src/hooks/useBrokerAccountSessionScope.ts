import { useSyncExternalStore } from 'react';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
} from '../services/brokerSession';

const getScopeKey = (): string => {
  const committed = getCommittedBrokerAccountSessionScope();
  return getCommittedBrokerAccountSessionScopeKey(committed);
};

/**
 * Canonical, token-free chart ownership scope. It changes only when the app
 * store publishes a successful auth/logout/account commit.
 */
export const useBrokerAccountSessionScope = (): string => {
  return useSyncExternalStore(
    onCommittedBrokerAccountSessionScopeChange,
    getScopeKey,
    getScopeKey,
  );
};
