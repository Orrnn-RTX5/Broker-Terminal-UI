/**
 * Admin Panel Component
 * Controls for routing mode, symbol management, LP configuration
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
import { RoutingRulesPanel } from './RoutingRulesPanel';
import { API_ENDPOINTS, buildAdminUrl } from '../config/api';
import { Settings, Server, TrendingUp, GitMerge } from 'lucide-react';

type ExecutionMode = 'ABOOK' | 'BBOOK';

type BrokerConfig = {
  brokerName: string;
  brokerDisplayName: string;
  priceFeedLP: string;
  priceFeedName: string;
  executionMode: ExecutionMode;
  defaultLeverage: number;
  defaultBalance: number;
  marginMode: string;
  maxTicksPerSymbol: number;
  disabledSymbols?: Record<string, boolean>;
};

type LiquidityProvider = {
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR';
  latency: number;
  uptime: number;
  symbols: string[];
};

type SymbolConfig = {
  symbol: string;
  enabled: boolean;
  routingMode: string;
  spread: number;
  commission: number;
  leverage: number;
  minVolume: number;
  maxVolume: number;
};

export const AdminPanel = () => {
  const [config, setConfig] = useState<BrokerConfig | null>(null);
  const [liquidityProviders, setLiquidityProviders] = useState<LiquidityProvider[]>([]);
  const [symbols, setSymbols] = useState<SymbolConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<'config' | 'lp' | 'symbols' | 'routing'>('config');

  // Fetch current configuration
  useEffect(() => {
    fetchConfig();
    fetchLiquidityProviders();
    fetchSymbols();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.admin.config);
      if (!response.ok) {
        if (response.status === 404) {
          showMessage('error', 'Config endpoint not found (404)');
        } else {
          showMessage('error', `Failed to load configuration: ${response.status}`);
        }
      } else {
        const data = await response.json();
        setConfig(data);
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
      showMessage('error', 'Failed to load configuration - server unreachable');
    } finally {
      setLoading(false);
    }
  };

  const fetchLiquidityProviders = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.admin.lp);
      if (!response.ok) {
        console.error('Failed to fetch LPs:', response.status);
      } else {
        const data = await response.json();
        setLiquidityProviders(data || []);
      }
    } catch (error) {
      console.error('Failed to fetch LPs:', error);
    }
  };

  const fetchSymbols = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.admin.symbols);
      if (!response.ok) {
        console.error('Failed to fetch symbols:', response.status);
      } else {
        const data = await response.json();
        setSymbols(data || []);
      }
    } catch (error) {
      console.error('Failed to fetch symbols:', error);
    }
  };

  const saveConfig = async () => {
    if (!config) return;

    setSaving(true);
    try {
      const response = await fetch(API_ENDPOINTS.admin.config, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        if (response.status === 404) {
          showMessage('error', 'Config endpoint not found (404)');
        } else {
          const error = await response.text();
          showMessage('error', `Failed to save: ${response.status} - ${error}`);
        }
      } else {
        showMessage('success', 'Configuration saved successfully');
        await fetchConfig();
      }
    } catch (error) {
      showMessage('error', 'Failed to save configuration - server unreachable');
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleLP = async (lpName: string) => {
    try {
      const response = await fetch(buildAdminUrl(`/admin/lps/${lpName}/toggle`), {
        method: 'POST',
      });

      if (!response.ok) {
        if (response.status === 404) {
          showMessage('error', `LP endpoint not found (404)`);
        } else {
          showMessage('error', `Failed to toggle LP: ${response.status}`);
        }
      } else {
        showMessage('success', `LP ${lpName} toggled`);
        await fetchLiquidityProviders();
      }
    } catch (error) {
      console.error('Toggle LP error:', error);
      showMessage('error', 'Failed to toggle LP - server unreachable');
    }
  };

  const updateSymbol = async (symbol: string, updates: Partial<SymbolConfig>) => {
    try {
      const response = await fetch(buildAdminUrl(`/admin/symbols/${symbol}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        if (response.status === 404) {
          showMessage('error', `Symbol endpoint not found (404)`);
        } else {
          showMessage('error', `Failed to update symbol: ${response.status}`);
        }
      } else {
        showMessage('success', `Symbol ${symbol} updated`);
        await fetchSymbols();
      }
    } catch (error) {
      console.error('Update symbol error:', error);
      showMessage('error', 'Failed to update symbol - server unreachable');
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        <Icon name="refresh" size="sm" className="w-6 h-6 animate-spin mr-2" />
        Loading admin panel...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <Icon name="settings" size="sm" className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-lg font-semibold text-white">Admin Panel</h2>
            <p className="text-xs text-zinc-500">Broker Configuration & Management</p>
          </div>
        </div>
        <button
          onClick={saveConfig}
          disabled={saving || !config}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="save" size="sm" className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Message Toast */}
      {message && (
        <div
          className={`mx-4 mt-4 p-3 rounded border flex items-center gap-2 ${
            message.type === 'success'
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

      {/* Tabs */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <TabButton
          active={activeTab === 'config'}
          onClick={() => setActiveTab('config')}
          icon={Settings}
          label="Broker Config"
        />
        <TabButton
          active={activeTab === 'lp'}
          onClick={() => setActiveTab('lp')}
          icon={Server}
          label="Liquidity Providers"
        />
        <TabButton
          active={activeTab === 'symbols'}
          onClick={() => setActiveTab('symbols')}
          icon={TrendingUp}
          label="Symbols"
        />
        <TabButton
          active={activeTab === 'routing'}
          onClick={() => setActiveTab('routing')}
          icon={GitMerge}
          label="Routing Rules"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'config' && config && (
          <ConfigTab config={config} setConfig={setConfig} />
        )}
        {activeTab === 'lp' && (
          <LiquidityProvidersTab providers={liquidityProviders} onToggle={toggleLP} />
        )}
        {activeTab === 'symbols' && <SymbolsTab symbols={symbols} onUpdate={updateSymbol} />}
        {activeTab === 'routing' && <RoutingRulesPanel />}
      </div>
    </div>
  );
};

// Tab Button Component
const TabButton = ({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Settings;
  label: string;
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      active
        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
    }`}
  >
    <Icon className="w-4 h-4" />
    {label}
  </button>
);

// Config Tab Component
const ConfigTab = ({
  config,
  setConfig,
}: {
  config: BrokerConfig;
  setConfig: (config: BrokerConfig) => void;
}) => (
  <div className="space-y-6 max-w-4xl">
    <div className="grid grid-cols-2 gap-6">
      {/* Broker Name */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Broker Name</label>
        <input
          type="text"
          value={config.brokerName}
          onChange={(e) => setConfig({ ...config, brokerName: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Broker Display Name */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Display Name</label>
        <input
          type="text"
          value={config.brokerDisplayName}
          onChange={(e) => setConfig({ ...config, brokerDisplayName: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Execution Mode */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Execution Mode</label>
        <select
          value={config.executionMode}
          onChange={(e) =>
            setConfig({ ...config, executionMode: e.target.value as ExecutionMode })
          }
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        >
          <option value="ABOOK">A-Book (STP - Route to LP)</option>
          <option value="BBOOK">B-Book (Market Maker - Internal)</option>
        </select>
        <p className="text-xs text-zinc-500 mt-1">
          {config.executionMode === 'ABOOK'
            ? 'Orders routed to OANDA (requires active LP connection)'
            : 'Orders processed by RTX engine using internal balance'}
        </p>
      </div>

      {/* Default Leverage */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Default Leverage</label>
        <input
          type="number"
          min={1}
          max={1000}
          value={config.defaultLeverage}
          onChange={(e) =>
            setConfig({ ...config, defaultLeverage: parseInt(e.target.value) || 100 })
          }
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Margin Mode */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Margin Mode</label>
        <input
          type="text"
          value={config.marginMode}
          onChange={(e) => setConfig({ ...config, marginMode: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Price Feed LP */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Price Feed LP</label>
        <input
          type="text"
          value={config.priceFeedLP}
          onChange={(e) => setConfig({ ...config, priceFeedLP: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Price Feed Name */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Price Feed Name</label>
        <input
          type="text"
          value={config.priceFeedName}
          onChange={(e) => setConfig({ ...config, priceFeedName: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Default Balance */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Default Balance (USD)</label>
        <input
          type="number"
          min={0}
          step={100}
          value={config.defaultBalance}
          onChange={(e) =>
            setConfig({ ...config, defaultBalance: parseFloat(e.target.value) || 0 })
          }
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Max Ticks Per Symbol */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 font-medium">Max Ticks Per Symbol</label>
        <input
          type="number"
          min={1000}
          step={1000}
          value={config.maxTicksPerSymbol}
          onChange={(e) =>
            setConfig({ ...config, maxTicksPerSymbol: parseInt(e.target.value) || 50000 })
          }
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-emerald-500"
        />
      </div>
    </div>
  </div>
);

// Liquidity Providers Tab
const LiquidityProvidersTab = ({
  providers,
  onToggle,
}: {
  providers: LiquidityProvider[];
  onToggle: (name: string) => void;
}) => (
  <div className="space-y-4">
    {providers.length === 0 ? (
      <div className="text-center text-zinc-500 py-8">
        <Icon name="server" size="sm" className="w-12 h-12 mx-auto mb-2 text-zinc-700" />
        <p>No liquidity providers configured</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map((lp) => (
          <div
            key={lp.name}
            className="p-4 bg-zinc-800/50 rounded-lg border border-zinc-700 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-white">{lp.name}</h4>
              <div
                className={`px-2 py-1 rounded text-xs font-medium ${
                  lp.status === 'ACTIVE'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : lp.status === 'INACTIVE'
                    ? 'bg-zinc-700 text-zinc-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {lp.status}
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Latency:</span>
                <span className="text-white font-mono">{lp.latency}ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Uptime:</span>
                <span className="text-emerald-400 font-mono">{lp.uptime.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Symbols:</span>
                <span className="text-white">{lp.symbols.length}</span>
              </div>
            </div>

            <button
              onClick={() => onToggle(lp.name)}
              className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors ${
                lp.status === 'ACTIVE'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
              }`}
            >
              {lp.status === 'ACTIVE' ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Symbols Tab
const SymbolsTab = ({
  symbols,
  onUpdate,
}: {
  symbols: SymbolConfig[];
  onUpdate: (symbol: string, updates: Partial<SymbolConfig>) => void;
}) => (
  <div className="space-y-4">
    {symbols.length === 0 ? (
      <div className="text-center text-zinc-500 py-8">
        <Icon name="trending-up" size="sm" className="w-12 h-12 mx-auto mb-2 text-zinc-700" />
        <p>No symbols configured</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800 border-b border-zinc-700">
            <tr className="text-left text-zinc-400 text-xs">
              <th className="p-3">Symbol</th>
              <th className="p-3">Status</th>
              <th className="p-3">Routing</th>
              <th className="p-3">Spread</th>
              <th className="p-3">Commission</th>
              <th className="p-3">Leverage</th>
              <th className="p-3">Min/Max Volume</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol) => (
              <tr key={symbol.symbol} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                <td className="p-3 font-medium text-white">{symbol.symbol}</td>
                <td className="p-3">
                  <button
                    onClick={() => onUpdate(symbol.symbol, { enabled: !symbol.enabled })}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      symbol.enabled
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-zinc-700 text-zinc-400'
                    }`}
                  >
                    {symbol.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </td>
                <td className="p-3 text-zinc-300">{symbol.routingMode}</td>
                <td className="p-3 font-mono text-zinc-300">{symbol.spread.toFixed(1)}</td>
                <td className="p-3 font-mono text-zinc-300">${symbol.commission.toFixed(2)}</td>
                <td className="p-3 font-mono text-zinc-300">1:{symbol.leverage}</td>
                <td className="p-3 font-mono text-zinc-300 text-xs">
                  {symbol.minVolume.toFixed(2)} - {symbol.maxVolume.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);
