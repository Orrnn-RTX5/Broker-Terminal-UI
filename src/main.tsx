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

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'
import './styles/print.css'
import App from './App.tsx'

import './i18n'; // Import i18n configuration
import './services/screenshotService'; // Initialize screenshot service (EXPORT_CHART)
import { Suspense } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';

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

console.log('Mounting App...');

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Root element 'root' not found in document");
  }
  console.log('Root element found, calling render.');
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ThemeProvider>
        <Suspense fallback={
          <div className="rtx-preloader">
            <svg className="rtx-infinity-svg" viewBox="0 0 100 50">
              <path className="rtx-infinity-bg" d="M 50 25 C 65 5, 95 5, 95 25 C 95 45, 65 45, 50 25 C 35 5, 5 5, 5 25 C 5 45, 35 45, 50 25 Z" />
              <path className="rtx-infinity-trace" d="M 50 25 C 65 5, 95 5, 95 25 C 95 45, 65 45, 50 25 C 35 5, 5 5, 5 25 C 5 45, 35 45, 50 25 Z" />
            </svg>
            <div className="rtx-preloader-logo">RTX<span>5</span></div>
            <div className="rtx-preloader-text">Loading Workspace...</div>
          </div>
        }>
          <App />
        </Suspense>
      </ThemeProvider>
    </StrictMode>,
  );
  console.log('Render call completed.');
} catch (e) {
  console.error("Mounting error:", e);
  throw e;
}
