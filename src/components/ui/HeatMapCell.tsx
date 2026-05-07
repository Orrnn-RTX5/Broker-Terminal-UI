import { useMemo } from 'react';

type HeatMapCellProps = {
  value: number;
  min?: number;
  max?: number;
  format?: (value: number) => string;
  className?: string;
  children?: React.ReactNode;
};

export function HeatMapCell({
  value,
  min = -100,
  max = 100,
  format = (v) => v.toFixed(2),
  className = '',
  children
}: HeatMapCellProps) {
  const { intensity, isPositive } = useMemo(() => {
    const normalized = Math.abs(value) / Math.max(Math.abs(min), Math.abs(max));
    const clamped = Math.min(Math.max(normalized, 0), 1);
    return {
      intensity: clamped,
      isPositive: value >= 0
    };
  }, [value, min, max]);

  const backgroundColor = useMemo(() => {
    if (value === 0) return 'transparent';
    const color = isPositive ? '0, 200, 83' : '255, 82, 82'; // RGB for profit/loss
    return `rgba(${color}, ${intensity * 0.3})`;
  }, [isPositive, intensity, value]);

  return (
    <div
      className={`heat-map-cell relative ${className}`}
      style={{ backgroundColor }}
    >
      {children || (
        <span className={`font-mono text-xs ${isPositive ? 'text-profit' : 'text-loss'}`}>
          {format(value)}
        </span>
      )}
    </div>
  );
}
