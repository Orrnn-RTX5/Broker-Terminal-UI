import { useDockLayoutStore } from '../store/useDockLayoutStore';
import type { DockContainer, DockPanelConfig } from './dockManager';

export type BottomDockNavigationTab = 'History' | 'Toolbox' | 'Historical Data' | 'Experts' | 'Code Base';
let requestedTab: BottomDockNavigationTab | null = null;

export const getRequestedBottomDockTab = (): BottomDockNavigationTab | null => requestedTab;
export const acknowledgeBottomDockTab = (tab: string): void => {
  if (requestedTab === tab) requestedTab = null;
};

/** Open an existing terminal, or restore it, then deliver the requested tab. */
export const openBottomDockTab = (tab: BottomDockNavigationTab): void => {
  requestedTab = tab;
  const store = useDockLayoutStore.getState();
  const layout = JSON.parse(JSON.stringify(store.layout)) as typeof store.layout;
  let changedSelection = false;
  const revealTerminal = (container: DockContainer): boolean => {
    for (const child of container.children) {
      const found = 'children' in child ? revealTerminal(child) : child.component === 'Terminal';
      if (!found) continue;
      if (container.type === 'tabs' && container.activeTab !== child.id) {
        container.activeTab = child.id;
        changedSelection = true;
      }
      return true;
    }
    return false;
  };
  const exists = revealTerminal(layout.root) || layout.floatingPanels.some(revealTerminal);
  if (!exists) {
    const terminal: DockPanelConfig = {
      id: 'toolbox', title: 'Toolbox', component: 'Terminal', ratio: 0.25,
      closable: true, floatable: true,
    };
    const findCenter = (container: DockContainer): DockContainer | undefined => {
      if (container.id === 'center-main') return container;
      for (const child of container.children) {
        if (!('children' in child)) continue;
        const found = findCenter(child);
        if (found) return found;
      }
    };
    const center = findCenter(layout.root);
    if (center?.type === 'split' && center.direction === 'vertical') {
      const total = center.children.reduce((sum, child) => sum + (child.ratio || 1), 0);
      center.children.forEach(child => { child.ratio = 0.75 * (child.ratio || 1) / total; });
      center.children.push({ ...terminal, ratio: total > 0 ? 0.25 : 1 });
      store.setLayout(layout);
    } else {
      store.addPanel(terminal, 'center-main', 'bottom');
    }
  } else if (changedSelection) {
    store.setLayout(layout);
  }
  // A newly restored panel mounts after this dispatch. The retained request is
  // read by BottomDock on mount, so the selected tab never depends on a timer.
  window.dispatchEvent(new CustomEvent('rtx:open-bottom-dock-tab', { detail: { tab } }));
};
