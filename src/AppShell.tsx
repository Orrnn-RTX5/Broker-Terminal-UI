import { useUiTranslation } from './hooks/useUiTranslation';
import { useCallback, useEffect, useState } from 'react';
import { WelcomeTerminal } from './components/WelcomeTerminal';
import {
  parseSessionExpiryMs,
  type AuthenticatedSessionHandoff,
} from './startup/authenticatedSessionHandoff';
import { TerminalLoadFallback } from './startup/TerminalLoadFallback';
import { preloadTradingChartRuntime } from './startup/tradingChartRuntime';
import { ensureConfiguredWebSession } from './startup/configuredWebSession';

type AppModule = typeof import('./App');
type AuthenticatedStylesModule = typeof import('./authenticatedStyles');

let appModulePromise: Promise<AppModule> | null = null;
let resolvedAppModule: AppModule | null = null;
let authenticatedStylesPromise: Promise<AuthenticatedStylesModule> | null = null;

/** Safe presentation-only warmup that may overlap the authentication request. */
export const preloadAuthenticatedPresentation = (): Promise<AuthenticatedStylesModule> => {
  if (!authenticatedStylesPromise) {
    authenticatedStylesPromise = import('./authenticatedStyles').catch((error) => {
      authenticatedStylesPromise = null;
      throw error;
    });
  }

  return authenticatedStylesPromise;
};

/**
 * Keep authenticated handoffs on one terminal-module import. Calling this
 * after submit only evaluates code; App is not mounted and cannot open an
 * authenticated connection until WelcomeTerminal commits a valid handoff.
 */
export const preloadAuthenticatedTerminal = (): Promise<AppModule> => {
  if (!appModulePromise) {
    // TradingChart is the largest first-viewport dependency. Warm it beside
    // the shell, but do not make authentication handoff wait for it.
    void preloadTradingChartRuntime().catch(() => undefined);
    appModulePromise = Promise.all([
      import('./App'),
      import('./i18n').then((module) => module.i18nReady),
      preloadAuthenticatedPresentation(),
    ])
      .then(([appModule]) => {
        resolvedAppModule = appModule;
        return appModule;
      })
      .catch((error) => {
        appModulePromise = null;
        resolvedAppModule = null;
        throw error;
      });
  }

  return appModulePromise;
};

interface StoredSessionTerminalLoaderProps {
  initialSessionHandoff: AuthenticatedSessionHandoff | null;
  loadTerminal: () => Promise<AppModule>;
  onSessionEnded: () => void;
}

function StoredSessionTerminalLoader({
  initialSessionHandoff,
  loadTerminal,
  onSessionEnded,
}: StoredSessionTerminalLoaderProps) {
    const tr = useUiTranslation();
  const [terminalModule, setTerminalModule] = useState<AppModule | null>(() => resolvedAppModule);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (terminalModule || initialSessionHandoff) return;

    let active = true;
    setLoadFailed(false);
    void loadTerminal().then(
      (module) => {
        if (active) setTerminalModule(module);
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );

    return () => {
      active = false;
    };
  }, [initialSessionHandoff, loadAttempt, loadTerminal, terminalModule]);

  if (terminalModule) {
    const Terminal = terminalModule.default;
    return (
      <Terminal
        initialSessionHandoff={initialSessionHandoff}
        onSessionEnded={onSessionEnded}
      />
    );
  }

  if (loadFailed) {
    return (
      <div data-terminal-module-error="true" role="alert">
        <span>{tr("Unable to load the terminal.")}</span>
        <button
          type="button"
          onClick={() => {
            setLoadFailed(false);
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          {tr("Retry")}</button>
      </div>
    );
  }

  return <TerminalLoadFallback />;
}

export const hasStoredSessionCandidate = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!ensureConfiguredWebSession()) return false;

  const accountId = window.localStorage.getItem('rtx_saved_username')
    || window.localStorage.getItem('rtx_last_login');
  const token = window.localStorage.getItem('auth_token')
    || window.sessionStorage.getItem('auth_token');
  const refreshToken = window.localStorage.getItem('refresh_token')
    || window.sessionStorage.getItem('refresh_token');
  const expiresAt = parseSessionExpiryMs(
    window.localStorage.getItem('token_expires_at')
      || window.sessionStorage.getItem('token_expires_at'),
  );

  // App's restore flow rejects a known-expired token. Make the same decision
  // before importing the authenticated bundle so an old session opens the
  // login screen directly even after weeks or months away.
  if (expiresAt !== null && expiresAt <= Date.now()) return false;

  return Boolean(accountId && (token || refreshToken));
};

/**
 * Anonymous sessions own only the login UI. The chart/data/WebSocket graph is
 * fetched through the dynamic boundary only after authentication succeeds or
 * a restorable stored session exists.
 */
interface AppShellProps {
  loadStoredSessionTerminal?: () => Promise<AppModule>;
}

export default function AppShell({
  loadStoredSessionTerminal = preloadAuthenticatedTerminal,
}: AppShellProps = {}) {
  const [shouldMountTerminal, setShouldMountTerminal] = useState(hasStoredSessionCandidate);
  const [initialSessionHandoff, setInitialSessionHandoff] = useState<AuthenticatedSessionHandoff | null>(null);
  const prepareTerminal = useCallback(() => {
    return preloadAuthenticatedTerminal();
  }, []);
  const prepareTerminalPresentation = useCallback(() => {
    return preloadAuthenticatedPresentation();
  }, []);
  const handleLogin = useCallback((accountId: string, handoff: AuthenticatedSessionHandoff) => {
    if (!handoff || handoff.accountId !== String(accountId)) return;
    setInitialSessionHandoff(handoff);
    setShouldMountTerminal(true);
  }, []);
  const handleSessionEnded = useCallback(() => {
    setInitialSessionHandoff(null);
    setShouldMountTerminal(false);
  }, []);

  if (!shouldMountTerminal) {
    return (
      <WelcomeTerminal
        onLogin={handleLogin}
        onPrepareTerminal={prepareTerminal}
        onPreloadTerminalPresentation={prepareTerminalPresentation}
      />
    );
  }

  // WelcomeTerminal awaits preloadAuthenticatedTerminal before it commits the
  // authenticated handoff. Render that already-resolved component directly so
  // React.lazy cannot suspend for one extra paint and flash the terminal shell.
  // Stored-session restores still use the lazy boundary because they are true
  // cold starts and do not carry a same-document handoff.
  const PreparedAuthenticatedTerminal = initialSessionHandoff
    ? resolvedAppModule?.default
    : null;

  if (PreparedAuthenticatedTerminal) {
    return (
      <PreparedAuthenticatedTerminal
        initialSessionHandoff={initialSessionHandoff}
        onSessionEnded={handleSessionEnded}
      />
    );
  }

  return (
    <StoredSessionTerminalLoader
      initialSessionHandoff={initialSessionHandoff}
      loadTerminal={loadStoredSessionTerminal}
      onSessionEnded={handleSessionEnded}
    />
  );
}
