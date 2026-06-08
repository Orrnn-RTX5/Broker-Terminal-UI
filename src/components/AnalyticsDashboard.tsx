/**
 * Analytics Dashboard Component
 * Main navigation hub for all analytics views
 * Features: Tab navigation, responsive layout, real-time updates
 */

import { Icon } from './ui/Icon';
import { useState } from 'react';
import { RoutingMetricsDashboard } from './RoutingMetricsDashboard';
import { LPComparisonDashboard } from './LPComparisonDashboard';
import { RuleEffectivenessDashboard } from './RuleEffectivenessDashboard';
import { ExposureHeatmap } from './ExposureHeatmap';
import { ExportDialog } from './ExportDialog';
import { AlertRulesManager } from './AlertRulesManager';
import { useAppStore } from '../store/useAppStore';
import { Grid3X3 } from 'lucide-react';

// ============================================
// Types
// ============================================

type AnalyticsTab =
  | 'routing'
  | 'lp'
  | 'exposure'
  | 'rules'
  | 'export'
  | 'alerts';

interface TabConfig {
  id: AnalyticsTab;
  label: string;
  icon: React.ReactNode;
  description: string;
}

// ============================================
// Tab Configuration
// ============================================

const TABS: TabConfig[] = [
  {
    id: 'routing',
    label: 'Routing Metrics',
    icon: <Icon name="bar-chart-3" size="sm" className="w-4 h-4" />,
    description: 'A/B/C-Book distribution and decisions',
  },
  {
    id: 'lp',
    label: 'LP Performance',
    icon: <Icon name="activity" size="sm" className="w-4 h-4" />,
    description: 'Liquidity provider comparison',
  },
  {
    id: 'exposure',
    label: 'Exposure Heatmap',
    icon: <Grid3X3 className="w-4 h-4" />,
    description: 'Real-time position exposure',
  },
  {
    id: 'rules',
    label: 'Rule Effectiveness',
    icon: <Icon name="check-circle" size="sm" className="w-4 h-4" />,
    description: 'Routing rule performance',
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: <Icon name="bell" size="sm" className="w-4 h-4" />,
    description: 'Alert rules and history',
  },
  {
    id: 'export',
    label: 'Export',
    icon: <Icon name="download" size="sm" className="w-4 h-4" />,
    description: 'Download reports',
  },
];

// ============================================
// Props
// ============================================

interface AnalyticsDashboardProps {
  onBack?: () => void;
  className?: string;
}

// ============================================
// Component
// ============================================

export function AnalyticsDashboard({ onBack, className = '' }: AnalyticsDashboardProps) {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('routing');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const accountId = useAppStore((state) => state.accountId);

  // Render active tab content
  const renderContent = () => {
    switch (activeTab) {
      case 'routing':
        return <RoutingMetricsDashboard />;
      case 'lp':
        return <LPComparisonDashboard />;
      case 'exposure':
        return <ExposureHeatmap />;
      case 'rules':
        return <RuleEffectivenessDashboard />;
      case 'alerts':
        return <AlertRulesManager />;
      case 'export':
        return (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Icon name="file-text" size="sm" className="w-16 h-16 mx-auto text-zinc-600 mb-4" />
              <h2 className="text-xl font-semibold mb-2">Export Analytics Data</h2>
              <p className="text-zinc-400 mb-6">
                Download routing metrics, LP performance, and exposure data
              </p>
              <button
                onClick={() => setShowExportDialog(true)}
                className="px-6 py-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30 transition-colors"
              >
                <Icon name="download" size="sm" className="w-4 h-4 inline mr-2" />
                Open Export Dialog
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`flex flex-col h-full bg-[#0d0d11] text-zinc-300 ${className}`}>
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center gap-4 px-4 py-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 hover:bg-zinc-800 rounded transition-colors"
            >
              <Icon name="chevron-left" size="sm" className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-lg font-semibold">Analytics Dashboard</h1>
            <p className="text-xs text-zinc-500">
              Real-time routing and performance analytics
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {renderContent()}
      </div>

      {/* Export Dialog */}
      {showExportDialog && (
        <ExportDialog
          accountId={accountId ? String(accountId) : ''}
          onClose={() => setShowExportDialog(false)}
        />
      )}
    </div>
  );
}

export default AnalyticsDashboard;
