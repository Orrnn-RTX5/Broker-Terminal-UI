/**
 * Alerts Container Component
 * Manages alert stack with WebSocket integration and sound notifications
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCard } from './AlertCard';
import type { Alert } from './AlertCard';
type AlertsContainerProps = {
  wsConnection?: WebSocket | null;
};

// Alert sound (data URL for a simple beep - you can replace with an actual .mp3 file)
const ALERT_SOUND_URL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSl+zPLTgjMHHGS36OizaBgJT6Lh8bllHgU2jdXyz3ssBSh+zPLUgzQHHGO35umzbhoJUKPi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8LpmHgU4jtbyz3ssBSt9y/LWgzQHHWO36OmzbxoJUKTi8Lpm';

export function AlertsContainer({ wsConnection }: AlertsContainerProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoHideTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        setHasNotificationPermission(true);
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          setHasNotificationPermission(permission === 'granted');
        });
      }
    }
  }, []);

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio(ALERT_SOUND_URL);
    audioRef.current.volume = 0.5; // 50% volume
  }, []);

  // Dismiss alert
  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== id));

    // Clear auto-hide timeout
    const timeout = autoHideTimeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      autoHideTimeouts.current.delete(id);
    }
  }, []);

  // Add new alert with sound, notification, and auto-hide
  const addAlert = useCallback((alert: Alert) => {
    setAlerts(prev => [alert, ...prev]);

    // Play sound
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(err => {
        console.warn('[Alerts] Failed to play sound:', err);
      });
    }

    // Show browser notification
    if (hasNotificationPermission && 'Notification' in window) {
      new Notification(`${alert.severity} Alert`, {
        body: alert.message,
        icon: '/favicon.ico',
        tag: alert.id,
        requireInteraction: alert.severity === 'CRITICAL',
      });
    }

    // Vibrate on mobile
    if ('vibrate' in navigator) {
      const pattern = alert.severity === 'CRITICAL'
        ? [200, 100, 200, 100, 200]
        : [100, 50, 100];
      navigator.vibrate(pattern);
    }

    // Auto-hide non-critical alerts after 10 seconds
    if (alert.severity !== 'CRITICAL') {
      const timeout = setTimeout(() => {
        dismissAlert(alert.id);
      }, 10000);
      autoHideTimeouts.current.set(alert.id, timeout);
    }
  }, [hasNotificationPermission, dismissAlert]);

  // WebSocket message handler
  useEffect(() => {
    if (!wsConnection) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // Handle alert messages
        if (data.type === 'alert') {
          const newAlert: Alert = {
            id: data.id || `alert-${Date.now()}-${Math.random()}`,
            severity: data.severity || 'MEDIUM',
            message: data.message || 'Alert triggered',
            timestamp: data.timestamp || Date.now(),
            acknowledged: false,
          };

          addAlert(newAlert);
        }
      } catch (error) {
        console.error('[Alerts] Failed to parse WebSocket message:', error);
      }
    };

    wsConnection.addEventListener('message', handleMessage);

    return () => {
      wsConnection.removeEventListener('message', handleMessage);
    };
  }, [wsConnection, addAlert]);

  // Acknowledge alert
  const acknowledgeAlert = (id: string) => {
    setAlerts(prev => prev.map(alert =>
      alert.id === id ? { ...alert, acknowledged: true } : alert
    ));

    // Clear auto-hide timeout
    const timeout = autoHideTimeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      autoHideTimeouts.current.delete(id);
    }

    // Remove after 2 seconds
    setTimeout(() => dismissAlert(id), 2000);
  };

  // Snooze alert
  const snoozeAlert = (id: string, minutes: number) => {
    const snoozedUntil = Date.now() + minutes * 60 * 1000;

    setAlerts(prev => prev.map(alert =>
      alert.id === id ? { ...alert, snoozedUntil } : alert
    ));

    // Clear auto-hide timeout
    const timeout = autoHideTimeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      autoHideTimeouts.current.delete(id);
    }

    // Remove from display
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== id));
    }, 300);

    // Re-add after snooze period
    setTimeout(() => {
      setAlerts(prev => {
        const alert = prev.find(a => a.id === id);
        if (alert) {
          return [{ ...alert, snoozedUntil: undefined }, ...prev.filter(a => a.id !== id)];
        }
        return prev;
      });
    }, minutes * 60 * 1000);
  };


  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      autoHideTimeouts.current.forEach(timeout => clearTimeout(timeout));
    };
  }, []);

  // Count unacknowledged alerts
  const unacknowledgedCount = alerts.filter(a => !a.acknowledged && !a.snoozedUntil).length;

  // Filter out snoozed alerts for display
  const displayAlerts = alerts.filter(a => !a.snoozedUntil);

  return (
    <>
      {/* Badge Counter (fixed position in top-right) */}
      {unacknowledgedCount > 0 && (
        <div className="fixed top-4 right-4 z-50 pointer-events-none">
          <div className="relative">
            <Icon name="bell" size="sm" className="w-6 h-6 text-zinc-400" />
            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unacknowledgedCount > 9 ? '9+' : unacknowledgedCount}
            </div>
          </div>
        </div>
      )}

      {/* Alert Stack (fixed position in top-right, below badge) */}
      <div className="fixed top-16 right-4 z-40 flex flex-col gap-2 max-h-[80vh] overflow-y-auto pointer-events-none">
        <div className="flex flex-col gap-2 pointer-events-auto">
          {displayAlerts.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={acknowledgeAlert}
              onSnooze={snoozeAlert}
              onDismiss={dismissAlert}
            />
          ))}
        </div>
      </div>
    </>
  );
}
