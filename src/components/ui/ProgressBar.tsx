import { useMemo } from 'react';

type ProgressBarProps = {
  value: number;
  max?: number;
  variant?: 'primary' | 'success' | 'danger' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  label?: string;
  className?: string;
};

export function ProgressBar({
  value,
  max = 100,
  variant = 'primary',
  size = 'md',
  showLabel = false,
  label,
  className = ''
}: ProgressBarProps) {
  const percentage = useMemo(() => {
    return Math.min(Math.max((value / max) * 100, 0), 100);
  }, [value, max]);

  const heightClass = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3'
  }[size];

  const colorClass = {
    primary: 'bg-zinc-600',
    success: 'bg-[#00C853]',
    danger: 'bg-[#FF5252]',
    warning: 'bg-[#FFA726]'
  }[variant];

  // Determine variant based on percentage thresholds
  const autoVariant = useMemo(() => {
    if (percentage >= 90) return 'danger';
    if (percentage >= 70) return 'warning';
    return 'success';
  }, [percentage]);

  const finalColorClass = variant === 'primary' ? colorClass : {
    primary: 'bg-zinc-600',
    success: 'bg-[#00C853]',
    danger: 'bg-[#FF5252]',
    warning: 'bg-[#FFA726]'
  }[autoVariant];

  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-zinc-400">{label}</span>
          <span className="text-xs font-mono text-zinc-300">
            {percentage.toFixed(0)}%
          </span>
        </div>
      )}
      <div className={`progress-bar ${heightClass} bg-zinc-800 rounded-full overflow-hidden`}>
        <div
          className={`progress-bar-fill ${finalColorClass} h-full transition-all duration-300 ease-out rounded-full`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
