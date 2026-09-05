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

class KeyboardShortcutManager {
  private shortcuts: Map<string, ShortcutDefinition> = new Map();
  private listeners: Set<ShortcutListener> = new Set();
  private isEnabled: boolean = true;
  private activeElement: HTMLElement | null = null;

  /**
   * Register a keyboard shortcut
   */
  register(shortcut: ShortcutDefinition): () => void {
    const key = this.generateKey(shortcut);

    // Check for conflicts
    const existing = this.shortcuts.get(key);
    if (existing && existing.id !== shortcut.id) {
      console.warn(
        `[KeyboardShortcut] Conflict detected: ${this.formatShortcut(shortcut)} ` +
        `is already registered by "${existing.id}". ` +
        `Priority: existing=${existing.priority || 0}, new=${shortcut.priority || 0}`
      );

      // If new shortcut has higher priority, replace existing
      if ((shortcut.priority || 0) <= (existing.priority || 0)) {
        console.warn(`[KeyboardShortcut] Keeping existing shortcut "${existing.id}"`);
        return () => { }; // Return noop unregister
      }

      console.warn(`[KeyboardShortcut] Replacing with higher priority shortcut "${shortcut.id}"`);
    }

    this.shortcuts.set(key, { ...shortcut, enabled: shortcut.enabled !== false });
    this.notifyListeners();

    console.log(
      `[KeyboardShortcut] Registered: ${this.formatShortcut(shortcut)} → ${shortcut.description}`
    );

    // Return unregister function
    return () => this.unregister(shortcut.id);
  }

  /**
   * Unregister a shortcut by ID
   */
  unregister(id: string): void {
    const toRemove: string[] = [];

    this.shortcuts.forEach((shortcut, key) => {
      if (shortcut.id === id) {
        toRemove.push(key);
      }
    });

    toRemove.forEach(key => {
      const shortcut = this.shortcuts.get(key);
      if (shortcut) {
        console.log(`[KeyboardShortcut] Unregistered: ${this.formatShortcut(shortcut)}`);
        this.shortcuts.delete(key);
      }
    });

    if (toRemove.length > 0) {
      this.notifyListeners();
    }
  }

  /**
   * Enable/disable a specific shortcut
   */
  setEnabled(id: string, enabled: boolean): void {
    let updated = false;

    this.shortcuts.forEach((shortcut, key) => {
      if (shortcut.id === id) {
        shortcut.enabled = enabled;
        updated = true;
      }
    });

    if (updated) {
      this.notifyListeners();
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!this.isEnabled || !event.key || event.repeat) return;

      // Check if typing in input field (unless shortcut explicitly allows it)
      if (this.isTypingInInput(event) && !this.isAllowedInInput(event)) {
        return;
      }

      // Find matching shortcut
      const key = this.generateKeyFromEvent(event);
      const shortcut = this.shortcuts.get(key);

      if (shortcut && shortcut.enabled !== false) {
        event.preventDefault();
        // Escape must keep bubbling so menus and the active chart can run
        // their own close/cancel semantics after the global handler fires.
        if (shortcut.key.toLowerCase() !== 'escape') {
          event.stopPropagation();
        }

        try {
          shortcut.handler(event);
        } catch (error) {
          console.error(`[KeyboardShortcut] Error executing shortcut "${shortcut.id}":`, error);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    console.log('[KeyboardShortcut] Manager initialized');

    // Return cleanup function
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      console.log('[KeyboardShortcut] Manager cleaned up');
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

    this.shortcuts.forEach((shortcut, key) => {
      const existing = keyMap.get(key) || [];
      existing.push(shortcut);
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
    return `${shortcut.ctrl ? 'ctrl+' : ''}${shortcut.shift ? 'shift+' : ''}${shortcut.alt ? 'alt+' : ''}${shortcut.meta ? 'meta+' : ''}${shortcut.key.toLowerCase()}`;
  }

  private generateKeyFromEvent(event: KeyboardEvent): string {
    // event.key can be a special char (e.g. '¡') when Alt is held on some keyboards.
    // Normalize to the base key using event.code as a fallback.
    let key = event.key || '';
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
    return `${event.ctrlKey ? 'ctrl+' : ''}${event.shiftKey ? 'shift+' : ''}${event.altKey ? 'alt+' : ''}${event.metaKey ? 'meta+' : ''}${key.toLowerCase()}`;
  }

  /**
   * Check if user is typing in an input field
   */
  private isTypingInInput(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;

    if (!target) return false;

    const tagName = target.tagName.toLowerCase();
    const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    const isContentEditable = target.getAttribute('contenteditable') === 'true';
    const isInDialog = target.closest('[role="dialog"]') !== null;

    return isInput || isContentEditable;
  }

  /**
   * Check if shortcut is allowed in input fields
   */
  private isAllowedInInput(event: KeyboardEvent): boolean {
    if (!event.key) return false;

    const key = this.generateKeyFromEvent(event);
    const shortcut = this.shortcuts.get(key);

    // Always allow Escape and F-keys
    if (event.key === 'Escape' || event.key.startsWith('F')) {
      return true;
    }

    return shortcut?.allowInInput || false;
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
  { id: 'trading.quick-buy', key: 'b', alt: true, description: 'Quick Buy', category: SHORTCUT_CATEGORIES.TRADING, priority: 95 },
  { id: 'trading.quick-sell', key: 's', alt: true, description: 'Quick Sell', category: SHORTCUT_CATEGORIES.TRADING, priority: 95 },

  // Navigation
  { id: 'navigation.close-modal', key: 'Escape', description: 'Close Modal', category: SHORTCUT_CATEGORIES.NAVIGATION, priority: 100, allowInInput: true },
  { id: 'navigation.next-tab', key: 'Tab', ctrl: true, description: 'Next Tab', category: SHORTCUT_CATEGORIES.NAVIGATION, priority: 80 },
  { id: 'navigation.prev-tab', key: 'Tab', ctrl: true, shift: true, description: 'Previous Tab', category: SHORTCUT_CATEGORIES.NAVIGATION, priority: 80 }
];
