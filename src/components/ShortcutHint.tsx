/**
 * Shortcut Hint Component
 * Displays keyboard shortcut hints in menu items and tooltips
 */

import React from 'react';

interface ShortcutHintProps {
  shortcut: string;
  className?: string;
}

/**
 * Display a keyboard shortcut hint
 *
 * @example
 * <button>
 *   Save
 *   <ShortcutHint shortcut="Ctrl+S" />
 * </button>
 */
export function ShortcutHint({ shortcut, className = '' }: ShortcutHintProps) {
  if (!shortcut) return null;

  return (
    <span className={`text-[10px] text-zinc-500 font-mono tracking-tighter ${className}`}>
      {shortcut}
    </span>
  );
}

/**
 * Display a shortcut hint with tooltip
 *
 * @example
 * <ShortcutTooltip shortcut="Ctrl+S" description="Save workspace">
 *   <button>Save</button>
 * </ShortcutTooltip>
 */
interface ShortcutTooltipProps {
  shortcut: string;
  description: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function ShortcutTooltip({
  shortcut,
  description,
  children,
  position = 'bottom'
}: ShortcutTooltipProps) {
  const [isVisible, setIsVisible] = React.useState(false);

  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2'
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute ${positionClasses[position]} z-50 animate-in fade-in zoom-in-95 duration-100`}
        >
          <div className="bg-zinc-900 text-zinc-200 px-3 py-2 rounded-lg shadow-xl border border-zinc-700 whitespace-nowrap">
            <div className="text-xs font-medium">{description}</div>
            {shortcut && (
              <div className="text-[10px] text-zinc-400 font-mono mt-1">
                {shortcut}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Display keyboard shortcut in badge style
 *
 * @example
 * <ShortcutBadge keys={['Ctrl', 'S']} />
 */
interface ShortcutBadgeProps {
  keys: string[];
  size?: 'sm' | 'md' | 'lg';
}

export function ShortcutBadge({ keys, size = 'sm' }: ShortcutBadgeProps) {
  const sizeClasses = {
    sm: 'text-[9px] px-1.5 py-0.5 gap-0.5',
    md: 'text-[10px] px-2 py-1 gap-1',
    lg: 'text-xs px-2.5 py-1.5 gap-1.5'
  };

  return (
    <div className={`inline-flex items-center font-mono ${sizeClasses[size]}`}>
      {keys.map((key, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span className="text-zinc-600 text-[8px]">+</span>
          )}
          <kbd className="bg-zinc-800 text-zinc-300 rounded border border-zinc-700 shadow-sm px-1.5 py-0.5">
            {key}
          </kbd>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Parse shortcut string into key parts
 * "Ctrl+Shift+S" -> ["Ctrl", "Shift", "S"]
 */
export function parseShortcut(shortcut: string): string[] {
  return shortcut.split('+').map(k => k.trim());
}
