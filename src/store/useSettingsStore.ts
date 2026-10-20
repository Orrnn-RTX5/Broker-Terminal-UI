/**
 * Settings Store with Zustand + Persist
 * Manages all application settings with automatic persistence
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// Server Settings
export interface ServerSettings {
  serverName: string;
  proxyEnabled: boolean;
  keepPersonalSettings: boolean;
  enableNews: boolean;
}

// Charts Settings
export interface ChartsSettings {
  showTradeHistory: boolean;
  showTradeLevels: boolean;
  tradeLevelsDragging: 'enabled' | 'disabled';
  preloadChartData: boolean;
  showObjectPropertiesAfterCreation: boolean;
  selectObjectAfterCreation: boolean;
  magnetSensitivity: number;
  maxBarsInChart: number | 'unlimited';
}

// Trade Settings
export interface TradeSettings {
  defaultSymbolMode: 'automatic' | 'last-used';
  defaultVolumeMode: 'last-used' | 'default';
  defaultVolume: number;
  defaultDeviationMode: 'last-used' | 'default';
  defaultDeviation: number;
  oneClickTrading: boolean;
}

// Automation Settings
export interface AutomationSettings {
  enableStrategies: boolean;
  disableOnAccountChange: boolean;
  disableOnProfileChange: boolean;
  disableOnChartChange: boolean;
  allowDLL: boolean;
  allowWebRequest: boolean;
  allowedURLs: string[];
}

// Notifications Settings
export type NotificationSound = 'default' | 'chime' | 'alert' | 'silent';
export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';
export type HistoryRetention = '1hr' | '6hr' | '24hr' | '7d';

export interface CategorySettings {
  enabled: boolean;
  showPopup: boolean;
  playSound: boolean;
  sound: NotificationSound;
  priority: NotificationPriority;
}

export interface DNDSchedule {
  enabled: boolean;
  fromTime: string; // HH:MM format
  toTime: string;   // HH:MM format
}

export interface NotificationsSettings {
  // Category-specific settings
  tradeExecution: CategorySettings;
  priceAlerts: CategorySettings;
  marginWarnings: CategorySettings;
  system: CategorySettings;
  news: CategorySettings;
  account: CategorySettings;

  // Global settings
  doNotDisturb: boolean;
  dndSchedule: DNDSchedule;
  maxNotificationsPerMinute: number;
  historyRetention: HistoryRetention;

  // Legacy fields (for backwards compatibility)
  enablePushNotifications: boolean;
  enableSoundAlerts: boolean;
  enableEmailAlerts: boolean;
}

// Keyboard Shortcuts Settings
export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  enabled: boolean;
}

export interface KeyboardShortcutsSettings {
  enabled: boolean;
  shortcuts: {
    newOrder: KeyboardShortcut;
    closeChart: KeyboardShortcut;
    toggleOneClick: KeyboardShortcut;
    toggleGrid: KeyboardShortcut;
    toggleVolume: KeyboardShortcut;
    zoomIn: KeyboardShortcut;
    zoomOut: KeyboardShortcut;
    scrollLeft: KeyboardShortcut;
    scrollRight: KeyboardShortcut;
    undoDrawing: KeyboardShortcut;
    deleteDrawing: KeyboardShortcut;
    saveWorkspace: KeyboardShortcut;
    printChart: KeyboardShortcut;
    fullscreen: KeyboardShortcut;
    help: KeyboardShortcut;
    timeframeM1: KeyboardShortcut;
    timeframeM5: KeyboardShortcut;
    timeframeM15: KeyboardShortcut;
    timeframeM30: KeyboardShortcut;
    timeframeH1: KeyboardShortcut;
    timeframeH4: KeyboardShortcut;
    timeframeD1: KeyboardShortcut;
    timeframeW1: KeyboardShortcut;
    timeframeMN: KeyboardShortcut;
  };
}

// Complete Settings State
export interface SettingsState {
  server: ServerSettings;
  charts: ChartsSettings;
  trade: TradeSettings;
  automation: AutomationSettings;
  notifications: NotificationsSettings;
  keyboardShortcuts: KeyboardShortcutsSettings;
}

// Actions
interface SettingsActions {
  updateServerSettings: (settings: Partial<ServerSettings>) => void;
  updateChartsSettings: (settings: Partial<ChartsSettings>) => void;
  updateTradeSettings: (settings: Partial<TradeSettings>) => void;
  updateAutomationSettings: (settings: Partial<AutomationSettings>) => void;
  updateNotificationsSettings: (settings: Partial<NotificationsSettings>) => void;
  updateKeyboardShortcutsSettings: (settings: Partial<KeyboardShortcutsSettings>) => void;
  updateShortcut: (shortcutName: keyof KeyboardShortcutsSettings['shortcuts'], shortcut: Partial<KeyboardShortcut>) => void;
  addAllowedURL: (url: string) => void;
  removeAllowedURL: (url: string) => void;
  resetToDefaults: () => void;
  getSnapshot: () => SettingsState;
  restoreSnapshot: (snapshot: SettingsState) => void;
}

type SettingsStore = SettingsState & SettingsActions;

// Default Settings
const defaultSettings: SettingsState = {
  server: {
    serverName: 'RTX 5 Web Terminal',
    proxyEnabled: false,
    keepPersonalSettings: true,
    enableNews: true,
  },
  charts: {
    showTradeHistory: true,
    showTradeLevels: true,
    tradeLevelsDragging: 'enabled',
    preloadChartData: true,
    showObjectPropertiesAfterCreation: false,
    selectObjectAfterCreation: true,
    magnetSensitivity: 10,
    maxBarsInChart: 100000,
  },
  trade: {
    defaultSymbolMode: 'automatic',
    defaultVolumeMode: 'last-used',
    defaultVolume: 0.01,
    defaultDeviationMode: 'last-used',
    defaultDeviation: 0,
    oneClickTrading: false,
  },
  automation: {
    enableStrategies: false,
    disableOnAccountChange: true,
    disableOnProfileChange: true,
    disableOnChartChange: false,
    allowDLL: true,
    allowWebRequest: true,
    allowedURLs: [],
  },
  notifications: {
    // Category-specific settings
    tradeExecution: {
      enabled: true,
      showPopup: true,
      playSound: true,
      sound: 'default',
      priority: 'high',
    },
    priceAlerts: {
      enabled: true,
      showPopup: true,
      playSound: true,
      sound: 'alert',
      priority: 'medium',
    },
    marginWarnings: {
      enabled: true,
      showPopup: true,
      playSound: true,
      sound: 'alert',
      priority: 'critical',
    },
    system: {
      enabled: true,
      showPopup: true,
      playSound: false,
      sound: 'default',
      priority: 'medium',
    },
    news: {
      enabled: true,
      showPopup: false,
      playSound: false,
      sound: 'chime',
      priority: 'low',
    },
    account: {
      enabled: true,
      showPopup: true,
      playSound: true,
      sound: 'chime',
      priority: 'high',
    },

    // Global settings
    doNotDisturb: false,
    dndSchedule: {
      enabled: false,
      fromTime: '22:00',
      toTime: '07:00',
    },
    maxNotificationsPerMinute: 10,
    historyRetention: '24hr',

    // Legacy fields
    enablePushNotifications: true,
    enableSoundAlerts: true,
    enableEmailAlerts: false,
  },
  keyboardShortcuts: {
    enabled: true,
    shortcuts: {
      newOrder: { key: 'F9', enabled: true },
      closeChart: { key: 'w', ctrl: true, enabled: true },
      toggleOneClick: { key: 't', ctrl: true, shift: true, enabled: true },
      toggleGrid: { key: 'g', ctrl: true, enabled: true },
      toggleVolume: { key: 'l', ctrl: true, enabled: true },
      zoomIn: { key: '+', enabled: true },
      zoomOut: { key: '-', enabled: true },
      scrollLeft: { key: 'ArrowLeft', enabled: true },
      scrollRight: { key: 'ArrowRight', enabled: true },
      undoDrawing: { key: 'z', ctrl: true, enabled: true },
      deleteDrawing: { key: 'Delete', enabled: true },
      saveWorkspace: { key: 's', ctrl: true, enabled: true },
      printChart: { key: 'p', ctrl: true, enabled: true },
      fullscreen: { key: 'F11', enabled: true },
      help: { key: 'F1', enabled: true },
      timeframeM1: { key: '1', alt: true, enabled: true },
      timeframeM5: { key: '2', alt: true, enabled: true },
      timeframeM15: { key: '3', alt: true, enabled: true },
      timeframeM30: { key: '4', alt: true, enabled: true },
      timeframeH1: { key: '5', alt: true, enabled: true },
      timeframeH4: { key: '6', alt: true, enabled: true },
      timeframeD1: { key: '7', alt: true, enabled: true },
      timeframeW1: { key: '8', alt: true, enabled: true },
      timeframeMN: { key: '9', alt: true, enabled: true },
    },
  },
};

export const useSettingsStore = create<SettingsStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...defaultSettings,

        updateServerSettings: (settings) =>
          set((state) => ({
            server: { ...state.server, ...settings },
          })),

        updateChartsSettings: (settings) =>
          set((state) => ({
            charts: { ...state.charts, ...settings },
          })),

        updateTradeSettings: (settings) =>
          set((state) => ({
            trade: { ...state.trade, ...settings },
          })),

        updateAutomationSettings: (settings) =>
          set((state) => ({
            automation: { ...state.automation, ...settings },
          })),

        updateNotificationsSettings: (settings) =>
          set((state) => ({
            notifications: { ...state.notifications, ...settings },
          })),

        updateKeyboardShortcutsSettings: (settings) =>
          set((state) => ({
            keyboardShortcuts: { ...state.keyboardShortcuts, ...settings },
          })),

        updateShortcut: (shortcutName, shortcut) =>
          set((state) => ({
            keyboardShortcuts: {
              ...state.keyboardShortcuts,
              shortcuts: {
                ...state.keyboardShortcuts.shortcuts,
                [shortcutName]: {
                  ...state.keyboardShortcuts.shortcuts[shortcutName],
                  ...shortcut,
                },
              },
            },
          })),

        addAllowedURL: (url) =>
          set((state) => ({
            automation: {
              ...state.automation,
              allowedURLs: [...state.automation.allowedURLs, url],
            },
          })),

        removeAllowedURL: (url) =>
          set((state) => ({
            automation: {
              ...state.automation,
              allowedURLs: state.automation.allowedURLs.filter((u) => u !== url),
            },
          })),

        resetToDefaults: () => set(defaultSettings),

        getSnapshot: () => {
          const state = get();
          return {
            server: state.server,
            charts: state.charts,
            trade: state.trade,
            automation: state.automation,
            notifications: state.notifications,
            keyboardShortcuts: state.keyboardShortcuts,
          };
        },

        restoreSnapshot: (snapshot) =>
          set({
            server: snapshot.server,
            charts: snapshot.charts,
            trade: snapshot.trade,
            automation: snapshot.automation,
            notifications: snapshot.notifications,
            keyboardShortcuts: snapshot.keyboardShortcuts,
          }),
      }),
      {
        name: 'rtx5-settings',
        // Only persist settings, not actions
        partialize: (state) => ({
          server: state.server,
          charts: state.charts,
          trade: state.trade,
          automation: state.automation,
          notifications: state.notifications,
          keyboardShortcuts: state.keyboardShortcuts,
        }),
      }
    )
  )
);

// Selectors for specific settings sections
export const useServerSettings = () => useSettingsStore((state) => state.server);
export const useChartsSettings = () => useSettingsStore((state) => state.charts);
export const useTradeSettings = () => useSettingsStore((state) => state.trade);
export const useAutomationSettings = () => useSettingsStore((state) => state.automation);
export const useNotificationsSettings = () => useSettingsStore((state) => state.notifications);
export const useKeyboardShortcutsSettings = () => useSettingsStore((state) => state.keyboardShortcuts);

// --- SUI-T8 consumer interface: trade defaults + one-click ---
// The Options dialog persists these values; the selectors/hooks/resolvers below
// are the single read path for order-path consumers. All helpers are
// broker-config-driven (they only read the persisted settings + caller-provided
// runtime context) and carry zero broker/tenant/symbol literals.

/** Direct selector for the one-click setting (no subscription churn for event handlers). */
export const selectOneClickTrading = (state: SettingsState): boolean =>
  state.trade.oneClickTrading;

/** Direct selector for the full trade-defaults section. */
export const selectTradeDefaults = (state: SettingsState): TradeSettings =>
  state.trade;

/** Reactive hook for the one-click setting. */
export const useOneClickTrading = (): boolean =>
  useSettingsStore((state) => state.trade.oneClickTrading);

/** Reactive hook for the trade-defaults section. */
export const useTradeDefaults = (): TradeSettings =>
  useSettingsStore((state) => state.trade);

/** Last-used runtime context supplied by the caller (order ticket, chart, panel). */
export interface LastUsedTradeContext {
  lastUsedVolume?: unknown;
  lastUsedDeviation?: unknown;
  lastUsedSymbol?: unknown;
  selectedSymbol?: unknown;
  /**
   * Broker-driven seed used only when `last-used` mode has no last-used value
   * yet (e.g. the instrument lot-grid minimum). Lets a panel keep its
   * broker-minimum initial state until the trader actually trades.
   */
  emptyVolumeSeed?: unknown;
  emptyDeviationSeed?: unknown;
}

const readPositiveVolume = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const readNonNegativeDeviation = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const readSymbolName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Resolve the effective default order volume (lots) from the persisted trade
 * settings. `default` mode always uses the configured default; `last-used`
 * mode prefers the caller's last-used volume and falls back to the configured
 * default. The final fallback is the store's own default, never a literal.
 */
export const resolveDefaultTradeVolume = (
  trade: TradeSettings,
  context: LastUsedTradeContext = {},
): number => {
  const configured = readPositiveVolume(trade.defaultVolume)
    ?? readPositiveVolume(defaultSettings.trade.defaultVolume)
    ?? 0;
  if (trade.defaultVolumeMode === 'default') return configured;
  return readPositiveVolume(context.lastUsedVolume)
    ?? readPositiveVolume(context.emptyVolumeSeed)
    ?? configured;
};

/**
 * Resolve the effective default deviation (points) from the persisted trade
 * settings. Same mode contract as the volume resolver.
 */
export const resolveDefaultTradeDeviation = (
  trade: TradeSettings,
  context: LastUsedTradeContext = {},
): number => {
  const configured = readNonNegativeDeviation(trade.defaultDeviation)
    ?? readNonNegativeDeviation(defaultSettings.trade.defaultDeviation)
    ?? 0;
  if (trade.defaultDeviationMode === 'default') return configured;
  return readNonNegativeDeviation(context.lastUsedDeviation)
    ?? readNonNegativeDeviation(context.emptyDeviationSeed)
    ?? configured;
};

/**
 * Resolve the effective default order symbol from the persisted trade
 * settings. `automatic` mode follows the active/selected symbol;
 * `last-used` mode prefers the last traded symbol. Returns '' when neither
 * source yields a symbol; eligibility filtering stays with the caller.
 */
export const resolveDefaultOrderSymbol = (
  trade: TradeSettings,
  context: LastUsedTradeContext = {},
): string => {
  const selected = readSymbolName(context.selectedSymbol);
  const lastUsed = readSymbolName(context.lastUsedSymbol);
  if (trade.defaultSymbolMode === 'last-used') return lastUsed ?? selected ?? '';
  return selected ?? lastUsed ?? '';
};

/** Routing decision for instant (one-click) order paths. */
export type QuickTradeRoute = 'instant' | 'confirm';

/**
 * Map the one-click setting to a quick-trade route: one-click ON places
 * immediately; one-click OFF must open the confirm ticket instead.
 */
export const resolveQuickTradeRoute = (oneClickTrading: boolean): QuickTradeRoute =>
  oneClickTrading ? 'instant' : 'confirm';

/** True when an instant order path must confirm first (one-click OFF). */
export const requiresTradeConfirmation = (
  trade: Pick<TradeSettings, 'oneClickTrading'> | boolean,
): boolean => (typeof trade === 'boolean' ? trade : trade.oneClickTrading) === false;

/**
 * Resolve the New Order ticket's initial symbol through the persisted default
 * symbol mode. An explicit caller-provided symbol always wins; otherwise the
 * default-symbol resolver decides between the active chart/selected symbol
 * and the last traded symbol.
 */
export const resolveOpenOrderTargetSymbol = (
  trade: TradeSettings,
  symbols: { explicitSymbol?: unknown; activeChartSymbol?: unknown; selectedSymbol?: unknown; lastUsedSymbol?: unknown },
): string => readSymbolName(symbols.explicitSymbol)
  ?? resolveDefaultOrderSymbol(trade, {
    selectedSymbol: readSymbolName(symbols.activeChartSymbol)
      ?? readSymbolName(symbols.selectedSymbol),
    lastUsedSymbol: symbols.lastUsedSymbol,
  });
