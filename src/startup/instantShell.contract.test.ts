import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const runInstantShell = ({
  runtimeConfig = {},
  storedSession = false,
  expiredSession = false,
  userAgent = 'Browser',
  protocol = 'https:',
  animationFrames = [],
  afterPaintTasks = [],
}: {
  runtimeConfig?: Record<string, unknown>;
  storedSession?: boolean;
  expiredSession?: boolean;
  userAgent?: string;
  protocol?: string;
  animationFrames?: FrameRequestCallback[];
  afterPaintTasks?: Array<() => void>;
} = {}) => {
  const html = readSource('index.html');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Instant shell script missing');
  const shellDocument = document.implementation.createHTMLDocument('Startup');
  const storage: Record<string, string> = storedSession ? {
    rtx_saved_username: 'test-account',
    auth_token: 'test-session',
    token_expires_at: String(Date.now() + (expiredSession ? -60_000 : 60_000)),
  } : {};
  const localStorage = { getItem: (key: string) => storage[key] ?? null };
  const sessionStorage = { getItem: () => null };
  runInNewContext(script, {
    document: shellDocument,
    window: {
      RUNTIME_CONFIG: runtimeConfig,
      location: { protocol, hostname: 'terminal.test' },
      addEventListener: () => undefined,
      requestAnimationFrame: (callback: FrameRequestCallback) => animationFrames.push(callback),
      setTimeout: (callback: () => void) => afterPaintTasks.push(callback),
    },
    navigator: { userAgent },
    localStorage,
    sessionStorage,
    MutationObserver,
    performance: { mark: () => undefined, now: () => 1234.5 },
  });
  return shellDocument;
};

describe('instant startup shell source contract', () => {
  it('measures the first revealed workspace after its paint and stops watching subsequent changes', async () => {
    const animationFrames: FrameRequestCallback[] = [];
    const afterPaintTasks: Array<() => void> = [];
    const shell = runInstantShell({ animationFrames, afterPaintTasks });
    const boundary = shell.createElement('div');
    boundary.setAttribute('data-terminal-startup', 'pending');
    shell.body.appendChild(boundary);
    await Promise.resolve();
    expect(animationFrames).toHaveLength(0);

    boundary.setAttribute('data-terminal-startup', 'ready');
    await Promise.resolve();
    expect(animationFrames).toHaveLength(1);
    expect(shell.documentElement.hasAttribute('data-rtx-perf-terminal-ready-ms')).toBe(false);
    animationFrames[0](1200);
    expect(shell.documentElement.hasAttribute('data-rtx-perf-terminal-ready-ms')).toBe(false);
    afterPaintTasks[0]();
    expect(shell.documentElement.getAttribute('data-rtx-perf-terminal-ready-ms')).toBe('1234.5');

    boundary.setAttribute('data-terminal-startup', 'pending');
    boundary.setAttribute('data-terminal-startup', 'ready');
    await Promise.resolve();
    expect(animationFrames).toHaveLength(1);
  });

  it('shows the initial terminal status for an anonymous web visitor without loading login artwork', () => {
    const shell = runInstantShell({ runtimeConfig: { BACKEND_TARGET: 'web' } });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('terminal');
    expect(shell.querySelectorAll('link[rel="preload"]')).toHaveLength(0);
  });

  it.each(['desktop', 'electron', 'direct'])('preloads the login artwork for an anonymous %s runtime', (target) => {
    const shell = runInstantShell({ runtimeConfig: { BACKEND_TARGET: target } });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('login');
    expect(shell.querySelectorAll('link[rel="preload"]')).toHaveLength(3);
  });

  it.each([
    { protocol: 'file:' },
    { userAgent: 'Browser Electron/40' },
    { runtimeConfig: { BACKEND_MODE: 'desktop' } },
  ])('retains the desktop login surface for physical or configured desktop runtimes: %j', (runtime) => {
    const shell = runInstantShell(runtime);

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('login');
  });

  it('shows the terminal status for a restorable desktop session', () => {
    const shell = runInstantShell({ runtimeConfig: { BACKEND_TARGET: 'electron' }, storedSession: true });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('terminal');
    expect(shell.querySelectorAll('link[rel="preload"]')).toHaveLength(0);
  });

  it('keeps an expired desktop session on the login surface', () => {
    const shell = runInstantShell({ runtimeConfig: { BACKEND_TARGET: 'electron' }, storedSession: true, expiredSession: true });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('login');
  });

  it('ships a neutral startup status without an empty terminal before React executes', () => {
    const html = readSource('index.html');

    expect(html).toContain('data-rtx-static-shell');
    expect(html).toContain('class="rtx-terminal-loading"');
    expect(html).toContain('role="status" aria-live="polite" aria-busy="true"');
    expect(html).toContain('Loading terminal…');
    expect(html).not.toContain('rtx-instant-terminal');
    expect(html).not.toContain('rtx-instant-workspace');
    expect(html).toContain("data-rtx-initial-view");
    expect(html).toContain("first-contentful-paint");
    expect(html).toContain('background: #050608');
    expect(html).toContain('html[data-rtx-initial-view="terminal"]');
    expect(html).toContain('html.rtx-skin-untitled-light');
    expect(html).toContain('isLightTheme');
    expect(html).not.toContain('class="rtx-instant-login"');
    expect(html).not.toContain('rtx-instant-login-button');
    expect(html).not.toContain('Enter Account ID');
    expect(html).not.toContain('Enter Password');
    expect(html).not.toContain('html[data-rtx-initial-view="login"] [data-rtx-static-shell] > .rtx-instant-login');
  });

  it('uses a shared login entry without adding an anonymous loading surface', () => {
    const appShell = readSource('src/AppShell.tsx');

    expect(appShell).toContain("import { WelcomeTerminal } from './startup/WelcomeTerminalEntry'");
    expect(appShell).toContain('<WelcomeTerminal');
    expect(appShell).not.toContain('LoginLoadFallback');
    expect(appShell).not.toContain('data-login-module-loading');
    expect(appShell).not.toContain('rtx-instant-login');
    expect(appShell).toContain("from './startup/TerminalLoadFallback'");

    const terminalFallback = readSource('src/startup/TerminalLoadFallback.tsx');
    const app = readSource('src/App.tsx');
    expect(terminalFallback).toContain('className="rtx-terminal-loading"');
    expect(terminalFallback).toContain('data-terminal-module-loading="true"');
    expect(terminalFallback).toContain('data-session-restore-pending=');
    expect(terminalFallback).toContain("message = 'Loading terminal…'");
    expect(terminalFallback).not.toContain('rtx-instant-toolbar');
    expect(terminalFallback).not.toContain('rtx-instant-sidebar');
    expect(terminalFallback).not.toContain('Restoring session');
    expect(app).not.toContain('Restoring session');
    expect(app).toContain("data-rtx-authenticated-shell={isAuthenticated ? 'true' : 'false'}");
  });

  it('makes the bootstrap path statically discoverable from the entry module', () => {
    const entry = readSource('src/main.tsx');

    expect(entry).toContain("import { mountApp } from './bootstrap'");
    expect(entry).toContain('mountApp();');
    expect(entry).not.toContain("import('./bootstrap')");
    expect(entry).not.toContain("from 'react'");
    expect(entry).not.toContain("from 'react-dom/client'");
    expect(entry).not.toContain("import './index.css'");
    expect(entry).not.toContain("from './AppShell'");
    expect(entry).toContain('getRegistrations()');
    expect(entry).toContain('registration.unregister()');
    expect(entry).not.toContain('location.reload');
  });

  it('keeps the trading graph and web login behind separate dynamic boundaries', () => {
    const appShell = readSource('src/AppShell.tsx');

    expect(appShell).toContain("import { WelcomeTerminal } from './startup/WelcomeTerminalEntry'");
    expect(appShell).toContain("import('./App')");
    expect(appShell).toContain('loadStoredSessionTerminal = preloadAuthenticatedTerminal');
    expect(appShell).toContain('void loadTerminal().then(');
    expect(appShell).toContain('<StoredSessionTerminalLoader');
    expect(readSource('src/startup/DeferredWelcomeTerminal.tsx')).toContain("import('../components/WelcomeTerminal')");
    expect(readSource('src/App.tsx')).toContain("import { WelcomeTerminal } from './startup/WelcomeTerminalEntry'");
    expect(readSource('src/startup/DesktopWelcomeTerminal.ts')).toContain("export { WelcomeTerminal } from '../components/WelcomeTerminal'");
    expect(readSource('vite.config.ts')).toContain("find: './startup/WelcomeTerminalEntry'");
  });

  it('uses HTTP caching without a service worker competing with rapid relaunches', () => {
    const bootstrap = readSource('src/bootstrap.tsx');
    const viteConfig = readSource('vite.config.ts');
    const nginx = readSource('nginx.conf');

    expect(bootstrap).not.toContain('serviceWorker.register');
    expect(viteConfig).not.toContain('instantShellServiceWorkerPlugin');
    expect(viteConfig).not.toContain("fileName: 'sw.js'");
    expect(viteConfig).toContain('retiredServiceWorkerDevPlugin()');
    expect(viteConfig).toContain("pathname !== '/sw.js'");
    expect(viteConfig).toContain('Service worker retired');
    expect(nginx).toContain('location ~ ^/(brand|login)/');
    expect(nginx).toContain('stale-while-revalidate=2592000');
  });
});
