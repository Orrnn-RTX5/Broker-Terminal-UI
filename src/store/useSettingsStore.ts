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
    serverName: 'FlexyMarkets-Server',
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
    allowedURLs: ['https://backend.yoforexai.com'],
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
