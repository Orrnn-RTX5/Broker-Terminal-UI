// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countUnreadNotifications,
  NOTIFICATION_DATA_MAX_CHARS,
  NOTIFICATION_RETENTION_LIMIT,
  NOTIFICATION_RETENTION_MS,
  retainNotifications,
  useNotificationStore,
  type Notification,
} from './useNotificationStore';

const notification = (id: string, timestamp: number, read = false, data?: unknown): Notification => ({
  id,
  type: 'system',
  severity: 'info',
  title: id,
  message: id,
  timestamp,
  read,
  data,
});

describe('notification retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00Z'));
    localStorage.clear();
    useNotificationStore.setState({ notifications: [], unreadCount: 0, isOpen: false });
  });

  afterEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0, isOpen: false });
    localStorage.clear();
    vi.useRealTimers();
  });

  it('caps newly added notifications and keeps unread count derived from retained rows', () => {
    for (let index = 0; index < NOTIFICATION_RETENTION_LIMIT + 5; index += 1) {
      useNotificationStore.getState().addNotification({
        type: 'system',
        severity: 'info',
        title: `Notification ${index}`,
        message: 'test',
      });
    }

    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(NOTIFICATION_RETENTION_LIMIT);
    expect(state.unreadCount).toBe(NOTIFICATION_RETENTION_LIMIT);
  });

  it('drops expired rows and oversized persisted payloads without trusting persisted counts', () => {
    const now = Date.now();
    const retained = retainNotifications([
      notification('fresh-read', now, true),
      notification('fresh-unread', now - 1, false, { huge: 'x'.repeat(NOTIFICATION_DATA_MAX_CHARS + 1) }),
      notification('expired', now - NOTIFICATION_RETENTION_MS - 1),
    ], now);

    expect(retained.map(item => item.id)).toEqual(['fresh-read', 'fresh-unread']);
    expect(retained[1].data).toBeUndefined();
    expect(countUnreadNotifications(retained)).toBe(1);
  });
});
