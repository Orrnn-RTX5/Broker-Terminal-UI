/**
 * Alerts & Notifications Panel
 * Price alerts, trade notifications, and system messages
 */

import { Icon } from '../ui/Icon';
import { useState, useCallback, useMemo } from 'react';
import type { Alert, AlertType, AlertPriority, PriceAlert, Notification } from '../../types/trading';

export const AlertsPanel = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showCreateAlert, setShowCreateAlert] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'TRIGGERED'>('ALL');

  const filteredAlerts = useMemo(() => {
    if (filter === 'ALL') return alerts;
    return alerts.filter((alert) => alert.status === filter);
  }, [alerts, filter]);

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp'>) => {
    const newNotif: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
    };

    setNotifications((prev) => [newNotif, ...prev].slice(0, 50));

    // Auto-remove after duration
    if (notification.duration) {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== newNotif.id));
      }, notification.duration);
    }
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <Icon name="bell" size="sm" className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
            Alerts & Notifications
          </h3>
          {alerts.filter((a) => a.status === 'ACTIVE').length > 0 && (
            <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-medium rounded">
              {alerts.filter((a) => a.status === 'ACTIVE').length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreateAlert(true)}
          className="p-1.5 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-zinc-200"
          title="Create Alert"
        >
          <Icon name="plus" size="sm" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setFilter('ALL')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            filter === 'ALL'
              ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          All ({alerts.length})
        </button>
        <button
          onClick={() => setFilter('ACTIVE')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            filter === 'ACTIVE'
              ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          Active ({alerts.filter((a) => a.status === 'ACTIVE').length})
        </button>
        <button
          onClick={() => setFilter('TRIGGERED')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            filter === 'TRIGGERED'
              ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/5'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          History ({alerts.filter((a) => a.status === 'TRIGGERED').length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Notifications Section */}
        {notifications.length > 0 && (
          <div className="border-b border-zinc-800">
            <div className="px-3 py-2 bg-zinc-900/30">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                Recent Notifications
              </div>
            </div>
            <div className="divide-y divide-zinc-800">
              {notifications.slice(0, 5).map((notif) => (
                <NotificationItem
                  key={notif.id}
                  notification={notif}
                  onRemove={() => removeNotification(notif.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Alerts Section */}
        <div>
          {filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
              <Icon name="bell" size="sm" className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">No alerts</p>
              <button
                onClick={() => setShowCreateAlert(true)}
                className="mt-3 px-3 py-1.5 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded font-medium transition-colors"
              >
                Create Alert
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {filteredAlerts.map((alert) => (
                <AlertItem key={alert.id} alert={alert} onRemove={() => removeAlert(alert.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Alert Modal */}
      {showCreateAlert && (
        <CreateAlertModal onClose={() => setShowCreateAlert(false)} onCreate={(alert) => {
          setAlerts((prev) => [alert, ...prev]);
          setShowCreateAlert(false);
        }} />
      )}
    </div>
  );
};

// Notification Item Component
const NotificationItem = ({
  notification,
  onRemove,
}: {
  notification: Notification;
  onRemove: () => void;
}) => {
  const icons = {
    SUCCESS: <Icon name="check-circle" size="sm" className="w-4 h-4 text-emerald-400" />,
    ERROR: <Icon name="alert-triangle" size="sm" className="w-4 h-4 text-red-400" />,
    WARNING: <Icon name="alert-triangle" size="sm" className="w-4 h-4 text-yellow-400" />,
    INFO: <Icon name="info" size="sm" className="w-4 h-4 text-blue-400" />,
  };

  const colors = {
    SUCCESS: 'border-emerald-500/20 bg-emerald-500/5',
    ERROR: 'border-red-500/20 bg-red-500/5',
    WARNING: 'border-yellow-500/20 bg-yellow-500/5',
    INFO: 'border-zinc-600/20 bg-zinc-800/30',
  };

  return (
    <div className={`px-3 py-2 border-l-2 ${colors[notification.type]} group`}>
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">{icons[notification.type]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-medium text-white">{notification.title}</div>
            <button
              onClick={onRemove}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-800 rounded transition-all"
            >
              <Icon name="x-close" size="xs" className="text-zinc-500" />
            </button>
          </div>
          <p className="text-[10px] text-zinc-400 mt-0.5">{notification.message}</p>
          <div className="flex items-center gap-2 mt-1">
            <Icon name="clock" size="xs" className="text-zinc-600" />
            <span className="text-[10px] text-zinc-600">
              {new Date(notification.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Alert Item Component
const AlertItem = ({ alert, onRemove }: { alert: Alert; onRemove: () => void }) => {
  const isPriceAlert = alert.type === 'PRICE';
  const priceAlert = isPriceAlert ? (alert as PriceAlert) : null;

  const statusColors = {
    ACTIVE: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    TRIGGERED: 'text-blue-400 bg-zinc-700/20 border-zinc-600/20',
    EXPIRED: 'text-zinc-500 bg-zinc-800/10 border-zinc-700/20',
    CANCELLED: 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  const priorityIcons = {
    LOW: <Icon name="info" size="xs" className="text-zinc-500" />,
    MEDIUM: <Icon name="bell" size="xs" className="text-blue-400" />,
    HIGH: <Icon name="alert-triangle" size="xs" className="text-yellow-400" />,
    CRITICAL: <Icon name="alert-triangle" size="xs" className="text-red-400" />,
  };

  return (
    <div className="px-3 py-2 hover:bg-zinc-800/50 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1">
          <div className="mt-0.5">{priorityIcons[alert.priority]}</div>
          <div className="flex-1 min-w-0">
            {priceAlert ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-white">{priceAlert.symbol}</span>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${
                      statusColors[priceAlert.status]
                    }`}
                  >
                    {priceAlert.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {priceAlert.condition === 'ABOVE' || priceAlert.condition === 'CROSSES_UP' ? (
                    <Icon name="trending-up" size="xs" className="text-emerald-400" />
                  ) : (
                    <Icon name="trending-down" size="xs" className="text-red-400" />
                  )}
                  <span>
                    {priceAlert.condition.replace('_', ' ')} {priceAlert.targetPrice.toFixed(5)}
                  </span>
                </div>
                {priceAlert.currentPrice && (
                  <div className="text-[10px] text-zinc-600 mt-1">
                    Current: {priceAlert.currentPrice.toFixed(5)}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-white mb-0.5">{alert.title}</div>
                <div className="text-xs text-zinc-400">{alert.message}</div>
              </>
            )}
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-600">
              <Icon name="clock" size="xs" />
              <span>{new Date(alert.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-800 rounded transition-all"
        >
          <Icon name="x-close" size="sm" className="text-zinc-500" />
        </button>
      </div>
    </div>
  );
};

// Create Alert Modal Component
const CreateAlertModal = ({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (alert: Alert) => void;
}) => {
  const [symbol, setSymbol] = useState('');
  const [condition, setCondition] = useState<PriceAlert['condition']>('ABOVE');
  const [targetPrice, setTargetPrice] = useState('');
  const [priority, setPriority] = useState<AlertPriority>('MEDIUM');

  const handleCreate = () => {
    if (!symbol || !targetPrice) return;

    const alert: PriceAlert = {
      id: `alert-${Date.now()}`,
      symbol,
      type: 'PRICE',
      condition,
      targetPrice: parseFloat(targetPrice),
      status: 'ACTIVE',
      priority,
      createdAt: new Date().toISOString(),
    };

    onCreate(alert);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-96 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Create Price Alert</h3>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded transition-colors">
            <Icon name="x-close" size="lg" className="text-zinc-500" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="EURUSD"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as PriceAlert['condition'])}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="ABOVE">Price Above</option>
              <option value="BELOW">Price Below</option>
              <option value="CROSSES_UP">Crosses Up</option>
              <option value="CROSSES_DOWN">Crosses Down</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Target Price</label>
            <input
              type="number"
              step="0.00001"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="1.08500"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as AlertPriority)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={handleCreate}
            disabled={!symbol || !targetPrice}
            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Alert
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
