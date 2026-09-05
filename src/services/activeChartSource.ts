export interface ActiveChartSourceRegistration {
  id: string;
  getCanvas?: () => HTMLCanvasElement | null;
  getContainer?: () => HTMLElement | null;
  getSymbol?: () => string | undefined;
  getTimeframe?: () => string | undefined;
}

export interface ResolvedActiveChartSource {
  id?: string;
  canvas: HTMLCanvasElement | null;
  container: HTMLElement | null;
  symbol?: string;
  timeframe?: string;
}

type LegacyChartSourceWindow = Window & {
  __activeChartCanvas?: HTMLCanvasElement | null;
  __activeChartContainer?: HTMLElement | null;
};

const sources = new Map<string, ActiveChartSourceRegistration>();
let activeSourceId: string | null = null;

const isConnectedElement = <T extends Element>(element: T | null | undefined): element is T => {
  return !!element && element.isConnected;
};

const isVisibleDockChartElement = (element: Element | null): boolean => {
  if (!element) return false;

  const dockLayer = element.closest<HTMLElement>('[data-dock-tab-content]');
  if (!dockLayer) return true;

  const inlineOpacity = Number.parseFloat(dockLayer.style.opacity || '1');
  if (
    dockLayer.style.display === 'none'
    || dockLayer.style.visibility === 'hidden'
    || dockLayer.style.pointerEvents === 'none'
    || inlineOpacity === 0
  ) {
    return false;
  }

  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
  const computed = window.getComputedStyle(dockLayer);
  return computed.display !== 'none'
    && computed.visibility !== 'hidden'
    && computed.pointerEvents !== 'none'
    && Number.parseFloat(computed.opacity || '1') !== 0;
};

export const findLargestChartCanvas = (container: HTMLElement | null): HTMLCanvasElement | null => {
  if (!container) return null;

  return Array.from(container.querySelectorAll('canvas')).reduce(
    (largest, current) => {
      if (!isConnectedElement(current)) return largest;
      const currentArea = current.width * current.height;
      const largestArea = largest ? largest.width * largest.height : 0;
      return currentArea > largestArea ? current : largest;
    },
    null as HTMLCanvasElement | null,
  );
};

const resolveRegisteredSource = (
  source: ActiveChartSourceRegistration,
): ResolvedActiveChartSource | null => {
  const container = source.getContainer?.() ?? null;
  const canvas = source.getCanvas?.() ?? findLargestChartCanvas(container);
  const connectedContainer = isConnectedElement(container) ? container : null;
  const connectedCanvas = isConnectedElement(canvas) ? canvas : null;

  if (!connectedCanvas && !connectedContainer) return null;

  return {
    id: source.id,
    canvas: connectedCanvas,
    container: connectedContainer,
    symbol: source.getSymbol?.(),
    timeframe: source.getTimeframe?.(),
  };
};

const isResolvedSourceVisible = (source: ResolvedActiveChartSource): boolean => (
  isVisibleDockChartElement(source.container ?? source.canvas)
);

const resolveLegacyWindowSource = (): ResolvedActiveChartSource | null => {
  if (typeof window === 'undefined') return null;

  const legacyWindow = window as LegacyChartSourceWindow;
  const canvas = legacyWindow.__activeChartCanvas;
  const container = legacyWindow.__activeChartContainer;
  const connectedCanvas = isConnectedElement(canvas) ? canvas : null;
  const connectedContainer = isConnectedElement(container) ? container : null;

  if (!connectedCanvas && !connectedContainer) return null;

  return {
    canvas: connectedCanvas,
    container: connectedContainer,
  };
};

const publishLegacyWindowSource = (source: ResolvedActiveChartSource | null): void => {
  if (typeof window === 'undefined') return;
  const legacyWindow = window as LegacyChartSourceWindow;

  if (source?.canvas || source?.container) {
    legacyWindow.__activeChartCanvas = source.canvas;
    legacyWindow.__activeChartContainer = source.container;
    return;
  }

  delete legacyWindow.__activeChartCanvas;
  delete legacyWindow.__activeChartContainer;
};

export const registerActiveChartSource = (
  source: ActiveChartSourceRegistration,
): (() => void) => {
  sources.set(source.id, source);

  if (!activeSourceId) {
    const resolved = resolveRegisteredSource(source);
    if (resolved && isResolvedSourceVisible(resolved)) {
      activeSourceId = source.id;
      publishLegacyWindowSource(resolved);
    }
  }

  return () => unregisterActiveChartSource(source.id);
};

export const activateActiveChartSource = (id: string): ResolvedActiveChartSource | null => {
  const source = sources.get(id);
  if (!source) return null;

  const resolved = resolveRegisteredSource(source);
  if (!resolved) {
    sources.delete(id);
    if (activeSourceId === id) activeSourceId = null;
    publishLegacyWindowSource(null);
    publishLegacyWindowSource(getActiveChartSource());
    return null;
  }

  if (!isResolvedSourceVisible(resolved)) {
    if (activeSourceId === id) activeSourceId = null;
    publishLegacyWindowSource(null);
    publishLegacyWindowSource(getActiveChartSource());
    return null;
  }

  activeSourceId = id;
  publishLegacyWindowSource(resolved);
  return resolved;
};

export const unregisterActiveChartSource = (id: string): void => {
  sources.delete(id);
  if (activeSourceId !== id) return;

  activeSourceId = null;
  publishLegacyWindowSource(null);
  publishLegacyWindowSource(getActiveChartSource());
};

export const getActiveChartSource = (): ResolvedActiveChartSource | null => {
  if (activeSourceId) {
    const active = sources.get(activeSourceId);
    const resolved = active ? resolveRegisteredSource(active) : null;
    if (resolved && isResolvedSourceVisible(resolved)) {
      publishLegacyWindowSource(resolved);
      return resolved;
    }

    if (!resolved) sources.delete(activeSourceId);
    activeSourceId = null;
  }

  for (const source of Array.from(sources.values()).reverse()) {
    const resolved = resolveRegisteredSource(source);
    if (resolved && isResolvedSourceVisible(resolved)) {
      activeSourceId = source.id;
      publishLegacyWindowSource(resolved);
      return resolved;
    }

    if (!resolved) sources.delete(source.id);
  }

  const legacy = resolveLegacyWindowSource();
  const visibleLegacy = legacy && isResolvedSourceVisible(legacy) ? legacy : null;
  publishLegacyWindowSource(visibleLegacy);
  return visibleLegacy;
};

export const clearActiveChartSources = (): void => {
  sources.clear();
  activeSourceId = null;
  publishLegacyWindowSource(null);
};
