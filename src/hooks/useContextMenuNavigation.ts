/**
 * Context Menu Navigation Hook
 * Implements full keyboard navigation for context menus with MT5-style controls
 */

import { useEffect, useCallback, useState, RefObject } from 'react';

export interface MenuNavigationState {
  focusedIndex: number;
  openSubmenu: string | null;
  submenuFocusedIndex: number;
}

export interface UseContextMenuNavigationOptions {
  isOpen: boolean;
  itemCount: number;
  hasSubmenu?: (index: number) => boolean;
  getSubmenuItemCount?: (submenuId: string) => number;
  onClose: () => void;
  onItemSelect: (index: number) => void;
  onSubmenuSelect?: (submenuId: string, itemIndex: number) => void;
  menuRef: RefObject<HTMLDivElement>;
}

export function useContextMenuNavigation({
  isOpen,
  itemCount,
  hasSubmenu = () => false,
  getSubmenuItemCount = () => 0,
  onClose,
  onItemSelect,
  onSubmenuSelect,
  menuRef,
}: UseContextMenuNavigationOptions) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [submenuFocusedIndex, setSubmenuFocusedIndex] = useState(0);

  // Reset state when menu opens
  useEffect(() => {
    if (isOpen) {
      setFocusedIndex(0);
      setOpenSubmenu(null);
      setSubmenuFocusedIndex(0);
    }
  }, [isOpen]);

  // Focus management - trap focus in menu
  useEffect(() => {
    if (isOpen && menuRef.current) {
      menuRef.current.focus();
    }
  }, [isOpen, menuRef]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          if (openSubmenu) {
            // Close submenu first
            setOpenSubmenu(null);
            setSubmenuFocusedIndex(0);
          } else {
            // Close entire menu
            onClose();
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (openSubmenu) {
            // Navigate in submenu
            const submenuCount = getSubmenuItemCount(openSubmenu);
            setSubmenuFocusedIndex((prev) => (prev + 1) % submenuCount);
          } else {
            // Navigate in main menu
            setFocusedIndex((prev) => (prev + 1) % itemCount);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (openSubmenu) {
            // Navigate in submenu
            const submenuCount = getSubmenuItemCount(openSubmenu);
            setSubmenuFocusedIndex((prev) => (prev - 1 + submenuCount) % submenuCount);
          } else {
            // Navigate in main menu
            setFocusedIndex((prev) => (prev - 1 + itemCount) % itemCount);
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (!openSubmenu && hasSubmenu(focusedIndex)) {
            // Open submenu
            setOpenSubmenu(`submenu-${focusedIndex}`);
            setSubmenuFocusedIndex(0);
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if (openSubmenu) {
            // Close submenu and return to parent menu
            setOpenSubmenu(null);
            setSubmenuFocusedIndex(0);
          }
          break;

        case 'Enter':
        case ' ':
          e.preventDefault();
          if (openSubmenu) {
            // Execute submenu item
            if (onSubmenuSelect) {
              onSubmenuSelect(openSubmenu, submenuFocusedIndex);
            }
            onClose();
          } else if (hasSubmenu(focusedIndex)) {
            // Open submenu
            setOpenSubmenu(`submenu-${focusedIndex}`);
            setSubmenuFocusedIndex(0);
          } else {
            // Execute main menu item
            onItemSelect(focusedIndex);
            onClose();
          }
          break;

        case 'Tab':
          // Prevent tab from leaving the menu
          e.preventDefault();
          break;

        default:
          // Letter navigation (first letter of menu item)
          // This can be enhanced to jump to items starting with the pressed letter
          break;
      }
    },
    [
      isOpen,
      focusedIndex,
      openSubmenu,
      submenuFocusedIndex,
      itemCount,
      hasSubmenu,
      getSubmenuItemCount,
      onClose,
      onItemSelect,
      onSubmenuSelect,
    ]
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  return {
    focusedIndex,
    openSubmenu,
    submenuFocusedIndex,
    setOpenSubmenu,
  };
}
