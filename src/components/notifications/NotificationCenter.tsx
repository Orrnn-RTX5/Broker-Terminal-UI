/**
 * Notification Center Component
 * Dropdown panel showing all notifications with filtering
 */

import { Icon } from '../ui/Icon';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNotificationStore, type Notification, type NotificationType } from '../../store/useNotificationStore';

export const NotificationCenter: React.FC = () => {
  const { notifications, isOpen, markAsRead, markAllRead, removeNotification, setOpen } = useNotificationStore();
  const [activeFilter, setActiveFilter] = useState<'all' | NotificationType>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Check if click is on bell icon (allow it to toggle)
        const target = e.target as HTMLElement;
        if (!target.closest('[data-notification-bell]')) {
          setOpen(false);
        }
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, setOpen]);

  // Filter notifications
  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return notifications;
    return notifications.filter(n => n.type === activeFilter);
  }, [notifications, activeFilter]);

  // Group by time periods
  const groupedNotifications = useMemo(() => {
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const yesterday = today - 24 * 60 * 60 * 1000;

    const groups: { title: string; items: Notification[] }[] = [
      { title: 'Today', items: [] },
      { title: 'Yesterday', items: [] },
      { title: 'Earlier', items: [] },
    ];

    filteredNotifications.forEach(notification => {
      if (notification.timestamp >= today) {
        groups[0].items.push(notification);
      } else if (notification.timestamp >= yesterday) {
        groups[1].items.push(notification);
      } else {
        groups[2].items.push(notification);
      }
    });

    return groups.filter(g => g.items.length > 0);
  }, [filteredNotifications]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-2 w-96 max-h-[600px] bg-[#131316] border border-zinc-800 rounded-lg shadow-2xl z-[9999] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#252525]">
        <h3 className="text-sm font-bold text-zinc-200">Notifications</h3>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-blue-400 hover:text-zinc-300 transition-colors font-medium"
            >
              Mark All Read
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Icon name="x-close" size="sm" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800 bg-[#131316]">
        {[
          { id: 'all' as const, label: 'All', icon: null },
          { id: 'trading' as const, label: 'Trading', icon: <Icon name="trending-up" size="sm" className="w-3 h-3" /> },
          { id: 'account' as const, label: 'Account', icon: <Icon name="user" size="sm" className="w-3 h-3" /> },
          { id: 'security' as const, label: 'Security', icon: <Icon name="shield" size="sm" className="w-3 h-3" /> },
          { id: 'system' as const, label: 'System', icon: <Icon name="server" size="sm" className="w-3 h-3" /> },
        ].map(filter => (
          <button
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              activeFilter === filter.id
                ? 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {filter.icon}
            {filter.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="overflow-y-auto max-h-[450px] custom-scrollbar">
        {groupedNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <Icon name="info" size="sm" className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          groupedNotifications.map((group, idx) => (
            <div key={idx}>
              {/* Group Header */}
              <div className="px-4 py-2 text-[10px] font-bold text-zinc-600 uppercase tracking-wider bg-[#252525] sticky top-0 z-10">
                {group.title}
              </div>

              {/* Notification Items */}
              {group.items.map(notification => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={markAsRead}
                  onRemove={removeNotification}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

/**
 * Individual Notification Item Component
 */

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onRemove: (id: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onMarkRead, onRemove }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getSeverityConfig = () => {
    switch (notification.severity) {
      case 'critical':
        return {
          icon: <Icon name="x-close" size="sm" className="w-4 h-4 flex-shrink-0" />,
          borderColor: 'border-rose-500',
          iconColor: 'text-rose-400',
        };
      case 'error':
        return {
          icon: <Icon name="error" size="sm" className="w-4 h-4 flex-shrink-0" />,
          borderColor: 'border-orange-500',
          iconColor: 'text-orange-400',
        };
      case 'warning':
        return {
          icon: <Icon name="alert-triangle" size="sm" className="w-4 h-4 flex-shrink-0" />,
          borderColor: 'border-yellow-500',
          iconColor: 'text-yellow-400',
        };
      case 'info':
      default:
        return {
          icon: <Icon name="info" size="sm" className="w-4 h-4 flex-shrink-0" />,
          borderColor: 'border-zinc-600',
          iconColor: 'text-blue-400',
        };
    }
  };

  const config = getSeverityConfig();
  const timeAgo = getTimeAgo(notification.timestamp);

  const handleClick = () => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      className={`border-l-2 ${config.borderColor} ${
        !notification.read ? 'bg-zinc-800/30' : 'bg-transparent'
      } hover:bg-zinc-800/30 transition-colors cursor-pointer`}
      onClick={handleClick}
    >
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Severity Icon */}
          <div className={config.iconColor}>
            {config.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className={`text-sm ${!notification.read ? 'font-bold text-zinc-200' : 'font-medium text-zinc-400'}`}>
                {notification.title}
              </h4>
              {!notification.read && (
                <div className="w-2 h-2 rounded-full bg-zinc-8000 flex-shrink-0 mt-1"></div>
              )}
            </div>

            <p className={`text-xs text-zinc-500 mb-2 ${isExpanded ? '' : 'line-clamp-2'}`}>
              {notification.message}
            </p>

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-600">{timeAgo}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(notification.id);
                }}
                className="text-zinc-600 hover:text-rose-400 transition-colors"
              >
                <Icon name="x-close" size="sm" className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && notification.data && (
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <pre className="text-[10px] text-zinc-500 font-mono whitespace-pre-wrap">
              {JSON.stringify(notification.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Utility function to format timestamp
 */
function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
