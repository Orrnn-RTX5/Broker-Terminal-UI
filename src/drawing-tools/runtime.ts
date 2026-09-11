type DrawingToolsRuntimeWindow = Window & {
  electronAPI?: unknown;
};

/**
 * Identify Electron without changing the shared drawing renderer's availability.
 * These signals mirror the runtime checks used by the API and broker-session layers.
 */
export const isElectronDrawingToolsRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;

  return Boolean(window.electron?.window)
    || Boolean((window as DrawingToolsRuntimeWindow).electronAPI)
    || window.location?.protocol === 'file:'
    || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
};

// Keep the existing export name for callers; both browser and Electron renderers
// use the same rail, menus, drawing selection toolbar, and keyboard registrations.
export const isWebDrawingToolsRuntime = (): boolean =>
  typeof window !== 'undefined';
