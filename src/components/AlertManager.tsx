/**
 * Alert Manager Component
 * Manage price alerts with table view and creation modal
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo, useEffect } from 'react';
import {
  useAlertStore,
  formatCondition,
  formatExpiration,
  type Alert,
  type AlertCondition,
  type NotifyMethod,
} from '../store/useAlertStore';

type SortColumn = 'symbol' | 'condition' | 'price' | 'status' | 'createdAt';
type SortDirection = 'asc' | 'desc';

export const AlertManager: React.FC = () => {
  const { alerts, removeAlert, toggleAlert } = useAlertStore();
  const [showNewAlertModal, setShowNewAlertModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState<Alert | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Count active alerts
  const activeCount = alerts.filter((a) => a.status === 'active' && a.enabled).length;

  // Sort alerts
  const sortedAlerts = useMemo(() => {
    const sorted = [...alerts].sort((a, b) => {
      let aVal: any = a[sortColumn];
      let bVal: any = b[sortColumn];

      if (sortColumn === 'condition') {
        aVal = formatCondition(a.condition);
        bVal = formatCondition(b.condition);
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [alerts, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleEdit = (alert: Alert) => {
    setEditingAlert(alert);
    setShowNewAlertModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this alert?')) {
      removeAlert(id);
    }
  };

  const handleCloseModal = () => {
    setShowNewAlertModal(false);
    setEditingAlert(null);
  };

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-[#252525]">
        <div className="flex items-center gap-2">
          <Icon name="bell" size="sm" className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-bold text-zinc-200">Alerts</h3>
          {activeCount > 0 && (
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full border border-emerald-500/30">
              {activeCount} Active
            </span>
          )}
        </div>
        <button
          onClick={() => setShowNewAlertModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium rounded transition-colors"
        >
          <Icon name="plus" size="sm" className="w-3.5 h-3.5" />
          New Alert
        </button>
      </div>

      {/* Alerts Table */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600">
            <Icon name="bell" size="sm" className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No alerts created yet</p>
            <p className="text-xs mt-1">Click "New Alert" to create your first price alert</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#252525] border-b border-zinc-800 z-10">
              <tr>
                <TableHeader label="Symbol" column="symbol" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                <TableHeader label="Condition" column="condition" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                <TableHeader label="Price" column="price" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                <TableHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                <TableHeader label="Created" column="createdAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                <th className="text-left py-2 px-3 text-zinc-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedAlerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onEdit={() => handleEdit(alert)}
                  onDelete={() => handleDelete(alert.id)}
                  onToggle={() => toggleAlert(alert.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New/Edit Alert Modal */}
      {showNewAlertModal && (
        <NewAlertModal
          onClose={handleCloseModal}
          editingAlert={editingAlert}
        />
      )}
    </div>
  );
};

/**
 * Table Header Component
 */
interface TableHeaderProps {
  label: string;
  column: SortColumn;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
}

const TableHeader: React.FC<TableHeaderProps> = ({ label, column, sortColumn, sortDirection, onSort }) => {
  const isActive = sortColumn === column;

  return (
    <th
      className="text-left py-2 px-3 text-zinc-500 font-medium cursor-pointer hover:text-zinc-300 transition-colors select-none"
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive && (
          sortDirection === 'asc' ? <Icon name="chevron-up" size="sm" className="w-3 h-3" /> : <Icon name="chevron-down" size="sm" className="w-3 h-3" />
        )}
      </div>
    </th>
  );
};

/**
 * Alert Row Component
 */
interface AlertRowProps {
  alert: Alert;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

const AlertRow: React.FC<AlertRowProps> = ({ alert, onEdit, onDelete, onToggle }) => {
  const statusConfig = {
    active: { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', label: 'Active' },
    triggered: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'Triggered' },
    expired: { color: 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30', label: 'Expired' },
    disabled: { color: 'bg-zinc-700/20 text-zinc-600 border-zinc-700/30', label: 'Disabled' },
  };

  const status = statusConfig[alert.status];
  const createdDate = new Date(alert.createdAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
      <td className="py-2 px-3">
        <span className="font-bold text-zinc-200">{alert.symbol}</span>
      </td>
      <td className="py-2 px-3 text-zinc-400">{formatCondition(alert.condition)}</td>
      <td className="py-2 px-3">
        <span className="font-mono font-bold text-zinc-200">{alert.price.toFixed(5)}</span>
      </td>
      <td className="py-2 px-3">
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${status.color}`}>
          {status.label}
        </span>
      </td>
      <td className="py-2 px-3 text-zinc-500">{createdDate}</td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            className="p-1 hover:bg-zinc-700 rounded transition-colors"
            title={alert.enabled ? 'Disable' : 'Enable'}
          >
            {alert.enabled ? (
              <Icon name="bell" size="sm" className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Icon name="bell" size="sm" className="w-3.5 h-3.5 text-zinc-600" />
            )}
          </button>
          <button
            onClick={onEdit}
            className="p-1 hover:bg-zinc-700 rounded transition-colors"
            title="Edit"
          >
            <Icon name="edit" size="sm" className="w-3.5 h-3.5 text-blue-400" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 hover:bg-zinc-700 rounded transition-colors"
            title="Delete"
          >
            <Icon name="trash" size="sm" className="w-3.5 h-3.5 text-rose-400" />
          </button>
        </div>
      </td>
    </tr>
  );
};

/**
 * New Alert Modal Component
 */
interface NewAlertModalProps {
  onClose: () => void;
  editingAlert?: Alert | null;
}

const NewAlertModal: React.FC<NewAlertModalProps> = ({ onClose, editingAlert }) => {
  const { addAlert, updateAlert } = useAlertStore();
  const [symbol, setSymbol] = useState(editingAlert?.symbol || '');
  const [condition, setCondition] = useState<AlertCondition>(editingAlert?.condition || 'price_above');
  const [price, setPrice] = useState(editingAlert?.price.toString() || '');
  const [expiration, setExpiration] = useState<string>('none');
  const [notifyMethod, setNotifyMethod] = useState<NotifyMethod>(editingAlert?.notifyMethod || 'both');
  const [message, setMessage] = useState(editingAlert?.message || '');
  const [error, setError] = useState('');

  // Available symbols - fetched from API
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);

  // Fetch available symbols on mount
  useEffect(() => {
    const fetchSymbols = async () => {
      setIsLoadingSymbols(true);
      try {
        // Placeholder: Replace with actual API call
        // const response = await fetch(API_ENDPOINTS.market.symbols);
        // if (response.ok) {
        //   const data = await response.json();
        //   setAvailableSymbols(data.symbols || []);
        // }

        // Empty until API is implemented
        setAvailableSymbols([]);
      } catch (error) {
        console.error('[AlertManager] Failed to fetch symbols:', error);
        setAvailableSymbols([]);
      } finally {
        setIsLoadingSymbols(false);
      }
    };

    fetchSymbols();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!symbol) {
      setError('Please select a symbol');
      return;
    }

    if (!price || isNaN(parseFloat(price))) {
      setError('Please enter a valid price');
      return;
    }

    // Calculate expiration timestamp
    let expirationTime: number | null = null;
    const now = Date.now();
    switch (expiration) {
      case '1h':
        expirationTime = now + 60 * 60 * 1000;
        break;
      case '4h':
        expirationTime = now + 4 * 60 * 60 * 1000;
        break;
      case '1d':
        expirationTime = now + 24 * 60 * 60 * 1000;
        break;
      case '1w':
        expirationTime = now + 7 * 24 * 60 * 60 * 1000;
        break;
    }

    if (editingAlert) {
      // Update existing alert
      updateAlert(editingAlert.id, {
        symbol,
        condition,
        price: parseFloat(price),
        expiration: expirationTime,
        notifyMethod,
        message: message || undefined,
      });
    } else {
      // Create new alert
      addAlert({
        symbol,
        condition,
        price: parseFloat(price),
        expiration: expirationTime,
        notifyMethod,
        message: message || undefined,
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="bg-[#131316] border border-zinc-800 rounded-lg shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-[#252525] sticky top-0 z-10">
          <h3 className="text-lg font-bold text-zinc-200">
            {editingAlert ? 'Edit Alert' : 'New Price Alert'}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <Icon name="x-close" size="sm" className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Symbol */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Symbol *</label>
            {isLoadingSymbols ? (
              <div className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-500">
                Loading symbols...
              </div>
            ) : availableSymbols.length === 0 ? (
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="Enter symbol (e.g., EURUSD)"
                required
                className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
              />
            ) : (
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                required
                className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
              >
                <option value="">Select symbol...</option>
                {availableSymbols.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Condition */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Condition *</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as AlertCondition)}
              required
              className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              <option value="price_above">Price Above</option>
              <option value="price_below">Price Below</option>
              <option value="bid_above">Bid Above</option>
              <option value="bid_below">Bid Below</option>
              <option value="ask_above">Ask Above</option>
              <option value="ask_below">Ask Below</option>
            </select>
          </div>

          {/* Price */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Price *</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00000"
              step="0.00001"
              required
              className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 font-mono focus:outline-none focus:border-zinc-600"
            />
          </div>

          {/* Expiration */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Expiration</label>
            <select
              value={expiration}
              onChange={(e) => setExpiration(e.target.value)}
              className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              <option value="none">Never</option>
              <option value="1h">1 Hour</option>
              <option value="4h">4 Hours</option>
              <option value="1d">1 Day</option>
              <option value="1w">1 Week</option>
            </select>
          </div>

          {/* Notification Method */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Notification Method</label>
            <div className="flex gap-2">
              <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-[#252525] border border-zinc-700 rounded cursor-pointer hover:bg-zinc-800 transition-colors">
                <input
                  type="radio"
                  name="notifyMethod"
                  value="sound"
                  checked={notifyMethod === 'sound'}
                  onChange={(e) => setNotifyMethod(e.target.value as NotifyMethod)}
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">Sound</span>
              </label>
              <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-[#252525] border border-zinc-700 rounded cursor-pointer hover:bg-zinc-800 transition-colors">
                <input
                  type="radio"
                  name="notifyMethod"
                  value="push"
                  checked={notifyMethod === 'push'}
                  onChange={(e) => setNotifyMethod(e.target.value as NotifyMethod)}
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">Push</span>
              </label>
              <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-[#252525] border border-zinc-700 rounded cursor-pointer hover:bg-zinc-800 transition-colors">
                <input
                  type="radio"
                  name="notifyMethod"
                  value="both"
                  checked={notifyMethod === 'both'}
                  onChange={(e) => setNotifyMethod(e.target.value as NotifyMethod)}
                  className="text-blue-500"
                />
                <span className="text-sm text-zinc-300">Both</span>
              </label>
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Custom Message (Optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter custom alert message..."
              rows={3}
              className="w-full px-3 py-2 bg-[#252525] border border-zinc-700 rounded text-sm text-zinc-300 resize-none focus:outline-none focus:border-zinc-600"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-400">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded transition-colors"
          >
            {editingAlert ? 'Update Alert' : 'Create Alert'}
          </button>
        </form>
      </div>
    </div>
  );
};
