// Injected by vite.config.ts from package.json; absent in plain Vitest runs.
declare const __APP_VERSION__: string | undefined;

/** Version of this terminal build: the desktop app's own version, else the web build's. */
export const getAppVersion = (): string => (
  (typeof window !== 'undefined' ? window.electron?.appVersion : undefined)
  || (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '')
  || '1.0.0'
);
