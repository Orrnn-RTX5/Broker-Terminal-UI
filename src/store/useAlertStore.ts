/**
 * Alert Store with Zustand + Persist
 * Manages price alerts and alert checking logic
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export type AlertCondition =
  | 'price_above'
  | 'price_below'
  | 'bid_above'
  | 'bid_below'
  | 'ask_above'
  | 'ask_below';

export type AlertStatus = 'active' | 'triggered' | 'expired' | 'disabled';

export type NotifyMethod = 'sound' | 'push' | 'both';

export interface Alert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  status: AlertStatus;
  expiration: number | null; // timestamp or null for no expiration
  notifyMethod: NotifyMethod;
  title?: string;
  message?: string;
  createdAt: number;
  triggeredAt?: number;
  enabled: boolean;
}

export const ALERT_TERMINAL_RETENTION_LIMIT = 200;
export const ALERT_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Preserve user-owned live/disabled alerts; bound only terminal history. */
export const retainAlerts = (alerts: readonly Alert[], now = Date.now()): Alert[] => {
  const live = alerts.filter(alert => alert.status === 'active' || alert.status === 'disabled');
  const terminal = alerts
    .filter(alert => alert.status === 'triggered' || alert.status === 'expired')
    .filter(alert => (alert.triggeredAt ?? alert.expiration ?? alert.createdAt) >= now - ALERT_TERMINAL_RETENTION_MS)
    .sort((left, right) => (
      (right.triggeredAt ?? right.expiration ?? right.createdAt)
      - (left.triggeredAt ?? left.expiration ?? left.createdAt)
    ))
    .slice(0, ALERT_TERMINAL_RETENTION_LIMIT);

  return [...live, ...terminal].sort((left, right) => right.createdAt - left.createdAt);
};

interface AlertState {
  alerts: Alert[];

  // Actions
  addAlert: (alert: Omit<Alert, 'id' | 'status' | 'createdAt' | 'enabled'>) => string;
  removeAlert: (id: string) => void;
  updateAlert: (id: string, updates: Partial<Alert>) => void;
  toggleAlert: (id: string) => void;
  checkAlerts: (currentPrices: Record<string, { bid: number; ask: number; last?: number }>) => Alert[];
  clearTriggered: () => void;
  clearAll: () => void;
}

export const useAlertStore = create<AlertState>()(
  devtools(
    persist(
      (set) => ({
        alerts: [],

        addAlert: (alert) => {
          const newAlert: Alert = {
            ...alert,
            id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            status: 'active',
            createdAt: Date.now(),
            enabled: true,
          };

          set((state) => ({
            alerts: retainAlerts([newAlert, ...state.alerts]),
          }));

          return newAlert.id;
        },

        removeAlert: (id) => {
          set((state) => ({
            alerts: state.alerts.filter((a) => a.id !== id),
          }));
        },

        updateAlert: (id, updates) => {
          set((state) => ({
            alerts: state.alerts.map((a) => (a.id === id ? { ...a, ...updates } : a)),
          }));
        },

        toggleAlert: (id) => {
          set((state) => ({
            alerts: state.alerts.map((a) =>
              a.id === id
                ? { ...a, enabled: !a.enabled, status: a.enabled ? 'disabled' : 'active' }
                : a
            ),
          }));
        },

        checkAlerts: (currentPrices) => {
          const now = Date.now();
          const triggeredAlerts: Alert[] = [];

          set((state) => {
            const updatedAlerts = state.alerts.map((alert) => {
              // Skip if not active or disabled
              if (alert.status !== 'active' || !alert.enabled) {
                return alert;
              }

              // Check expiration
              if (alert.expiration && now > alert.expiration) {
                return { ...alert, status: 'expired' as AlertStatus };
              }

              // Get current price data for this symbol
              const priceData = currentPrices[alert.symbol];
              if (!priceData) return alert;

              const { bid, ask, last } = priceData;
              const currentPrice = last || (bid + ask) / 2;

              // Check if alert condition is met
              let conditionMet = false;

              switch (alert.condition) {
                case 'price_above':
                  conditionMet = currentPrice >= alert.price;
                  break;
                case 'price_below':
                  conditionMet = currentPrice <= alert.price;
                  break;
                case 'bid_above':
                  conditionMet = bid >= alert.price;
                  break;
                case 'bid_below':
                  conditionMet = bid <= alert.price;
                  break;
                case 'ask_above':
                  conditionMet = ask >= alert.price;
                  break;
                case 'ask_below':
                  conditionMet = ask <= alert.price;
                  break;
              }

              if (conditionMet) {
                const triggeredAlert = {
                  ...alert,
                  status: 'triggered' as AlertStatus,
                  triggeredAt: now,
                };
                triggeredAlerts.push(triggeredAlert);
                return triggeredAlert;
              }

              return alert;
            });

            return { alerts: retainAlerts(updatedAlerts, now) };
          });

          return triggeredAlerts;
        },

        clearTriggered: () => {
          set((state) => ({
            alerts: state.alerts.filter((a) => a.status !== 'triggered'),
          }));
        },

        clearAll: () => {
          set({ alerts: [] });
        },
      }),
      {
        name: 'rtx5-alerts',
        version: 2,
        migrate: (persistedState) => persistedState,
        partialize: (state) => ({
          alerts: state.alerts,
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<AlertState> | undefined;
          return {
            ...currentState,
            alerts: retainAlerts(Array.isArray(persisted?.alerts) ? persisted.alerts : []),
          };
        },
      }
    )
  )
);

/**
 * Helper function to format alert condition for display
 */
export function formatCondition(condition: AlertCondition): string {
  const map: Record<AlertCondition, string> = {
    price_above: 'Price Above',
    price_below: 'Price Below',
    bid_above: 'Bid Above',
    bid_below: 'Bid Below',
    ask_above: 'Ask Above',
    ask_below: 'Ask Below',
  };
  return map[condition];
}

/**
 * Helper function to format expiration time
 */
export function formatExpiration(expiration: number | null): string {
  if (!expiration) return 'Never';

  const now = Date.now();
  const diff = expiration - now;

  if (diff < 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;

  const minutes = Math.floor(diff / (1000 * 60));
  return `${minutes}m`;
}
