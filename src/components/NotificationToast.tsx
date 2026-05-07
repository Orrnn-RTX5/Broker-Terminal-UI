/**
 * Notification Toast Component
 * Display toast notifications with auto-dismiss and animations
 */

import { Icon } from './ui/Icon';
import { useNotifications, notificationService, type Notification } from '../services/notifications';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    icon: 'text-emerald-500',
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    icon: 'text-red-500',
  },
  warning: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    icon: 'text-yellow-500',
  },
  info: {
    bg: 'bg-zinc-700/20',
    border: 'border-zinc-600/30',
    text: 'text-blue-400',
    icon: 'text-blue-500',
  },
};

function Toast({ notification }: { notification: Notification }) {
  const Icon = ICONS[notification.type];
  const colors = COLORS[notification.type];

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border ${colors.bg} ${colors.border} min-w-80 max-w-md shadow-xl backdrop-blur-sm animate-slide-in`}
    >
      <Icon className={`${colors.icon} flex-shrink-0 mt-0.5`} size={20} />
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm ${colors.text}`}>{notification.title}</div>
        {notification.message && (
          <div className="text-xs text-zinc-400 mt-1">{notification.message}</div>
        )}
      </div>
      <button
        onClick={() => notificationService.remove(notification.id)}
        className="text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
      >
        <Icon name="x-close" size="md" />
      </button>
    </div>
  );
}

export function NotificationToast() {
  const notifications = useNotifications();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {notifications.slice(0, 5).map((notification) => (
          <Toast key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  );
}
