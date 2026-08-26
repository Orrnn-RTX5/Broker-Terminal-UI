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
  window.onerror = (_msg, _src, _line, _col, _err) => true;

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

// The real login UI is part of the static entry graph. Vite can therefore
// discover its JavaScript and CSS directly from the initial module request,
// eliminating the former entry -> bootstrap -> login request waterfall.
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
