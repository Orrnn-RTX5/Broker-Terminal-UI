/**
 * Notifications Hook
 * Connects to WebSocket for real-time notifications and manages toast display
 */

import { useEffect, useState, useCallback } from 'react';
import { useNotificationStore } from '../store/useNotificationStore';
import type { NotificationSeverity, NotificationType } from '../store/useNotificationStore';
import { api } from '../services/api';
import { ApiError } from '../api/client';

interface UseNotificationsProps {
  wsConnection: WebSocket | null;
}

export const useNotifications = ({ wsConnection }: UseNotificationsProps) => {
  const { addNotification } = useNotificationStore();
  const [activeToasts, setActiveToasts] = useState<any[]>([]);

  // Play sound for critical notifications (optional)
  const playNotificationSound = useCallback(() => {
    // Browser notification sound
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZUQ0PVKvn77BfGAg+ltvy0H0pBSl+zPLaizsIGGS56+OZUQ4OUKXi8LaHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsI');
    audio.volume = 0.3;
    audio.play().catch(() => {
      // Ignore errors if browser blocks audio
    });
  }, []);

  // Show toast notification
  const showToast = useCallback((notification: any) => {
    const toastId = notification.id;

    setActiveToasts(prev => [...prev, {
      id: toastId,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      onDismiss: () => {
        setActiveToasts(current => current.filter(t => t.id !== toastId));
      }
    }]);

    // Play sound for critical notifications
    if (notification.severity === 'critical') {
      playNotificationSound();
    }
  }, [playNotificationSound]);

  // WebSocket message handler
  useEffect(() => {
    if (!wsConnection) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // Handle notification messages
        if (data.type === 'notification') {
          const notification = {
            type: data.notificationType || 'system',
            severity: data.severity || 'info',
            title: data.title,
            message: data.message,
            data: data.data,
          };

          addNotification(notification);
          showToast({ ...notification, id: Date.now().toString() });
        }
      } catch (error) {
        console.error('[Notifications] Failed to parse WS message:', error);
      }
    };

    wsConnection.addEventListener('message', handleMessage);

    return () => {
      wsConnection.removeEventListener('message', handleMessage);
    };
  }, [wsConnection, addNotification, showToast]);

  // NOTE: /api/notifications/unread-count is not deployed yet.
  // Skipping the fetch to avoid 404 / 401 console spam.
  // Re-enable when the backend notifications endpoint is ready.

  return {
    activeToasts,
  };
};

/**
 * Fetch notifications from API
 * TODO: Implement actual API endpoint when backend is ready
 */
export const fetchNotifications = async (): Promise<Array<{
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
}>> => {
  try {
    // Placeholder: Replace with actual API call
    // const response = await api.notifications.getAll();
    // return response.data;

    // Return empty array until API is implemented
    return [];
  } catch (error) {
    console.error('[Notifications] Failed to fetch notifications:', error);
    return [];
  }
};
