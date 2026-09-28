import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import { METRIC_UNAVAILABLE } from './tradeTabModel';

type TradeMetricValueProps = {
  value: number;
  formatFn?: (value: number) => ReactNode;
  prefix?: string;
  suffix?: string;
  defaultColor?: string;
  flashDirection?: boolean;
};

export function TradeMetricValue({
  value,
  formatFn,
  prefix = '',
  suffix = '',
  defaultColor = 'text-zinc-100',
  flashDirection = true,
}: TradeMetricValueProps) {
  const [changeColor, setChangeColor] = useState<string | null>(null);
  const previousValueRef = useRef<number | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const numericValue = Number(value);

  useEffect(() => {
    if (!Number.isFinite(numericValue)) return;

    const previousValue = previousValueRef.current;
    if (flashDirection && previousValue !== null && numericValue !== previousValue) {
      // A short-lived state value is intentional: it is the visual price-change flash.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChangeColor(numericValue > previousValue ? 'text-[#22c55e]' : 'text-[#ff2d2d]');
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setChangeColor(null), 900);
    }

    previousValueRef.current = numericValue;

    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [flashDirection, numericValue]);

  return (
    <span className={`${flashDirection ? (changeColor ?? defaultColor) : defaultColor} px-0.5 rounded-sm inline-block transition-colors duration-150`}>
      {prefix}{formatFn ? formatFn(value) : value}{suffix}
    </span>
  );
}

// The dash is deliberately not a synthetic zero: this metric was not reported by the server.
export function UnavailableTradeMetric({
  title = 'Not reported by the trading server',
}: {
  title?: string;
}) {
  const tr = useUiTranslation();
  return (
    <span className="px-0.5 rounded-sm inline-block text-zinc-500" title={tr(title)}>
      {METRIC_UNAVAILABLE}
    </span>
  );
}
