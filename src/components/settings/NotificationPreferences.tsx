/**
 * Notification Preferences Panel
 * Detailed notification settings for all categories
 */

import { Icon } from '../ui/Icon';
import React from 'react';
import {
  useSettingsStore,
  type CategorySettings,
  type NotificationSound,
  type NotificationPriority,
  type HistoryRetention,
} from '../../store/useSettingsStore';
import { useNotificationStore } from '../../store/useNotificationStore';

interface NotificationCategory {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const CATEGORIES: NotificationCategory[] = [
  {
    id: 'tradeExecution' as any,
    label: 'Trade Execution',
    description: 'Order filled, position opened/closed',
    icon: <Icon name="trending-up" size="md" />,
  },
  {
    id: 'priceAlerts' as any,
    label: 'Price Alerts',
    description: 'Triggered alerts from Alert Manager',
    icon: <Icon name="bell" size="md" />,
  },
  {
    id: 'marginWarnings' as any,
    label: 'Margin Warnings',
    description: 'Margin call, stop-out approaching',
    icon: <Icon name="alert-triangle" size="md" />,
  },
  {
    id: 'system' as any,
    label: 'System',
    description: 'Connection lost, reconnected, maintenance',
    icon: <Icon name="wifi" size="md" />,
  },
  {
    id: 'news' as any,
    label: 'News',
    description: 'High-impact economic events',
    icon: <Icon name="newspaper" size="md" />,
  },
  {
    id: 'account' as any,
    label: 'Account',
    description: 'Deposits, withdrawals, balance changes',
    icon: <Icon name="user" size="md" />,
  },
];

const SOUND_OPTIONS: { value: NotificationSound; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'chime', label: 'Chime' },
  { value: 'alert', label: 'Alert' },
  { value: 'silent', label: 'Silent' },
];

const PRIORITY_OPTIONS: { value: NotificationPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-gray-400' },
  { value: 'medium', label: 'Medium', color: 'text-blue-400' },
  { value: 'high', label: 'High', color: 'text-yellow-400' },
  { value: 'critical', label: 'Critical', color: 'text-rose-400' },
];

const HISTORY_RETENTION_OPTIONS: { value: HistoryRetention; label: string }[] = [
  { value: '1hr', label: '1 hour' },
  { value: '6hr', label: '6 hours' },
  { value: '24hr', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

export function NotificationPreferences() {
  const notifications = useSettingsStore((state) => state.notifications);
  const updateNotificationsSettings = useSettingsStore((state) => state.updateNotificationsSettings);
  const clearAll = useNotificationStore((state) => state.clearAll);

  const updateCategorySettings = (
    categoryKey: keyof typeof notifications,
    settings: Partial<CategorySettings>
  ) => {
    updateNotificationsSettings({
      [categoryKey]: {
        ...(notifications[categoryKey] as CategorySettings),
        ...settings,
      },
    });
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all notifications?')) {
      clearAll();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
        {/* Global Settings */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
            <Icon name="monitor" size="sm" />
            Global Settings
          </h3>

          <div className="bg-[#131316] border border-zinc-700 rounded p-4 space-y-4">
            {/* Do Not Disturb */}
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <Icon name="settings" size="md" className="text-zinc-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-sm text-zinc-200 font-medium">Do Not Disturb</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Mutes all non-critical notifications
                  </div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifications.doNotDisturb}
                  onChange={(e) =>
                    updateNotificationsSettings({ doNotDisturb: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* DND Schedule */}
            <div className="flex items-start gap-3">
              <Icon name="clock" size="md" className="text-zinc-400 mt-2 flex-shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-zinc-200 font-medium">DND Schedule</div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifications.dndSchedule.enabled}
                      onChange={(e) =>
                        updateNotificationsSettings({
                          dndSchedule: {
                            ...notifications.dndSchedule,
                            enabled: e.target.checked,
                          },
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                {notifications.dndSchedule.enabled && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-zinc-500 mb-1">From</label>
                      <input
                        type="time"
                        value={notifications.dndSchedule.fromTime}
                        onChange={(e) =>
                          updateNotificationsSettings({
                            dndSchedule: {
                              ...notifications.dndSchedule,
                              fromTime: e.target.value,
                            },
                          })
                        }
                        className="w-full px-2 py-1.5 bg-[#252528] border border-zinc-700 rounded text-zinc-300 text-xs focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-zinc-500 mb-1">To</label>
                      <input
                        type="time"
                        value={notifications.dndSchedule.toTime}
                        onChange={(e) =>
                          updateNotificationsSettings({
                            dndSchedule: {
                              ...notifications.dndSchedule,
                              toTime: e.target.value,
                            },
                          })
                        }
                        className="w-full px-2 py-1.5 bg-[#252528] border border-zinc-700 rounded text-zinc-300 text-xs focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Max Notifications Per Minute */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-zinc-200 font-medium">
                  Max Notifications Per Minute
                </label>
                <span className="text-sm text-blue-400 font-mono">
                  {notifications.maxNotificationsPerMinute}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                value={notifications.maxNotificationsPerMinute}
                onChange={(e) =>
                  updateNotificationsSettings({
                    maxNotificationsPerMinute: parseInt(e.target.value),
                  })
                }
                className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            {/* History Retention */}
            <div className="space-y-2">
              <label className="block text-sm text-zinc-200 font-medium">
                Notification History Retention
              </label>
              <select
                value={notifications.historyRetention}
                onChange={(e) =>
                  updateNotificationsSettings({
                    historyRetention: e.target.value as HistoryRetention,
                  })
                }
                className="w-full px-3 py-2 bg-[#252528] border border-zinc-700 rounded text-zinc-300 text-sm focus:outline-none focus:border-zinc-600"
              >
                {HISTORY_RETENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear All Button */}
            <button
              onClick={handleClearAll}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-600/30 rounded text-sm transition-colors"
            >
              <Icon name="trash" size="sm" />
              <span>Clear All Notifications</span>
            </button>
          </div>
        </div>

        {/* Notification Categories */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
            <Icon name="bell" size="sm" />
            Notification Categories
          </h3>

          <div className="space-y-3">
            {CATEGORIES.map((category) => {
              const categorySettings = notifications[
                category.id as keyof typeof notifications
              ] as CategorySettings;

              if (!categorySettings || typeof categorySettings !== 'object') {
                return null;
              }

              return (
                <div
                  key={category.id}
                  className="bg-[#131316] border border-zinc-700 rounded p-4"
                >
                  {/* Category Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="text-zinc-400 mt-0.5">{category.icon}</div>
                      <div className="flex-1">
                        <div className="text-sm text-zinc-200 font-semibold">
                          {category.label}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {category.description}
                        </div>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={categorySettings.enabled}
                        onChange={(e) =>
                          updateCategorySettings(category.id as any, {
                            enabled: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Category Settings */}
                  {categorySettings.enabled && (
                    <div className="space-y-3 pl-7">
                      {/* Show Popup */}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={categorySettings.showPopup}
                          onChange={(e) =>
                            updateCategorySettings(category.id as any, {
                              showPopup: e.target.checked,
                            })
                          }
                          className="w-4 h-4 text-blue-600 bg-zinc-700 border-zinc-600 rounded focus:ring-blue-500 focus:ring-2"
                        />
                        <span className="text-xs text-zinc-300">Show popup notification</span>
                      </label>

                      {/* Play Sound */}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={categorySettings.playSound}
                          onChange={(e) =>
                            updateCategorySettings(category.id as any, {
                              playSound: e.target.checked,
                            })
                          }
                          className="w-4 h-4 text-blue-600 bg-zinc-700 border-zinc-600 rounded focus:ring-blue-500 focus:ring-2"
                        />
                        <span className="text-xs text-zinc-300">Play sound</span>
                      </label>

                      {/* Sound Selector */}
                      {categorySettings.playSound && (
                        <div className="space-y-1">
                          <label className="block text-xs text-zinc-500">Sound</label>
                          <select
                            value={categorySettings.sound}
                            onChange={(e) =>
                              updateCategorySettings(category.id as any, {
                                sound: e.target.value as NotificationSound,
                              })
                            }
                            className="w-full px-2 py-1.5 bg-[#252528] border border-zinc-700 rounded text-zinc-300 text-xs focus:outline-none focus:border-zinc-600"
                          >
                            {SOUND_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Priority Level */}
                      <div className="space-y-1">
                        <label className="block text-xs text-zinc-500">Priority Level</label>
                        <select
                          value={categorySettings.priority}
                          onChange={(e) =>
                            updateCategorySettings(category.id as any, {
                              priority: e.target.value as NotificationPriority,
                            })
                          }
                          className="w-full px-2 py-1.5 bg-[#252528] border border-zinc-700 rounded text-zinc-300 text-xs focus:outline-none focus:border-zinc-600"
                        >
                          {PRIORITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
