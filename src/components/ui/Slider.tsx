import { useId, useState, useRef } from 'react';

type SliderProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  showValue?: boolean;
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
};

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = true,
  format = (v) => v.toString(),
  disabled = false,
  className = ''
}: SliderProps) {
  const id = useId();
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const percentage = ((value - min) / (max - min)) * 100;

  const handleMouseDown = () => {
    if (!disabled) setIsDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const updateValue = (clientX: number) => {
    if (!trackRef.current || disabled) return;

    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawValue = min + percent * (max - min);
    const steppedValue = Math.round(rawValue / step) * step;
    const clampedValue = Math.max(min, Math.min(max, steppedValue));

    onChange(clampedValue);
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    updateValue(e.clientX);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      updateValue(e.clientX);
    }
  };

  // Set up global mouse listeners for dragging
  useState(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => handleMouseMove(e);
    const handleGlobalMouseUp = () => handleMouseUp();

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  });

  return (
    <div className={`w-full ${className}`}>
      {(label || showValue) && (
        <div className="flex justify-between items-center mb-2">
          {label && (
            <label htmlFor={id} className="text-sm text-zinc-400">
              {label}
            </label>
          )}
          {showValue && (
            <span className="text-sm font-mono text-zinc-300">
              {format(value)}
            </span>
          )}
        </div>
      )}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className={`
          relative h-2 bg-zinc-800 rounded-full cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <div
          className="absolute h-full bg-[#2196F3] rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
        <div
          className={`
            absolute top-1/2 -translate-y-1/2
            w-4 h-4 bg-white border-2 border-[#2196F3] rounded-full shadow-lg
            cursor-grab active:cursor-grabbing
            transition-transform
            ${isDragging ? 'scale-110' : 'hover:scale-110'}
            ${disabled ? 'cursor-not-allowed' : ''}
          `}
          style={{ left: `calc(${percentage}% - 8px)` }}
          onMouseDown={handleMouseDown}
        />
      </div>
      <div className="flex justify-between mt-1 text-2xs text-zinc-600">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
