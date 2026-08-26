import { useEffect, useState } from 'react';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
} from '../services/brokerSession';

const getInitialScopeKey = (): string => {
  const committed = getCommittedBrokerAccountSessionScope();
  return getCommittedBrokerAccountSessionScopeKey(committed);
};

/**
 * Canonical, token-free chart ownership scope. It changes only when the app
 * store publishes a successful auth/logout/account commit.
 */
export const useBrokerAccountSessionScope = (): string => {
  const [scopeKey, setScopeKey] = useState(getInitialScopeKey);

  useEffect(() => {
    const unsubscribe = onCommittedBrokerAccountSessionScopeChange(scope => {
      setScopeKey(getCommittedBrokerAccountSessionScopeKey(scope));
    });
    return unsubscribe;
  }, []);

  return scopeKey;
};
