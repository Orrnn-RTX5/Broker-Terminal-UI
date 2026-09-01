type DrawingToolsRuntimeWindow = Window & {
  electronAPI?: unknown;
};

/**
 * Keep the web-only drawing rail out of every supported Electron boot path.
 * These signals intentionally mirror the runtime checks used by the shared
 * API and broker-session layers.
 */
export const isElectronDrawingToolsRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;

  return Boolean(window.electron?.window)
    || Boolean((window as DrawingToolsRuntimeWindow).electronAPI)
    || window.location?.protocol === 'file:'
    || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
};

export const isWebDrawingToolsRuntime = (): boolean =>
  typeof window !== 'undefined' && !isElectronDrawingToolsRuntime();
