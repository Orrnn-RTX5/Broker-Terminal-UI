import { useAppStore } from '../store/useAppStore';
import { api } from './api';

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

  setBootstrapping(true, 'Connecting to server...');

  try {
    setBootstrapping(true, 'Loading account...');
    const accountData = await api.account.getAccountSummary(login).catch(() => null);
    if (accountData) {
      useAppStore.getState().setAccount(normalizeBootstrapAccount(accountData) as any);
    }

    setBootstrapping(true, 'Loading positions...');
    const positions = await api.positions.getPositions(login).catch(() => []);
    useAppStore.getState().setPositions(positions as any);

    setBootstrapping(true, 'Loading pending orders...');
    const orders = await api.orders.getPendingOrders(login).catch(() => []);
    useAppStore.getState().setOrders(orders as any);

    setBootstrapping(true, 'All systems ready');
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
  } catch (err) {
    console.error('[Bootstrap] Critical error during app initialization:', err);
  } finally {
    useAppStore.getState().setBootstrapping(false);
  }
}
