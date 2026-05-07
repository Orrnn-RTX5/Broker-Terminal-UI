/**
 * Alert Rules Manager Component
 * Create, edit, and manage alert rules
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config/api';

export type AlertRule = {
  id: string;
  name: string;
  enabled: boolean;
  condition: {
    type: 'price_above' | 'price_below' | 'pnl_above' | 'pnl_below' | 'margin_level_below';
    symbol?: string;
    threshold: number;
  };
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
};

export function AlertRulesManager() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  // Fetch rules from backend
  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('${API_ENDPOINTS.alertRules}');
      if (response.ok) {
        const data = await response.json();
        setRules(data || []);
      }
    } catch (error) {
      console.error('[AlertRules] Failed to fetch rules:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const createRule = async (rule: Omit<AlertRule, 'id'>) => {
    try {
      const response = await fetch('${API_ENDPOINTS.alertRules}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });

      if (response.ok) {
        await fetchRules();
        setShowCreateDialog(false);
      }
    } catch (error) {
      console.error('[AlertRules] Failed to create rule:', error);
    }
  };

  const updateRule = async (id: string, updates: Partial<AlertRule>) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.alertRules}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        await fetchRules();
        setEditingRule(null);
      }
    } catch (error) {
      console.error('[AlertRules] Failed to update rule:', error);
    }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this alert rule?')) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.alertRules}/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchRules();
      }
    } catch (error) {
      console.error('[AlertRules] Failed to delete rule:', error);
    }
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await updateRule(id, { enabled });
  };

  const testRule = async (id: string) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.alertRules}/${id}/test`, {
        method: 'POST',
      });

      if (response.ok) {
        alert('Test alert triggered! Check your alerts panel.');
      }
    } catch (error) {
      console.error('[AlertRules] Failed to test rule:', error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-lg border border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-200">Alert Rules</h3>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium transition-colors border border-emerald-500/20"
        >
          <Icon name="plus" size="sm" className="w-3.5 h-3.5" />
          New Rule
        </button>
      </div>

      {/* Rules List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? (
          <div className="text-center text-xs text-zinc-500 py-8">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-8">
            No alert rules configured. Click "New Rule" to create one.
          </div>
        ) : (
          rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={(enabled) => toggleRule(rule.id, enabled)}
              onEdit={() => setEditingRule(rule)}
              onDelete={() => deleteRule(rule.id)}
              onTest={() => testRule(rule.id)}
            />
          ))
        )}
      </div>

      {/* Create/Edit Dialog */}
      {(showCreateDialog || editingRule) && (
        <RuleDialog
          rule={editingRule || undefined}
          onSave={(rule) => {
            if (editingRule) {
              updateRule(editingRule.id, rule);
            } else {
              createRule(rule as Omit<AlertRule, 'id'>);
            }
          }}
          onCancel={() => {
            setShowCreateDialog(false);
            setEditingRule(null);
          }}
        />
      )}
    </div>
  );
}

function RuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
  onTest
}: {
  rule: AlertRule;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const severityColors = {
    LOW: 'text-blue-400 bg-zinc-700/20 border-zinc-600/20',
    MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  const conditionText = () => {
    const { type, symbol, threshold } = rule.condition;
    switch (type) {
      case 'price_above':
        return `${symbol} price above ${threshold}`;
      case 'price_below':
        return `${symbol} price below ${threshold}`;
      case 'pnl_above':
        return `P&L above ${threshold}`;
      case 'pnl_below':
        return `P&L below ${threshold}`;
      case 'margin_level_below':
        return `Margin level below ${threshold}%`;
      default:
        return 'Unknown condition';
    }
  };

  return (
    <div className={`p-3 rounded border ${rule.enabled ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-800 bg-zinc-900/50 opacity-60'}`}>
      <div className="flex items-start gap-2 mb-2">
        <button
          onClick={() => onToggle(!rule.enabled)}
          className={`mt-0.5 ${rule.enabled ? 'text-emerald-400' : 'text-zinc-600'}`}
        >
          <Icon name="play" size="sm" className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-zinc-200 mb-1">{rule.name}</h4>
          <p className="text-xs text-zinc-400 mb-2">{conditionText()}</p>
          <p className="text-xs text-zinc-500 italic">"{rule.message}"</p>
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${severityColors[rule.severity]} border`}>
          {rule.severity}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-800/50">
        <button
          onClick={onTest}
          className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition-colors"
          title="Test Rule"
        >
          <Icon name="play" size="sm" className="w-3 h-3" />
          Test
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition-colors"
          title="Edit Rule"
        >
          <Icon name="edit" size="sm" className="w-3 h-3" />
          Edit
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-xs transition-colors"
          title="Delete Rule"
        >
          <Icon name="trash" size="sm" className="w-3 h-3" />
          Delete
        </button>
      </div>
    </div>
  );
}

function RuleDialog({
  rule,
  onSave,
  onCancel
}: {
  rule?: AlertRule;
  onSave: (rule: Partial<AlertRule>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: rule?.name || '',
    enabled: rule?.enabled ?? true,
    conditionType: rule?.condition.type || 'price_above',
    symbol: rule?.condition.symbol || 'EURUSD',
    threshold: rule?.condition.threshold || 0,
    severity: rule?.severity || 'MEDIUM',
    message: rule?.message || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const ruleData: Partial<AlertRule> = {
      name: formData.name,
      enabled: formData.enabled,
      condition: {
        type: formData.conditionType as 'price_above' | 'price_below' | 'pnl_above' | 'pnl_below' | 'margin_level_below',
        symbol: formData.conditionType.includes('price') ? formData.symbol : undefined,
        threshold: formData.threshold,
      },
      severity: formData.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      message: formData.message,
    };

    onSave(ruleData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-200">
            {rule ? 'Edit Alert Rule' : 'Create Alert Rule'}
          </h3>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
            <Icon name="x-close" size="sm" className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Rule Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
              placeholder="e.g., EURUSD High Price Alert"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Condition Type</label>
            <select
              value={formData.conditionType}
              onChange={(e) => setFormData({ ...formData, conditionType: e.target.value as typeof formData.conditionType })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="price_above">Price Above</option>
              <option value="price_below">Price Below</option>
              <option value="pnl_above">P&L Above</option>
              <option value="pnl_below">P&L Below</option>
              <option value="margin_level_below">Margin Level Below</option>
            </select>
          </div>

          {formData.conditionType.includes('price') && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Symbol</label>
              <input
                type="text"
                value={formData.symbol}
                onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
                placeholder="e.g., EURUSD"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Threshold</label>
            <input
              type="number"
              step="0.00001"
              value={formData.threshold}
              onChange={(e) => setFormData({ ...formData, threshold: parseFloat(e.target.value) })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Severity</label>
            <select
              value={formData.severity}
              onChange={(e) => setFormData({ ...formData, severity: e.target.value as typeof formData.severity })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Alert Message</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 resize-none"
              rows={3}
              placeholder="Custom alert message..."
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={formData.enabled}
              onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
              className="rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
            />
            <label htmlFor="enabled" className="text-xs text-zinc-400">
              Enable rule immediately
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-sm font-medium transition-colors"
            >
              <Icon name="save" size="sm" className="w-4 h-4" />
              {rule ? 'Update' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
