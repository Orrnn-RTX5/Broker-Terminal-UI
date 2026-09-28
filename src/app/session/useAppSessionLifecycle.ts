import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { api } from '../../services/api';
import { brokerApi } from '../../api/brokerApi';
import { chartDataService } from '../../services/chartDataService';
import { getCommittedBrokerAccountSessionScope } from '../../services/brokerSession';
import { seedValidatedSessionAccountSummary } from '../../services/tradeStartupSnapshot';
import { updateDynamicUrls } from '../../config/api';
import { useAppStore } from '../../store/useAppStore';
import type { AuthenticatedSessionHandoff } from '../../startup/authenticatedSessionHandoff';
import {
  getStoredAuthToken,
  getStoredTokenExpiryMs,
  hasTokenExpiryElapsed,
  parseStoredTokenExpiryMs,
} from './authSessionStorage';
import { parsePositiveLogin } from './sessionIdentity';

interface UseAppSessionLifecycleOptions {
  freshSessionHandoff: AuthenticatedSessionHandoff | null;
  isAuthenticated: boolean;
  setIsAuthenticated: Dispatch<SetStateAction<boolean>>;
  setIsAutoAuthenticating: Dispatch<SetStateAction<boolean>>;
  accountId: string;
  setAccountId: Dispatch<SetStateAction<string>>;
  accountIdRef: MutableRefObject<string>;
  isAuthenticatedRef: MutableRefObject<boolean>;
  lastObservedAuthTokenRef: MutableRefObject<string | null>;
  sessionRestoreStartedRef: MutableRefObject<boolean>;
  authSessionGenerationRef: MutableRefObject<number>;
  clearLocalAccountState: () => void;
  onSessionEnded?: () => void;
}

interface AppSessionLifecycle {
  handleLoginSuccess: (nextAccountId: string) => void;
}

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export const useAppSessionLifecycle = ({
  freshSessionHandoff,
  isAuthenticated,
  setIsAuthenticated,
  setIsAutoAuthenticating,
  accountId,
  setAccountId,
  accountIdRef,
  isAuthenticatedRef,
  lastObservedAuthTokenRef,
  sessionRestoreStartedRef,
  authSessionGenerationRef,
  clearLocalAccountState,
  onSessionEnded,
}: UseAppSessionLifecycleOptions): AppSessionLifecycle => {
  const [, setAutoAuthError] = useState<string | null>(null);
  const [tokenSessionVersion, setTokenSessionVersion] = useState(0);
  const storeTokenExpiresAt = useAppStore((state) => state.tokenExpiresAt);
  const storeAccountId = useAppStore((state) => state.accountId);
  const storeIsAuthenticated = useAppStore((state) => state.isAuthenticated);

  accountIdRef.current = accountId;
  isAuthenticatedRef.current = isAuthenticated;

  const performSessionExpiredLogout = useCallback((reason = 'session_expired') => {
    console.warn(`[App] Logging out session: ${reason}`);
    authSessionGenerationRef.current += 1;
    lastObservedAuthTokenRef.current = null;
    clearLocalAccountState();
    setIsAuthenticated(false);
    setIsAutoAuthenticating(false);
    setAccountId('');
    useAppStore.getState().logout();
    onSessionEnded?.();
  }, [
    authSessionGenerationRef,
    clearLocalAccountState,
    lastObservedAuthTokenRef,
    onSessionEnded,
    setAccountId,
    setIsAuthenticated,
    setIsAutoAuthenticating,
  ]);

  const validateStoredAuthSession = useCallback((reason = 'auth_token_missing'): boolean => {
    const token = getStoredAuthToken();
    if (token) {
      lastObservedAuthTokenRef.current = token;
      const expiryMs = parseStoredTokenExpiryMs(useAppStore.getState().tokenExpiresAt) || getStoredTokenExpiryMs();
      if (hasTokenExpiryElapsed(expiryMs)) {
        performSessionExpiredLogout('token_expired');
        return false;
      }
      return true;
    }

    const storeState = useAppStore.getState();
    const hadActiveSession = Boolean(
      isAuthenticatedRef.current
      || storeState.isAuthenticated
      || lastObservedAuthTokenRef.current
    );
    if (hadActiveSession) {
      performSessionExpiredLogout(reason);
      return false;
    }
    return true;
  }, [isAuthenticatedRef, lastObservedAuthTokenRef, performSessionExpiredLogout]);

  const handleLoginSuccess = useCallback((nextAccountId: string) => {
    const loginId = parsePositiveLogin(nextAccountId);
    const token = getStoredAuthToken();
    if (!loginId || !token) {
      performSessionExpiredLogout('login_missing_token');
      return;
    }

    lastObservedAuthTokenRef.current = token;
    authSessionGenerationRef.current += 1;
    setIsAuthenticated(true);
    setAccountId(String(loginId));
    const storeState = useAppStore.getState();
    if (!storeState.isAuthenticated || storeState.accountId !== String(loginId)) {
      const refreshToken = localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token') || undefined;
      const expiresAt = getStoredTokenExpiryMs() || undefined;
      storeState.setAuthenticated(true, String(loginId), token, refreshToken, expiresAt);
    }
  }, [
    authSessionGenerationRef,
    lastObservedAuthTokenRef,
    performSessionExpiredLogout,
    setAccountId,
    setIsAuthenticated,
  ]);

  useEffect(() => {
    const handleLogoutEvent = () => performSessionExpiredLogout('manual_logout');
    window.addEventListener('rtx:logout', handleLogoutEvent);
    return () => window.removeEventListener('rtx:logout', handleLogoutEvent);
  }, [performSessionExpiredLogout]);

  useEffect(() => {
    const handleUnauthorizedEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ staleRequest?: boolean; reason?: string }>).detail;
      if (detail?.staleRequest) {
        console.warn('[App] Ignoring stale unauthorized response for an older session token.');
        return;
      }
      console.warn('[App] Session expired or unauthorized request. Performing global logout.');
      performSessionExpiredLogout(detail?.reason || 'unauthorized');
    };
    window.addEventListener('auth:unauthorized', handleUnauthorizedEvent);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorizedEvent);
  }, [performSessionExpiredLogout]);

  useEffect(() => {
    const handleTokenUpdated = () => {
      setTokenSessionVersion((value) => value + 1);
      validateStoredAuthSession('auth_token_missing');
    };
    window.addEventListener('auth:token-updated', handleTokenUpdated);
    return () => window.removeEventListener('auth:token-updated', handleTokenUpdated);
  }, [validateStoredAuthSession]);

  useEffect(() => {
    const authStorageKeys = new Set(['auth_token', 'refresh_token', 'token_expires_at']);
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage && event.storageArea !== sessionStorage) return;
      if (event.key && !authStorageKeys.has(event.key)) return;
      setTokenSessionVersion((value) => value + 1);
      validateStoredAuthSession(event.key === 'auth_token' && !event.newValue
        ? 'auth_token_removed'
        : 'auth_storage_changed');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [validateStoredAuthSession]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const intervalId = window.setInterval(() => validateStoredAuthSession('auth_token_removed'), 1000);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, tokenSessionVersion, validateStoredAuthSession]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const expiryMs = parseStoredTokenExpiryMs(storeTokenExpiresAt) || getStoredTokenExpiryMs();
    if (!expiryMs) return undefined;
    const delay = expiryMs - Date.now();
    if (delay <= 0) {
      performSessionExpiredLogout('token_expired');
      return undefined;
    }
    const timeoutId = window.setTimeout(
      () => performSessionExpiredLogout('token_expired'),
      Math.min(delay, 2_147_483_647),
    );
    return () => window.clearTimeout(timeoutId);
  }, [isAuthenticated, performSessionExpiredLogout, storeTokenExpiresAt, tokenSessionVersion]);

  useEffect(() => {
    if (sessionRestoreStartedRef.current) return;
    sessionRestoreStartedRef.current = true;
    if (freshSessionHandoff) {
      setIsAutoAuthenticating(false);
      return;
    }

    const restoreSession = async () => {
      const sessionGeneration = authSessionGenerationRef.current;
      setIsAutoAuthenticating(true);
      setAutoAuthError(null);
      updateDynamicUrls();

      const token = localStorage.getItem('auth_token');
      const refreshToken = localStorage.getItem('refresh_token');
      const rememberedLogin = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
      localStorage.removeItem('rtx_saved_password');

      const storeState = useAppStore.getState();
      const savedAccounts = storeState.savedAccounts || [];
      if (savedAccounts.some((savedAccount) => 'password' in savedAccount)) {
        useAppStore.setState({
          savedAccounts: savedAccounts.map((savedAccount) => {
            const sanitized = { ...savedAccount } as typeof savedAccount & { password?: unknown };
            delete sanitized.password;
            return sanitized;
          }),
        });
      }
      const lastAccountId = storeState.accountId;
      const restoredExpiryMs = storeState.tokenExpiresAt || getStoredTokenExpiryMs();
      const restoreScope = getCommittedBrokerAccountSessionScope();
      const isCurrentRestore = () => {
        const currentState = useAppStore.getState();
        return getCommittedBrokerAccountSessionScope() === restoreScope
          && currentState.isAuthenticated === storeState.isAuthenticated
          && currentState.accountId === lastAccountId;
      };

      if (hasTokenExpiryElapsed(restoredExpiryMs)) {
        performSessionExpiredLogout('token_expired');
        setIsAutoAuthenticating(false);
        return;
      }
      if (storeState.isAuthenticated) {
        const authenticatedLogin = parsePositiveLogin(lastAccountId || undefined);
        if (authenticatedLogin) {
          const restoredAccountId = String(authenticatedLogin);
          setIsAuthenticated(true);
          setAccountId(restoredAccountId);
          console.log('[Session] Restored active authenticated store session for:', restoredAccountId);
          setIsAutoAuthenticating(false);
          return;
        }
      }

      const targetLogin = lastAccountId || rememberedLogin;
      if (!targetLogin || (!token && !refreshToken)) {
        setIsAutoAuthenticating(false);
        return;
      }
      const loginId = parsePositiveLogin(String(targetLogin));
      if (!loginId) {
        setIsAutoAuthenticating(false);
        return;
      }

      try {
        const accountData = await api.account.getAccountSummary(loginId);
        if (!isCurrentRestore()
          || authSessionGenerationRef.current !== sessionGeneration
          || !getStoredAuthToken()) return;
        const restoredAccountId = accountData.id || String(loginId);
        const expiresAtString = localStorage.getItem('token_expires_at');
        const expiresAt = expiresAtString ? new Date(expiresAtString).getTime() : undefined;
        const activeToken = localStorage.getItem('auth_token') || token;
        const activeRefresh = localStorage.getItem('refresh_token') || refreshToken;
        if (!activeToken) throw new Error('Session restore did not produce an access token');

        useAppStore.getState().setAuthTokens(activeToken, activeRefresh || undefined, expiresAt);
        useAppStore.getState().setAuthenticated(true, restoredAccountId, activeToken, activeRefresh || undefined, expiresAt);
        seedValidatedSessionAccountSummary(loginId, accountData, activeToken);
        chartDataService.preloadStartupHistory();
        setIsAuthenticated(true);
        setAccountId(restoredAccountId);
        console.log('[Session] Restored via token for:', restoredAccountId);
      } catch (error) {
        if (!isCurrentRestore() || authSessionGenerationRef.current !== sessionGeneration) return;
        const message = getErrorMessage(error);
        console.log('[Session] Restore failed:', message);
        performSessionExpiredLogout('restore_failed');
        setAutoAuthError(message || 'Session restore failed');
      } finally {
        if (authSessionGenerationRef.current === sessionGeneration) setIsAutoAuthenticating(false);
      }
    };

    void restoreSession();
  }, [
    authSessionGenerationRef,
    freshSessionHandoff,
    performSessionExpiredLogout,
    sessionRestoreStartedRef,
    setAccountId,
    setIsAuthenticated,
    setIsAutoAuthenticating,
  ]);

  useEffect(() => {
    const handleForeground = async () => {
      if (!isAuthenticatedRef.current || !validateStoredAuthSession('auth_token_removed')) return;
      const sessionGeneration = authSessionGenerationRef.current;
      try {
        const activeToken = await brokerApi.checkAndProactiveRefresh();
        if (authSessionGenerationRef.current !== sessionGeneration) return;
        if (!activeToken) {
          performSessionExpiredLogout('auth_token_missing');
          return;
        }
        window.dispatchEvent(new CustomEvent('rtx:reconnect-ws'));
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
      } catch (error) {
        if (authSessionGenerationRef.current !== sessionGeneration
          || (error instanceof Error && 'code' in error && error.code === 'SESSION_CHANGED')) return;
        console.error('[App] Failed to refresh token or sync on foreground:', error);
        performSessionExpiredLogout('refresh_failed');
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void handleForeground();
    };
    window.addEventListener('focus', handleForeground);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleForeground);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authSessionGenerationRef, isAuthenticatedRef, performSessionExpiredLogout, validateStoredAuthSession]);

  useEffect(() => {
    if (!storeIsAuthenticated || !storeAccountId) {
      if (accountId) {
        clearLocalAccountState();
        setIsAuthenticated(false);
        setAccountId('');
      }
      return;
    }
    setAccountId((previous) => {
      if (previous === storeAccountId) return previous;
      setIsAuthenticated(true);
      return storeAccountId;
    });
  }, [
    accountId,
    clearLocalAccountState,
    setAccountId,
    setIsAuthenticated,
    storeAccountId,
    storeIsAuthenticated,
  ]);

  return { handleLoginSuccess };
};
