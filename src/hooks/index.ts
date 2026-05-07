// Hook exports

export { useMemoizedSelector } from './useOptimizedSelector';
export { useWebWorker } from './useWebWorker';
export { useHistoricalData } from './useHistoricalData';
export { useContextMenuNavigation } from './useContextMenuNavigation';
export type { UseHistoricalDataOptions, UseHistoricalDataResult } from './useHistoricalData';
export type { MenuNavigationState, UseContextMenuNavigationOptions } from './useContextMenuNavigation';
export { useHoverIntent } from './useHoverIntent';
export { useSafeHoverTriangle } from './useSafeHoverTriangle';
export { useContextMenu } from './useContextMenu';
export type { ContextMenuState } from './useContextMenu';
export {
  useCommandBus,
  useCommandDispatch,
  useCommandListener,
  useCommandHistory,
} from './useCommandBus';

// New keyboard shortcut hooks
export {
  useKeyboardShortcut,
  useShortcutList,
  useShortcutsByCategory,
  useShortcutToggle,
  useShortcutFormat
} from './useKeyboardShortcut';
export type { UseKeyboardShortcutOptions } from './useKeyboardShortcut';

// Fix Market Data WebSocket hooks
export {
  useFixMarketDataSocket,
  useSymbolPrice,
  useSymbolCandles,
} from './useFixMarketDataSocket';
export type {
  UseFixMarketDataSocketProps,
  UseFixMarketDataSocketReturn,
} from './useFixMarketDataSocket';
