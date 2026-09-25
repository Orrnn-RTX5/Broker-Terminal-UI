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

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
  const generatedId = useId();
  useKeyboardShortcuts([{ ...shortcut, id: shortcut.id || `shortcut-${generatedId}` }], deps);
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
  const instanceId = useId();
  const anonymousIds = useRef(new Map<string, string>());
  const latestHandlers = useRef(new Map<string, ShortcutDefinition['handler']>());
  const occurrences = new Map<string, number>();
  const declarations = shortcuts.map((shortcut): ShortcutDefinition => {
    if (shortcut.id) return { ...shortcut, id: shortcut.id };
    // Anonymous declarations follow their key/action identity instead of an
    // array index, so inserting or reordering actions cannot swap handlers.
    const identity = JSON.stringify([
      shortcut.key.toLowerCase(), Boolean(shortcut.ctrl), Boolean(shortcut.shift),
      Boolean(shortcut.alt), Boolean(shortcut.meta), shortcut.description, shortcut.category,
    ]);
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    const identityKey = `${identity}:${occurrence}`;
    let id = anonymousIds.current.get(identityKey);
    if (!id) {
      id = `shortcut-${instanceId}-${anonymousIds.current.size}`;
      anonymousIds.current.set(identityKey, id);
    }
    return { ...shortcut, id };
  });
  const signature = JSON.stringify(declarations.map((declaration) => (
    Object.fromEntries(Object.entries(declaration).filter(([key]) => key !== 'handler'))
  )));

  useLayoutEffect(() => {
    latestHandlers.current = new Map(declarations.map(({ id, handler }) => [id, handler]));
  });

  useEffect(() => {
    const unregisterFns = declarations
      .filter((shortcut) => shortcut.enabled !== false)
      .map((shortcut) => keyboardShortcutManager.register({
        ...shortcut,
        handler: (event) => latestHandlers.current.get(shortcut.id)?.(event),
      }));

    return () => {
      unregisterFns.forEach(fn => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ...deps]);
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
