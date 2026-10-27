/**
 * Global Keyboard Shortcut Manager
 * MT5-compatible keyboard shortcut system with conflict detection and input protection
 *
 * Features:
 * - Global shortcut registration with priority levels
 * - Automatic conflict detection and resolution
 * - Input field protection (disables shortcuts when typing)
 * - Modal/dialog awareness
 * - Shortcut hints for UI components
 * - Event delegation and automatic cleanup
 */

export interface ShortcutDefinition {
  id: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean; // Command key on Mac
  description: string;
  category?: string;
  handler: (event: KeyboardEvent) => void;
  enabled?: boolean;
  priority?: number; // Higher priority shortcuts take precedence
  allowInInput?: boolean; // Allow shortcut even when input is focused
}

export interface ShortcutHint {
  id: string;
  label: string;
  shortcut: string;
}

type ShortcutListener = (shortcuts: ShortcutDefinition[]) => void;

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"], [role="menu"], [role="menubar"]';
const NAVIGATION_WIDGET_SELECTOR = '[role="listbox"], [role="combobox"], [role="tree"], [role="tablist"], [role="grid"], [role="slider"], [role="spinbutton"], [role="radiogroup"]';
const NAVIGATION_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown', 'tab', 'enter', ' ', 'escape', 'backspace', 'delete']);

export const getShortcutEventTarget = (event: KeyboardEvent): Element | null => {
  const target = event.composedPath().find((node): node is Element => node instanceof Element);
  if (target) return target;
  if (event.target instanceof Element) return event.target;
  return document.activeElement;
};

export const shouldIgnoreShortcutEvent = (event: KeyboardEvent): boolean => (
  !event.key || event.defaultPrevented || event.repeat || event.isComposing
  || event.keyCode === 229 || event.key === 'Process' || event.key === 'Dead'
  || event.getModifierState('AltGraph')
);

export const isShortcutInput = (event: KeyboardEvent): boolean => {
  const target = getShortcutEventTarget(event);
  if (!target) return false;
  if (target.closest('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]')) return true;
  const editable = target.closest('[contenteditable]');
  return (target instanceof HTMLElement && target.isContentEditable)
    || Boolean(editable && editable.getAttribute('contenteditable')?.toLowerCase() !== 'false');
};

export const isShortcutLocalScope = (event: KeyboardEvent): boolean => (
  Boolean(getShortcutEventTarget(event)?.closest('[data-shortcut-scope="local"]'))
);

export const isShortcutOverlay = (event: KeyboardEvent): boolean => (
  Boolean(getShortcutEventTarget(event)?.closest(OVERLAY_SELECTOR))
);

/** A background dialog must not capture keys belonging to a newer popup. */
export const isShortcutOwnedBy = (event: KeyboardEvent, owner: Element | null): boolean => {
  const target = getShortcutEventTarget(event);
  if (!owner || !target || !owner.contains(target)) return false;
  const scope = target.closest(`${OVERLAY_SELECTOR}, [data-shortcut-scope="local"]`);
  return !scope || scope === owner || scope.contains(owner);
};

const isFunctionKey = (key: string): boolean => /^f(?:[1-9]|1\d|2[0-4])$/i.test(key);

class KeyboardShortcutManager {
  private shortcuts: Map<string, ShortcutDefinition> = new Map();
  private registrations: Map<symbol, ShortcutDefinition> = new Map();
  private listeners: Set<ShortcutListener> = new Set();
  private isEnabled: boolean = true;
  private initializationCount = 0;
  private removeKeyboardListener: (() => void) | null = null;

  /**
   * Register a keyboard shortcut
   */
  register(shortcut: ShortcutDefinition): () => void {
    const key = this.generateKey(shortcut);
    const existing = this.shortcuts.get(key);
    if (existing && existing.id !== shortcut.id) {
      console.warn(
        `[KeyboardShortcut] Conflict detected: ${this.formatShortcut(shortcut)} ` +
        `is already registered by "${existing.id}". ` +
        `Priority: existing=${existing.priority || 0}, new=${shortcut.priority || 0}`
      );
    }
    const token = Symbol(shortcut.id);
    this.registrations.set(token, { ...shortcut, enabled: shortcut.enabled !== false });
    this.refreshActiveShortcuts();
    // A stale effect cleanup must remove only its own registration.
    return () => {
      if (this.registrations.delete(token)) this.refreshActiveShortcuts();
    };
  }

  /**
   * Unregister a shortcut by ID
   */
  unregister(id: string): void {
    let removed = false;
    for (const [token, shortcut] of this.registrations) {
      if (shortcut.id === id) removed = this.registrations.delete(token) || removed;
    }
    if (removed) this.refreshActiveShortcuts();
  }

  /**
   * Enable/disable a specific shortcut
   */
  setEnabled(id: string, enabled: boolean): void {
    let updated = false;

    this.registrations.forEach((shortcut) => {
      if (shortcut.id === id) {
        shortcut.enabled = enabled;
        updated = true;
      }
    });

    if (updated) {
      this.refreshActiveShortcuts();
    }
  }

  /**
   * Enable/disable all shortcuts
   */
  setGlobalEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    console.log(`[KeyboardShortcut] Global shortcuts ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Initialize the keyboard event listener
   */
  initialize(): () => void {
    this.initializationCount += 1;
    if (!this.removeKeyboardListener) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!this.isEnabled || shouldIgnoreShortcutEvent(event)) return;
        // A print preview owns Ctrl+P, zoom and close while it has focus.
        if (isShortcutLocalScope(event)) return;
        const target = getShortcutEventTarget(event);
        const overlay = isShortcutOverlay(event);
        const inControls = overlay || Boolean(target?.closest(NAVIGATION_WIDGET_SELECTOR));
        const navigationKey = NAVIGATION_KEYS.has(event.key.toLowerCase());
        const typeaheadKey = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && (!event.shiftKey || overlay);
        // Local widgets own focus movement, unmodified typeahead and Escape. Modified
        // application commands (including Shift+letter quick-trade shortcuts outside overlays)
        // and documented function keys remain available.
        if (inControls && (navigationKey || typeaheadKey)) return;

        const key = this.generateKeyFromEvent(event);
        const shortcut = this.shortcuts.get(key);
        if (isShortcutInput(event) && !shortcut?.allowInInput && event.key !== 'Escape' && !isFunctionKey(event.key)) return;

        if (shortcut && shortcut.enabled !== false) {
          event.preventDefault();
          // Escape must keep bubbling so menus and the active chart can run
          // their own close/cancel semantics after the global handler fires.
          if (shortcut.key.toLowerCase() !== 'escape') event.stopPropagation();

          try {
            shortcut.handler(event);
          } catch (error) {
            console.error(`[KeyboardShortcut] Error executing shortcut "${shortcut.id}":`, error);
          }
        }
      };

      // Bubble after the focused control/React handler so preventDefault and
      // stopPropagation can claim the event before a global chart action runs.
      document.addEventListener('keydown', handleKeyDown);
      this.removeKeyboardListener = () => document.removeEventListener('keydown', handleKeyDown);
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.initializationCount -= 1;
      if (this.initializationCount === 0) {
        this.removeKeyboardListener?.();
        this.removeKeyboardListener = null;
      }
    };
  }

  /**
   * Subscribe to shortcut changes
   */
  subscribe(listener: ShortcutListener): () => void {
    this.listeners.add(listener);
    listener(Array.from(this.shortcuts.values()));

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get all registered shortcuts
   */
  getShortcuts(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Get shortcuts by category
   */
  getShortcutsByCategory(category: string): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values())
      .filter(s => s.category === category);
  }

  /**
   * Get shortcut hints for UI display
   */
  getShortcutHints(): ShortcutHint[] {
    return Array.from(this.shortcuts.values())
      .map(shortcut => ({
        id: shortcut.id,
        label: shortcut.description,
        shortcut: this.formatShortcut(shortcut)
      }));
  }

  /**
   * Find shortcuts by action ID
   */
  findShortcut(id: string): ShortcutDefinition | undefined {
    return Array.from(this.shortcuts.values()).find(s => s.id === id);
  }

  /**
   * Check for conflicts
   */
  getConflicts(): Array<{ key: string; shortcuts: ShortcutDefinition[] }> {
    const conflicts: Array<{ key: string; shortcuts: ShortcutDefinition[] }> = [];
    const keyMap = new Map<string, ShortcutDefinition[]>();

    this.registrations.forEach((shortcut) => {
      if (shortcut.enabled === false) return;
      const key = this.generateKey(shortcut);
      const existing = keyMap.get(key) || [];
      if (!existing.some((candidate) => candidate.id === shortcut.id)) existing.push(shortcut);
      keyMap.set(key, existing);
    });

    keyMap.forEach((shortcuts, key) => {
      if (shortcuts.length > 1) {
        conflicts.push({ key, shortcuts });
      }
    });

    return conflicts;
  }

  /**
   * Format shortcut for display
   */
  formatShortcut(shortcut: ShortcutDefinition): string {
    const parts: string[] = [];

    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.shift) parts.push('Shift');
    if (shortcut.alt) parts.push('Alt');
    if (shortcut.meta) parts.push('Cmd');

    parts.push(this.formatKey(shortcut.key));

    return parts.join('+');
  }

  /**
   * Format key name for display
   */
  private formatKey(key: string): string {
    const keyMap: Record<string, string> = {
      ' ': 'Space',
      'arrowup': '↑',
      'arrowdown': '↓',
      'arrowleft': '←',
      'arrowright': '→',
      'escape': 'Esc',
      'delete': 'Del',
      'backspace': '⌫',
      'enter': '↵',
      'tab': '⇥'
    };

    const normalized = key.toLowerCase();
    return keyMap[normalized] || key.toUpperCase();
  }

  /**
   * Generate unique key for shortcut
   */
  private generateKey(shortcut: ShortcutDefinition): string {
    const key = shortcut.key === '=' && shortcut.shift ? '+' : shortcut.key.toLowerCase();
    // On many layouts Shift is how the '+' character is produced, not an
    // additional shortcut modifier. NumpadAdd produces the same action.
    const shift = shortcut.shift && key !== '+';
    return `${shortcut.ctrl ? 'ctrl+' : ''}${shift ? 'shift+' : ''}${shortcut.alt ? 'alt+' : ''}${shortcut.meta ? 'meta+' : ''}${key}`;
  }

  private generateKeyFromEvent(event: KeyboardEvent): string {
    // event.key can be a special char (e.g. '¡') when Alt is held on some keyboards.
    // Normalize to the base key using event.code as a fallback.
    let key = event.key || '';
    if (event.code === 'NumpadAdd' || key === 'Add' || (key === '=' && event.shiftKey && event.code === 'Equal')) key = '+';
    else if (event.code === 'NumpadSubtract' || key === 'Subtract') key = '-';
    if (key.length > 1 || (event.altKey && key.length === 1 && !/^[a-zA-Z0-9]$/.test(key))) {
      // Try to extract plain key from event.code: 'Digit1'→'1', 'KeyG'→'g', 'Equal'→'=', 'Minus'→'-'
      const code = event.code || '';
      if (code.startsWith('Digit')) key = code.replace('Digit', '');
      else if (code.startsWith('Key')) key = code.replace('Key', '').toLowerCase();
      else if (code === 'Equal') key = '=';
      else if (code === 'Minus') key = '-';
      else if (code === 'BracketLeft') key = '[';
      else if (code === 'BracketRight') key = ']';
      else if (code === 'Semicolon') key = ';';
      else if (code === 'Quote') key = "'";
      else if (code === 'Backslash') key = '\\';
      else if (code === 'Comma') key = ',';
      else if (code === 'Period') key = '.';
      else if (code === 'Slash') key = '/';
    }
    return this.generateKey({ key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey } as ShortcutDefinition);
  }

  /**
   * Select one enabled owner per key while retaining temporary overrides.
   */
  private refreshActiveShortcuts(): void {
    this.shortcuts.clear();
    for (const shortcut of this.registrations.values()) {
      const key = this.generateKey(shortcut);
      const current = this.shortcuts.get(key);
      const enabled = shortcut.enabled !== false;
      const currentEnabled = current?.enabled !== false;
      if (!current
        || (enabled && !currentEnabled)
        || (enabled === currentEnabled && ((shortcut.priority || 0) > (current.priority || 0)
          || ((shortcut.priority || 0) === (current.priority || 0) && shortcut.id === current.id)))) {
        this.shortcuts.set(key, shortcut);
      }
    }
    this.notifyListeners();
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    const shortcuts = Array.from(this.shortcuts.values());
    this.listeners.forEach(listener => {
      try {
        listener(shortcuts);
      } catch (error) {
        console.error('[KeyboardShortcut] Error in listener:', error);
      }
    });
  }

  /**
   * Clear all shortcuts
   */
  clear(): void {
    this.registrations.clear();
    this.shortcuts.clear();
    this.notifyListeners();
    console.log('[KeyboardShortcut] All shortcuts cleared');
  }
}

// Singleton instance
export const keyboardShortcutManager = new KeyboardShortcutManager();

/**
 * MT5-compatible shortcut categories
 */
export const SHORTCUT_CATEGORIES = {
  FILE: 'File',
  VIEW: 'View',
  INSERT: 'Insert',
  CHARTS: 'Charts',
  TOOLS: 'Tools',
  WINDOW: 'Window',
  HELP: 'Help',
  TRADING: 'Trading',
  NAVIGATION: 'Navigation'
} as const;

/**
 * Default MT5 shortcuts
 */
export const DEFAULT_SHORTCUTS: Omit<ShortcutDefinition, 'handler'>[] = [
  // File menu
  { id: 'file.save', key: 's', ctrl: true, description: 'Save workspace', category: SHORTCUT_CATEGORIES.FILE, priority: 100 },
  { id: 'file.open-data-folder', key: 'd', ctrl: true, shift: true, description: 'Open data folder', category: SHORTCUT_CATEGORIES.FILE, priority: 100 },
  { id: 'file.print', key: 'p', ctrl: true, description: 'Print chart', category: SHORTCUT_CATEGORIES.FILE, priority: 100 },
  { id: 'file.exit', key: 'F4', alt: true, description: 'Exit application', category: SHORTCUT_CATEGORIES.FILE, priority: 100 },

  // View menu
  { id: 'view.symbols', key: 'u', ctrl: true, description: 'Open symbols', category: SHORTCUT_CATEGORIES.VIEW, priority: 90 },
  { id: 'view.depth-of-market', key: 'b', alt: true, description: 'Depth of Market', category: SHORTCUT_CATEGORIES.VIEW, priority: 90 },
  { id: 'view.market-watch', key: 'm', ctrl: true, description: 'Market Watch', category: SHORTCUT_CATEGORIES.VIEW, priority: 90 },
  { id: 'view.data-window', key: 'd', ctrl: true, description: 'Data Window', category: SHORTCUT_CATEGORIES.VIEW, priority: 90 },
  { id: 'view.navigator', key: 'n', ctrl: true, description: 'Navigator', category: SHORTCUT_CATEGORIES.VIEW, priority: 90 },
  { id: 'view.toolbox', key: 't', ctrl: true, description: 'Toolbox', category: SHORTCUT_CATEGORIES.VIEW, priority: 90 },
  { id: 'view.strategy-tester', key: 'r', ctrl: true, description: 'Strategy Tester', category: SHORTCUT_CATEGORIES.VIEW, priority: 90 },
  { id: 'view.fullscreen', key: 'F11', description: 'Full Screen', category: SHORTCUT_CATEGORIES.VIEW, priority: 100, allowInInput: true },

  // Charts menu
  { id: 'charts.indicator-list', key: 'i', ctrl: true, description: 'Indicator List', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.object-list', key: 'b', ctrl: true, description: 'Object List', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.bar-chart', key: '1', alt: true, description: 'Bar Chart', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.candlesticks', key: '2', alt: true, description: 'Candlesticks', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.line-chart', key: '3', alt: true, description: 'Line Chart', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.grid', key: 'g', ctrl: true, description: 'Grid', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.volumes', key: 'l', ctrl: true, description: 'Volumes', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.zoom-in', key: '+', description: 'Zoom In', category: SHORTCUT_CATEGORIES.CHARTS, priority: 80 },
  { id: 'charts.zoom-out', key: '-', description: 'Zoom Out', category: SHORTCUT_CATEGORIES.CHARTS, priority: 80 },
  { id: 'charts.properties', key: 'F8', description: 'Chart Properties', category: SHORTCUT_CATEGORIES.CHARTS, priority: 100, allowInInput: true },
  { id: 'charts.delete-last', key: 'Backspace', description: 'Delete Last Object', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.delete-selected', key: 'Delete', description: 'Delete Selected', category: SHORTCUT_CATEGORIES.CHARTS, priority: 90 },
  { id: 'charts.undo', key: 'z', ctrl: true, description: 'Undo', category: SHORTCUT_CATEGORIES.CHARTS, priority: 100 },

  // Tools menu
  { id: 'tools.new-order', key: 'F9', description: 'New Order', category: SHORTCUT_CATEGORIES.TOOLS, priority: 100, allowInInput: true },
  { id: 'tools.options', key: 'o', ctrl: true, description: 'Options', category: SHORTCUT_CATEGORIES.TOOLS, priority: 90 },

  // Window menu
  { id: 'window.tile', key: 'r', alt: true, description: 'Tile Windows', category: SHORTCUT_CATEGORIES.WINDOW, priority: 90 },

  // Trading shortcuts
  { id: 'trading.quick-buy', key: 'b', shift: true, description: 'Quick Buy', category: SHORTCUT_CATEGORIES.TRADING, priority: 95 },
  { id: 'trading.quick-sell', key: 's', shift: true, description: 'Quick Sell', category: SHORTCUT_CATEGORIES.TRADING, priority: 95 },

  // Navigation
  { id: 'navigation.close-modal', key: 'Escape', description: 'Close Modal', category: SHORTCUT_CATEGORIES.NAVIGATION, priority: 100, allowInInput: true },
  { id: 'navigation.next-tab', key: 'Tab', ctrl: true, description: 'Next Tab', category: SHORTCUT_CATEGORIES.NAVIGATION, priority: 80 },
  { id: 'navigation.prev-tab', key: 'Tab', ctrl: true, shift: true, description: 'Previous Tab', category: SHORTCUT_CATEGORIES.NAVIGATION, priority: 80 }
];
