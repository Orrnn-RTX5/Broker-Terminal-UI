/**
 * MT5 Direct Trading Store
 * Manages MT5 positions, account data, orders, and history
 * Auto-refreshes positions and account every 2 seconds
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { api, MT5Position, MT5Account, MT5Order, MT5HistoryDeal, MT5Status } from '../services/api';
import { useAppStore } from './useAppStore';

interface MT5Store {
  // Data
  positions: MT5Position[];
  account: MT5Account | null;
  orders: MT5Order[];
  history: MT5HistoryDeal[];
  status: MT5Status | null;

  // UI State
  connected: boolean;
  loading: boolean;
  error: string | null;
  autoRefresh: boolean;

  // Refresh interval reference
  _refreshInterval: NodeJS.Timeout | null;
  _wsUpdatesActive: boolean; // Track if WebSocket is delivering updates

  // Actions
  fetchPositions: (login?: number) => Promise<void>;
  fetchAccount: (login?: number) => Promise<void>;
  fetchOrders: (login?: number) => Promise<void>;

  // WebSocket setters (bypass HTTP polling)
  setPositionsFromWS: (positions: MT5Position[]) => void;
  setAccountFromWS: (account: MT5Account) => void;
  setOrdersFromWS: (orders: MT5Order[]) => void;
  fetchHistory: (params?: { login?: number; from?: number; to?: number; symbol?: string }) => Promise<void>;
  fetchStatus: () => Promise<void>;
  submitOrder: (order: {
    symbol: string;
    action: string;
    volume: number;
    price?: number;
    sl?: number;
    tp?: number;
    login?: number;
  }) => Promise<any>;
  closePosition: (ticket: number, volume?: number) => Promise<any>;
  modifyPosition: (ticket: number, sl: number, tp: number) => Promise<any>;

  // Control actions
  startAutoRefresh: (login?: number) => void;
  stopAutoRefresh: () => void;
  setAutoRefresh: (enabled: boolean) => void;
  // Persistent registry: ticket → first-captured open time (ms)
  // Populated on first sighting of each ticket. Never overwritten.
  openTimeRegistry: Map<number, number>;
  recordOpenTime: (ticket: number, timeMsFromServer: number) => void;

  // Persistent registry for SL & TP (fixes MT5 backends that drop these fields)
  slTpRegistry: Map<number, { sl: number, tp: number }>;
  setSlTp: (ticket: number, sl: number, tp: number) => void;
}

export const useMT5Store = create<MT5Store>()(
  devtools(
    (set, get) => ({
      // Initial state
      positions: [],
      account: null,
      orders: [],
      history: [],
      status: null,
      connected: false,
      loading: false,
      error: null,
      autoRefresh: false,
      _refreshInterval: null,
      _wsUpdatesActive: false,
      openTimeRegistry: (() => {
        // Restore from localStorage so arrows survive page refresh
        try {
          const saved = localStorage.getItem('rtx_open_time_registry');
          if (saved) {
            const entries: [number, number][] = JSON.parse(saved);
            return new Map<number, number>(entries);
          }
        } catch { /* ignore */ }
        return new Map<number, number>();
      })(),

      slTpRegistry: (() => {
        try {
          const saved = localStorage.getItem('rtx_sltp_registry');
          if (saved) {
             const entries: [number, { sl: number, tp: number }][] = JSON.parse(saved);
             return new Map(entries);
          }
        } catch { /* ignore */ }
        return new Map();
      })(),

      setSlTp: (ticket: number, sl: number, tp: number) => {
        const { slTpRegistry } = get();
        slTpRegistry.set(ticket, { sl, tp });
        try {
          localStorage.setItem('rtx_sltp_registry', JSON.stringify(Array.from(slTpRegistry.entries())));
        } catch { /* ignore quota errors */ }
      },

      recordOpenTime: (ticket: number, timeMsFromServer: number) => {
        const { openTimeRegistry } = get();
        if (!openTimeRegistry.has(ticket)) {
          // Normalize to milliseconds (time_ms from MT5 may be seconds or ms)
          const normalizedMs = timeMsFromServer > 1_000_000_000_000
            ? timeMsFromServer
            : timeMsFromServer * 1000;
          const nowMs = Date.now();
          // Trust server time only if it's clearly historical (>2s in the past)
          // otherwise capture current time as the best approximation of entry
          const captureMs = (normalizedMs > 1_000_000_000_000 && normalizedMs < nowMs - 2000)
            ? normalizedMs
            : nowMs;
          openTimeRegistry.set(ticket, captureMs);
          // Persist so arrows survive page refresh
          try {
            localStorage.setItem(
              'rtx_open_time_registry',
              JSON.stringify(Array.from(openTimeRegistry.entries()))
            );
          } catch { /* ignore quota errors */ }
        }
      },

      // Fetch positions
      fetchPositions: async (login?: number) => {
        set({ loading: true, error: null });
        try {
          const positions = await api.mt5.getPositions(login);
          // Guard: don't overwrite existing positions with empty data from unreliable gateway
          // when WebSocket was previously delivering updates
          const state = get();
          if (positions.length === 0 && state.positions.length > 0 && state._wsUpdatesActive) {
            console.log('[MT5Store] Skipping empty positions update — WebSocket is active with', state.positions.length, 'positions');
            set({ loading: false });
            return;
          }
          
          // FREEZE OPEN TIME: MT5 /positions may only return current update time 'time_ms'.
          // To prevent chart execution markers from sliding horizontally on every PnL tick,
          // we must permanently freeze the first known 'time_ms' for each ticket.
          const frozenPositions = state.positions.length > 0 ? 
            positions.map(newPos => {
              const existingPos = state.positions.find(p => p.ticket === newPos.ticket);
              if (existingPos) {
                 const ex = existingPos as any;
                 const nw = newPos as any;
                 return {
                   ...newPos,
                   time_ms: (ex.time_ms && ex.time_ms < nw.time_ms) ? ex.time_ms : nw.time_ms,
                   time_create: ex.time_create || nw.time_create,
                   time_create_msc: ex.time_create_msc || nw.time_create_msc,
                   time_setup: ex.time_setup || nw.time_setup,
                   time_setup_msc: ex.time_setup_msc || nw.time_setup_msc,
                   time_update: ex.time_update || nw.time_update,
                   time_update_msc: ex.time_update_msc || nw.time_update_msc,
                   time: ex.time || nw.time
                 };
              }
              return newPos;
            }) : positions;

          // Register open times for new tickets before freezing
          positions.forEach(p => {
            if (p.ticket) {
              const createMs = (p as any).time_create_msc || ((p as any).time_create ? (p as any).time_create * 1000 : 0) || (p as any).time_ms || 0;
              get().recordOpenTime(p.ticket, createMs);
            }
          });

          // Inject captured open times and registered SL/TP into positions
          const registry = get().openTimeRegistry;
          const slTpReg = get().slTpRegistry;
          const positionsWithOpenTime = frozenPositions.map(p => {
             const localSlTp = slTpReg.get(p.ticket);
             return {
               ...p,
               open_time_captured: registry.get(p.ticket) || (p as any).time_ms || 0,
               sl: localSlTp ? localSlTp.sl : (p.sl || 0),
               tp: localSlTp ? localSlTp.tp : (p.tp || 0)
             };
          });

          set({ positions: positionsWithOpenTime, loading: false });

          // ── PURGE OPTIMISTIC POSITIONS from useAppStore ──
          // Real MT5 positions have now arrived. Remove any optimistic positions
          // from useAppStore that match the same symbol — their IDs differ from
          // the real ticket so dedup fails and they cause double arrows.
          if (positionsWithOpenTime.length > 0) {
            try {
              const realSymbols = new Set(
                positionsWithOpenTime.map(p => (p.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase())
              );
              const appState = useAppStore.getState();
              const realTickets = new Set(positionsWithOpenTime.map(p => Number(p.ticket)));
              const cleaned = (appState.positions || []).filter((p: any) => {
                const sym = (p.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                // Remove optimistic entries: same symbol but ID not in real ticket set
                if (realSymbols.has(sym) && !realTickets.has(Number(p.id))) return false;
                return true;
              });
              if (cleaned.length !== (appState.positions || []).length) {
                appState.setPositions(cleaned);
              }
            } catch { /* ignore */ }
          }
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch positions',
            loading: false,
            connected: false
          });
        }
      },

      // Fetch account info
      fetchAccount: async (login?: number) => {
        set({ loading: true, error: null });
        try {
          const account = await api.mt5.getAccount(login);
          set({ account, loading: false });
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch account',
            loading: false,
            connected: false
          });
        }
      },

      // Fetch pending orders
      fetchOrders: async (login?: number) => {
        set({ loading: true, error: null });
        try {
          const orders = await api.mt5.getOrders(login);
          set({ orders, loading: false });
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch orders',
            loading: false,
            connected: false
          });
        }
      },

      // Fetch trade history
      fetchHistory: async (params?: { login?: number; from?: number; to?: number; symbol?: string }) => {
        set({ loading: true, error: null });
        try {
          const history = await api.mt5.getHistory(params || {});
          set({ history, loading: false });
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch history',
            loading: false,
            connected: false
          });
        }
      },

      // Fetch MT5 adapter status
      fetchStatus: async () => {
        try {
          const status = await api.mt5.getStatus();
          set({
            status,
            connected: status.connected,
            error: status.connected ? null : 'MT5 adapter not connected'
          });
        } catch (error: any) {
          set({
            status: null,
            connected: false,
            error: error.message || 'Failed to fetch status'
          });
        }
      },

      // Submit a new order
      submitOrder: async (order) => {
        set({ loading: true, error: null });
        try {
          const result = await api.mt5.submitOrder(order);
          // ── CAPTURE EXACT OPEN TIME at execution moment ──
          // This is the golden timestamp — precisely when the broker filled the order.
          // Register it in openTimeRegistry BEFORE fetchPositions runs,
          // so when positions arrive, the registry already has the correct candle time.
          const execTimeMs = (() => {
            const ticks = useAppStore.getState().ticks;
            const normalized = (order.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            const tick = ticks[normalized] || Object.values(ticks).find(t =>
              t.symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase().includes(normalized)
            );
            return (tick && tick.timestamp > 0) ? tick.timestamp : Date.now();
          })();

          // Register by BOTH possible ticket IDs (order ID and deal ID)
          const { openTimeRegistry } = get();
          const ticketFromResult = result.result_order || result.mt5_order_id || result.id;
          const dealFromResult = result.result_deal || result.mt5_deal_id;
          if (ticketFromResult && !openTimeRegistry.has(Number(ticketFromResult))) {
            openTimeRegistry.set(Number(ticketFromResult), execTimeMs);
          }
          if (dealFromResult && !openTimeRegistry.has(Number(dealFromResult))) {
            openTimeRegistry.set(Number(dealFromResult), execTimeMs);
          }
          // Persist immediately
          try {
            localStorage.setItem(
              'rtx_open_time_registry',
              JSON.stringify(Array.from(openTimeRegistry.entries()))
            );
          } catch { /* ignore */ }

          set({ loading: false });

          // ── INSTANT: Add optimistic position to useAppStore (synchronous, no await) ──
          try {
            const existing = useAppStore.getState().positions || [];
            const optimisticPos = {
              id: result.result_order || result.result_deal || Date.now(),
              symbol: order.symbol,
              side: (order.action || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
              volume: order.volume,
              openPrice: result.result_price || 0,
              currentPrice: result.result_price || 0,
              openTime: (() => {
                const ticks = useAppStore.getState().ticks;
                const normalized = (order.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                const tick = ticks[normalized] || Object.values(ticks).find(t => 
                  t.symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase().includes(normalized)
                );
                return tick && tick.timestamp > 0 
                  ? new Date(tick.timestamp).toISOString() 
                  : new Date().toISOString();
              })(),
              sl: order.sl || 0,
              tp: order.tp || 0,
              swap: 0,
              commission: 0,
              unrealizedPnL: 0,
            };
            useAppStore.getState().setPositions([...existing, optimisticPos] as any);
          } catch { /* ignore */ }

          // Dispatch refresh event immediately (chart lines update)
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
          }

          // Fire-and-forget: real data replaces optimistic on next poll/fetch
          const { fetchPositions, fetchAccount } = get();
          Promise.all([
            fetchPositions(order.login),
            fetchAccount(order.login)
          ]).then(() => {
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
          }).catch(() => {});

          return result;
        } catch (error: any) {
          set({
            error: error.message || 'Failed to submit order',
            loading: false
          });
          throw error;
        }
      },

      // Close a position
      closePosition: async (ticket: number, volume?: number) => {
        // Trigger fast-optimistic close sound
        import('../utils/audio').then(m => m.playSystemSound('close'));
        set({ loading: true, error: null });
        try {
          const result = await api.mt5.closePosition(ticket, volume);
          set({ loading: false });

          // Refresh positions after closing
          const { fetchPositions, fetchAccount } = get();
          await Promise.all([
            fetchPositions(),
            fetchAccount()
          ]);

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
          }

          // Prune closed ticket from registry
          try {
            const { openTimeRegistry } = get();
            if (openTimeRegistry.has(ticket)) {
              openTimeRegistry.delete(ticket);
              localStorage.setItem(
                'rtx_open_time_registry',
                JSON.stringify(Array.from(openTimeRegistry.entries()))
              );
            }
          } catch { /* ignore */ }

          return result;
        } catch (error: any) {
          set({
            error: error.message || 'Failed to close position',
            loading: false
          });
          throw error;
        }
      },

      // Modify position SL/TP
      modifyPosition: async (ticket: number, sl: number, tp: number) => {
        set({ loading: true, error: null });
        try {
          // Persist the SL/TP to local registry so it survives backend drops
          get().setSlTp(ticket, sl, tp);

          const result = await api.mt5.modifyPosition(ticket, sl, tp);
          set({ loading: false });

          // Optimistically update the position's SL/TP in the store immediately
          // so the UI reflects the change without waiting for a network round-trip
          const currentPositions = get().positions;
          const updatedPositions = currentPositions.map(p =>
            p.ticket === ticket ? { ...p, sl, tp } : p
          );
          set({ positions: updatedPositions });

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
          }

          // Fire-and-forget: real data replaces optimistic on next WS push
          const { fetchPositions } = get();
          fetchPositions().catch(() => {});

          return result;
        } catch (error: any) {
          set({
            error: error.message || 'Failed to modify position',
            loading: false
          });
          throw error;
        }
      },

      // Start auto-refresh (poll every 2 seconds)
      startAutoRefresh: (login?: number) => {
        const { _refreshInterval } = get();

        // Clear existing interval if any
        if (_refreshInterval) {
          clearInterval(_refreshInterval);
        }

        // Initial fetch
        const { fetchPositions, fetchAccount, fetchOrders, fetchStatus } = get();
        Promise.all([
          fetchStatus(),
          fetchPositions(login),
          fetchAccount(login),
          fetchOrders(login)
        ]);

        // Start polling (only when WebSocket is not delivering updates)
        const interval = setInterval(() => {
          const state = get();
          // Skip HTTP polling if WebSocket is delivering real-time updates
          if (state._wsUpdatesActive) {
            console.log('[MT5Store] Skipping HTTP poll - WebSocket is active');
            return;
          }
          if (state.connected) {
            Promise.all([
              state.fetchPositions(login),
              state.fetchAccount(login)
            ]).catch(err => {
              console.error('[MT5Store] Auto-refresh error:', err);
            });
          }
        }, 2000);

        set({
          autoRefresh: true,
          _refreshInterval: interval
        });
      },

      // Stop auto-refresh
      stopAutoRefresh: () => {
        const { _refreshInterval } = get();
        if (_refreshInterval) {
          clearInterval(_refreshInterval);
        }
        set({
          autoRefresh: false,
          _refreshInterval: null
        });
      },

      // Toggle auto-refresh
      setAutoRefresh: (enabled: boolean) => {
        if (enabled) {
          get().startAutoRefresh();
        } else {
          get().stopAutoRefresh();
        }
      },

      // Clear error
      clearError: () => set({ error: null }),

      // WebSocket setters - update state directly from WebSocket data
      setPositionsFromWS: (positions: MT5Position[]) => {
        const state = get();
        const frozenPositions = state.positions.length > 0 ? 
          positions.map(newPos => {
            const existingPos = state.positions.find(p => p.ticket === newPos.ticket);
            if (existingPos) {
               const ex = existingPos as any;
               const nw = newPos as any;
               return {
                 ...newPos,
                 time_ms: (ex.time_ms && ex.time_ms < nw.time_ms) ? ex.time_ms : nw.time_ms,
                 time_create: ex.time_create || nw.time_create,
                 time_create_msc: ex.time_create_msc || nw.time_create_msc,
                 time_setup: ex.time_setup || nw.time_setup,
                 time_setup_msc: ex.time_setup_msc || nw.time_setup_msc,
                 time_update: ex.time_update || nw.time_update,
                 time_update_msc: ex.time_update_msc || nw.time_update_msc,
                 time: ex.time || nw.time
               };
            }
            return newPos;
          }) : positions;

        // Register new tickets and inject captured open time
        positions.forEach(p => {
          if (p.ticket) {
            const createMs = (p as any).time_create_msc || ((p as any).time_create ? (p as any).time_create * 1000 : 0) || (p as any).time_ms || 0;
            get().recordOpenTime(p.ticket, createMs);
          }
        });
        const registry = get().openTimeRegistry;
        const slTpReg = get().slTpRegistry;
        const positionsWithOpenTime = frozenPositions.map(p => {
           const localSlTp = slTpReg.get(p.ticket);
           return {
             ...p,
             open_time_captured: registry.get(p.ticket) || (p as any).time_ms || 0,
             sl: localSlTp ? localSlTp.sl : (p.sl || 0),
             tp: localSlTp ? localSlTp.tp : (p.tp || 0)
           };
        });

        // ── PURGE OPTIMISTIC POSITIONS from useAppStore (WS path) ──
        if (positionsWithOpenTime.length > 0) {
          try {
            const realSymbols = new Set(
              positionsWithOpenTime.map((p: any) => (p.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase())
            );
            const appState = useAppStore.getState();
            const realTickets = new Set(positionsWithOpenTime.map((p: any) => Number(p.ticket)));
            const cleaned = (appState.positions || []).filter((p: any) => {
              const sym = (p.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (realSymbols.has(sym) && !realTickets.has(Number(p.id))) return false;
              return true;
            });
            if (cleaned.length !== (appState.positions || []).length) {
              appState.setPositions(cleaned);
            }
          } catch { /* ignore */ }
        }

        set({
          positions: positionsWithOpenTime,
          _wsUpdatesActive: true,
          connected: true,
          error: null
        });
      },

      setAccountFromWS: (account: MT5Account) => {
        set({
          account,
          _wsUpdatesActive: true,
          connected: true,
          error: null
        });
      },

      setOrdersFromWS: (orders: MT5Order[]) => {
        set({
          orders,
          _wsUpdatesActive: true,
          connected: true,
          error: null
        });
      },
    }),
    { name: 'MT5Store' }
  )
);

export default useMT5Store;
