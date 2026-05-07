/**
 * MT5 Mode Toggle
 * Simple toggle to switch between B-Book (internal) and MT5 (real) execution
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
import { useMT5Store } from '../store/useMT5Store';

export function MT5Toggle() {
  const { connected, status, fetchStatus, autoRefresh, startAutoRefresh, stopAutoRefresh, error } = useMT5Store();
  const [mt5Enabled, setMT5Enabled] = useState(() => {
    return localStorage.getItem('rtx5_mt5_mode') === 'true';
  });

  // Check MT5 status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Start/stop auto-refresh based on MT5 mode
  useEffect(() => {
    if (mt5Enabled && connected) {
      const login = parseInt(localStorage.getItem('rtx5_mt5_login') || '900690', 10);
      startAutoRefresh(login);
    } else {
      stopAutoRefresh();
    }
  }, [mt5Enabled, connected, startAutoRefresh, stopAutoRefresh]);

  const handleToggle = () => {
    const newValue = !mt5Enabled;
    setMT5Enabled(newValue);
    localStorage.setItem('rtx5_mt5_mode', String(newValue));

    if (newValue && !connected) {
      fetchStatus();
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-md border border-zinc-700">
      {/* Status Indicator */}
      <div className="flex items-center gap-1.5">
        <div
          className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
          }`}
          title={connected ? 'MT5 Connected' : 'MT5 Disconnected'}
        />
        <Icon name="activity" size="sm" className="text-zinc-400" />
      </div>

      {/* Toggle */}
      <button
        onClick={handleToggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          mt5Enabled ? 'bg-zinc-700' : 'bg-zinc-700'
        }`}
        title={mt5Enabled ? 'Using MT5 (Real)' : 'Using B-Book (Internal)'}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            mt5Enabled ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>

      {/* Label */}
      <span className="text-xs font-medium text-zinc-300">
        {mt5Enabled ? 'MT5' : 'B-Book'}
      </span>

      {/* Error indicator */}
      {mt5Enabled && !connected && (
        <span title={error || 'MT5 not connected'}>
          <Icon name="error" size="sm"
            className="text-yellow-500"
          />
        </span>
      )}

      {/* Auto-refresh indicator */}
      {mt5Enabled && connected && autoRefresh && (
        <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse" title="Auto-refreshing" />
      )}
    </div>
  );
}
