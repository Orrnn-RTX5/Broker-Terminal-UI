import React, { createContext, useContext, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import type { DockContainer, DockPanelConfig } from '../../services/dockManager';
import { getChartPanels } from '../../services/chartPanelNavigation';
import { activateActiveChartSource } from '../../services/activeChartSource';

export type DockPanelRenderer = (panel: DockPanelConfig, isActive: boolean, isFloating?: boolean) => React.ReactNode;

interface ChartHost {
  id: string;
  element: HTMLDivElement;
  slot: HTMLDivElement | null;
  active: boolean;
  floating: boolean;
}

interface ChartHostsContext {
  attach: (id: string, slot: HTMLDivElement, active: boolean, floating: boolean) => void;
  detach: (id: string, slot: HTMLDivElement) => void;
}

const ChartHosts = createContext<ChartHostsContext | null>(null);
export const useHasStableChartHosts = (): boolean => useContext(ChartHosts) !== null;

/**
 * A chart's React parent and portal destination remain stable for its entire
 * open lifetime. Docking moves only the destination's DOM host, so changing
 * split/tab/floating ancestry cannot recreate its canvas, drafts or drawings.
 */
export const StableChartHosts: React.FC<{
  renderPanel?: DockPanelRenderer;
  rootContainer?: DockContainer;
  children: React.ReactNode;
}> = ({ renderPanel, rootContainer, children }) => {
  const layout = useDockLayoutStore(state => state.layout);
  const hosts = useRef(new Map<string, ChartHost>());
  const parking = useRef<HTMLDivElement>(null);
  const [, refresh] = useReducer(value => value + 1, 0);
  const panels = new Map(getChartPanels(rootContainer
    ? { ...layout, root: rootContainer, floatingPanels: [] }
    : layout).map(panel => [panel.id, panel]));

  const context = useMemo<ChartHostsContext>(() => ({
    attach(id, slot, active, floating) {
      let host = hosts.current.get(id);
      let changed = false;
      if (!host) {
        const element = document.createElement('div');
        element.dataset.stableChartHost = id;
        Object.assign(element.style, { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minWidth: '0', minHeight: '0', flex: '1 1 auto' });
        host = { id, element, slot: null, active: false, floating: false };
        hosts.current.set(id, host);
        // Portals bubble through the provider's React tree. These native
        // listeners preserve the dock shell's activation behavior instead.
        const activate = () => {
          const current = hosts.current.get(id);
          if (!current?.active || !current.slot?.isConnected) return;
          activateActiveChartSource(`trading-chart:${id}`);
          if (current.floating) useDockLayoutStore.getState().bringFloatingToFront(id);
        };
        element.addEventListener('mousedown', activate);
        element.addEventListener('focusin', activate);
        changed = true;
      }
      changed ||= host.slot !== slot || host.active !== active || host.floating !== floating;
      host.slot = slot; host.active = active; host.floating = floating;
      if (host.element.parentElement !== slot) slot.appendChild(host.element);
      if (changed) refresh();
    },
    detach(id, slot) {
      const host = hosts.current.get(id);
      // A replacement shell may have attached before the old shell cleans up.
      if (!host || host.slot !== slot) return;
      host.slot = null; host.active = false;
      if (parking.current) parking.current.appendChild(host.element);
      else host.element.remove();
      refresh();
    },
  }), []);

  useLayoutEffect(() => {
    for (const [id, host] of hosts.current) {
      if (panels.has(id)) continue;
      host.element.remove();
      hosts.current.delete(id);
    }
  }, [layout, rootContainer]);

  return <ChartHosts.Provider value={context}>
    {children}
    {/* Parked tabs stay connected but cannot own chart commands. */}
    <div ref={parking} hidden aria-hidden="true" data-stable-chart-parking="true" data-dock-minimized="true" />
    {[...hosts.current.values()].map(host => {
      const panel = panels.get(host.id);
      return panel ? createPortal(renderPanel?.(panel, host.active && !panel.minimized, host.floating), host.element, host.id) : null;
    })}
  </ChartHosts.Provider>;
};

export const StableChartSlot: React.FC<{
  panel: DockPanelConfig;
  active: boolean;
  floating?: boolean;
  renderPanel?: DockPanelRenderer;
}> = ({ panel, active, floating = false, renderPanel }) => {
  const context = useContext(ChartHosts);
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!context || !slot.current) return;
    const element = slot.current;
    context.attach(panel.id, element, active, floating);
    return () => context.detach(panel.id, element);
  }, [context, panel.id]);
  useLayoutEffect(() => {
    if (context && slot.current) context.attach(panel.id, slot.current, active, floating);
  }, [context, panel.id, active, floating]);
  return context ? <div ref={slot} data-stable-chart-slot={panel.id}
    style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minWidth: 0, minHeight: 0, flex: '1 1 auto' }} />
    : <>{renderPanel?.(panel, active, floating)}</>;
};
