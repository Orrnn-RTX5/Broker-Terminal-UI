// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { acknowledgeBottomDockTab, getRequestedBottomDockTab, openBottomDockTab } from './bottomDockNavigation';
import { DockManager, type DockContainer } from './dockManager';

const original = useDockLayoutStore.getState().layout;
afterEach(() => {
  useDockLayoutStore.getState().setLayout(original);
  const pending = getRequestedBottomDockTab();
  if (pending) acknowledgeBottomDockTab(pending);
  vi.restoreAllMocks();
});

describe('bottom dock navigation', () => {
  it('restores a closed Terminal once and retains the destination until it mounts', () => {
    const initial = new DockManager().getLayout();
    const center = initial.root.children[1] as DockContainer;
    center.children = center.children.filter(child => child.id !== 'toolbox');
    useDockLayoutStore.getState().setLayout(initial);
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    openBottomDockTab('History');
    openBottomDockTab('Historical Data');
    const currentCenter = useDockLayoutStore.getState().layout.root.children[1] as DockContainer;
    expect(currentCenter.children.filter(child => child.id === 'toolbox')).toHaveLength(1);
    expect(currentCenter.children[0]).toMatchObject({ id: center.children[0].id, props: { timeframe: 'M1' } });
    expect(getRequestedBottomDockTab()).toBe('Historical Data');
    expect(dispatch.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'rtx:open-bottom-dock-tab', detail: { tab: 'Historical Data' } });
    acknowledgeBottomDockTab('History');
    expect(getRequestedBottomDockTab()).toBe('Historical Data');
    acknowledgeBottomDockTab('Historical Data');
    expect(getRequestedBottomDockTab()).toBeNull();
  });

  it('keeps an already visible Terminal and layout intact', () => {
    const initial = new DockManager().getLayout();
    useDockLayoutStore.getState().setLayout(initial);
    openBottomDockTab('Toolbox');
    expect(useDockLayoutStore.getState().layout).toEqual(initial);
    expect(getRequestedBottomDockTab()).toBe('Toolbox');
  });

  it('reveals a Terminal in inactive tabs without losing the neighboring panel', () => {
    const initial = new DockManager().getLayout();
    const center = initial.root.children[1] as DockContainer;
    const terminal = center.children[1];
    center.children[1] = {
      id: 'bottom-tabs', type: 'tabs', ratio: 0.25, activeTab: 'news', children: [
        { id: 'news', title: 'News', component: 'News' }, terminal,
      ],
    };
    useDockLayoutStore.getState().setLayout(initial);
    openBottomDockTab('History');
    const updatedCenter = useDockLayoutStore.getState().layout.root.children[1] as DockContainer;
    expect(updatedCenter.children[1]).toEqual({ ...center.children[1], activeTab: 'toolbox' });
    expect(updatedCenter.children[0]).toEqual(center.children[0]);
  });
});
