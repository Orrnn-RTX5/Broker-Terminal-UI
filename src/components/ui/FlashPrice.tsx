// Simple price display component (no flash/blink animations)

type FlashPriceProps = {
  value: number | string;
  format?: (value: number) => string;
  direction?: 'up' | 'down' | 'none';
  flashDuration?: number;
  className?: string;
  colorize?: boolean;
};

export function FlashPrice({
  value,
  format = (v) => v.toFixed(5),
  className = '',
}: FlashPriceProps) {
  const displayValue = typeof value === 'number' ? format(value) : value;

  return (
    <span className={`font-mono ${className}`}>
      {displayValue}
    </span>
  );
}
