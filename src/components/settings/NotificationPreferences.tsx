import { useUiTranslation } from '../../hooks/useUiTranslation';
import {
  useSettingsStore,
  type CategorySettings,
  type NotificationSound,
  type NotificationPriority,
  type HistoryRetention,
} from '../../store/useSettingsStore';
import { useNotificationStore } from '../../store/useNotificationStore';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconRegistry';
import { SettingsField, SettingsSection, SettingsToggle } from './OptionsControls';

type NotificationCategoryKey =
  | 'tradeExecution'
  | 'priceAlerts'
  | 'marginWarnings'
  | 'system'
  | 'news'
  | 'account';

interface NotificationCategory {
  id: NotificationCategoryKey;
  label: string;
  description: string;
  icon: IconName;
}

const CATEGORIES: NotificationCategory[] = [
  {
    id: 'tradeExecution',
    label: 'Trade Execution',
    description: 'Order fills and position updates.',
    icon: 'trending-up',
  },
  {
    id: 'priceAlerts',
    label: 'Price Alerts',
    description: 'Price targets from Alert Manager.',
    icon: 'bell',
  },
  {
    id: 'marginWarnings',
    label: 'Margin Warnings',
    description: 'Margin calls and approaching stop-outs.',
    icon: 'alert-triangle',
  },
  {
    id: 'system',
    label: 'System',
    description: 'Connection and maintenance updates.',
    icon: 'wifi',
  },
  {
    id: 'news',
    label: 'News',
    description: 'High-impact economic events.',
    icon: 'newspaper',
  },
  {
    id: 'account',
    label: 'Account',
    description: 'Deposits, withdrawals and balance changes.',
    icon: 'user',
  },
];

const SOUND_OPTIONS: { value: NotificationSound; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'chime', label: 'Chime' },
  { value: 'alert', label: 'Alert' },
  { value: 'silent', label: 'Silent' },
];

const PRIORITY_OPTIONS: { value: NotificationPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const HISTORY_RETENTION_OPTIONS: { value: HistoryRetention; label: string }[] = [
  { value: '1hr', label: '1 hour' },
  { value: '6hr', label: '6 hours' },
  { value: '24hr', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

export function NotificationPreferences() {
  const tr = useUiTranslation();
  const notifications = useSettingsStore((state) => state.notifications);
  const updateNotificationsSettings = useSettingsStore((state) => state.updateNotificationsSettings);
  const clearAll = useNotificationStore((state) => state.clearAll);

  const updateCategorySettings = (
    categoryKey: NotificationCategoryKey,
    settings: Partial<CategorySettings>
  ) => {
    updateNotificationsSettings({
      [categoryKey]: {
        ...notifications[categoryKey],
        ...settings,
      },
    });
  };

  const handleClearAll = () => {
    if (window.confirm(tr('Are you sure you want to clear all notifications?'))) {
      clearAll();
    }
  };

  return (
    <div className="options-stack">
      <SettingsSection
        title="Quiet hours"
        description="Choose when to pause non-critical notifications."
      >
        <SettingsToggle
          label="Do Not Disturb"
          description="Mute non-critical notifications until you turn this off."
          checked={notifications.doNotDisturb}
          onChange={(checked) => updateNotificationsSettings({ doNotDisturb: checked })}
        />
        <SettingsToggle
          label="DND Schedule"
          description="Pause notifications automatically during your chosen hours."
          checked={notifications.dndSchedule.enabled}
          onChange={(checked) =>
            updateNotificationsSettings({
              dndSchedule: { ...notifications.dndSchedule, enabled: checked },
            })
          }
        />
        {notifications.dndSchedule.enabled && (
          <div className="options-field-grid">
            <SettingsField label="From" htmlFor="options-dnd-from">
              <input
                id="options-dnd-from"
                type="time"
                value={notifications.dndSchedule.fromTime}
                onChange={(event) =>
                  updateNotificationsSettings({
                    dndSchedule: { ...notifications.dndSchedule, fromTime: event.target.value },
                  })
                }
                className="options-control"
              />
            </SettingsField>
            <SettingsField label="To" htmlFor="options-dnd-to">
              <input
                id="options-dnd-to"
                type="time"
                value={notifications.dndSchedule.toTime}
                onChange={(event) =>
                  updateNotificationsSettings({
                    dndSchedule: { ...notifications.dndSchedule, toTime: event.target.value },
                  })
                }
                className="options-control"
              />
            </SettingsField>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Delivery & history"
        description="Manage notification frequency and how long history is kept."
      >
        <div className="options-field-grid">
          <SettingsField
            label="Max Notifications Per Minute"
            htmlFor="options-notification-limit"
            hint="Choose between 1 and 20 notifications per minute."
          >
            <div className="options-range-field">
              <input
                id="options-notification-limit"
                type="range"
                min="1"
                max="20"
                value={notifications.maxNotificationsPerMinute}
                onChange={(event) =>
                  updateNotificationsSettings({
                    maxNotificationsPerMinute: parseInt(event.target.value, 10),
                  })
                }
                className="options-range"
              />
              <output htmlFor="options-notification-limit" className="options-range-value">
                {notifications.maxNotificationsPerMinute}
              </output>
            </div>
          </SettingsField>
          <SettingsField
            label="Notification History Retention"
            htmlFor="options-notification-retention"
            hint="Choose a retention period for notification history."
          >
            <select
              id="options-notification-retention"
              value={notifications.historyRetention}
              onChange={(event) =>
                updateNotificationsSettings({ historyRetention: event.target.value as HistoryRetention })
              }
              className="options-control"
            >
              {HISTORY_RETENTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {tr(option.label)}
                </option>
              ))}
            </select>
          </SettingsField>
        </div>
        <div className="options-setting-actions">
          <span>{tr('Remove all notifications from your history.')}</span>
          <button type="button" onClick={handleClearAll} className="options-button options-button--danger">
            <Icon name="trash" size="sm" />
            {tr('Clear All Notifications')}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Notification categories"
        description="Set delivery channels, sounds and priority for each type of update."
      >
        <div className="options-category-grid">
          {CATEGORIES.map((category) => {
            const categorySettings = notifications[category.id];

            if (!categorySettings || typeof categorySettings !== 'object') {
              return null;
            }

            return (
              <section
                key={category.id}
                className="options-category-card"
                aria-label={tr(category.label)}
              >
                <div className="options-category-heading">
                  <Icon name={category.icon} size="sm" />
                  <SettingsToggle
                    label={category.label}
                    description={category.description}
                    checked={categorySettings.enabled}
                    onChange={(checked) => updateCategorySettings(category.id, { enabled: checked })}
                  />
                </div>
                {categorySettings.enabled && (
                  <div className="options-category-controls">
                    <SettingsToggle
                      label="Show popup notification"
                      checked={categorySettings.showPopup}
                      onChange={(checked) => updateCategorySettings(category.id, { showPopup: checked })}
                    />
                    <SettingsToggle
                      label="Play sound"
                      checked={categorySettings.playSound}
                      onChange={(checked) => updateCategorySettings(category.id, { playSound: checked })}
                    />
                    <div className="options-field-grid">
                      {categorySettings.playSound && (
                        <SettingsField label="Sound" htmlFor={`options-${category.id}-sound`}>
                          <select
                            id={`options-${category.id}-sound`}
                            value={categorySettings.sound}
                            onChange={(event) =>
                              updateCategorySettings(category.id, { sound: event.target.value as NotificationSound })
                            }
                            className="options-control"
                          >
                            {SOUND_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {tr(option.label)}
                              </option>
                            ))}
                          </select>
                        </SettingsField>
                      )}
                      <SettingsField label="Priority Level" htmlFor={`options-${category.id}-priority`}>
                        <select
                          id={`options-${category.id}-priority`}
                          value={categorySettings.priority}
                          onChange={(event) =>
                            updateCategorySettings(category.id, { priority: event.target.value as NotificationPriority })
                          }
                          className="options-control"
                        >
                          {PRIORITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {tr(option.label)}
                            </option>
                          ))}
                        </select>
                      </SettingsField>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </SettingsSection>
    </div>
  );
}
