/**
 * Toast Notification System
 * Centralized notification management with queue and auto-dismiss
 */

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  timestamp: number;
}

type NotificationListener = (notifications: Notification[]) => void;

class NotificationService {
  private notifications: Notification[] = [];
  private listeners: Set<NotificationListener> = new Set();
  private autoRemoveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    listener(this.notifications);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener([...this.notifications]));
  }

  show(
    type: NotificationType,
    title: string,
    message?: string,
    duration = 5000
  ): string {
    const id = `${Date.now()}-${Math.random()}`;
    const notification: Notification = {
      id,
      type,
      title,
      message,
      duration,
      timestamp: Date.now(),
    };

    this.notifications.unshift(notification);
    this.notify();

    // Auto-remove after duration
    if (duration > 0) {
      const timer = setTimeout(() => {
        this.remove(id);
      }, duration);

      this.autoRemoveTimers.set(id, timer);
    }

    return id;
  }

  success(title: string, message?: string, duration?: number): string {
    return this.show('success', title, message, duration);
  }

  error(title: string, message?: string, duration?: number): string {
    return this.show('error', title, message, duration);
  }

  warning(title: string, message?: string, duration?: number): string {
    return this.show('warning', title, message, duration);
  }

  info(title: string, message?: string, duration?: number): string {
    return this.show('info', title, message, duration);
  }

  remove(id: string): void {
    const timer = this.autoRemoveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.autoRemoveTimers.delete(id);
    }

    this.notifications = this.notifications.filter((n) => n.id !== id);
    this.notify();
  }

  clear(): void {
    this.autoRemoveTimers.forEach((timer) => clearTimeout(timer));
    this.autoRemoveTimers.clear();
    this.notifications = [];
    this.notify();
  }

  getAll(): Notification[] {
    return [...this.notifications];
  }
}

export const notificationService = new NotificationService();

// React Hook
import { useEffect, useState } from 'react';

export function useNotifications(): Notification[] {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    return notificationService.subscribe(setNotifications);
  }, []);

  return notifications;
}
