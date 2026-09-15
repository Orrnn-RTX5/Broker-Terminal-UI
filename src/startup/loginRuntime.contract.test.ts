import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

const expectOrdered = (source: string, snippets: readonly string[]) => {
  let cursor = -1;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor + 1);
    expect(next, `Expected ${JSON.stringify(snippet)} after source offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
};

describe('interactive login runtime boundary source contract', () => {
  it('keeps submit-only transport and store graphs out of the login component imports', () => {
    const welcome = readSource('src/components/WelcomeTerminal.tsx');

    expect(welcome).not.toContain("from '../api/trade'");
    expect(welcome).not.toContain("from '../services/brokerSession'");
    expect(welcome).not.toContain("from '../store/useAppStore'");
    expect(welcome).toContain('preloadLoginTransportRuntime');
    expect(welcome).toContain('loadAuthenticatedLoginStoreRuntime');
  });

  it('idle-warms the complete login path only after the real form receives a paint opportunity', () => {
    const welcome = readSource('src/components/WelcomeTerminal.tsx');
    const warmupStart = welcome.indexOf('const warmLoginPath');
    const submitStart = welcome.indexOf('const handleSubmit');
    const warmup = welcome.slice(warmupStart, submitStart);

    expect(warmupStart).toBeGreaterThan(0);
    expect(warmup.match(/requestAnimationFrame/g)).toHaveLength(2);
    expect(warmup).toContain('requestIdleCallback(warmLoginPath');
    expect(warmup).toContain('setTimeout(warmLoginPath, 0)');
    expect(warmup).toContain('preloadLoginTransportRuntime()');
    expect(warmup).toContain('onPrepareTerminal?.()');
  });

  it('preserves authentication and state-transition ordering', () => {
    const welcome = readSource('src/components/WelcomeTerminal.tsx');
    const submit = welcome.slice(welcome.indexOf('const handleSubmit'));

    expectOrdered(submit, [
      'await preloadLoginTransportRuntime()',
      'markAuthenticationRequestStarted();',
      'const authenticationPromise = authV2Api.login({',
      'const terminalReadyPromise = feedbackPaintPromise',
      '.then(() => onPrepareTerminal?.())',
      'onPreloadTerminalPresentation?.()',
      'const data = await authenticationPromise;',
      "if (!token) throw new Error('No authentication token received');",
      'markAuthenticationAccepted();',
      'loadAuthenticatedLoginStoreRuntime();',
      'persistBrokerSessionDiscovery({',
      'LAST_AUTHENTICATED_BROKER_ID_KEY,',
      'updateDynamicUrls();',
      'const sessionHandoff = createAuthenticatedSessionHandoff({',
      'appStore.setAuthenticated(',
      'await terminalReadyPromise;',
      'onLogin(String(accountId), sessionHandoff);',
      'scheduleAuthenticatedShellPaintMeasurement();',
      'schedulePostLoginBookkeeping(() => {',
    ]);

    const authenticationAccepted = submit.indexOf('markAuthenticationAccepted();');
    const authenticationResponse = submit.indexOf('const data = await authenticationPromise;');
    const sessionCommitted = submit.indexOf('appStore.setAuthenticated(');
    const terminalPreparation = submit.indexOf('const terminalReadyPromise = feedbackPaintPromise');
    const authenticationRequest = submit.indexOf('const authenticationPromise = authV2Api.login({');
    const sessionPersistence = submit.indexOf('persistBrokerSessionDiscovery({');

    expect(terminalPreparation).toBeGreaterThan(0);
    expect(authenticationRequest).toBeGreaterThan(0);
    expect(authenticationRequest).toBeLessThan(terminalPreparation);
    expect(terminalPreparation).toBeLessThan(authenticationResponse);
    expect(terminalPreparation).toBeLessThan(authenticationAccepted);
    expect(terminalPreparation).toBeLessThan(sessionCommitted);
    expect(sessionPersistence).toBeGreaterThan(authenticationResponse);
    expect(submit.slice(0, authenticationResponse)).not.toContain('persistBrokerSessionDiscovery({');
    expect(submit.slice(0, authenticationResponse)).not.toContain('updateDynamicUrls();');
    expect(submit.slice(0, authenticationResponse)).toContain('onPrepareTerminal?.()');
    expect(submit).not.toContain('appStore.setActiveAccount(loginNum)');
  });

  it('keeps pending feedback measurable without replacing the visible Login label', () => {
    const welcome = readSource('src/components/WelcomeTerminal.tsx');
    const button = welcome.slice(
      welcome.indexOf('<button\n                                    type="submit"'),
      welcome.indexOf('</button>', welcome.indexOf('data-rtx-login-submit')),
    );

    expect(button).toContain('disabled={loading || (isDesktopBrokerSelection && !desktopLoginReady)}');
    expect(button).toContain("data-rtx-login-feedback={loading ? 'true' : undefined}");
    expect(button).toContain('Login');
    expect(button).not.toContain('Connecting');
    expect(button).not.toContain('rtx-spinner');
  });

  it('warms transport on autofocus and the complete login path on real interaction', () => {
    const welcome = readSource('src/components/WelcomeTerminal.tsx');
    const formStart = welcome.indexOf('<form');
    const form = welcome.slice(formStart, welcome.indexOf('>', formStart));

    expect(welcome).toContain('const warmLoginPath = useCallback');
    expect(form).toContain('onPointerEnter={warmLoginPath}');
    expect(form).toContain('onPointerDownCapture={warmLoginPath}');
    expect(form).toContain('onInputCapture={warmLoginPath}');
    expect(form).toContain('onFocusCapture={warmLoginTransport}');
    expect(form).not.toContain('onFocusCapture={warmLoginPath}');
  });

  it('limits authentication-wait warmup to presentation styles', () => {
    const appShell = readSource('src/AppShell.tsx');
    const presentationWarmup = appShell.slice(
      appShell.indexOf('export const preloadAuthenticatedPresentation'),
      appShell.indexOf('export const preloadAuthenticatedTerminal'),
    );

    expect(presentationWarmup).toContain("import('./authenticatedStyles')");
    expect(presentationWarmup).not.toContain("import('./App')");
    expect(presentationWarmup).not.toContain('useAppStore');
    expect(presentationWarmup).not.toContain('tradeSocket');
  });

  it('prepares the authenticated shell while warming the chart outside the shell gate', () => {
    const appShell = readSource('src/AppShell.tsx');
    const app = readSource('src/App.tsx');
    const dockWorkspace = readSource('src/components/dock/DockWorkspace.tsx');

    expect(appShell).not.toContain("import('./services/screenshotService')");
    expect(appShell).not.toContain("import('./components/dock/DockWorkspace')");
    expect(app).toContain("import { DockWorkspace } from './components/dock/DockWorkspace'");
    expect(dockWorkspace).toContain('export const preloadDockWorkspaceViewport');
    expect(dockWorkspace).toContain("import { MarketWatchPanel");
    expect(dockWorkspace).toContain("import { NavigatorPanel }");
    expect(dockWorkspace).toContain("import { BottomDock }");
    expect(dockWorkspace).toContain('preloadTradingChartRuntime');
    expect(dockWorkspace).toContain('<DeferredTradingChart');
    expect(dockWorkspace).not.toContain("import { TradingChart,");
    expect(dockWorkspace).not.toContain('lazy(');
    expect(dockWorkspace).not.toContain('<Suspense');
    expect(dockWorkspace).not.toContain('if (!isInitialized) return null');
    expect(dockWorkspace).toContain('data-rtx-authenticated-viewport="true"');
  });

  it('keeps initially closed tools and trade-overlay helpers out of the shell chunk', () => {
    const app = readSource('src/App.tsx');

    expect(app).toContain("const LazyOrderPanelDialog = lazy(() => import('./components/OrderPanelDialog')");
    expect(app).toContain("const LazyDepthOfMarket = lazy(() => import('./components/DepthOfMarket')");
    expect(app).toContain("const LazyChartPropertiesDialog = lazy(() => import('./components/dialogs/ChartPropertiesDialog')");
    expect(app).not.toContain("import { OrderPanelDialog } from './components/OrderPanelDialog'");
    expect(app).not.toContain("import { DepthOfMarket } from './components/DepthOfMarket'");
    expect(app).toContain("void import('./services/tradeOverlayHistory').then");
  });

  it('memoizes retryable dynamic imports and provides no eager store warmup', () => {
    const runtime = readSource('src/startup/loginRuntime.ts');

    expect(runtime).toContain("import('./loginTransportRuntime')");
    expect(runtime).toContain("import('../store/useAppStore')");
    expect(runtime).toContain('loginTransportRuntimePromise = null');
    expect(runtime).toContain('loginStoreRuntimePromise = null');
    expect(runtime.match(/loadAuthenticatedLoginStoreRuntime/g)).toHaveLength(1);
  });
});
