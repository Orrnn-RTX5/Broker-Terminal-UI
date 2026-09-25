import { useEffect, useState, type ComponentProps } from 'react';
import { isDesktopBackendTarget } from '../config/backendTarget.js';
import { useUiTranslation } from '../hooks/useUiTranslation';
import { TerminalLoadFallback } from './TerminalLoadFallback';

type WelcomeModule = typeof import('../components/WelcomeTerminal');
type WelcomeProps = ComponentProps<WelcomeModule['WelcomeTerminal']>;

let welcomePromise: Promise<WelcomeModule> | null = null;
let resolvedWelcome: WelcomeModule | null = null;

export const preloadWelcomeTerminal = (): Promise<WelcomeModule> => {
  if (!welcomePromise) {
    welcomePromise = import('../components/WelcomeTerminal').then((module) => {
      resolvedWelcome = module;
      return module;
    }).catch((error) => {
      welcomePromise = null;
      throw error;
    });
  }
  return welcomePromise;
};

// Desktop opens on sign-in. Start its login chunk alongside entry evaluation,
// while web guests leave login code and artwork unloaded until they need it.
if (isDesktopBackendTarget()) {
  void preloadWelcomeTerminal().catch(() => undefined);
}

export function DeferredWelcomeTerminal(props: WelcomeProps) {
  const tr = useUiTranslation();
  const [welcomeModule, setWelcomeModule] = useState(() => resolvedWelcome);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (welcomeModule) return;
    let active = true;
    void preloadWelcomeTerminal().then(
      (module) => { if (active) setWelcomeModule(module); },
      () => { if (active) setLoadFailed(true); },
    );
    return () => { active = false; };
  }, [attempt, welcomeModule]);

  if (welcomeModule) {
    const WelcomeTerminal = welcomeModule.WelcomeTerminal;
    return <WelcomeTerminal {...props} />;
  }

  if (loadFailed) {
    return (
      <TerminalLoadFallback message="Unable to load sign in." isError>
        <div className="rtx-terminal-loading__actions">
          <button type="button" onClick={() => {
            setLoadFailed(false);
            setAttempt(value => value + 1);
          }}>{tr('Retry')}</button>
        </div>
      </TerminalLoadFallback>
    );
  }

  // Preserve the existing desktop pre-login surface without a loader flash.
  return null;
}
