/**
 * Notification Store with Zustand + Persist
 * Manages notification state with automatic persistence
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export type NotificationType = 'trading' | 'account' | 'security' | 'system';
export type NotificationSeverity = 'critical' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  data?: unknown;
}

export const NOTIFICATION_RETENTION_LIMIT = 200;
export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const NOTIFICATION_DATA_MAX_CHARS = 8_192;

const safeNotificationData = (data: unknown): unknown => {
  if (data === undefined) return undefined;
  try {
    return JSON.stringify(data).length <= NOTIFICATION_DATA_MAX_CHARS ? data : undefined;
  } catch {
    return undefined;
  }
};

export const retainNotifications = (
  notifications: readonly Notification[],
  now = Date.now(),
): Notification[] => notifications
  .filter((notification) => (
    Boolean(notification?.id)
    && Number.isFinite(notification?.timestamp)
    && notification.timestamp >= now - NOTIFICATION_RETENTION_MS
  ))
  .sort((left, right) => right.timestamp - left.timestamp)
  .slice(0, NOTIFICATION_RETENTION_LIMIT)
  .map((notification) => ({
    ...notification,
    data: safeNotificationData(notification.data),
  }));

export const countUnreadNotifications = (notifications: readonly Notification[]): number =>
  notifications.reduce((count, notification) => count + (notification.read ? 0 : 1), 0);

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean; // Notification center panel open/closed

  // Actions
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllRead: () => void;
  removeNotification: (id: string) => void;
  toggleCenter: () => void;
  setOpen: (open: boolean) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  devtools(
    persist(
      (set) => ({
        notifications: [],
        unreadCount: 0,
        isOpen: false,

        addNotification: (notification) => {
          const newNotification: Notification = {
            ...notification,
            id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            read: false,
          };

          set((state) => {
            const notifications = retainNotifications([newNotification, ...state.notifications]);
            return {
              notifications,
              unreadCount: countUnreadNotifications(notifications),
            };
          });
        },

        markAsRead: (id) => {
          set((state) => {
            const notification = state.notifications.find(n => n.id === id);
            if (!notification || notification.read) return state;

            return {
              notifications: state.notifications.map(n =>
                n.id === id ? { ...n, read: true } : n
              ),
              unreadCount: Math.max(0, state.unreadCount - 1),
            };
          });
        },

        markAllRead: () => {
          set((state) => ({
            notifications: state.notifications.map(n => ({ ...n, read: true })),
            unreadCount: 0,
          }));
        },

        removeNotification: (id) => {
          set((state) => {
            const notification = state.notifications.find(n => n.id === id);
            const wasUnread = notification && !notification.read;

            return {
              notifications: state.notifications.filter(n => n.id !== id),
              unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
            };
          });
        },

        toggleCenter: () => {
          set((state) => ({ isOpen: !state.isOpen }));
        },

        setOpen: (open) => {
          set({ isOpen: open });
        },

        clearAll: () => {
          set({ notifications: [], unreadCount: 0 });
        },
      }),
      {
        name: 'rtx5-notifications',
        version: 2,
        migrate: (persistedState) => persistedState,
        partialize: (state) => ({
          notifications: state.notifications,
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<NotificationState> | undefined;
          const notifications = retainNotifications(
            Array.isArray(persisted?.notifications) ? persisted.notifications : [],
          );
          return {
            ...currentState,
            notifications,
            unreadCount: countUnreadNotifications(notifications),
            isOpen: false,
          };
        },
      }
    )
  )
);
