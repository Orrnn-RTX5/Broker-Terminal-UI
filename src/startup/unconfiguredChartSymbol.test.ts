import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockContainer, DockPanelConfig } from '../services/dockManager';

// A deployment without DEFAULT_CHART_SYMBOL must not request or open any
// compiled-in market: the first chart settles on the first authorized symbol.
vi.mock('../config/backendTarget.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicBackendTarget: () => 'https://broker.example',
  isDesktopBackendTarget: () => false,
  getRuntimeBrokerConfiguration: () => ({ brokerId: 'Fixture' }),
}));
vi.mock('../config/localDevProxy', () => ({ toLocalDevProxyUrl: (url: string) => url }));

const collectCharts = (node: DockContainer | DockPanelConfig): DockPanelConfig[] => (
  'children' in node ? node.children.flatMap(collectCharts) : node.component === 'Chart' ? [node] : []
);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_DEFAULT_CHART_SYMBOL', '');
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('unconfigured tenant chart symbol', () => {
  it('starts no public candle warmup for an empty symbol', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    const prefetch = await import('./publicHistoryPrefetch');
    prefetch.preloadPublicStartupHistory();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens a symbol-less default chart instead of a compiled-in market', async () => {
    const { DockManager } = await import('../services/dockManager');
    const charts = collectCharts(new DockManager().getDefaultLayout().root);
    expect(charts).toHaveLength(1);
    expect(charts[0].title).toBe('Chart,M1');
    expect(charts[0].props).toEqual({ timeframe: 'M1' });
  });

  it('uses the configured symbol once the deployment sets one', async () => {
    vi.stubEnv('VITE_DEFAULT_CHART_SYMBOL', 'xauusd');
    const { DockManager } = await import('../services/dockManager');
    const charts = collectCharts(new DockManager().getDefaultLayout().root);
    expect(charts[0].title).toBe('XAUUSD,M1');
    expect(charts[0].props).toEqual({ symbol: 'XAUUSD', timeframe: 'M1' });
  });
});
