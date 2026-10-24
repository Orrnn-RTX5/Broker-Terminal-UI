import BugReportHost from './components/BugReportHost';
import { useUiTranslation } from './hooks/useUiTranslation';
import { useCallback, useEffect, useState } from 'react';
import { getPublicBackendTarget, isDesktopBackendTarget, isElectronRuntime } from './config/backendTarget.js';
import { preloadPublicMarketCatalog } from './services/publicMarketCatalog';
import { preloadPublicStartupHistory } from './startup/publicHistoryPrefetch';
import { WelcomeTerminal } from './startup/WelcomeTerminalEntry';
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
let preloadFailureCount = 0;

const importAppModule = (): Promise<AppModule> => {
  if (preloadFailureCount > 0 && import.meta.env.DEV && !import.meta.env.VITEST) {
    return import('./App').catch(
      () => import(/* @vite-ignore */ `./App?t=${Date.now()}`) as Promise<AppModule>,
    );
  }
  return import('./App');
};

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
    // Begin public market discovery while the terminal modules download. The
    // mounted catalog and guest quote consumers join this in-flight request.
    if (!isDesktopBackendTarget()) {
      void preloadPublicMarketCatalog(getPublicBackendTarget()).catch(() => undefined);
      preloadPublicStartupHistory();
    }
    // TradingChart is the largest first-viewport dependency. Warm it beside
    // the shell, but do not make authentication handoff wait for it.
    void preloadTradingChartRuntime().catch(() => undefined);
    appModulePromise = Promise.all([
      importAppModule(),
      import('./i18n').then((module) => module.i18nReady),
      preloadAuthenticatedPresentation(),
    ])
      .then(([appModule]) => {
        preloadFailureCount = 0;
        resolvedAppModule = appModule;
        return appModule;
      })
      .catch((error) => {
        preloadFailureCount += 1;
        appModulePromise = null;
        resolvedAppModule = null;
        throw error;
      });
  }

  return appModulePromise;
};

const TERMINAL_LOAD_AUTORELOAD_KEY = 'rtx_terminal_load_autoreload';

if (
  import.meta.hot
  && !import.meta.env.VITEST
  && typeof window !== 'undefined'
  && typeof document !== 'undefined'
  && document.querySelector('[data-terminal-module-error="true"]')
) {
  window.location.reload();
}

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
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLoadFailed(false);
    void loadTerminal().then(
      (module) => {
        if (!active) return;
        try {
          window.sessionStorage.removeItem(TERMINAL_LOAD_AUTORELOAD_KEY);
        } catch {
          // Ignore storage errors in restricted environments.
        }
        setTerminalModule(module);
      },
      () => {
        if (!active) return;
        if (loadTerminal === preloadAuthenticatedTerminal && !import.meta.env.VITEST) {
          if (loadAttempt === 0) {
            retryTimer = setTimeout(() => {
              if (active) setLoadAttempt(1);
            }, 250);
            return;
          }
          try {
            if (window.sessionStorage.getItem(TERMINAL_LOAD_AUTORELOAD_KEY) !== '1') {
              window.sessionStorage.setItem(TERMINAL_LOAD_AUTORELOAD_KEY, '1');
              window.location.reload();
              return;
            }
          } catch {
            // Fall through to manual retry UI if sessionStorage is unavailable.
          }
        }
        setLoadFailed(true);
      },
    );

    return () => {
      active = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [initialSessionHandoff, loadAttempt, loadTerminal, terminalModule]);

  if (terminalModule) {
    const Terminal = terminalModule.default;
    return (
      <>
        <Terminal
          initialSessionHandoff={initialSessionHandoff}
          onSessionEnded={onSessionEnded}
        />
        {/* Mounted beside the terminal so Help → Report a Bug can open the
            dialog from deep inside the menu without threading a callback
            through several shared components. */}
        <BugReportHost />
      </>
    );
  }

  if (loadFailed) {
    return (
      <TerminalLoadFallback message="Unable to load the terminal." isError>
        <div className="rtx-terminal-loading__actions" data-terminal-module-error="true">
        <button
          type="button"
          onClick={() => {
            if (loadTerminal === preloadAuthenticatedTerminal && !import.meta.env.VITEST) {
              try {
                window.sessionStorage.removeItem(TERMINAL_LOAD_AUTORELOAD_KEY);
              } catch {
                // Ignore storage errors.
              }
            }
            setLoadFailed(false);
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          {tr("Retry")}</button>
        </div>
      </TerminalLoadFallback>
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
 * Web visitors open the terminal with public market data. App independently
 * gates private account state and trading, and owns authenticated connection
 * gating after the terminal graph crosses its dynamic boundary. Only Electron
 * retains its login boundary; local/direct backend settings must never select
 * the old browser login screen.
 */
interface AppShellProps {
  loadStoredSessionTerminal?: () => Promise<AppModule>;
}

export default function AppShell({
  loadStoredSessionTerminal = preloadAuthenticatedTerminal,
}: AppShellProps = {}) {
  const [shouldMountTerminal, setShouldMountTerminal] = useState(() => {
    const storedSessionCandidate = hasStoredSessionCandidate();
    return !isElectronRuntime() || storedSessionCandidate;
  });
  const [sessionGeneration, setSessionGeneration] = useState(0);
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
    setShouldMountTerminal(!isElectronRuntime());
    // Web keeps the public workspace open, but account-owned component state
    // and effects must end just as they do when the desktop opens login. The
    // generation key remounts the terminal so a guest session starts clean.
    setSessionGeneration((generation) => generation + 1);
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
      <>
        <PreparedAuthenticatedTerminal
          initialSessionHandoff={initialSessionHandoff}
          onSessionEnded={handleSessionEnded}
        />
        <BugReportHost />
      </>
    );
  }

  return (
    <StoredSessionTerminalLoader
      key={sessionGeneration}
      initialSessionHandoff={initialSessionHandoff}
      loadTerminal={loadStoredSessionTerminal}
      onSessionEnded={handleSessionEnded}
    />
  );
}
