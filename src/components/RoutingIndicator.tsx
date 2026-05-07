/**
 * Routing Indicator Component
 * Shows users which routing path (A-Book/B-Book/C-Book) their order will take
 * Displays routing decision before order submission with exposure warnings
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
// ============================================
// Types
// ============================================

export type RoutingPath = 'ABOOK' | 'BBOOK' | 'CBOOK' | 'PARTIAL';

export interface RoutingDecision {
  path: RoutingPath;
  lpName?: string;
  hedgePercentage?: number;
  reason: string;
  confidence: number;
  exposureImpact: {
    current: number;
    after: number;
    limit: number;
    utilizationPercent: number;
    isWarning: boolean;
    isCritical: boolean;
  };
}

export interface RoutingIndicatorProps {
  symbol: string;
  volume: number;
  accountId: string | number;
  side?: 'BUY' | 'SELL';
  className?: string;
}

// ============================================
// Color & Styling Configuration
// ============================================

const ROUTING_CONFIG = {
  ABOOK: {
    color: 'bg-zinc-800',
    border: 'border-blue-300',
    badge: 'bg-blue-100 text-blue-800',
    text: 'text-blue-900',
    icon: 'text-blue-600',
  },
  BBOOK: {
    color: 'bg-amber-50',
    border: 'border-amber-300',
    badge: 'bg-amber-100 text-amber-800',
    text: 'text-amber-900',
    icon: 'text-amber-600',
  },
  CBOOK: {
    color: 'bg-orange-50',
    border: 'border-orange-300',
    badge: 'bg-orange-100 text-orange-800',
    text: 'text-orange-900',
    icon: 'text-orange-600',
  },
  PARTIAL: {
    color: 'bg-purple-50',
    border: 'border-purple-300',
    badge: 'bg-purple-100 text-purple-800',
    text: 'text-purple-900',
    icon: 'text-purple-600',
  },
} as const;

// ============================================
// Helper Functions
// ============================================

function getRoutingLabel(path: RoutingPath): string {
  const labels: Record<RoutingPath, string> = {
    ABOOK: 'A-Book (Direct LP)',
    BBOOK: 'B-Book (Internal)',
    CBOOK: 'C-Book (Market Maker)',
    PARTIAL: 'Partial Hedge',
  };
  return labels[path];
}

function getExposureStatus(utilizationPercent: number): {
  level: 'safe' | 'warning' | 'critical';
  message: string;
} {
  if (utilizationPercent >= 90) {
    return {
      level: 'critical',
      message: 'Critical exposure level',
    };
  }
  if (utilizationPercent >= 75) {
    return {
      level: 'warning',
      message: 'High exposure',
    };
  }
  return {
    level: 'safe',
    message: 'Exposure within limits',
  };
}

// ============================================
// Tooltip Component
// ============================================

interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible(!visible)}
        className="cursor-help"
      >
        {children}
      </div>
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-50">
          {content}
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function RoutingIndicator({
  symbol,
  volume,
  accountId,
  side = 'BUY',
  className = '',
}: RoutingIndicatorProps) {
  const [routing, setRouting] = useState<RoutingDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch routing decision when props change
  useEffect(() => {
    const fetchRouting = async () => {
      if (!symbol || volume <= 0) {
        setRouting(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // This endpoint will be created on the backend
        const response = await fetch(
          `/api/routing/preview?symbol=${symbol}&volume=${volume}&accountId=${accountId}&side=${side}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch routing decision');
        }

        const data = await response.json();
        setRouting(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch routing');
        setRouting(null);
      } finally {
        setLoading(false);
      }
    };

    // Debounce the fetch to avoid too many requests
    const timer = setTimeout(fetchRouting, 500);
    return () => clearTimeout(timer);
  }, [symbol, volume, accountId, side]);

  if (!symbol || volume <= 0) {
    return null;
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-4 ${className}`}>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Calculating routing...
        </div>
      </div>
    );
  }

  if (error || !routing) {
    return (
      <div className={`flex items-center gap-2 p-3 rounded border border-red-200 bg-red-50 ${className}`}>
        <Icon name="error" size="sm" className="w-4 h-4 text-red-600 flex-shrink-0" />
        <span className="text-sm text-red-700">{error || 'Unable to determine routing'}</span>
      </div>
    );
  }

  const config = ROUTING_CONFIG[routing.path];
  const exposureStatus = getExposureStatus(routing.exposureImpact.utilizationPercent);

  return (
    <div
      className={`border-2 rounded-lg p-4 transition-all ${config.color} ${config.border} ${className}`}
    >
      {/* Header with Routing Path */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <Icon name="trending-up" size="sm" className={`w-5 h-5 ${config.icon} flex-shrink-0`} />
          <div>
            <div className="flex items-center gap-2">
              <span className={`font-semibold ${config.text}`}>
                {getRoutingLabel(routing.path)}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.badge}`}>
                {Math.round(routing.confidence * 100)}% confidence
              </span>
            </div>
            <p className={`text-xs mt-0.5 ${config.text} opacity-75`}>
              {routing.reason}
            </p>
          </div>
        </div>
      </div>

      {/* LP Details (for A-Book) */}
      {routing.path === 'ABOOK' && routing.lpName && (
        <div className={`mb-3 p-2 rounded bg-white bg-opacity-50 border ${config.border}`}>
          <p className={`text-sm ${config.text}`}>
            <span className="font-medium">Liquidity Provider:</span> {routing.lpName}
          </p>
        </div>
      )}

      {/* Hedge Percentage (for Partial Hedge) */}
      {routing.path === 'PARTIAL' && routing.hedgePercentage !== undefined && (
        <div className={`mb-3 p-2 rounded bg-white bg-opacity-50 border ${config.border}`}>
          <p className={`text-sm ${config.text}`}>
            <span className="font-medium">Hedge Ratio:</span> {Math.round(routing.hedgePercentage * 100)}%
            <Tooltip content="Percentage of order volume that will be hedged with external LP">
              <Icon name="info" size="sm" className="w-4 h-4 inline ml-1 opacity-60" />
            </Tooltip>
          </p>
        </div>
      )}

      {/* Exposure Impact */}
      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-start justify-between mb-2">
          <Tooltip content="Current symbol exposure and impact after this order">
            <span className={`text-xs font-semibold ${config.text} cursor-help flex items-center gap-1`}>
              Exposure Impact
              <Icon name="info" size="sm" className="w-3 h-3 opacity-60" />
            </span>
          </Tooltip>
          <span
            className={`text-xs px-2 py-1 rounded font-semibold ${
              exposureStatus.level === 'critical'
                ? 'bg-red-100 text-red-800'
                : exposureStatus.level === 'warning'
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-green-100 text-green-800'
            }`}
          >
            {exposureStatus.message}
          </span>
        </div>

        {/* Exposure Progress Bar */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Current: {routing.exposureImpact.current.toFixed(2)}</span>
            <span>After: {routing.exposureImpact.after.toFixed(2)} / {routing.exposureImpact.limit.toFixed(2)}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all ${
                routing.exposureImpact.utilizationPercent >= 90
                  ? 'bg-red-500'
                  : routing.exposureImpact.utilizationPercent >= 75
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(routing.exposureImpact.utilizationPercent, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {routing.exposureImpact.utilizationPercent.toFixed(1)}% utilized
          </p>
        </div>

        {/* Critical Warning */}
        {routing.exposureImpact.isCritical && (
          <div className="mt-2 p-2 rounded bg-red-100 border border-red-300">
            <p className="text-xs text-red-800 font-medium flex items-start gap-2">
              <Icon name="error" size="sm" className="w-4 h-4 mt-0.5 flex-shrink-0" />
              This order will significantly exceed exposure limits. Consider reducing volume or waiting for position
              reduction.
            </p>
          </div>
        )}

        {/* Warning (non-critical) */}
        {routing.exposureImpact.isWarning && !routing.exposureImpact.isCritical && (
          <div className="mt-2 p-2 rounded bg-yellow-100 border border-yellow-300">
            <p className="text-xs text-yellow-800 font-medium flex items-start gap-2">
              <Icon name="error" size="sm" className="w-4 h-4 mt-0.5 flex-shrink-0" />
              High exposure after this order. Verify this is intentional before proceeding.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoutingIndicator;
