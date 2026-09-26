/**
 * Toast Notification Component
 * Transient notifications that auto-dismiss based on severity
 */

import { Icon } from '../ui/Icon';
import React, { useEffect, useState } from 'react';
import type { NotificationSeverity } from '../../store/useNotificationStore';

export interface ToastNotification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  onDismiss: () => void;
}

interface ToastProps {
  notification: ToastNotification;
}

export const Toast: React.FC<ToastProps> = ({ notification }) => {
  const [isExiting, setIsExiting] = useState(false);

  // Auto-dismiss based on severity
  useEffect(() => {
    if (notification.severity === 'critical') {
      // Critical notifications don't auto-dismiss
      return;
    }

    const duration =
      notification.severity === 'error' ? 15000 :
      notification.severity === 'warning' ? 10000 :
      5000; // info default

    const timer = setTimeout(() => {
      handleDismiss();
    }, duration);

    return () => clearTimeout(timer);
  }, [notification.severity]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      notification.onDismiss();
    }, 200); // Match animation duration
  };

  const getSeverityConfig = () => {
    switch (notification.severity) {
      case 'critical':
        return {
          icon: <Icon name="x-close" size="sm" className="w-5 h-5 flex-shrink-0" />,
          borderColor: 'border-rose-500',
          bgColor: 'bg-rose-500/10',
          textColor: 'text-rose-300',
          iconColor: 'text-rose-400',
        };
      case 'error':
        return {
          icon: <Icon name="error" size="sm" className="w-5 h-5 flex-shrink-0" />,
          borderColor: 'border-orange-500',
          bgColor: 'bg-orange-500/10',
          textColor: 'text-orange-300',
          iconColor: 'text-orange-400',
        };
      case 'warning':
        return {
          icon: <Icon name="alert-triangle" size="sm" className="w-5 h-5 flex-shrink-0" />,
          borderColor: 'border-yellow-500',
          bgColor: 'bg-yellow-500/10',
          textColor: 'text-yellow-300',
          iconColor: 'text-yellow-400',
        };
      case 'info':
      default:
        return {
          icon: <Icon name="info" size="sm" className="w-5 h-5 flex-shrink-0" />,
          borderColor: 'border-zinc-600',
          bgColor: 'bg-zinc-700/20',
          textColor: 'text-zinc-300',
          iconColor: 'text-blue-400',
        };
    }
  };

  const config = getSeverityConfig();

  return (
    <div
      className={`w-80 ${config.bgColor} ${config.borderColor} border-l-4 rounded-lg shadow-2xl p-4 mb-3 transition-all duration-200 ${
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0 animate-in slide-in-from-right-5'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={config.iconColor}>
          {config.icon}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-bold ${config.textColor} mb-1`}>
            {notification.title}
          </h4>
          <p className="text-xs text-zinc-400 leading-relaxed break-words">
            {notification.message}
          </p>
        </div>

        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <Icon name="x-close" size="sm" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * Toast Container Component
 * Manages and renders multiple toast notifications
 */

interface ToastContainerProps {
  notifications: ToastNotification[];
  avoidActionFeedback?: boolean;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  notifications,
  avoidActionFeedback = false,
}) => {
  // Limit to 5 visible toasts
  const visibleToasts = notifications.slice(0, 5);

  if (visibleToasts.length === 0) return null;

  return (
    <div className={`rtx-notification-toast-region${avoidActionFeedback ? ' rtx-notification-toast-region--below-action' : ''} fixed right-4 pointer-events-none`}>
      <div className="pointer-events-auto space-y-0">
        {visibleToasts.map((notification) => (
          <Toast key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  );
};
