import { useSyncExternalStore } from 'react';
import { onSessionChange, getAccessToken } from '../services/brokerSession';
import { isInvestorToken } from '../services/investorSession';
import { useAppStore } from '../store/useAppStore';

const subscribe = (onChange: () => void): (() => void) => {
  const unsubscribeSession = onSessionChange(onChange);
  window.addEventListener('auth:token-updated', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    unsubscribeSession();
    window.removeEventListener('auth:token-updated', onChange);
    window.removeEventListener('storage', onChange);
  };
};

/** Always derive access from the current session, including restore and refresh. */
export const useInvestorSession = (): boolean => {
  const storeToken = useAppStore(state => state.authToken);
  const storedToken = useSyncExternalStore(subscribe, getAccessToken, () => null);
  return isInvestorToken(storedToken ?? storeToken);
};
