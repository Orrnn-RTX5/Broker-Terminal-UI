// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, describe, expect, it } from 'vitest';
import type { DockLayout } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockContainer } from './DockContainer';

const originalLayout = useDockLayoutStore.getState().layout;

const layoutWithToolbox = (): DockLayout => ({
  version: 'chart-fill-test',
  floatingPanels: [],
  root: {
    id: 'root',
    type: 'split',
    direction: 'horizontal',
    ratio: 1,
    children: [
      {
        id: 'left-sidebar',
        type: 'split',
        direction: 'vertical',
        ratio: 0.2,
        children: [
          {
            id: 'market-watch',
            title: 'Market Watch',
            component: 'MarketWatch',
            ratio: 0.5,
          },
          {
            id: 'navigator',
            title: 'Navigator',
            component: 'Navigator',
            ratio: 0.5,
          },
        ],
      },
      {
        id: 'center-main',
        type: 'split',
        direction: 'vertical',
        ratio: 0.8,
        children: [
          {
            id: 'chart',
            title: 'XAUUSD,M1',
            component: 'Chart',
            ratio: 0.44,
          },
          {
            id: 'toolbox',
            title: 'Toolbox',
            component: 'Terminal',
            ratio: 0.56,
          },
        ],
      },
    ],
  },
});

afterAll(() => {
  useDockLayoutStore.getState().setLayout(originalLayout);
});

describe('DockContainer split sizing', () => {
  it('keeps Navigator and docked Toolbox chrome while Market Watch stays headerless', () => {
    useDockLayoutStore.getState().setLayout(layoutWithToolbox());

    const { container } = render(
      <DockContainer
        isRoot
        renderPanel={(panel) => <div>{panel.component}</div>}
      />,
    );

    const marketWatch = container.querySelector('[data-dock-panel-component="marketwatch"]');
    const navigator = container.querySelector('[data-dock-panel-component="navigator"]');
    const toolbox = container.querySelector('[data-dock-panel-component="terminal"]');

    expect(marketWatch?.querySelector('.dock-panel__header')).toBeNull();
    expect(toolbox?.querySelector('.dock-panel__header')).not.toBeNull();
    expect(toolbox?.querySelector('.dock-panel__title')?.textContent).toBe('Toolbox');
    expect(toolbox?.querySelector('button[title="Close"]')).not.toBeNull();
    expect(navigator?.querySelector('.dock-panel__header')).not.toBeNull();
    expect(navigator?.querySelector('.dock-panel__title')?.textContent).toBe('Navigator');
  });

  it('fills the chart column after Toolbox closes without changing the left sidebar split', async () => {
    useDockLayoutStore.getState().setLayout(layoutWithToolbox());

    const { container } = render(
      <DockContainer
        isRoot
        renderPanel={(panel) => <div>{panel.title}</div>}
      />,
    );

    const marketWatch = container.querySelector<HTMLElement>('[data-dock-child="market-watch"]');
    const navigator = container.querySelector<HTMLElement>('[data-dock-child="navigator"]');
    const chart = container.querySelector<HTMLElement>('[data-dock-child="chart"]');
    const toolbox = container.querySelector<HTMLElement>('[data-dock-panel="toolbox"]');
    const verticalHandles = container.querySelectorAll<HTMLElement>('[data-dock-resize-handle="vertical"]');
    const horizontalHandles = container.querySelectorAll<HTMLElement>('[data-dock-resize-handle="horizontal"]');

    expect(marketWatch?.style.flexGrow).toBe('0.5');
    expect(navigator?.style.flexGrow).toBe('0.5');
    expect(chart?.style.flexGrow).toBe('0.44');
    expect(verticalHandles).toHaveLength(1);
    expect(horizontalHandles).toHaveLength(2);
    expect(verticalHandles[0].className).toContain('w-0');
    expect(horizontalHandles[0].className).toContain('h-0');
    expect(verticalHandles[0].querySelector('[data-dock-resize-hit-target="vertical"]')).not.toBeNull();
    expect(horizontalHandles[0].querySelector('[data-dock-resize-hit-target="horizontal"]')).not.toBeNull();

    expect(toolbox?.querySelector('.dock-panel__header')).not.toBeNull();
    const toolboxCloseButton = toolbox?.querySelector<HTMLButtonElement>('button[title="Close"]');
    expect(toolboxCloseButton).not.toBeNull();
    fireEvent.click(toolboxCloseButton!);

    await waitFor(() => {
      expect(container.querySelector('[data-dock-panel="toolbox"]')).toBeNull();
      expect(container.querySelector<HTMLElement>('[data-dock-child="chart"]')?.style.flexGrow).toBe('1');
    });

    expect(container.querySelector<HTMLElement>('[data-dock-child="market-watch"]')?.style.flexGrow).toBe('0.5');
    expect(container.querySelector<HTMLElement>('[data-dock-child="navigator"]')?.style.flexGrow).toBe('0.5');
  });
});
