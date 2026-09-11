import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useCallback, useRef } from 'react';
import type { Timeframe } from '../TradingChart';

interface TimeframeOption {
  value: Timeframe;
  label: string;
}

const TIMEFRAME_OPTIONS: readonly TimeframeOption[] = [
  { value: 'M1', label: '1 minute' },
  { value: 'M5', label: '5 minutes' },
  { value: 'M15', label: '15 minutes' },
  { value: 'M30', label: '30 minutes' },
  { value: 'H1', label: '1 hour' },
  { value: 'H4', label: '4 hours' },
  { value: 'D1', label: '1 day' },
  { value: 'W1', label: '1 week' },
  { value: 'MN', label: '1 month' },
];

interface TimeframePickerProps {
  timeframe: Timeframe;
  advancedViewEnabled: boolean;
  onSelect: (timeframe: Timeframe) => void;
}

export const TimeframePicker: React.FC<TimeframePickerProps> = ({
  timeframe,
  advancedViewEnabled,
  onSelect,
}) => {
    const tr = useUiTranslation();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = useCallback((index: number) => {
    const normalizedIndex = (index + TIMEFRAME_OPTIONS.length) % TIMEFRAME_OPTIONS.length;
    const option = TIMEFRAME_OPTIONS[normalizedIndex];
    optionRefs.current[normalizedIndex]?.focus();
    onSelect(option.value);
  }, [onSelect]);

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) => {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = optionIndex + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = optionIndex - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = TIMEFRAME_OPTIONS.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    focusAndSelect(nextIndex);
  };

  return (
    <div
      role="radiogroup"
      aria-label={tr("Chart timeframes")}
      aria-orientation="horizontal"
      className="rtx-timeframe-picker rtx-timeframe-strip flex h-[32px] min-w-0 max-w-full flex-nowrap items-center overflow-x-auto overflow-y-hidden no-scrollbar"
    >
      {TIMEFRAME_OPTIONS.map((option, optionIndex) => {
        const selected = option.value === timeframe;
        const optionClassName = selected
          ? advancedViewEnabled
            ? 'border-[#7E57C2] bg-[#F3E5F5] text-[#6941C6]'
            : 'border-blue-500/50 bg-blue-500/15 text-blue-300'
          : advancedViewEnabled
            ? 'border-transparent bg-transparent text-[#667085] hover:border-[#d0d5dd] hover:bg-[#f9fafb] hover:text-[#344054]'
            : 'border-transparent bg-transparent text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-100';

        return (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[optionIndex] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={tr("Timeframe: {{value0}}", { value0: tr(option.label) })}
            title={tr("Timeframe: {{value0}}", { value0: tr(option.label) })}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(option.value)}
            onKeyDown={(event) => handleKeyDown(event, optionIndex)}
            className={`rtx-timeframe-option flex h-[32px] min-w-[38px] shrink-0 items-center justify-center whitespace-nowrap rounded-[3px] border px-2.5 text-[13px] font-normal font-segoe leading-none transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-400 ${optionClassName}`}
          >
            {option.value}
          </button>
        );
      })}
    </div>
  );
};
