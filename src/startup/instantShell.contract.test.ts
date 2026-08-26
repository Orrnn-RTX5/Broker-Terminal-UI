import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('instant startup shell source contract', () => {
  it('ships only the authenticated terminal shell before React executes', () => {
    const html = readSource('index.html');

    expect(html).toContain('data-rtx-static-shell');
    expect(html).toContain('class="rtx-instant-terminal"');
    expect(html).toContain("data-rtx-initial-view");
    expect(html).toContain("first-contentful-paint");
    expect(html).toContain('background: #050608');
    expect(html).toContain('html[data-rtx-initial-view="terminal"]');
    expect(html).not.toContain('class="rtx-instant-login"');
    expect(html).not.toContain('rtx-instant-login-button');
    expect(html).not.toContain('Enter Account ID');
    expect(html).not.toContain('Enter Password');
    expect(html).not.toContain('html[data-rtx-initial-view="login"] [data-rtx-static-shell] > .rtx-instant-login');
  });

  it('renders the real login component directly with no anonymous loading surface', () => {
    const appShell = readSource('src/AppShell.tsx');

    expect(appShell).toContain("import { WelcomeTerminal } from './components/WelcomeTerminal'");
    expect(appShell).toContain('<WelcomeTerminal');
    expect(appShell).not.toContain('LoginLoadFallback');
    expect(appShell).not.toContain('data-login-module-loading');
    expect(appShell).not.toContain('rtx-instant-login');
    expect(appShell).toContain("from './startup/TerminalLoadFallback'");

    const terminalFallback = readSource('src/startup/TerminalLoadFallback.tsx');
    const app = readSource('src/App.tsx');
    expect(terminalFallback).toContain('className="rtx-instant-terminal"');
    expect(terminalFallback).toContain('data-terminal-module-loading="true"');
    expect(terminalFallback).not.toContain('Restoring session');
    expect(app).not.toContain('Restoring session');
    expect(app).toContain('data-rtx-authenticated-shell="true"');
  });

  it('makes the real login/bootstrap path statically discoverable from the entry module', () => {
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

  it('keeps only the authenticated trading graph behind a dynamic boundary', () => {
    const appShell = readSource('src/AppShell.tsx');

    expect(appShell).toContain("import { WelcomeTerminal } from './components/WelcomeTerminal'");
    expect(appShell).toContain("import('./App')");
    expect(appShell).toContain('loadStoredSessionTerminal = preloadAuthenticatedTerminal');
    expect(appShell).toContain('void loadTerminal().then(');
    expect(appShell).toContain('<StoredSessionTerminalLoader');
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
