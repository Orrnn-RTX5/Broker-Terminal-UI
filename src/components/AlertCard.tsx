import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Alert Card Component
 * Individual alert display with severity indicator and actions
 */

import { useState } from 'react';
import { Info, AlertCircle, AlertTriangle } from 'lucide-react';
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type Alert = {
  id: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
  acknowledged?: boolean;
  snoozedUntil?: number;
};

type AlertCardProps = {
  alert: Alert;
  onAcknowledge: (id: string) => void;
  onSnooze: (id: string, minutes: number) => void;
  onDismiss: (id: string) => void;
};

const SEVERITY_CONFIG = {
  LOW: {
    icon: Info,
    bgColor: 'bg-zinc-700/20',
    borderColor: 'border-zinc-600/30',
    textColor: 'text-blue-400',
    dotColor: 'bg-zinc-600',
  },
  MEDIUM: {
    icon: AlertCircle,
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    textColor: 'text-yellow-400',
    dotColor: 'bg-yellow-500',
  },
  HIGH: {
    icon: AlertTriangle,
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    textColor: 'text-orange-400',
    dotColor: 'bg-orange-500',
  },
  CRITICAL: {
    icon: AlertTriangle,
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    textColor: 'text-red-400',
    dotColor: 'bg-red-500',
  },
};

export function AlertCard({ alert, onAcknowledge, onSnooze, onDismiss }: AlertCardProps) {
    const tr = useUiTranslation();
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const config = SEVERITY_CONFIG[alert.severity];
  const Icon = config.icon;

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleSnooze = (minutes: number) => {
    onSnooze(alert.id, minutes);
    setShowSnoozeMenu(false);
  };

  return (
    <div
      className={`${config.bgColor} ${config.borderColor} border rounded-lg p-3 shadow-lg backdrop-blur-sm animate-slide-in`}
      style={{
        minWidth: '320px',
        maxWidth: '400px',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <div className={`${config.dotColor} w-2 h-2 rounded-full mt-1.5 animate-pulse`} />
        <Icon className={`${config.textColor} w-4 h-4 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`${config.textColor} text-xs font-bold uppercase tracking-wide`}>
              {alert.severity}
            </span>
            <span className="text-[10px] text-zinc-500">
              {formatTimestamp(alert.timestamp)}
            </span>
          </div>
          <p className="text-sm text-zinc-200 leading-snug break-words">
            {alert.message}
          </p>
        </div>
        <button
          onClick={() => onDismiss(alert.id)}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
          title={tr("Dismiss")}
        >
          <Icon name="x-close" size="sm" className="w-4 h-4" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-800/50">
        <button
          onClick={() => onAcknowledge(alert.id)}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium transition-colors border border-emerald-500/20"
        >
          <Icon name="check-circle" size="sm" className="w-3 h-3" />
          {tr("Acknowledge")}</button>

        <div className="relative">
          <button
            onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 rounded text-xs font-medium transition-colors border border-zinc-700/50"
          >
            <Icon name="clock" size="sm" className="w-3 h-3" />
            {tr("Snooze")}</button>

          {showSnoozeMenu && (
            <div className="absolute bottom-full left-0 mb-1 bg-zinc-900 border border-zinc-800 rounded shadow-lg overflow-hidden z-10">
              <button
                onClick={() => handleSnooze(5)}
                className="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
              >
                5 minutes
              </button>
              <button
                onClick={() => handleSnooze(15)}
                className="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
              >
                15 minutes
              </button>
              <button
                onClick={() => handleSnooze(60)}
                className="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
              >
                1 hour
              </button>
            </div>
          )}
        </div>
      </div>

      <style>
        {`
          @keyframes slide-in {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
          .animate-slide-in {
            animation: slide-in 0.3s ease-out;
          }
        `}
      </style>
    </div>
  );
}
