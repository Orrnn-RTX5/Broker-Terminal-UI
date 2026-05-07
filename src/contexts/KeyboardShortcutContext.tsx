/**
 * Keyboard Shortcut Context
 * Provides global keyboard shortcut management across the application
 *
 * Features:
 * - Centralized shortcut registry
 * - Enable/disable shortcuts globally or by ID
 * - Shortcut conflict detection
 * - React Context integration
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  keyboardShortcutManager,
  type ShortcutDefinition,
  type ShortcutHint,
  DEFAULT_SHORTCUTS
} from '../services/keyboardShortcutManager';

interface KeyboardShortcutContextValue {
  shortcuts: ShortcutDefinition[];
  enabled: boolean;
  setGlobalEnabled: (enabled: boolean) => void;
  setShortcutEnabled: (id: string, enabled: boolean) => void;
  getShortcutHints: () => ShortcutHint[];
  getShortcutsByCategory: (category: string) => ShortcutDefinition[];
  formatShortcut: (shortcut: Partial<ShortcutDefinition>) => string;
  findShortcut: (id: string) => ShortcutDefinition | undefined;
  hasConflicts: () => boolean;
  getConflicts: () => Array<{ key: string; shortcuts: ShortcutDefinition[] }>;
}

const KeyboardShortcutContext = createContext<KeyboardShortcutContextValue | null>(null);

interface KeyboardShortcutProviderProps {
  children: ReactNode;
  autoInitialize?: boolean;
}

/**
 * Keyboard Shortcut Provider
 * Wraps the application and provides keyboard shortcut management
 *
 * @example
 * function App() {
 *   return (
 *     <KeyboardShortcutProvider>
 *       <YourApp />
 *     </KeyboardShortcutProvider>
 *   );
 * }
 */
export function KeyboardShortcutProvider({
  children,
  autoInitialize = true
}: KeyboardShortcutProviderProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>([]);
  const [enabled, setEnabled] = useState(true);

  // Initialize keyboard manager
  useEffect(() => {
    if (!autoInitialize) return;

    console.log('[KeyboardShortcut] Initializing provider');

    // Initialize the manager
    const cleanup = keyboardShortcutManager.initialize();

    // Subscribe to shortcut changes
    const unsubscribe = keyboardShortcutManager.subscribe(setShortcuts);

    return () => {
      console.log('[KeyboardShortcut] Cleaning up provider');
      cleanup();
      unsubscribe();
    };
  }, [autoInitialize]);

  const setGlobalEnabled = useCallback((enabled: boolean) => {
    setEnabled(enabled);
    keyboardShortcutManager.setGlobalEnabled(enabled);
  }, []);

  const setShortcutEnabled = useCallback((id: string, enabled: boolean) => {
    keyboardShortcutManager.setEnabled(id, enabled);
  }, []);

  const getShortcutHints = useCallback((): ShortcutHint[] => {
    return keyboardShortcutManager.getShortcutHints();
  }, []);

  const getShortcutsByCategory = useCallback((category: string): ShortcutDefinition[] => {
    return keyboardShortcutManager.getShortcutsByCategory(category);
  }, []);

  const formatShortcut = useCallback((shortcut: Partial<ShortcutDefinition>): string => {
    return keyboardShortcutManager.formatShortcut(shortcut as ShortcutDefinition);
  }, []);

  const findShortcut = useCallback((id: string): ShortcutDefinition | undefined => {
    return keyboardShortcutManager.findShortcut(id);
  }, []);

  const hasConflicts = useCallback((): boolean => {
    return keyboardShortcutManager.getConflicts().length > 0;
  }, []);

  const getConflicts = useCallback(() => {
    return keyboardShortcutManager.getConflicts();
  }, []);

  const value: KeyboardShortcutContextValue = {
    shortcuts,
    enabled,
    setGlobalEnabled,
    setShortcutEnabled,
    getShortcutHints,
    getShortcutsByCategory,
    formatShortcut,
    findShortcut,
    hasConflicts,
    getConflicts
  };

  return (
    <KeyboardShortcutContext.Provider value={value}>
      {children}
    </KeyboardShortcutContext.Provider>
  );
}

/**
 * Hook to access keyboard shortcut context
 *
 * @example
 * const { setGlobalEnabled, getShortcutHints } = useKeyboardShortcutContext();
 */
export function useKeyboardShortcutContext(): KeyboardShortcutContextValue {
  const context = useContext(KeyboardShortcutContext);

  if (!context) {
    throw new Error(
      'useKeyboardShortcutContext must be used within a KeyboardShortcutProvider'
    );
  }

  return context;
}

/**
 * Hook to temporarily disable shortcuts
 * Useful for modals, dialogs, or input-heavy components
 *
 * @example
 * function MyDialog() {
 *   useDisableShortcuts(); // Disables all shortcuts while this component is mounted
 *   return <div>...</div>;
 * }
 */
export function useDisableShortcuts(): void {
  const { setGlobalEnabled } = useKeyboardShortcutContext();

  useEffect(() => {
    setGlobalEnabled(false);
    return () => setGlobalEnabled(true);
  }, [setGlobalEnabled]);
}

/**
 * Hook to get shortcut hint for a specific action
 * Useful for displaying shortcuts in UI
 *
 * @example
 * function SaveButton() {
 *   const hint = useShortcutHint('file.save');
 *   return <button title={hint}>Save {hint && `(${hint})`}</button>;
 * }
 */
export function useShortcutHint(id: string): string | null {
  const { findShortcut, formatShortcut } = useKeyboardShortcutContext();

  const shortcut = findShortcut(id);
  if (!shortcut) return null;

  return formatShortcut(shortcut);
}

/**
 * Hook to detect shortcut conflicts
 * Useful for settings/configuration screens
 *
 * @example
 * function ShortcutSettings() {
 *   const conflicts = useShortcutConflicts();
 *   if (conflicts.length > 0) {
 *     return <Alert>Found {conflicts.length} conflicts</Alert>;
 *   }
 * }
 */
export function useShortcutConflicts() {
  const { getConflicts } = useKeyboardShortcutContext();
  const [conflicts, setConflicts] = useState<Array<{ key: string; shortcuts: ShortcutDefinition[] }>>([]);

  useEffect(() => {
    setConflicts(getConflicts());
  }, [getConflicts]);

  return conflicts;
}

/**
 * Export the context for advanced use cases
 */
export { KeyboardShortcutContext };
