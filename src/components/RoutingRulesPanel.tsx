/**
 * Routing Rules Management Panel
 * Allows admins to manage order routing rules with filters and priorities
 * Features: CRUD operations, drag-and-drop reordering, filter builder
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
import { API_ENDPOINTS, buildApiUrl } from '../config/api';
import { GripVertical } from 'lucide-react';

// Type definitions for routing rules
type RoutingAction = 'A-Book' | 'B-Book' | 'Partial' | 'Reject';

type FilterCondition = {
  id: string;
  type: 'accountId' | 'userGroup' | 'symbol' | 'volumeRange';
  operator?: 'equals' | 'contains' | 'in' | 'between';
  value?: string | number | number[];
};

type RoutingRule = {
  id: string;
  priority: number;
  name: string;
  filters: FilterCondition[];
  action: RoutingAction;
  targetLP: string;
  hedgePercentage: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export const RoutingRulesPanel = () => {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [liquidityProviders, setLiquidityProviders] = useState<string[]>([]);

  // Fetch data on mount
  useEffect(() => {
    fetchRules();
    fetchLiquidityProviders();
  }, []);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.admin.routingRules);
      if (response.ok) {
        const data = await response.json();
        setRules(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to fetch routing rules:', error);
      showMessage('error', 'Failed to load routing rules');
    } finally {
      setLoading(false);
    }
  };

  const fetchLiquidityProviders = async () => {
    try {
      const response = await fetch(buildApiUrl('/api/routing/liquidity-providers'));
      if (response.ok) {
        const data = await response.json();
        setLiquidityProviders(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to fetch LPs:', error);
    }
  };

  const saveRule = async (rule: RoutingRule) => {
    try {
      const method = rule.id ? 'PUT' : 'POST';
      const endpoint = rule.id
        ? `${API_ENDPOINTS.admin.routingRules}/${rule.id}`
        : API_ENDPOINTS.admin.routingRules;

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });

      if (response.ok) {
        showMessage('success', `Rule ${rule.id ? 'updated' : 'created'} successfully`);
        await fetchRules();
        setIsFormOpen(false);
        setEditingRule(null);
      } else {
        const error = await response.text();
        showMessage('error', `Failed to save: ${error}`);
      }
    } catch (error) {
      showMessage('error', 'Failed to save rule');
    }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.admin.routingRules}/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        showMessage('success', 'Rule deleted successfully');
        await fetchRules();
      } else {
        showMessage('error', 'Failed to delete rule');
      }
    } catch (error) {
      showMessage('error', 'Failed to delete rule');
    }
  };

  const reorderRules = async (reorderedRules: RoutingRule[]) => {
    try {
      const response = await fetch(buildApiUrl('/api/routing/rules/reorder'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: reorderedRules.map((r, idx) => ({ id: r.id, priority: idx })),
        }),
      });

      if (response.ok) {
        setRules(reorderedRules);
      }
    } catch (error) {
      console.error('Failed to reorder rules:', error);
    }
  };

  const handleDragStart = (id: string) => {
    setDraggedItem(id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (targetId: string) => {
    if (!draggedItem || draggedItem === targetId) return;

    const draggedIdx = rules.findIndex((r) => r.id === draggedItem);
    const targetIdx = rules.findIndex((r) => r.id === targetId);

    const newRules = [...rules];
    [newRules[draggedIdx], newRules[targetIdx]] = [newRules[targetIdx], newRules[draggedIdx]];

    reorderRules(newRules);
    setDraggedItem(null);
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div>
          <h2 className="text-lg font-semibold text-white">Routing Rules</h2>
          <p className="text-xs text-zinc-500">Manage order routing logic and priorities</p>
        </div>
        <button
          onClick={() => {
            setEditingRule(null);
            setIsFormOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded font-medium transition-colors"
        >
          <Icon name="plus" size="sm" className="w-4 h-4" />
          New Rule
        </button>
      </div>

      {/* Message Toast */}
      {message && (
        <div
          className={`mx-4 mt-4 p-3 rounded border flex items-center gap-2 ${message.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
        >
          {message.type === 'success' ? (
            <Icon name="check-circle" size="sm" className="w-4 h-4" />
          ) : (
            <Icon name="error" size="sm" className="w-4 h-4" />
          )}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      {/* Form */}
      {isFormOpen && (
        <RuleForm
          rule={editingRule}
          liquidityProviders={liquidityProviders}
          onSave={saveRule}
          onCancel={() => {
            setIsFormOpen(false);
            setEditingRule(null);
          }}
        />
      )}

      {/* Rules List */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <Icon name="refresh" size="sm" className="w-6 h-6 animate-spin mr-2" />
            Loading rules...
          </div>
        ) : sortedRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Icon name="error" size="sm" className="w-12 h-12 mb-2 text-zinc-700" />
            <p>No routing rules configured</p>
            <p className="text-xs text-zinc-600 mt-1">Create a new rule to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onEdit={() => {
                  setEditingRule(rule);
                  setIsFormOpen(true);
                }}
                onDelete={() => deleteRule(rule.id)}
                onDragStart={() => handleDragStart(rule.id)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(rule.id)}
                isDragging={draggedItem === rule.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Individual Rule Row Component
const RuleRow = ({
  rule,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
}: {
  rule: RoutingRule;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragging: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`p-3 rounded-lg border transition-all ${isDragging
          ? 'bg-emerald-500/10 border-emerald-500/30 opacity-50'
          : 'bg-zinc-800/50 border-zinc-700 hover:bg-zinc-800'
        }`}
    >
      <div className="flex items-center gap-3">
        {/* Drag Handle */}
        <button
          onMouseDown={onDragStart}
          className="p-1 text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Priority Badge */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-semibold">
            {rule.priority + 1}
          </div>
        </div>

        {/* Rule Info */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-white">{rule.name}</h3>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${rule.enabled
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-zinc-700 text-zinc-400'
                }`}
            >
              {rule.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-zinc-400">
            <span>Action: {rule.action}</span>
            <span>Target LP: {rule.targetLP}</span>
            <span>Hedge: {rule.hedgePercentage}%</span>
            <span>{rule.filters.length} filter(s)</span>
          </div>
        </div>

        {/* Expand Button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 text-zinc-600 hover:text-zinc-400"
        >
          <Icon name="chevron-down" size="sm"
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Action Buttons */}
        <button
          onClick={onEdit}
          className="p-1 text-zinc-600 hover:text-emerald-400 transition-colors"
          title="Edit rule"
        >
          <Icon name="edit" size="sm" className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
          title="Delete rule"
        >
          <Icon name="trash" size="sm" className="w-4 h-4" />
        </button>
      </div>

      {/* Expanded Filters View */}
      {expanded && rule.filters.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-700 space-y-2">
          <p className="text-xs text-zinc-500 font-medium">Filters:</p>
          {rule.filters.map((filter, idx) => (
            <div key={idx} className="text-xs text-zinc-400 ml-8">
              <span className="text-zinc-500">{filter.type}:</span>
              {filter.type === 'volumeRange' && Array.isArray(filter.value)
                ? ` ${filter.value[0]} - ${filter.value[1]}`
                : ` ${filter.value || 'any'}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Rule Form Component
const RuleForm = ({
  rule,
  liquidityProviders,
  onSave,
  onCancel,
}: {
  rule: RoutingRule | null;
  liquidityProviders: string[];
  onSave: (rule: RoutingRule) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState<Partial<RoutingRule>>(
    rule || {
      id: Math.random().toString(36).substr(2, 9),
      priority: 0,
      name: '',
      filters: [],
      action: 'A-Book' as RoutingAction,
      targetLP: '',
      hedgePercentage: 0,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  );
  const [filterType, setFilterType] = useState<FilterCondition['type']>('accountId');
  const [filterValue, setFilterValue] = useState('');

  const addFilter = () => {
    if (!filterValue.trim()) return;

    const newFilter: FilterCondition = {
      id: Math.random().toString(36).substr(2, 9),
      type: filterType,
      operator: filterType === 'volumeRange' ? 'between' : 'equals',
      value: filterType === 'volumeRange' ? [0, 1000000] : filterValue,
    };

    setFormData({
      ...formData,
      filters: [...(formData.filters || []), newFilter],
    });
    setFilterValue('');
  };

  const removeFilter = (id: string) => {
    setFormData({
      ...formData,
      filters: formData.filters?.filter((f) => f.id !== id) || [],
    });
  };

  const handleSubmit = () => {
    if (!formData.name?.trim() || !formData.targetLP) {
      alert('Please fill in all required fields');
      return;
    }

    onSave({
      id: formData.id || Math.random().toString(36).substr(2, 9),
      priority: formData.priority || 0,
      name: formData.name,
      filters: formData.filters || [],
      action: formData.action || 'A-Book',
      targetLP: formData.targetLP,
      hedgePercentage: formData.hedgePercentage || 0,
      enabled: formData.enabled !== false,
      createdAt: formData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="border-b border-zinc-800 p-4 bg-zinc-800/30 space-y-4">
      <h3 className="font-semibold text-white">
        {rule ? 'Edit Rule' : 'Create New Rule'}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Rule Name */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400 font-medium">Rule Name</label>
          <input
            type="text"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., High Volume EURUSD"
            className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Target LP */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400 font-medium">Target Liquidity Provider</label>
          <select
            value={formData.targetLP || ''}
            onChange={(e) => setFormData({ ...formData, targetLP: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="">Select LP...</option>
            {liquidityProviders.map((lp) => (
              <option key={lp} value={lp}>
                {lp}
              </option>
            ))}
          </select>
        </div>

        {/* Action */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400 font-medium">Action</label>
          <select
            value={formData.action || 'A-Book'}
            onChange={(e) => setFormData({ ...formData, action: e.target.value as RoutingAction })}
            className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="A-Book">A-Book (STP)</option>
            <option value="B-Book">B-Book (Market Maker)</option>
            <option value="Partial">Partial (Hybrid)</option>
            <option value="Reject">Reject</option>
          </select>
        </div>

        {/* Hedge Percentage */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400 font-medium">Hedge %</label>
          <input
            type="number"
            min="0"
            max="100"
            step="5"
            value={formData.hedgePercentage || 0}
            onChange={(e) =>
              setFormData({ ...formData, hedgePercentage: parseFloat(e.target.value) || 0 })
            }
            className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Priority Slider */}
      <div className="space-y-2">
        <label className="text-xs text-zinc-400 font-medium">
          Priority: {formData.priority || 0}
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={formData.priority || 0}
          onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
          className="w-full"
        />
      </div>

      {/* Filters Builder */}
      <div className="space-y-2">
        <label className="text-xs text-zinc-400 font-medium">Filters</label>
        <div className="flex gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FilterCondition['type'])}
            className="px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="accountId">Account ID</option>
            <option value="userGroup">User Group</option>
            <option value="symbol">Symbol</option>
            <option value="volumeRange">Volume Range</option>
          </select>
          <input
            type="text"
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            placeholder="Filter value..."
            className="flex-1 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={addFilter}
            className="px-3 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-sm font-medium hover:bg-emerald-500/30"
          >
            Add
          </button>
        </div>

        {/* Active Filters */}
        {formData.filters && formData.filters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {formData.filters.map((filter) => (
              <div
                key={filter.id}
                className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-400"
              >
                <span>
                  {filter.type}: {filter.value}
                </span>
                <button
                  onClick={() => removeFilter(filter.id)}
                  className="text-emerald-400 hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Enable Toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="enabled"
          checked={formData.enabled !== false}
          onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
          className="w-4 h-4 rounded"
        />
        <label htmlFor="enabled" className="text-xs text-zinc-400">
          Enable this rule
        </label>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-zinc-700 text-white rounded text-sm font-medium hover:bg-zinc-600"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          className="px-4 py-2 bg-emerald-500 text-black rounded text-sm font-medium hover:bg-emerald-600"
        >
          {rule ? 'Update Rule' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
};
