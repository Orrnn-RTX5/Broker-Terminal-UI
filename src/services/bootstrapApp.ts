import { useAppStore } from '../store/useAppStore';
import { accountV2Api, authV2Api, marketV2Api, tradingV2Api } from '../api/trade';
import { getStoredBrokerServer } from './brokerServers';

const toFinite = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeBootstrapAccount = (raw: any) => ({
  balance: toFinite(raw?.balance, 0),
  equity: toFinite(raw?.equity ?? raw?.balance, 0),
  margin: toFinite(raw?.margin ?? raw?.margin_used, 0),
  freeMargin: toFinite(raw?.freeMargin ?? raw?.free_margin ?? raw?.margin_free ?? raw?.margin_available, 0),
  unrealizedPL: toFinite(raw?.profit ?? raw?.unrealizedPL ?? raw?.unrealized_pl, 0),
  marginLevel: toFinite(raw?.marginLevel ?? raw?.margin_level, 0),
  currency: String(raw?.currency ?? 'USD'),
  leverage: toFinite(raw?.leverage, 100),
});

export async function bootstrapApp(login: number): Promise<void> {
  const { setBootstrapping, setAccount, setPositions, setOrders } = useAppStore.getState();

  // Clear stale data from any previous session before showing fresh data
  setAccount(null);
  setPositions([]);
  setOrders([]);
  useAppStore.getState().setTrades([]);
  useAppStore.setState({ savedAccounts: [] });

  setBootstrapping(true, 'Initializing dashboard in parallel...');

  try {
    // Fire all dashboard APIs concurrently in parallel as requested
    const [authMe, activeAccount, rawPositions, rawOrders, instruments, marketStatus] = await Promise.all([
      authV2Api.me().catch(err => { console.warn('[Bootstrap] /api/v2/auth/me failed:', err); return null; }),
      accountV2Api.get(login).catch(err => { console.warn(`[Bootstrap] /api/v2/account/${login} failed:`, err); return null; }),
      tradingV2Api.getPositions(login, { limit: 50, offset: 0 }).catch(err => { console.warn(`[Bootstrap] /api/v2/positions/${login} failed:`, err); return []; }),
      tradingV2Api.getOrders(login, { limit: 500 }).catch(err => { console.warn(`[Bootstrap] /api/v2/orders/${login} failed:`, err); return []; }),
      marketV2Api.getInstruments().catch(err => { console.warn('[Bootstrap] /api/v2/instruments failed:', err); return []; }),
      marketV2Api.getStatus().catch(err => { console.warn('[Bootstrap] /api/v2/market/status failed:', err); return null; }),
    ]);

    // Handle Auth User
    if (authMe) {
      console.log('[Bootstrap] User profile successfully loaded:', authMe.username);
    }

    if (activeAccount) {
      setAccount(normalizeBootstrapAccount(activeAccount) as any);
    }

    // Handle resolved Positions
    const normalizedPositions = Array.isArray(rawPositions)
      ? rawPositions
      : ((rawPositions as any)?.positions || []);
    setPositions(normalizedPositions);

    // Handle resolved Orders
    const normalizedOrders = Array.isArray(rawOrders)
      ? rawOrders
      : ((rawOrders as any)?.orders || []);
    setOrders(normalizedOrders);

    // Populate saved accounts dynamically from fetched accounts or profile
    const serverName = localStorage.getItem('broker_id') || getStoredBrokerServer();
    let mappedAccounts: any[] = [];
    if (activeAccount) {
      const loginNum = parseInt(activeAccount.login ?? activeAccount.account_login, 10);
      mappedAccounts = [{
        login: isNaN(loginNum) ? login : loginNum,
        name: activeAccount.name || activeAccount.username || '',
        server: activeAccount.server || activeAccount.broker_name || serverName,
        isLive: activeAccount.isLive !== false,
        lastUsed: Date.now(),
      }];
    } else {
      const accountName = authMe?.username || authMe?.name || '';
      mappedAccounts = [{
        login,
        name: accountName,
        server: serverName,
        isLive: true,
        lastUsed: Date.now(),
      }];
    }
    useAppStore.setState({ savedAccounts: mappedAccounts });

    setBootstrapping(true, 'All systems ready');
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  } catch (err) {
    console.error('[Bootstrap] Critical error during app parallel initialization:', err);
  } finally {
    useAppStore.getState().setBootstrapping(false);
  }
}

