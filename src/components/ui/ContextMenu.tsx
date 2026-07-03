import { Icon } from './/Icon';
import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useHoverIntent } from '../../hooks/useHoverIntent';
import { useSafeHoverTriangle } from '../../hooks/useSafeHoverTriangle';

// ============================================================================
// TYPES - Exported from centralized types file
// ============================================================================

import type { ContextMenuItemConfig } from './context-menu.types';
export type { ContextMenuItemConfig } from './context-menu.types';

interface ContextMenuProps {
  items: ContextMenuItemConfig[];
  onClose?: () => void;
  position?: { x: number; y: number };
  triggerSymbol?: string;
  variant?: ContextMenuVariant;
  ignoredElements?: readonly (HTMLElement | null)[];
  children?: React.ReactNode;
}

type ContextMenuVariant = 'dark' | 'mt5-light' | 'mt5-dark';

interface SubMenuState {
  parentId: string;
  items: ContextMenuItemConfig[];
  triggerRect: DOMRect;
}

// ============================================================================
// VIEWPORT COLLISION DETECTION
// ============================================================================

interface Position {
  x: number;
  y: number;
}

function calculateMenuPosition(
  triggerX: number,
  triggerY: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number
): Position {
  let x = triggerX;
  let y = triggerY;

  const EDGE_PADDING = 8;

  // MT5-style auto-flip: Horizontal overflow check
  if (x + menuWidth > viewportWidth - EDGE_PADDING) {
    // Try to flip left of cursor
    x = Math.max(EDGE_PADDING, triggerX - menuWidth);

    // If still overflows, clamp to right edge
    if (x + menuWidth > viewportWidth - EDGE_PADDING) {
      x = viewportWidth - menuWidth - EDGE_PADDING;
    }
  }

  // MT5-style auto-flip: Vertical overflow check
  if (y + menuHeight > viewportHeight - EDGE_PADDING) {
    // Try to flip above cursor
    y = Math.max(EDGE_PADDING, triggerY - menuHeight);

    // If still overflows, clamp to bottom edge
    if (y + menuHeight > viewportHeight - EDGE_PADDING) {
      y = viewportHeight - menuHeight - EDGE_PADDING;
    }
  }

  // Ensure minimum padding from all edges
  x = Math.max(EDGE_PADDING, Math.min(x, viewportWidth - menuWidth - EDGE_PADDING));
  y = Math.max(EDGE_PADDING, Math.min(y, viewportHeight - menuHeight - EDGE_PADDING));

  return { x, y };
}

function calculateSubmenuPosition(
  triggerRect: DOMRect,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number
): Position {
  const EDGE_PADDING = 8;
  const SUBMENU_OVERLAP = 4; // Slight overlap for better UX
  const MIN_GAP = 8; // Minimum gap to prevent parent/submenu overlap at corners

  let x = triggerRect.right - SUBMENU_OVERLAP;
  let y = triggerRect.top;
  let horizontalFlipped = false;

  // MT5-style horizontal flip: Try right first, then left
  if (x + menuWidth > viewportWidth - EDGE_PADDING) {
    x = triggerRect.left - menuWidth + SUBMENU_OVERLAP;
    horizontalFlipped = true;

    // If still overflows left, clamp to left edge
    if (x < EDGE_PADDING) {
      x = EDGE_PADDING;
    }
  }

  // MT5-style vertical alignment: Keep submenu aligned with parent item
  // But prevent overflow at bottom
  if (y + menuHeight > viewportHeight - EDGE_PADDING) {
    // PERFORMANCE FIX: Prevent overlap at corners when both horizontal and vertical flip
    // If we flipped horizontally AND need to flip vertically, add extra spacing
    if (horizontalFlipped) {
      // Align bottom of submenu with bottom of trigger item (prevents corner overlap)
      y = triggerRect.bottom - menuHeight;

      // If that causes top overflow, align to bottom edge with gap
      if (y < EDGE_PADDING) {
        y = Math.max(EDGE_PADDING, viewportHeight - menuHeight - EDGE_PADDING);
      }
    } else {
      // Standard vertical positioning
      y = Math.max(EDGE_PADDING, viewportHeight - menuHeight - EDGE_PADDING);

      // Alternative: Align bottom of submenu with bottom of trigger
      const bottomAlign = triggerRect.bottom - menuHeight;
      if (bottomAlign >= EDGE_PADDING && bottomAlign < y) {
        y = bottomAlign;
      }
    }
  }

  // PERFORMANCE FIX: Final bounds check with corner detection
  // Ensure minimum gap between parent menu edges and submenu
  x = Math.max(EDGE_PADDING, Math.min(x, viewportWidth - menuWidth - EDGE_PADDING));
  y = Math.max(EDGE_PADDING, Math.min(y, viewportHeight - menuHeight - EDGE_PADDING));

  // Corner overlap detection: If submenu would overlap parent menu, shift it
  const parentLeft = triggerRect.left;
  const parentRight = triggerRect.right;
  const submenuLeft = x;
  const submenuRight = x + menuWidth;

  // Check if submenu overlaps parent horizontally (shouldn't happen, but safety check)
  if (horizontalFlipped && submenuRight > parentLeft - MIN_GAP) {
    x = Math.max(EDGE_PADDING, parentLeft - menuWidth - MIN_GAP);
  } else if (!horizontalFlipped && submenuLeft < parentRight + MIN_GAP) {
    x = parentRight + MIN_GAP;
  }

  return { x, y };
}

// ============================================================================
// MENU ITEM COMPONENT (WITH SUBMENU SUPPORT)
// ============================================================================

interface MenuItemProps {
  item: ContextMenuItemConfig;
  onClose: () => void;
  onSubmenuOpen: (submenu: ContextMenuItemConfig[], rect: DOMRect, parentIndex: number) => void;
  onSubmenuClose: () => void;
  isSubmenuActive: boolean;
  itemId: string;
  itemIndex: number;
  variant: ContextMenuVariant;
  isPointerHovered?: boolean;
  onPointerEnterItem?: () => void;
  onPointerLeaveItem?: () => void;
  isFocused?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({
  item,
  onClose,
  onSubmenuOpen,
  onSubmenuClose,
  isSubmenuActive,
  itemId,
  itemIndex,
  variant,
  isPointerHovered = false,
  onPointerEnterItem,
  onPointerLeaveItem,
  isFocused = false
}) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const hasSubmenu = item.submenu && item.submenu.length > 0;

  // MT5-style hover intent: 300ms delay for submenus (MT5 standard)
  const hoverIntent = useHoverIntent({ delay: 300, sensitivity: 7 });

  // Safe hover triangle: prevents submenu closing when moving diagonally toward it
  const safeTriangle = useSafeHoverTriangle({
    parentElement: itemRef.current,
    submenuElement: submenuRef.current,
    tolerance: 100,
  });

  // Open submenu when hover intent is triggered
  useEffect(() => {
    if (hasSubmenu && hoverIntent.isHovering && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      onSubmenuOpen(item.submenu!, rect, itemIndex);
      setIsHovered(true);
    }
  }, [hoverIntent.isHovering, hasSubmenu, item.submenu, itemIndex, onSubmenuOpen]);

  // Track safe zone and close submenu intelligently
  useEffect(() => {
    if (!hasSubmenu || !isSubmenuActive) return;

    const checkSafeZone = () => {
      const shouldStay = safeTriangle.shouldStayOpen();

      if (!shouldStay && !hoverIntent.isHovering) {
        // Clear any pending close
        if (closeTimeoutRef.current) {
          clearTimeout(closeTimeoutRef.current);
        }

        // Delay close to prevent flicker (100ms tolerance)
        closeTimeoutRef.current = setTimeout(() => {
          if (!safeTriangle.shouldStayOpen() && !hoverIntent.isHovering) {
            onSubmenuClose();
            setIsHovered(false);
          }
        }, 100);
      }
    };

    const interval = setInterval(checkSafeZone, 50);
    return () => {
      clearInterval(interval);
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, [hasSubmenu, isSubmenuActive, safeTriangle, hoverIntent.isHovering, onSubmenuClose]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (item.disabled) return;

    if (hasSubmenu) {
      // Toggle submenu on click (secondary interaction method)
      if (isSubmenuActive) {
        onSubmenuClose();
        setIsHovered(false);
      } else if (itemRef.current) {
        const rect = itemRef.current.getBoundingClientRect();
        onSubmenuOpen(item.submenu!, rect, itemIndex);
        setIsHovered(true);
      }
    } else if (item.action) {
      item.action();
      if (item.autoClose !== false) {
        onClose();
      }
    }
  };

  const handleMouseEnter = (e: React.MouseEvent) => {
    setIsHovered(true);
    onPointerEnterItem?.();
    hoverIntent.onMouseEnter(e);

    // For non-submenu items, close any active submenus immediately
    if (!hasSubmenu) {
      onSubmenuClose();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    hoverIntent.onMouseMove(e);
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    setIsHovered(false);
    onPointerLeaveItem?.();
    hoverIntent.onMouseLeave();
  };

  const isMt5Light = variant === 'mt5-light';
  const isMt5Dark = variant === 'mt5-dark';
  const isMt5 = isMt5Light || isMt5Dark;

  if (item.divider) {
    return (
      <div
        className={isMt5Light
          ? "h-px bg-[#a7a7a7] my-[4px] mx-[5px]"
          : isMt5Dark
            ? "h-px bg-[#3e424b] my-[4px] mx-[5px]"
            : "h-[1px] bg-zinc-700 my-1 mx-2"}
      />
    );
  }

  const isActive = isMt5
    ? !item.disabled && (isSubmenuActive || isFocused || isPointerHovered)
    : isSubmenuActive || isHovered || isFocused;
  const itemClassName = isMt5
    ? `flex h-[23px] items-center px-[5px] py-0 cursor-default group relative ${item.disabled ? 'cursor-default' : ''}`
    : `flex items-center px-3 py-1.5 cursor-pointer group relative ${isActive
      ? 'bg-zinc-700 text-white'
      : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
      } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
  const itemStyle = isMt5Light
    ? {
      backgroundColor: isActive ? '#0078d7' : '#f2f2f2',
      color: item.disabled ? '#8a8a8a' : (isActive ? '#ffffff' : '#000000'),
    }
    : isMt5Dark
      ? {
        backgroundColor: isActive ? '#0078d7' : '#15161a',
        color: item.disabled ? '#8b9098' : (isActive ? '#ffffff' : '#e4e7ee'),
      }
      : undefined;
  const iconClassName = isMt5
    ? "w-[18px] flex items-center justify-center mr-[5px]"
    : "w-5 flex items-center justify-center mr-1";
  const customIconClassName = isMt5
    ? "text-current"
    : "text-zinc-400 group-hover:text-white";
  const shortcutClassName = isMt5
    ? "text-[12px] text-current ml-4"
    : "text-[10px] text-zinc-500 group-hover:text-zinc-200 ml-4 font-mono";
  const chevronClassName = isMt5
    ? "ml-2 text-current"
    : "ml-2 text-zinc-500 group-hover:text-white";
  const labelClassName = isMt5
    ? "min-w-0 flex-1 whitespace-nowrap"
    : "flex-1";

  return (
    <div
      ref={itemRef}
      className={itemClassName}
      style={itemStyle}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="menuitem"
      aria-disabled={item.disabled}
      aria-haspopup={hasSubmenu ? 'true' : undefined}
      aria-expanded={hasSubmenu && isSubmenuActive ? 'true' : 'false'}
      tabIndex={-1}
    >
      <div className={iconClassName} aria-hidden="true">
        {isMt5 ? (
          item.checked ? (
            <span className="block w-[14px] text-center text-[13px] font-normal leading-[13px]">
              {'\u2713'}
            </span>
          ) : item.icon ? (
            <span className={customIconClassName}>{item.icon}</span>
          ) : null
        ) : (
          <>
            {item.checked && <Icon name="check" size="xs" />}
            {item.icon && !item.checked && (
              <span className={customIconClassName}>{item.icon}</span>
            )}
          </>
        )}
      </div>
      <span className={labelClassName}>{item.label}</span>
      {item.shortcut && (
        <span className={shortcutClassName}>
          {item.shortcut}
        </span>
      )}
      {hasSubmenu && <Icon name="chevron-right" size="xs" className={chevronClassName} />}
    </div>
  );
};

// ============================================================================
// MENU COMPONENT (PORTAL-BASED)
// ============================================================================

interface MenuProps {
  items: ContextMenuItemConfig[];
  position: Position;
  onClose: () => void;
  zIndex: number;
  variant: ContextMenuVariant;
  isSubmenu?: boolean;
  triggerRect?: DOMRect;
}

const Menu: React.FC<MenuProps> = ({ items, position, onClose, zIndex, variant, isSubmenu = false, triggerRect }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [activeSubmenu, setActiveSubmenu] = useState<{
    items: ContextMenuItemConfig[];
    triggerRect: DOMRect;
    parentIndex: number;
  } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [isPositioned, setIsPositioned] = useState(false);

  // Calculate adjusted position after render using useLayoutEffect
  // This prevents menu clipping at viewport edges (MT5 behavior)
  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const newPos = isSubmenu && triggerRect
        ? calculateSubmenuPosition(
          triggerRect,
          rect.width,
          rect.height,
          viewportWidth,
          viewportHeight
        )
        : isSubmenu
          ? position
          : calculateMenuPosition(
          position.x,
          position.y,
          rect.width,
          rect.height,
          viewportWidth,
          viewportHeight
        );

      setAdjustedPosition(prev => (
        prev.x === newPos.x && prev.y === newPos.y ? prev : newPos
      ));
      setIsPositioned(prev => prev ? prev : true); // Prevent flash of mispositioned menu
    }
  }, [
    position.x,
    position.y,
    isSubmenu,
    triggerRect?.left,
    triggerRect?.right,
    triggerRect?.top,
    triggerRect?.bottom,
    items,
  ]);

  const handleSubmenuOpen = useCallback((submenuItems: ContextMenuItemConfig[], rect: DOMRect, parentIndex: number) => {
    setActiveSubmenu(prev => {
      if (
        prev
        && prev.parentIndex === parentIndex
        && prev.items === submenuItems
        && prev.triggerRect.left === rect.left
        && prev.triggerRect.right === rect.right
        && prev.triggerRect.top === rect.top
        && prev.triggerRect.bottom === rect.bottom
      ) {
        return prev;
      }
      return { items: submenuItems, triggerRect: rect, parentIndex };
    });
  }, []);

  const handleSubmenuClose = useCallback(() => {
    setActiveSubmenu(prev => prev === null ? prev : null);
  }, []);

  useEffect(() => {
    setActiveSubmenu(prev => {
      if (!prev) return prev;
      const nextItems = items[prev.parentIndex]?.submenu;
      if (!nextItems || nextItems.length === 0) return null;
      return prev.items === nextItems ? prev : { ...prev, items: nextItems };
    });
  }, [items]);

  // Keyboard navigation (MT5-style) with proper focus management
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const nonDividerItems = items.filter(item => !item.divider && !item.disabled);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setFocusedIndex(prev => {
            const nextIndex = (prev + 1) % nonDividerItems.length;
            // Scroll focused item into view
            const itemIndex = items.indexOf(nonDividerItems[nextIndex]);
            itemRefs.current[itemIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return nextIndex;
          });
          break;

        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setFocusedIndex(prev => {
            const prevIndex = (prev - 1 + nonDividerItems.length) % nonDividerItems.length;
            // Scroll focused item into view
            const itemIndex = items.indexOf(nonDividerItems[prevIndex]);
            itemRefs.current[itemIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return prevIndex;
          });
          break;

        case 'ArrowRight':
          e.preventDefault();
          e.stopPropagation();
          const currentItem = nonDividerItems[focusedIndex];
          if (currentItem?.submenu && currentItem.submenu.length > 0) {
            const itemIndex = items.indexOf(currentItem);
            const itemElement = itemRefs.current[itemIndex];
            if (itemElement) {
              const rect = itemElement.getBoundingClientRect();
              handleSubmenuOpen(currentItem.submenu, rect, itemIndex);
            }
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          e.stopPropagation();
          if (activeSubmenu) {
            handleSubmenuClose();
          } else if (isSubmenu) {
            onClose();
          }
          break;

        case 'Enter':
        case ' ':
          e.preventDefault();
          e.stopPropagation();
          const selectedItem = nonDividerItems[focusedIndex];
          if (selectedItem?.submenu && selectedItem.submenu.length > 0) {
            const itemIndex = items.indexOf(selectedItem);
            const itemElement = itemRefs.current[itemIndex];
            if (itemElement) {
              const rect = itemElement.getBoundingClientRect();
              handleSubmenuOpen(selectedItem.submenu, rect, itemIndex);
            }
          } else if (selectedItem?.action) {
            selectedItem.action();
            if (selectedItem.autoClose !== false) {
              onClose();
            }
          }
          break;

        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          if (activeSubmenu) {
            handleSubmenuClose();
          } else {
            onClose();
          }
          break;

        default:
          // First-letter navigation (MT5 feature)
          if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
            const letter = e.key.toLowerCase();
            const matchingIndex = nonDividerItems.findIndex(item =>
              item.label.toLowerCase().startsWith(letter)
            );
            if (matchingIndex !== -1) {
              setFocusedIndex(matchingIndex);
              const itemIndex = items.indexOf(nonDividerItems[matchingIndex]);
              itemRefs.current[itemIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
          break;
      }
    };

    // Only attach listener when menu is focused or a submenu is active
    if (menuRef.current) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [focusedIndex, items, activeSubmenu, isSubmenu, handleSubmenuOpen, handleSubmenuClose, onClose]);

  // Focus management - set focus on menu when it opens (MT5 behavior)
  useLayoutEffect(() => {
    if (menuRef.current && !isSubmenu && isPositioned) {
      // Delay focus to prevent immediate keyboard event conflicts
      const timer = setTimeout(() => {
        menuRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isSubmenu, isPositioned]);

  return (
    <>
      <div
        ref={menuRef}
        className={variant === 'mt5-light'
          ? "fixed w-[210px] bg-[#f2f2f2] border border-[#9a9a9a] shadow-[2px_2px_4px_rgba(0,0,0,0.35)] rounded-none py-[3px] text-[12px] leading-[18px] text-black outline-none transition-opacity duration-75 max-h-[80vh] overflow-y-auto"
          : variant === 'mt5-dark'
            ? "fixed w-[210px] bg-[#15161a] border border-[#4b5563] shadow-[2px_2px_6px_rgba(0,0,0,0.65)] rounded-none py-[3px] text-[12px] leading-[18px] text-[#e4e7ee] outline-none transition-opacity duration-75 max-h-[80vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-[#15161a]"
            : "fixed w-64 bg-[#131316]/80 backdrop-blur-md border border-zinc-600 shadow-2xl rounded-sm py-1 text-xs text-zinc-200 outline-none transition-opacity duration-100 max-h-[80vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700"}
        style={{
          left: `${adjustedPosition.x}px`,
          top: `${adjustedPosition.y}px`,
          zIndex,
          opacity: isPositioned ? 1 : 0,
          pointerEvents: isPositioned ? 'auto' : 'none',
          outline: 'none',
          userSelect: 'none',
        }}
        tabIndex={-1}
        role="menu"
        aria-label="Context menu"
      >
        {items.map((item, index) => {
          const itemId = `item-${index}`;
          const nonDividerItems = items.filter(i => !i.divider && !i.disabled);
          const focusedItem = focusedIndex >= 0 ? nonDividerItems[focusedIndex] : null;
          const isFocused = !item.divider && !item.disabled && focusedItem === item;

          return (
            <div
              key={itemId}
              ref={el => { itemRefs.current[index] = el; }}
            >
              <MenuItem
                item={item}
                onClose={onClose}
                onSubmenuOpen={handleSubmenuOpen}
                onSubmenuClose={handleSubmenuClose}
                isSubmenuActive={activeSubmenu !== null && activeSubmenu.parentIndex === index}
                itemId={itemId}
                itemIndex={index}
                variant={variant}
                isPointerHovered={hoveredIndex === index}
                onPointerEnterItem={() => setHoveredIndex(index)}
                onPointerLeaveItem={() => setHoveredIndex(prev => prev === index ? null : prev)}
                isFocused={isFocused}
              />
            </div>
          );
        })}
      </div>

      {/* Render submenu with collision detection and higher z-index */}
      {activeSubmenu && (
        <SubmenuPortal
          items={activeSubmenu.items}
          triggerRect={activeSubmenu.triggerRect}
          onClose={onClose}
          zIndex={zIndex + 10} // Ensure submenus are always above parent menus
          variant={variant}
        />
      )}
    </>
  );
};

// ============================================================================
// SUBMENU PORTAL (WITH VIEWPORT COLLISION DETECTION)
// ============================================================================

interface SubmenuPortalProps {
  items: ContextMenuItemConfig[];
  triggerRect: DOMRect;
  onClose: () => void;
  zIndex: number;
  variant: ContextMenuVariant;
}

const SubmenuPortal: React.FC<SubmenuPortalProps> = ({ items, triggerRect, onClose, zIndex, variant }) => {
  const initialPosition = { x: triggerRect.right, y: triggerRect.top };

  return (
    <Menu
      items={items}
      position={initialPosition}
      onClose={onClose}
      zIndex={zIndex}
      variant={variant}
      isSubmenu
      triggerRect={triggerRect}
    />
  );
};

// ============================================================================
// MAIN CONTEXT MENU COMPONENT (PORTAL-BASED)
// ============================================================================

export const ContextMenu: React.FC<ContextMenuProps> = ({
  items,
  onClose: externalOnClose,
  position: externalPosition,
  triggerSymbol,
  variant = 'dark',
  ignoredElements = [],
  children
}) => {
  const [internalVisible, setInternalVisible] = useState(false);
  const [internalPosition, setInternalPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const isControlled = externalPosition !== undefined && externalOnClose !== undefined;
  const visible = isControlled ? true : internalVisible;
  const position = isControlled ? externalPosition : internalPosition;
  const onClose = isControlled ? externalOnClose : () => setInternalVisible(false);

  // Keep track of the latest onClose to avoid re-running the effect on every render
  const onCloseRef = useRef(onClose);
  const ignoredElementsRef = useRef(ignoredElements);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    ignoredElementsRef.current = ignoredElements;
  }, [ignoredElements]);

  // Close on click outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isIgnoredTarget = ignoredElementsRef.current.some(element => element?.contains(target));

      if (!isIgnoredTarget && menuRef.current && !menuRef.current.contains(target)) {
        onCloseRef.current();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
      }
    };

    // Delay to avoid immediate close from the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('keydown', handleEscape, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [visible]); // Omit onCloseRef from dependencies to prevent remounting

  const handleContextMenu = (e: React.MouseEvent) => {
    if (children) {
      e.preventDefault();
      setInternalPosition({ x: e.clientX, y: e.clientY });
      setInternalVisible(true);
    }
  };

  const menuContent = visible ? createPortal(
    <div ref={menuRef}>
      {triggerSymbol && (
        <div
          className="fixed w-64 bg-[#131316]/80 backdrop-blur-md border border-zinc-600 shadow-2xl rounded-sm py-1 text-xs text-zinc-200"
          style={{
            top: position.y,
            left: position.x,
            zIndex: 9998 // Symbol header just below menu
          }}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold text-emerald-400 border-b border-zinc-700 mb-1">
            {triggerSymbol}
          </div>
        </div>
      )}
      <Menu items={items} position={position} onClose={onClose} zIndex={9999} variant={variant} />
    </div>,
    document.body
  ) : null;

  if (children) {
    if (React.isValidElement<{ onContextMenu?: React.MouseEventHandler }>(children)) {
      const existingContextMenu = children.props.onContextMenu;
      return (
        <>
          {React.cloneElement(children, {
            onContextMenu: (event: React.MouseEvent) => {
              existingContextMenu?.(event);
              if (!event.defaultPrevented) {
                handleContextMenu(event);
              }
            },
          })}
          {menuContent}
        </>
      );
    }

    return (
      <div onContextMenu={handleContextMenu} className="contents">
        {children}
        {menuContent}
      </div>
    );
  }

  return menuContent;
};

// ============================================================================
// UTILITY: SECTION HEADER
// ============================================================================

export const MenuSectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-2">
    {label}
  </div>
);

// ============================================================================
// UTILITY: DIVIDER
// ============================================================================

export const MenuDivider: React.FC = () => (
  <div className="h-[1px] bg-zinc-700 my-1 mx-2"></div>
);
