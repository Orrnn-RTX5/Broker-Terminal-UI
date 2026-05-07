/**
 * Notification Badge Component
 * Shows unread notification count on the bell icon
 */

import React from 'react';
import { useNotificationStore } from '../../store/useNotificationStore';

export const NotificationBadge: React.FC = () => {
  const { notifications, unreadCount } = useNotificationStore();

  // Check if there are any critical unread notifications for pulse animation
  const hasCritical = notifications.some(n => !n.read && n.severity === 'critical');

  if (unreadCount === 0) return null;

  const displayCount = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <div
      className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-rose-500 text-white text-[9px] font-bold rounded-full border-2 border-[#131316] ${
        hasCritical ? 'animate-pulse' : ''
      }`}
    >
      {displayCount}
    </div>
  );
};
