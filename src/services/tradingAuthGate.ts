import { useAppStore } from '../store/useAppStore';

export const TRADING_AUTH_REQUEST_EVENT = 'rtx:request-trading-auth';

export interface TradingOrderAuthIntent {
  kind?: 'order';
  source: 'quick-trade' | 'order-panel' | 'one-click-trading' | 'last-symbol-panel';
  side: 'BUY' | 'SELL';
  symbol: string;
  volume: number;
  bid?: number;
  ask?: number;
}

export interface TradingMutationAuthIntent {
  kind: 'mutation';
  source: 'new-order';
  actionLabel: string;
  symbol?: string;
}

export type TradingAuthIntent = TradingOrderAuthIntent | TradingMutationAuthIntent;

const parseTradingLogin = (value: unknown): number | null => {
  const login = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(login) && login > 0 ? login : null;
};

export const hasAuthenticatedTradingSession = (): boolean => {
  const state = useAppStore.getState();
  const expiresAt = Number(state.tokenExpiresAt || 0);
  return Boolean(
    state.isAuthenticated
      && parseTradingLogin(state.accountId)
      && state.authToken
      && (!expiresAt || expiresAt > Date.now()),
  );
};

export const requestTradingAuth = (intent: TradingAuthIntent): void => {
  if (typeof window === 'undefined') return;
  const normalized = intent.kind === 'mutation'
    ? { ...intent, symbol: intent.symbol?.trim().toUpperCase() }
    : {
        ...intent,
        symbol: intent.symbol.trim().toUpperCase(),
        volume: Number.isFinite(intent.volume) && intent.volume > 0 ? intent.volume : 0.01,
      };
  window.dispatchEvent(new CustomEvent<TradingAuthIntent>(TRADING_AUTH_REQUEST_EVENT, {
    detail: normalized,
  }));
};

export const requireTradingAuth = (intent: TradingAuthIntent): boolean => {
  if (hasAuthenticatedTradingSession()) return true;
  requestTradingAuth(intent);
  return false;
};

export const requireNewOrderAuth = (symbol?: string): boolean => requireTradingAuth({
  kind: 'mutation',
  source: 'new-order',
  actionLabel: 'Open New Order',
  symbol,
});

export interface TradingAuthenticationCompletionActions {
  login: (accountId: string) => void;
  closeDialog: () => void;
  clearIntent: () => void;
  openOrderDraft: (intent: TradingOrderAuthIntent) => void;
}

export const completeTradingAuthentication = (
  accountId: string,
  intent: TradingAuthIntent | null,
  actions: TradingAuthenticationCompletionActions,
): void => {
  actions.login(accountId);
  actions.closeDialog();
  if (intent && intent.kind !== 'mutation') actions.openOrderDraft(intent);
  actions.clearIntent();
};
