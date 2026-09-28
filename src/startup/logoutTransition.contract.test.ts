import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('same-document logout transition source contract', () => {
  it('never reloads the browser from the account logout action', () => {
    const toolbar = readSource('src/components/layout/TopToolbar.tsx');
    const logoutStart = toolbar.indexOf('const handleLogout');
    const logoutEnd = toolbar.indexOf('const getToolBtnClass', logoutStart);
    const logoutHandler = toolbar.slice(logoutStart, logoutEnd);

    expect(logoutHandler).toContain("window.dispatchEvent(new CustomEvent('rtx:logout'))");
    expect(logoutHandler).not.toContain('window.location.reload');
    expect(logoutHandler).not.toContain('Logging out...');
  });

  it('returns web sessions to guest charts and desktop sessions to login', () => {
    const appShell = readSource('src/AppShell.tsx');
    const app = readSource('src/App.tsx');
    const sessionLifecycle = readSource('src/app/session/useAppSessionLifecycle.ts');
    const lifecycleBindingStart = app.indexOf('useAppSessionLifecycle({');
    const lifecycleBinding = app.slice(
      lifecycleBindingStart,
      app.indexOf('});', lifecycleBindingStart) + 3,
    );

    expect(appShell).toContain('const handleSessionEnded');
    expect(appShell).toContain('setShouldMountTerminal(!isElectronRuntime())');
    expect(appShell).toContain('onSessionEnded={handleSessionEnded}');
    expect(lifecycleBindingStart).toBeGreaterThan(0);
    expect(lifecycleBinding).toContain('onSessionEnded,');
    expect(sessionLifecycle).toContain('onSessionEnded?.();');
  });

  it('closes session-owned sockets without relying on a document reload', () => {
    const store = readSource('src/store/useAppStore.ts');

    expect(store).toContain("emitSessionChange('logout')");
    expect(store).toContain("localStorage.removeItem('feed_broker_id')");
    expect(store).toContain("sessionStorage.removeItem('feed_broker_id')");
    // The market-data feed has no credential; logout must not resurrect one.
    expect(store).not.toContain('feed_broker_token');
  });
});
