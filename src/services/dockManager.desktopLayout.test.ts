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

afterEach(() => {
  localStorage.clear();
  delete window.electron;
});

describe('desktop dock defaults', () => {
  it('preserves the established browser workspace proportions', () => {
    const root = new DockManager().getLayout().root as any;
    expect(root.children.map((child: any) => child.ratio)).toEqual([0.20, 0.80]);
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
    expect(leftSidebar.children.map((child: any) => child.ratio)).toEqual([0.50, 0.50]);

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
