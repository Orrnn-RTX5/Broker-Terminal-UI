/**
 * React Hook for Keyboard Shortcuts
 * Provides a clean React interface for registering keyboard shortcuts
 *
 * Features:
 * - Automatic registration/unregistration on mount/unmount
 * - Conditional activation based on deps
 * - TypeScript support
 * - Multiple shortcuts per component
 */

import { useEffect, useRef, useState } from 'react';
import { keyboardShortcutManager, type ShortcutDefinition } from '../services/keyboardShortcutManager';

export interface UseKeyboardShortcutOptions {
  enabled?: boolean;
  priority?: number;
  category?: string;
  allowInInput?: boolean;
}

/**
 * Register a single keyboard shortcut
 *
 * @example
 * useKeyboardShortcut({
 *   key: 's',
 *   ctrl: true,
 *   description: 'Save document',
 *   handler: () => save()
 * });
 */
export function useKeyboardShortcut(
  shortcut: Omit<ShortcutDefinition, 'id'> & { id?: string },
  deps: React.DependencyList = []
): void {
  const idRef = useRef<string>(shortcut.id || `shortcut-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    if ((shortcut.enabled as any) === false) return;

    const fullShortcut: ShortcutDefinition = {
      ...shortcut,
      id: idRef.current,
      enabled: (shortcut as any).enabled !== false
    };

    const unregister = keyboardShortcutManager.register(fullShortcut);

    return () => {
      unregister();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcut.enabled, ...deps]);
}

/**
 * Register multiple keyboard shortcuts at once
 *
 * @example
 * useKeyboardShortcuts([
 *   { key: 's', ctrl: true, description: 'Save', handler: save },
 *   { key: 'o', ctrl: true, description: 'Open', handler: open }
 * ]);
 */
export function useKeyboardShortcuts(
  shortcuts: Array<Omit<ShortcutDefinition, 'id'> & { id?: string }>,
  deps: React.DependencyList = []
): void {
  const idsRef = useRef<string[]>(
    shortcuts.map((s, i) => s.id || `shortcut-${i}-${Math.random().toString(36).substr(2, 9)}`)
  );

  useEffect(() => {
    const unregisterFns = shortcuts.map((shortcut, index) => {
      if ((shortcut.enabled as any) === false) return () => { };

      const fullShortcut: ShortcutDefinition = {
        ...shortcut,
        id: idsRef.current[index],
        enabled: (shortcut as any).enabled !== false, // undefined means enabled
      };

      return keyboardShortcutManager.register(fullShortcut);
    });

    return () => {
      unregisterFns.forEach(fn => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts.length, ...deps]);
}

/**
 * Hook to get all registered shortcuts (for help dialogs, etc.)
 *
 * @example
 * const shortcuts = useShortcutList();
 * return <ShortcutHelpDialog shortcuts={shortcuts} />;
 */
export function useShortcutList(): ShortcutDefinition[] {
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>([]);

  useEffect(() => {
    const unsubscribe = keyboardShortcutManager.subscribe(setShortcuts);
    return unsubscribe;
  }, []);

  return shortcuts;
}

/**
 * Hook to get shortcuts by category
 *
 * @example
 * const fileShortcuts = useShortcutsByCategory('File');
 */
export function useShortcutsByCategory(category: string): ShortcutDefinition[] {
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>([]);

  useEffect(() => {
    const unsubscribe = keyboardShortcutManager.subscribe((allShortcuts) => {
      setShortcuts(allShortcuts.filter(s => s.category === category));
    });
    return unsubscribe;
  }, [category]);

  return shortcuts;
}

/**
 * Hook to conditionally enable/disable a shortcut
 *
 * @example
 * useShortcutToggle('file.save', canSave);
 */
export function useShortcutToggle(id: string, enabled: boolean): void {
  useEffect(() => {
    keyboardShortcutManager.setEnabled(id, enabled);
  }, [id, enabled]);
}

/**
 * Hook to format a shortcut for display
 *
 * @example
 * const formatted = useShortcutFormat({ key: 's', ctrl: true });
 * // Returns: "Ctrl+S"
 */
export function useShortcutFormat(shortcut: Partial<ShortcutDefinition>): string {
  return keyboardShortcutManager.formatShortcut(shortcut as ShortcutDefinition);
}

// React hooks are imported at the top of the file
