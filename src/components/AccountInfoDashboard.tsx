/**
 * Account Info Dashboard Component
 * Displays real-time account metrics with visual indicators
 */

import { Icon } from './ui/Icon';
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ExportDialog } from './ExportDialog';
import { DollarSign, Activity, Shield, TrendingUp } from 'lucide-react';
import { useTradeFacingData } from '../hooks/useTradeFacingData';

const StatCard = ({
  icon: Icon,
  label,
  value,
  subtext,
  color = 'blue',
  highlight = false,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  subtext?: string;
  color?: string;
  highlight?: boolean;
}) => (
  <div
    className={`p-4 rounded-lg border ${
      highlight
        ? `bg-${color}-900/20 border-${color}-700/50`
        : 'bg-zinc-900 border-zinc-800'
    }`}
  >
    <div className="flex items-center gap-2 mb-2">
      <Icon className={`w-4 h-4 text-${color}-400`} />
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
    <div className={`text-2xl font-bold text-${highlight ? color + '-400' : 'white'}`}>
      {value}
    </div>
    {subtext && <div className="text-xs text-zinc-500 mt-1">{subtext}</div>}
  </div>
);

export const AccountInfoDashboard = () => {
  const { account, positions, accountId } = useAppStore();
  const { loading, error, refresh } = useTradeFacingData(accountId ?? undefined, 10000);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const accountHealth = useMemo(() => {
    if (!account) return { level: 'unknown', color: 'zinc', message: 'No data' };

    const marginLevel = account.marginLevel;

    if (marginLevel >= 200) {
      return { level: 'healthy', color: 'green', message: 'Excellent' };
    } else if (marginLevel >= 100) {
      return { level: 'good', color: 'blue', message: 'Good' };
    } else if (marginLevel >= 50) {
      return { level: 'warning', color: 'yellow', message: 'Warning' };
    } else {
      return { level: 'critical', color: 'red', message: 'Critical' };
    }
  }, [account]);

  const marginUtilization = useMemo(() => {
    if (!account || account.equity === 0) return 0;
    return (account.margin / account.equity) * 100;
  }, [account]);

  if (!account) {
    return (
      <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="text-center text-zinc-500">{loading ? 'Loading account data...' : (error || 'No account data')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Account Health Indicator */}
      <div
        className={`p-4 rounded-lg border bg-${accountHealth.color}-900/20 border-${accountHealth.color}-700/50`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {accountHealth.level === 'critical' ? (
              <Icon name="alert-triangle" size="sm" className={`w-6 h-6 text-${accountHealth.color}-400`} />
            ) : (
              <Icon name="check-circle" size="sm" className={`w-6 h-6 text-${accountHealth.color}-400`} />
            )}
            <div>
              <div className="text-sm font-medium text-white">Account Health</div>
              <div className={`text-xs text-${accountHealth.color}-400`}>
                {accountHealth.message}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-500">Margin Level</div>
            <div className={`text-2xl font-bold text-${accountHealth.color}-400`}>
              {account.marginLevel.toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Margin Utilization Bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Margin Utilization</span>
            <span>{marginUtilization.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full bg-${accountHealth.color}-500 transition-all duration-300`}
              style={{ width: `${Math.min(marginUtilization, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={DollarSign}
          label="Balance"
          value={`$${account.balance.toFixed(2)}`}
          color="blue"
        />
        <StatCard
          icon={Activity}
          label="Equity"
          value={`$${account.equity.toFixed(2)}`}
          subtext={`${account.equity >= account.balance ? '+' : ''}$${(
            account.equity - account.balance
          ).toFixed(2)}`}
          color={account.equity >= account.balance ? 'green' : 'red'}
          highlight={account.unrealizedPL !== 0}
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Shield}
          label="Used Margin"
          value={`$${account.margin.toFixed(2)}`}
          color="yellow"
        />
        <StatCard
          icon={TrendingUp}
          label="Free Margin"
          value={`$${account.freeMargin.toFixed(2)}`}
          color="green"
        />
      </div>

      {/* Unrealized P&L */}
      {account.unrealizedPL !== 0 && (
        <div
          className={`p-4 rounded-lg border ${
            account.unrealizedPL >= 0
              ? 'bg-green-900/20 border-green-700/50'
              : 'bg-red-900/20 border-red-700/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="text-sm text-zinc-400">Unrealized P&L</div>
            <div
              className={`text-2xl font-bold ${
                account.unrealizedPL >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {account.unrealizedPL >= 0 ? '+' : ''}${account.unrealizedPL.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Position Summary */}
      <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="text-xs text-zinc-500 mb-2">Position Summary</div>
        <div className="flex items-center justify-between">
          <div className="text-sm text-white">
            {positions.length} Open Position{positions.length !== 1 ? 's' : ''}
          </div>
          <div className="text-xs text-zinc-500">
            Total Volume: {positions.reduce((sum: number, p: { volume: number }) => sum + p.volume, 0).toFixed(2)} lots
          </div>
        </div>
      </div>

      {/* Risk Warning */}
      {marginUtilization > 80 && (
        <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg flex items-start gap-2">
          <Icon name="alert-triangle" size="sm" className="w-4 h-4 text-red-400 mt-0.5" />
          <div className="text-xs text-red-400">
            <strong>High Risk:</strong> Margin utilization above 80%. Consider reducing exposure
            or adding funds.
          </div>
        </div>
      )}

      {/* Export Button */}
      <button
        onClick={() => refresh()}
        className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-zinc-300 text-sm transition-colors flex items-center justify-center gap-2"
      >
        <Icon name="refresh" size="sm" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        Refresh Account
      </button>

      <button
        onClick={() => setShowExportDialog(true)}
        className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 border border-emerald-500 rounded-lg text-white font-medium transition-colors flex items-center justify-center gap-2"
      >
        <Icon name="download" size="sm" className="w-4 h-4" />
        Export Data
      </button>

      {/* Export Dialog */}
      {showExportDialog && (
        <ExportDialog
          accountId="1"
          onClose={() => setShowExportDialog(false)}
        />
      )}
    </div>
  );
};
