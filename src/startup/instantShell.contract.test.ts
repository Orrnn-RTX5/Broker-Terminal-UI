import { selectBrokerRuntimeConfig, validateBrokerRuntimeConfig } from '../config/brokerRuntimeConfig';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEarlyPublicStartup } from './earlyPublicStartup';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const runInstantShell = ({
  runtimeConfig = {},
  storedSession = false,
  cachedPresentation,
  expiredSession = false,
  userAgent = 'Browser',
  protocol = 'https:',
  hostname = 'terminal.test',
  viteDev = false,
  viteMode = 'web',
  electron = false,
  animationFrames = [],
  afterPaintTasks = [],
  fetch,
}: {
  runtimeConfig?: Record<string, unknown>;
  storedSession?: boolean;
  cachedPresentation?: Record<string, unknown>;
  expiredSession?: boolean;
  userAgent?: string;
  protocol?: string;
  hostname?: string;
  viteDev?: boolean;
  viteMode?: string;
  electron?: boolean;
  animationFrames?: FrameRequestCallback[];
  afterPaintTasks?: Array<() => void>;
  fetch?: (...args: unknown[]) => unknown;
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
  if (cachedPresentation) storage.rtx_broker_presentation_v1 = JSON.stringify(cachedPresentation);
  const localStorage = { getItem: (key: string) => storage[key] ?? null };
  const sessionStorage = { getItem: () => null };
  const fixtureConfig = runtimeConfig.API_HOST ? {
    BROKER_ID: 'fixture-broker', DEFAULT_MT5_SERVER: 'Fixture Server',
    WS_HOST: String(runtimeConfig.API_HOST).replace(/^http/, 'ws'), ...runtimeConfig,
  } : runtimeConfig;
  const startupWindow = {
    __RTX_SELECT_BROKER_CONFIG__: selectBrokerRuntimeConfig,
    __RTX_VALIDATE_BROKER_CONFIG__: validateBrokerRuntimeConfig,
    RUNTIME_CONFIG: fixtureConfig,
    location: { protocol, hostname },
    electronAPI: electron ? {} : undefined,
    addEventListener: () => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback) => animationFrames.push(callback),
    setTimeout: (callback: () => void) => afterPaintTasks.push(callback),
    fetch,
    __RTX_EARLY_PUBLIC_STARTUP__: undefined as undefined | { symbolsUrl?: string; candlesUrl?: string },
  };
  runInNewContext(script.replaceAll('%DEV%', String(viteDev)).replaceAll('%MODE%', viteMode), {
    document: shellDocument,
    window: startupWindow,
    fetch,
    navigator: { userAgent },
    localStorage,
    sessionStorage,
    MutationObserver,
    URL,
    performance: { mark: () => undefined, now: () => 1234.5 },
  });
  Object.assign(shellDocument, { startupWindow });
  return shellDocument;
};

afterEach(() => {
  delete (window as Window & { __RTX_EARLY_PUBLIC_STARTUP__?: unknown }).__RTX_EARLY_PUBLIC_STARTUP__;
  vi.unstubAllGlobals();
});

describe('instant startup shell source contract', () => {
  it('preloads shared desktop artwork and ignores stale broker presentation', () => {
    const shell = runInstantShell({
      electron: true,
      runtimeConfig: { API_HOST: 'https://brand-new.example', BROKER_LOGIN_HERO_URL: 'https://cdn.new.example/hero.jpg' },
      cachedPresentation: { brokerId: 'myprop-trade', brokerName: 'Achiever', login_hero_url: 'https://old-broker.example/hero.jpg' },
    });
    expect(shell.querySelector('link[rel="preload"][media="(min-width: 761px)"]')?.getAttribute('href')).toBe('./login/trading-desk-hero.webp');
    expect(shell.querySelector('link[rel="preload"][media="(max-width: 760px)"]')?.getAttribute('href')).toBe('./login/trading-desk-hero-mobile.webp');
    expect(shell.querySelector('link[href*="old-broker.example"]')).toBeNull();
    expect(shell.querySelector('link[href*="cdn.new.example"]')).toBeNull();
  });
  it('does not preload external artwork before desktop selection or with invalid settings', () => {
    const shell = runInstantShell({ electron: true, runtimeConfig: { API_HOST: 'https://new.example', WS_HOST: '', BROKER_LOGIN_HERO_URL: 'https://cdn.new.example/hero.jpg' } });
    expect(shell.querySelector('link[href*="cdn.new.example"]')).toBeNull();
    expect(shell.querySelector('link[rel="preload"][media="(min-width: 761px)"]')?.getAttribute('href')).toBe('./login/trading-desk-hero.webp');
  });
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
    const shell = runInstantShell({ runtimeConfig: { BACKEND_TARGET: target }, hostname: 'localhost' });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('login');
    expect(shell.querySelectorAll('link[rel="preload"]')).toHaveLength(3);
  });

  it.each([
    { protocol: 'file:' },
    { userAgent: 'Browser Electron/40' },
    { runtimeConfig: { BACKEND_MODE: 'desktop' } },
  ])('retains the desktop login surface for physical or configured desktop runtimes: %j', (runtime) => {
    const shell = runInstantShell({ hostname: 'localhost', ...runtime });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('login');
  });

  it('shows the terminal status for a restorable desktop session', () => {
    const shell = runInstantShell({ runtimeConfig: { BACKEND_TARGET: 'electron' }, storedSession: true });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('terminal');
    expect(shell.querySelectorAll('link[rel="preload"]')).toHaveLength(0);
  });

  it('keeps an expired desktop session on the login surface', () => {
    const shell = runInstantShell({ runtimeConfig: { BACKEND_TARGET: 'electron' }, hostname: 'localhost', storedSession: true, expiredSession: true });

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('login');
  });

  it('starts the public catalog and first chart page before the terminal modules download', () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true }));
    const shell = runInstantShell({
      runtimeConfig: { BACKEND_TARGET: 'web', API_HOST: 'https://service.example' },
      fetch,
    }) as Document & { startupWindow: { __RTX_EARLY_PUBLIC_STARTUP__?: { symbolsUrl: string; candlesUrl: string } } };

    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('terminal');
    expect(fetch).toHaveBeenCalledWith('https://service.example/api/v2/instruments', {
      credentials: 'omit',
      cache: 'no-store', redirect: 'error', headers: { 'X-Broker-ID': 'fixture-broker' },
    });
    expect(fetch).toHaveBeenCalledWith('https://service.example/api/v2/candles/BTCUSD?timeframe=M1&limit=500', {
      credentials: 'omit',
      cache: 'no-store', redirect: 'error', headers: { 'X-Broker-ID': 'fixture-broker' },
    });
    expect(shell.startupWindow.__RTX_EARLY_PUBLIC_STARTUP__).toMatchObject({
      symbolsUrl: 'https://service.example/api/v2/instruments',
      candlesUrl: 'https://service.example/api/v2/candles/BTCUSD?timeframe=M1&limit=500',
    });

    const restored = vi.fn(() => Promise.resolve({ ok: true }));
    runInstantShell({
      runtimeConfig: { BACKEND_TARGET: 'web', API_HOST: 'https://service.example' },
      storedSession: true,
      fetch: restored,
    });
    expect(restored).toHaveBeenCalledTimes(1);
    expect(restored).toHaveBeenCalledWith('https://service.example/api/v2/instruments', {
      credentials: 'omit',
      cache: 'no-store', redirect: 'error', headers: { 'X-Broker-ID': 'fixture-broker' },
    });
  });

  it.each([
    {},
    { API_HOST: 'https://service.example', BROKER_ID: '' },
    { API_HOST: 'https://service.example', DEFAULT_MT5_SERVER: '' },
    { API_HOST: 'https://service.example', WS_HOST: 'wss://service.orrnn.com' },
    { API_HOST: 'https://user:secret@service.example' },
  ])('starts no broker warmup or connection hint for invalid runtime configuration: %j', (runtimeConfig) => {
    const fetch = vi.fn();
    const shell = runInstantShell({ runtimeConfig, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(shell.querySelectorAll('link[rel="preconnect"]')).toHaveLength(0);
  });

  it('preconnects only canonical validated origins and ignores stale compiled aliases', () => {
    const shell = runInstantShell({ runtimeConfig: {
      API_HOST: 'https://service.achiever.orrnn.com',
      VITE_API_HOST: 'https://service.orrnn.com', VITE_WS_HOST: 'wss://service.orrnn.com',
      BACKEND_TARGET: 'web', VITE_BACKEND_TARGET: 'desktop',
    }, hostname: 'localhost' });
    expect(shell.documentElement.getAttribute('data-rtx-initial-view')).toBe('terminal');
    expect(Array.from(shell.querySelectorAll('link[rel="preconnect"]')).map(link => link.getAttribute('href')))
      .toEqual(['https://service.achiever.orrnn.com']);
  });

  it.each(['127.0.0.1', 'localhost', '::1', 'terminal.localhost'])('uses the same-origin broker proxy for early requests on Vite dev host %s', (hostname) => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}')));
    const shell = runInstantShell({
      runtimeConfig: { BACKEND_TARGET: 'web', API_HOST: 'https://service.example:8443/' },
      viteDev: true,
      protocol: 'http:',
      hostname,
      fetch,
    }) as Document & { startupWindow: { __RTX_EARLY_PUBLIC_STARTUP__?: { symbolsUrl: string; candlesUrl: string } } };
    const proxyBase = '/__broker_api/https%3A%2F%2Fservice.example%3A8443';

    expect(fetch).toHaveBeenNthCalledWith(1, `${proxyBase}/api/v2/instruments`, {
      credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'X-Broker-ID': 'fixture-broker' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, `${proxyBase}/api/v2/candles/BTCUSD?timeframe=M1&limit=500`, {
      credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'X-Broker-ID': 'fixture-broker' },
    });
    expect(shell.startupWindow.__RTX_EARLY_PUBLIC_STARTUP__).toMatchObject({
      symbolsUrl: `${proxyBase}/api/v2/instruments`,
      candlesUrl: `${proxyBase}/api/v2/candles/BTCUSD?timeframe=M1&limit=500`,
    });
  });

  it.each([
    { viteDev: false, hostname: 'localhost' },
    { viteDev: true, hostname: 'terminal.example' },
    { viteDev: true, hostname: 'localhost', viteMode: 'test' },
    { viteDev: true, hostname: 'localhost', protocol: 'file:', storedSession: true },
    { viteDev: true, hostname: 'localhost', electron: true, storedSession: true },
    { viteDev: true, hostname: 'localhost', userAgent: 'Browser Electron/40', storedSession: true },
  ])('retains direct broker requests outside local web development: %j', (runtime) => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}')));
    runInstantShell({
      runtimeConfig: { BACKEND_TARGET: 'web', API_HOST: 'https://service.example' },
      protocol: 'http:',
      ...runtime,
      fetch,
    });

    expect(fetch).toHaveBeenCalledWith('https://service.example/api/v2/instruments', {
      credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'X-Broker-ID': 'fixture-broker' },
    });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringMatching(/^\/__broker_api\//), expect.anything());
  });

  it('hands proxied catalog and chart responses to the normal readers without duplicate requests', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{"source":"broker"}')));
    const shell = runInstantShell({
      runtimeConfig: { BACKEND_TARGET: 'web', API_HOST: 'https://service.example' },
      viteDev: true,
      protocol: 'http:',
      hostname: '127.0.0.1',
      fetch,
    }) as Document & { startupWindow: { __RTX_EARLY_PUBLIC_STARTUP__?: unknown } };
    (window as Window & { __RTX_EARLY_PUBLIC_STARTUP__?: unknown }).__RTX_EARLY_PUBLIC_STARTUP__ = shell.startupWindow.__RTX_EARLY_PUBLIC_STARTUP__;
    vi.stubGlobal('fetch', fetch);
    const proxyBase = '/__broker_api/https%3A%2F%2Fservice.example';

    const symbols = await fetchEarlyPublicStartup('symbols', `${proxyBase}/api/v2/instruments`, new AbortController().signal);
    const candles = await fetchEarlyPublicStartup('candles', `${proxyBase}/api/v2/candles/BTCUSD?timeframe=M1&limit=500`, new AbortController().signal);
    expect(await symbols.json()).toEqual({ source: 'broker' });
    expect(await candles.json()).toEqual({ source: 'broker' });
    expect(fetch).toHaveBeenCalledTimes(2);

    await fetchEarlyPublicStartup('symbols', `${proxyBase}/api/v2/instruments`, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(3);
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
    expect(app).toContain("data-rtx-authenticated-shell={isAuthenticated ? 'true' : undefined}");
    expect(app).toContain("data-rtx-guest-shell={guestMode ? 'true' : undefined}");
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
