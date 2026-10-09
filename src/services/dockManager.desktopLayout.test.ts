// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { DockManager } from './dockManager';

const installElectronBridge = () => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: { window: {} },
  });
};

const createPreviousDesktopLayout = () => ({
  root: {
    id: 'root',
    type: 'split',
    direction: 'vertical',
    ratio: 1,
    children: [
      {
        id: 'desktop-top-main',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.657,
        children: [
          {
            id: 'left-sidebar',
            type: 'split',
            direction: 'vertical',
            ratio: 0.184,
            children: [
              { id: 'market-watch', type: 'panel', component: 'MarketWatch', ratio: 0.5 },
              { id: 'navigator', type: 'panel', component: 'Navigator', ratio: 0.5 },
            ],
          },
          {
            id: 'chart-live',
            type: 'panel',
            component: 'Chart',
            title: 'BTCUSD,M5',
            props: { symbol: 'BTCUSD', timeframe: 'M5', preserved: true },
            ratio: 0.816,
          },
        ],
      },
      { id: 'toolbox', type: 'panel', component: 'Terminal', ratio: 0.343 },
    ],
  },
  floatingPanels: [
    {
      id: 'floating-one',
      type: 'split',
      direction: 'horizontal',
      ratio: 1,
      children: [{ id: 'floating-news', type: 'panel', component: 'News', ratio: 1 }],
    },
  ],
  version: '2.6',
});

const createPreviousSidebarLayout = () => {
  const layout = new DockManager().getLayout();
  const root = layout.root as any;
  root.children[0].children[0].ratio = 0.5;
  root.children[0].children[1].ratio = 0.5;
  root.children[1].children[0].props = { symbol: 'BTCUSD', timeframe: 'M5', preserved: true };
  layout.floatingPanels = [{
    id: 'floating-news', type: 'panel', ratio: 1, isFloating: true,
    position: { x: 700, y: 150 }, size: { width: 320, height: 240 },
    children: [{ id: 'news', title: 'News', component: 'News', ratio: 1 }],
  }];
  return layout;
};

afterEach(() => {
  localStorage.clear();
  delete window.electron;
});

describe('desktop dock defaults', () => {
  it('preserves the established browser workspace proportions', () => {
    const root = new DockManager().getLayout().root as any;
    expect(root.children.map((child: any) => child.ratio)).toEqual([0.20, 0.80]);
    expect(root.children[0].children.map((child: any) => child.ratio)).toEqual([0.38, 0.62]);
    expect(root.children[1].children.map((child: any) => child.ratio)).toEqual([0.75, 0.25]);
  });

  it('keeps Market Watch and Navigator full-height beside Chart over Toolbox', () => {
    installElectronBridge();

    const layout = new DockManager().getLayout();
    const root = layout.root as any;
    expect(root.direction).toBe('horizontal');
    expect(root.children.map((child: any) => child.id)).toEqual(['left-sidebar', 'center-main']);

    const [leftSidebar, centerMain] = root.children;
    expect(leftSidebar.ratio).toBe(0.20);
    expect(leftSidebar.direction).toBe('vertical');
    expect(leftSidebar.children.map((child: any) => child.id)).toEqual(['market-watch', 'navigator']);
    expect(leftSidebar.children.map((child: any) => child.ratio)).toEqual([0.38, 0.62]);

    expect(centerMain.ratio).toBe(0.80);
    expect(centerMain.direction).toBe('vertical');
    expect(centerMain.children.map((child: any) => child.id)).toEqual(['chart-default-container', 'toolbox']);
    expect(centerMain.children.map((child: any) => child.ratio)).toEqual([0.75, 0.25]);
  });

  it('migrates the previous full-width Toolbox default without losing panel state', () => {
    installElectronBridge();
    const storageKey = 'desktop-layout-migration-test';
    const previousDesktopLayout = createPreviousDesktopLayout();
    localStorage.setItem(storageKey, JSON.stringify(previousDesktopLayout));
    localStorage.setItem(`dock-layout-desktop-mt5-v2:${storageKey}`, '1');

    const manager = new DockManager();
    expect(manager.loadFromStorage(storageKey)).toBe(true);

    const layout = manager.getLayout();
    const root = layout.root as any;
    expect(root.direction).toBe('horizontal');
    expect(root.children.map((child: any) => child.id)).toEqual(['left-sidebar', 'center-main']);
    expect(root.children[0].ratio).toBe(0.20);
    expect(root.children[0].children.map((child: any) => child.ratio)).toEqual([0.38, 0.62]);
    expect(root.children[1].ratio).toBe(0.80);
    expect(root.children[1].children.map((child: any) => child.id)).toEqual(['chart-live', 'toolbox']);
    expect(root.children[1].children.map((child: any) => child.ratio)).toEqual([0.75, 0.25]);
    expect(root.children[1].children[0].props).toEqual({
      symbol: 'BTCUSD',
      timeframe: 'M5',
      preserved: true,
    });
    expect(layout.floatingPanels).toEqual(previousDesktopLayout.floatingPanels);
    expect(localStorage.getItem(`dock-layout-desktop-web-parity-v3:${storageKey}`)).toBe('1');
  });

  it('does not migrate the previous desktop layout when it is loaded in the web app', () => {
    const storageKey = 'browser-layout-isolation-test';
    const previousDesktopLayout = createPreviousDesktopLayout();
    localStorage.setItem(storageKey, JSON.stringify(previousDesktopLayout));
    localStorage.setItem(`dock-layout-desktop-mt5-v2:${storageKey}`, '1');

    const manager = new DockManager();
    expect(manager.loadFromStorage(storageKey)).toBe(true);

    const root = manager.getLayout().root as any;
    expect(root.direction).toBe('vertical');
    expect(root.children.map((child: any) => child.id)).toEqual(['desktop-top-main', 'toolbox']);
    expect(localStorage.getItem(`dock-layout-desktop-web-parity-v3:${storageKey}`)).toBeNull();
  });

  it('does not overwrite a customized desktop layout that shares the old structure', () => {
    installElectronBridge();
    const storageKey = 'custom-desktop-layout-test';
    const customizedDesktopLayout = createPreviousDesktopLayout();
    customizedDesktopLayout.root.children[0].ratio = 0.60;
    customizedDesktopLayout.root.children[1].ratio = 0.40;
    localStorage.setItem(storageKey, JSON.stringify(customizedDesktopLayout));
    localStorage.setItem(`dock-layout-desktop-mt5-v2:${storageKey}`, '1');

    const manager = new DockManager();
    expect(manager.loadFromStorage(storageKey)).toBe(true);

    const root = manager.getLayout().root as any;
    expect(root.direction).toBe('vertical');
    expect(root.children.map((child: any) => child.ratio)).toEqual([0.60, 0.40]);
    expect(localStorage.getItem(`dock-layout-desktop-web-parity-v3:${storageKey}`)).toBe('1');
  });
});

describe('compact Market Watch sidebar migration', () => {
  it.each(['browser', 'desktop'])('migrates the old equal split once in %s without changing chart, Toolbox, or floating state', platform => {
    if (platform === 'desktop') installElectronBridge();
    const storageKey = `dock-layout-sidebar-${platform}`;
    const previous = createPreviousSidebarLayout();
    localStorage.setItem(storageKey, JSON.stringify(previous));
    const expected = structuredClone(previous);
    const expectedSidebar = expected.root.children[0] as any;
    expectedSidebar.children[0].ratio = 0.38;
    expectedSidebar.children[1].ratio = 0.62;

    const manager = new DockManager();
    expect(manager.loadFromStorage(storageKey)).toBe(true);
    expect(manager.getLayout()).toEqual(expected);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(expected);
    expect(localStorage.getItem(`dock-layout-compact-sidebar-v1:${storageKey}`)).toBe('1');
  });

  it('preserves customized sidebar ratios', () => {
    const storageKey = 'dock-layout-custom-sidebar';
    const customized = createPreviousSidebarLayout();
    const sidebar = customized.root.children[0] as any;
    sidebar.children[0].ratio = 0.44;
    sidebar.children[1].ratio = 0.56;
    localStorage.setItem(storageKey, JSON.stringify(customized));

    const manager = new DockManager();
    expect(manager.loadFromStorage(storageKey)).toBe(true);
    expect(manager.getLayout()).toEqual(customized);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(customized);
  });

  it('preserves an equal split explicitly restored after the migration marker was saved', () => {
    const storageKey = 'dock-layout-resized-sidebar';
    localStorage.setItem(storageKey, JSON.stringify(createPreviousSidebarLayout()));
    const manager = new DockManager();
    expect(manager.loadFromStorage(storageKey)).toBe(true);
    expect(localStorage.getItem(`dock-layout-compact-sidebar-v1:${storageKey}`)).toBe('1');

    const resized = manager.getLayout();
    const sidebar = resized.root.children[0] as any;
    sidebar.children[0].ratio = 0.5;
    sidebar.children[1].ratio = 0.5;
    manager.setLayout(resized);
    manager.saveToStorage(storageKey);

    const restored = new DockManager();
    expect(restored.loadFromStorage(storageKey)).toBe(true);
    expect(restored.getLayout()).toEqual(resized);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(resized);
  });
});
