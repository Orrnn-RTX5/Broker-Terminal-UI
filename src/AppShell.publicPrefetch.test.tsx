import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  publicCatalog: vi.fn(() => new Promise<unknown>(() => {})),
  publicHistory: vi.fn(),
  chartRuntime: vi.fn(async () => undefined),
  desktop: false,
  welcomeLoaded: vi.fn(),
}));

vi.mock('./hooks/useUiTranslation', () => ({ useUiTranslation: () => (value: string) => value }));
vi.mock('./components/BugReportHost', () => ({ default: () => null }));
vi.mock('./components/WelcomeTerminal', () => {
  mocks.welcomeLoaded();
  return { WelcomeTerminal: () => null };
});
vi.mock('./config/backendTarget.js', () => ({
  isDesktopBackendTarget: () => mocks.desktop,
  getPublicBackendTarget: () => 'https://nexa.orrnn.com',
}));
vi.mock('./services/publicMarketCatalog', () => ({ preloadPublicMarketCatalog: mocks.publicCatalog }));
vi.mock('./startup/publicHistoryPrefetch', () => ({ preloadPublicStartupHistory: mocks.publicHistory }));
vi.mock('./startup/configuredWebSession', () => ({ ensureConfiguredWebSession: () => true }));
vi.mock('./startup/tradingChartRuntime', () => ({ preloadTradingChartRuntime: mocks.chartRuntime }));
vi.mock('./App', () => ({ default: () => null }));
vi.mock('./i18n', () => ({ i18nReady: Promise.resolve() }));
vi.mock('./authenticatedStyles', () => ({}));

describe('early public market prefetch', () => {
  it('starts public discovery beside module loading without gating the terminal on it', async () => {
    vi.resetModules();
    const { preloadAuthenticatedTerminal } = await import('./AppShell');
    const terminal = preloadAuthenticatedTerminal();
    expect(mocks.publicCatalog).toHaveBeenCalledWith('https://nexa.orrnn.com');
    expect(mocks.publicHistory).toHaveBeenCalledOnce();
    expect(mocks.chartRuntime).toHaveBeenCalledOnce();
    await expect(terminal).resolves.toHaveProperty('default');
    expect(mocks.welcomeLoaded).not.toHaveBeenCalled();
  });

  it('keeps desktop login module loading free of public market requests', async () => {
    mocks.desktop = true;
    mocks.publicCatalog.mockClear();
    mocks.publicHistory.mockClear();
    vi.resetModules();
    const { preloadAuthenticatedTerminal } = await import('./AppShell');
    await preloadAuthenticatedTerminal();
    expect(mocks.publicCatalog).not.toHaveBeenCalled();
    expect(mocks.publicHistory).not.toHaveBeenCalled();
  });
});
