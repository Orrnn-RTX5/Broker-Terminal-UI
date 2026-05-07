import { useMemo } from 'react';

type StatusIndicatorProps = {
  status: 'connected' | 'disconnected' | 'pending' | 'idle';
  label?: string;
  showPulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export function StatusIndicator({
  status,
  label,
  showPulse = true,
  size = 'md',
  className = ''
}: StatusIndicatorProps) {
  const { color, bgColor, textColor } = useMemo(() => {
    const colors = {
      connected: {
        color: '#00C853',
        bgColor: 'bg-[#00C853]/10',
        textColor: 'text-[#00C853]'
      },
      disconnected: {
        color: '#FF5252',
        bgColor: 'bg-[#FF5252]/10',
        textColor: 'text-[#FF5252]'
      },
      pending: {
        color: '#FFA726',
        bgColor: 'bg-[#FFA726]/10',
        textColor: 'text-[#FFA726]'
      },
      idle: {
        color: '#71717A',
        bgColor: 'bg-zinc-700/10',
        textColor: 'text-zinc-400'
      }
    };
    return colors[status];
  }, [status]);

  const sizeClasses = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-3 h-3'
  }[size];

  const containerPadding = {
    sm: 'px-1.5 py-0.5',
    md: 'px-2 py-1',
    lg: 'px-3 py-1.5'
  }[size];

  const fontSize = {
    sm: 'text-2xs',
    md: 'text-xs',
    lg: 'text-sm'
  }[size];

  if (!label) {
    return (
      <div
        className={`${sizeClasses} rounded-full ${className}`}
        style={{
          backgroundColor: color,
          boxShadow: showPulse && status !== 'idle' ? `0 0 8px ${color}` : 'none'
        }}
      >
        {showPulse && status !== 'idle' && (
          <div
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: color }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 ${containerPadding} ${bgColor} rounded border border-current/20 ${className}`}
    >
      <div className="relative flex items-center justify-center">
        <div
          className={`${sizeClasses} rounded-full`}
          style={{ backgroundColor: color }}
        />
        {showPulse && status !== 'idle' && (
          <div
            className={`absolute ${sizeClasses} rounded-full animate-ping opacity-75`}
            style={{ backgroundColor: color }}
          />
        )}
      </div>
      <span className={`${fontSize} ${textColor} font-medium whitespace-nowrap`}>
        {label}
      </span>
    </div>
  );
}
