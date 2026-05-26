import { useAppStore } from '../store/useAppStore';
import { brokerApi } from '../api/brokerApi';
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
    const [authMe, accounts, rawPositions, rawOrders, instruments, marketStatus] = await Promise.all([
      brokerApi.get<any>('/auth/me').catch(err => { console.warn('[Bootstrap] /auth/me failed:', err); return null; }),
      brokerApi.get<any>('/accounts').catch(err => { console.warn('[Bootstrap] /accounts failed:', err); return []; }),
      brokerApi.get<any>(`/positions/${login}`).catch(err => { console.warn(`[Bootstrap] /positions/${login} failed:`, err); return []; }),
      brokerApi.get<any>(`/orders/${login}`).catch(err => { console.warn(`[Bootstrap] /orders/${login} failed:`, err); return []; }),
      brokerApi.get<any>('/instruments?favorites=true').catch(err => { console.warn('[Bootstrap] /instruments failed:', err); return []; }),
      brokerApi.get<any>('/market/status').catch(err => { console.warn('[Bootstrap] /market/status failed:', err); return null; }),
    ]);

    // Handle Auth User
    if (authMe) {
      console.log('[Bootstrap] User profile successfully loaded:', authMe.username);
    }

    // Handle resolved Accounts list
    const activeAccount = Array.isArray(accounts)
      ? accounts.find((a: any) => Number(a.login) === login) || accounts[0]
      : accounts;
    if (activeAccount) {
      setAccount(normalizeBootstrapAccount(activeAccount) as any);
    } else {
      // If /accounts didn't return this login, query it directly as a fallback
      const singleAccount = await brokerApi.get<any>(`/account/${login}`).catch(() => null);
      if (singleAccount) {
        setAccount(normalizeBootstrapAccount(singleAccount) as any);
      }
    }

    // Handle resolved Positions
    const normalizedPositions = Array.isArray(rawPositions)
      ? rawPositions
      : (rawPositions?.positions || []);
    setPositions(normalizedPositions);

    // Handle resolved Orders
    const normalizedOrders = Array.isArray(rawOrders)
      ? rawOrders
      : (rawOrders?.orders || []);
    setOrders(normalizedOrders);

    // Populate saved accounts dynamically from fetched accounts or profile
    const serverName = localStorage.getItem('broker_id') || getStoredBrokerServer();
    let mappedAccounts: any[] = [];
    if (Array.isArray(accounts) && accounts.length > 0) {
      mappedAccounts = accounts.map((acc: any) => {
        const loginNum = parseInt(acc.login ?? acc.account_login, 10);
        return {
          login: isNaN(loginNum) ? login : loginNum,
          name: acc.name || acc.username || '',
          server: acc.server || acc.broker_name || serverName,
          isLive: acc.isLive !== false,
          lastUsed: Date.now(),
        };
      });
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

