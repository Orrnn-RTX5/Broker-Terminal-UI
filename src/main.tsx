import { mountApp } from './bootstrap';

// ── Electron-only: Suppress all console output and runtime errors ──
// In Electron, end users must never see red error overlays or console noise.
// In browser/dev mode everything works normally so devs still see all output.
(function suppressInElectron() {
  const isElectron = !!(
    (window as any).electron ||
    (window as any).electronAPI ||
    navigator.userAgent.includes('Electron') ||
    window.location.protocol === 'file:'
  );
  if (!isElectron) return; // Browser/dev — leave console untouched

  // Silence all console methods
  const noop = () => { };
  (window as any).__originalConsole = { ...console };
  (console as any).log = noop;
  (console as any).info = noop;
  (console as any).warn = noop;
  (console as any).error = noop;
  (console as any).debug = noop;
  (console as any).trace = noop;
  (console as any).group = noop;
  (console as any).groupCollapsed = noop;
  (console as any).groupEnd = noop;

  // Swallow all uncaught JS errors silently
  window.onerror = () => true;

  // Swallow all unhandled promise rejections silently
  window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
  });

  // Prevent Vite/React error overlay from appearing
  window.addEventListener('error', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
})();

// ── One-time migration: strip stale `isAuthenticated` from Zustand persist ──
// Previously this field was included in the persisted state, which caused charts
// to appear after a refresh even without a fresh login. This cleans it up once.
try {
  const stored = localStorage.getItem('trading-app-storage');
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed?.state && 'isAuthenticated' in parsed.state) {
      delete parsed.state.isAuthenticated;
      localStorage.setItem('trading-app-storage', JSON.stringify(parsed));
    }
  }
} catch { /* ignore parse errors */ }

// ── One-time migration: clear stale pre-fix fallback symbol selection ──
// Earlier builds without a configured default symbol wrote the first alphabetical
// catalog symbol into `rtx5_selected_symbol` during startup reconciliation. Clear
// that stale automatic fallback once so the configured default symbol opens first,
// while preserving all subsequent user symbol changes across reloads and restarts.
try {
  if (!localStorage.getItem('rtx5_selected_symbol_v2_migrated')) {
    localStorage.removeItem('rtx5_selected_symbol');
    localStorage.setItem('rtx5_selected_symbol_v2_migrated', '1');
  }
  if (!localStorage.getItem('rtx5_mw_grid_v3_migrated')) {
    const rawMwOptions = localStorage.getItem('rtx5_marketwatch_options');
    if (rawMwOptions) {
      const parsedMwOptions = JSON.parse(rawMwOptions);
      if (parsedMwOptions && typeof parsedMwOptions === 'object') {
        parsedMwOptions.showGrid = true;
        localStorage.setItem('rtx5_marketwatch_options', JSON.stringify(parsedMwOptions));
      }
    }
    localStorage.setItem('rtx5_mw_grid_v3_migrated', '1');
  }
  if (!localStorage.getItem('rtx5-main-light-restored-v4')) {
    const rawThemeAppearance = localStorage.getItem('rtx5-theme-appearance');
    if (rawThemeAppearance) {
      const parsedTheme = JSON.parse(rawThemeAppearance);
      if (parsedTheme && typeof parsedTheme === 'object') {
        parsedTheme.contrast = 'default';
        parsedTheme.light = {
          preset: 'default-light',
          background: '#F9F9F9',
          foreground: '#101010',
          accent: '#007ACC',
        };
        localStorage.setItem('rtx5-theme-appearance', JSON.stringify(parsedTheme));
      }
    }
    localStorage.setItem('rtx5-main-light-restored-v4', '1');
  }
} catch { /* ignore storage errors */ }

// Keep bootstrap statically discoverable from the first entry request.
// Desktop builds include login here; web builds defer its code and styles
// while their public terminal runtime loads through AppShell.
try {
  mountApp();
} catch (error) {
  console.error('Application bootstrap failed:', error);
  throw error;
}

// Retire workers from older releases. This is intentionally asynchronous and
// never reloads the page; it fixes subsequent launches without creating a
// second navigation or competing with the current render.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => undefined);
}
