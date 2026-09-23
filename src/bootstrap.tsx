import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppShell, { hasStoredSessionCandidate, preloadAuthenticatedTerminal } from './AppShell';
import { isElectronRuntime } from './config/backendTarget.js';
import { DesktopWindowShell } from './components/layout/DesktopWindowShell';
import { ThemeProvider } from './contexts/ThemeContext';
import { initRootTheme } from './utils/advancedViewRootClasses';

export const mountApp = () => {
  initRootTheme();
  // The terminal will mount for every web visitor and for restored desktop
  // sessions. Kick its module and public-data preloads off before React's
  // first render instead of waiting for the mounted shell's effect, so the
  // downloads overlap the initial mount. Failures surface through the
  // terminal loader's own retry flow.
  if (!isElectronRuntime() || hasStoredSessionCandidate()) {
    preloadAuthenticatedTerminal().catch(() => undefined);
  }
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Root element 'root' not found in document");
  }

  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ThemeProvider>
        <DesktopWindowShell>
          <AppShell />
        </DesktopWindowShell>
      </ThemeProvider>
    </StrictMode>,
  );
};
