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
  data?: any; // Optional additional data
}

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
      (set, get) => ({
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

          set((state) => ({
            notifications: [newNotification, ...state.notifications],
            unreadCount: state.unreadCount + 1,
          }));
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
        partialize: (state) => ({
          notifications: state.notifications,
          unreadCount: state.unreadCount,
        }),
      }
    )
  )
);
