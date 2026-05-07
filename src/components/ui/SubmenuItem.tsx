import { Icon } from './/Icon';
import React, { useRef, useState, useEffect } from 'react';
import { useHoverIntent } from '../../hooks/useHoverIntent';
import { useSafeHoverTriangle } from '../../hooks/useSafeHoverTriangle';

interface SubmenuItemProps {
  label: string;
  shortcut?: string;
  checked?: boolean;
  hasSubmenu?: boolean;
  active?: boolean;
  action?: () => void;
  icon?: React.ReactNode;
  autoClose?: boolean;
  submenu?: React.ReactNode;
  onSubmenuChange?: (isOpen: boolean) => void;
}

/**
 * SubmenuItem - Context menu item with MT5-equivalent hover behavior
 *
 * Features:
 * - 150ms hover intent delay (feels instant but prevents accidents)
 * - Safe hover triangle (move cursor toward submenu without closing)
 * - No flickering when moving between items
 * - Desktop-grade UX matching professional trading platforms
 */
export const SubmenuItem: React.FC<SubmenuItemProps> = ({
  label,
  shortcut,
  checked,
  hasSubmenu,
  active,
  action,
  icon,
  autoClose = true,
  submenu,
  onSubmenuChange,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [isSubmenuOpen, setIsSubmenuOpen] = useState(false);

  // Hover intent for parent item (150ms delay)
  const hoverIntent = useHoverIntent({ delay: 150, sensitivity: 7 });

  // Safe hover triangle for submenu navigation
  const safeTriangle = useSafeHoverTriangle({
    parentElement: parentRef.current,
    submenuElement: submenuRef.current,
    tolerance: 100,
  });

  // Open submenu when hover intent is triggered
  useEffect(() => {
    if (hasSubmenu && hoverIntent.isHovering) {
      setIsSubmenuOpen(true);
      onSubmenuChange?.(true);
    }
  }, [hoverIntent.isHovering, hasSubmenu, onSubmenuChange]);

  // Handle mouse leave with safe triangle logic
  useEffect(() => {
    if (!hasSubmenu) return;

    const handleGlobalMouseMove = () => {
      if (isSubmenuOpen) {
        // Check if mouse should keep submenu open
        const shouldStay = safeTriangle.shouldStayOpen();

        if (!shouldStay) {
          // Small delay before closing to prevent flicker
          setTimeout(() => {
            if (!safeTriangle.shouldStayOpen()) {
              setIsSubmenuOpen(false);
              onSubmenuChange?.(false);
              hoverIntent.reset();
            }
          }, 100);
        }
      }
    };

    if (isSubmenuOpen) {
      const timer = setInterval(handleGlobalMouseMove, 50);
      return () => clearInterval(timer);
    }
  }, [isSubmenuOpen, hasSubmenu, safeTriangle, hoverIntent, onSubmenuChange]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (hasSubmenu) {
      // Toggle submenu on click (secondary interaction)
      setIsSubmenuOpen(!isSubmenuOpen);
      onSubmenuChange?.(!isSubmenuOpen);
    } else if (action) {
      action();
    }
  };

  return (
    <div
      ref={parentRef}
      className={`flex items-center px-3 py-1.5 hover:bg-zinc-700 hover:text-white cursor-pointer group relative ${
        active || isSubmenuOpen ? 'bg-zinc-700 text-white' : 'text-zinc-300'
      }`}
      onClick={handleClick}
      onMouseEnter={hoverIntent.onMouseEnter}
      onMouseMove={hoverIntent.onMouseMove}
      onMouseLeave={hoverIntent.onMouseLeave}
    >
      <div className="w-5 flex items-center justify-center mr-1">
        {checked && <Icon name="check" size="xs" />}
        {icon && !checked && <span className="text-zinc-400 group-hover:text-white">{icon}</span>}
      </div>
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-zinc-500 group-hover:text-zinc-200 ml-4 font-mono">
          {shortcut}
        </span>
      )}
      {hasSubmenu && <Icon name="chevron-right" size="xs" className="ml-2 text-zinc-500 group-hover:text-white" />}

      {/* Submenu */}
      {hasSubmenu && isSubmenuOpen && submenu && (
        <div
          ref={submenuRef}
          className="absolute left-full top-0 -ml-1 w-48 bg-[#131316] border border-zinc-600 shadow-xl rounded-sm py-1 z-50"
          style={{ pointerEvents: 'auto' }}
        >
          {submenu}
        </div>
      )}
    </div>
  );
};
