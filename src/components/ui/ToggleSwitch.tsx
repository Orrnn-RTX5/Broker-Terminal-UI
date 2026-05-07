import { useId } from 'react';

type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = ''
}: ToggleSwitchProps) {
  const id = useId();

  const sizeClasses = {
    sm: {
      track: 'w-8 h-4',
      thumb: 'w-3 h-3',
      translate: 'translate-x-4'
    },
    md: {
      track: 'w-11 h-6',
      thumb: 'w-5 h-5',
      translate: 'translate-x-5'
    },
    lg: {
      track: 'w-14 h-7',
      thumb: 'w-6 h-6',
      translate: 'translate-x-7'
    }
  }[size];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? id : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          ${sizeClasses.track}
          relative inline-flex items-center rounded-full
          transition-colors duration-200 ease-in-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${checked ? 'bg-[#00C853]' : 'bg-zinc-700'}
        `}
      >
        <span
          className={`
            ${sizeClasses.thumb}
            inline-block rounded-full bg-white shadow-lg
            transform transition-transform duration-200 ease-in-out
            ${checked ? sizeClasses.translate : 'translate-x-0.5'}
          `}
        />
      </button>
      {label && (
        <label
          id={id}
          htmlFor={id}
          className={`text-sm ${disabled ? 'text-zinc-600' : 'text-zinc-300'} cursor-pointer`}
        >
          {label}
        </label>
      )}
    </div>
  );
}
