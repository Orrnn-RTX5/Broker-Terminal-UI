/**
 * useLiveAccountState — React hook for Section 4 (Account + Positions /ws/v2)
 *
 * Connects to AccountSocketManager on mount with the given login.
 * Account data flows through Zustand store (useAppStore).
 *
 * Usage:
 *   const { account, isConnected } = useLiveAccountState(100001);
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { getAccountSocketManager } from '../services/accountSocketManager';
import { useAppStore, type Account } from '../store/useAppStore';

export function useLiveAccountState(login?: number | string | null) {
  const storeAccountId = useAppStore((s) => s.accountId);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const account = useAppStore((s) => s.account);
  const [isConnected, setIsConnected] = useState(false);

  const resolvedLogin = useMemo(() => {
    const direct = Number.parseInt(String(login ?? storeAccountId ?? ''), 10);
    return Number.isFinite(direct) && direct > 0 ? direct : null;
  }, [login, storeAccountId]);

  const managerRef = useRef(getAccountSocketManager());

  useEffect(() => {
    if (!isAuthenticated || !resolvedLogin) return;

    const manager = managerRef.current;

    // Only connect if not already connected with this login
    if (manager.getLogin() !== resolvedLogin) {
      manager.connect(resolvedLogin);
    }

    const unsubConnection = manager.onConnectionChange(setIsConnected);

    return () => {
      unsubConnection();
      // Don't disconnect on unmount — other components may still need it
    };
  }, [resolvedLogin, isAuthenticated]);

  return {
    account,
    isConnected,
    login: resolvedLogin,
  };
}
