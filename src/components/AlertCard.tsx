import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Alert Card Component
 * Individual alert display with severity indicator and actions
 */

import { useState } from 'react';
import { Info, AlertCircle, AlertTriangle } from 'lucide-react';
import { Icon } from './ui/Icon';

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
    accentColor: '#3b82f6',
    badgeBg: 'rgba(59, 130, 246, 0.12)',
    badgeBorder: 'rgba(59, 130, 246, 0.28)',
    textColor: 'text-blue-400',
    dotColor: 'bg-blue-500',
  },
  MEDIUM: {
    icon: AlertCircle,
    accentColor: '#eab308',
    badgeBg: 'rgba(234, 179, 8, 0.12)',
    badgeBorder: 'rgba(234, 179, 8, 0.3)',
    textColor: 'text-yellow-400',
    dotColor: 'bg-yellow-500',
  },
  HIGH: {
    icon: AlertTriangle,
    accentColor: '#f97316',
    badgeBg: 'rgba(249, 115, 22, 0.12)',
    badgeBorder: 'rgba(249, 115, 22, 0.3)',
    textColor: 'text-orange-400',
    dotColor: 'bg-orange-500',
  },
  CRITICAL: {
    icon: AlertTriangle,
    accentColor: '#ef4444',
    badgeBg: 'rgba(239, 68, 68, 0.14)',
    badgeBorder: 'rgba(239, 68, 68, 0.35)',
    textColor: 'text-red-400',
    dotColor: 'bg-red-500',
  },
};

export function AlertCard({ alert, onAcknowledge, onSnooze, onDismiss }: AlertCardProps) {
  const tr = useUiTranslation();
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const config = SEVERITY_CONFIG[alert.severity];
  const SeverityIcon = config.icon;

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleSnooze = (minutes: number) => {
    onSnooze(alert.id, minutes);
    setShowSnoozeMenu(false);
  };

  return (
    <div
      className="rtx-alert-card rounded-md p-3 shadow-lg animate-slide-in"
      style={{
        minWidth: '320px',
        maxWidth: '400px',
        background: 'var(--bg-elevated, #191a1e)',
        border: '1px solid var(--border-primary, #28282e)',
        borderLeft: `3px solid ${config.accentColor}`,
        color: 'var(--text-primary, #e2e2e8)',
        boxShadow: 'var(--shadow-lg, 0 10px 28px rgba(0, 0, 0, 0.45))',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className={`${config.dotColor} w-2 h-2 rounded-full mt-1.5 shrink-0 animate-pulse`} />
        <SeverityIcon className={`${config.textColor} w-4 h-4 mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className={`${config.textColor} text-[11px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded`}
              style={{
                background: config.badgeBg,
                border: `1px solid ${config.badgeBorder}`,
              }}
            >
              {alert.severity}
            </span>
            <span
              className="text-[11px] font-mono tabular-nums"
              style={{ color: 'var(--text-tertiary, #808088)' }}
            >
              {formatTimestamp(alert.timestamp)}
            </span>
          </div>
          <p
            className="text-[13px] leading-[19.5px] font-normal break-words"
            style={{ color: 'var(--text-primary, #e2e2e8)' }}
          >
            {alert.message}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(alert.id)}
          className="rounded p-1 transition-colors hover:bg-zinc-500/15"
          style={{ color: 'var(--text-tertiary, #808088)' }}
          title={tr("Dismiss")}
          aria-label={tr("Dismiss")}
        >
          <Icon name="x-close" size="sm" className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Actions */}
      <div
        className="flex items-center justify-end gap-2 mt-2.5 pt-2"
        style={{ borderTop: '1px solid var(--border-primary, #28282e)' }}
      >
        <button
          type="button"
          onClick={() => onAcknowledge(alert.id)}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded text-[12px] font-medium transition-colors border border-emerald-500/25"
        >
          <Icon name="check-circle" size="sm" className="w-3.5 h-3.5" />
          {tr("Acknowledge")}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition-colors hover:opacity-90"
            style={{
              background: 'var(--bg-tertiary, #222226)',
              color: 'var(--text-secondary, #a0a0ab)',
              border: '1px solid var(--border-secondary, #333338)',
            }}
          >
            <Icon name="clock" size="sm" className="w-3.5 h-3.5" />
            {tr("Snooze")}
          </button>

          {showSnoozeMenu && (
            <div
              className="rtx-menu-surface absolute bottom-full right-0 mb-1 rounded shadow-lg overflow-hidden z-10 min-w-[110px]"
              style={{
                background: 'var(--bg-elevated, #191a1e)',
                border: '1px solid var(--border-secondary, #333338)',
              }}
            >
              {[
                { minutes: 5, label: '5 minutes' },
                { minutes: 15, label: '15 minutes' },
                { minutes: 60, label: '1 hour' },
              ].map((option) => (
                <button
                  key={option.minutes}
                  type="button"
                  onClick={() => handleSnooze(option.minutes)}
                  className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-blue-500/15 transition-colors whitespace-nowrap"
                  style={{ color: 'var(--text-primary, #e2e2e8)' }}
                >
                  {tr(option.label)}
                </button>
              ))}
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
            animation: slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          }
        `}
      </style>
    </div>
  );
}

