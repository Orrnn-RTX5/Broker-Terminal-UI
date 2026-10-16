// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockLayout } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockContainer, FloatingPanelsLayer } from './DockContainer';
import { DockPanel } from './DockPanel';

const initialLayout = useDockLayoutStore.getState().layout;

const createSidebarLayout = (): DockLayout => ({
  version: 'mt5-navigator-float-test',
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
        ratio: 0.22,
        children: [
          {
            id: 'market-watch',
            title: 'Market Watch',
            component: 'MarketWatch',
            closable: true,
            floatable: true,
            ratio: 0.62,
          },
          {
            id: 'navigator',
            title: 'Navigator',
            component: 'Navigator',
            closable: true,
            floatable: true,
            ratio: 0.38,
          },
        ],
      },
      {
        id: 'center-main',
        type: 'split',
        direction: 'vertical',
        ratio: 0.78,
        children: [
          {
            id: 'chart',
            title: 'EURUSD,H1',
            component: 'Chart',
            closable: true,
            floatable: true,
            ratio: 1,
          },
        ],
      },
    ],
  },
});

afterEach(() => {
  useDockLayoutStore.getState().setLayout(initialLayout);
});

describe('Navigator dock chrome and MT5 double-click undock/move/redock', () => {
  it('keeps one outer title, only the close button, and triggers onFloat on header double-click', () => {
    const onClose = vi.fn();
    const onFloat = vi.fn();

    const { container } = render(
      <DockPanel
        panel={{
          id: 'navigator',
          title: 'Navigator',
          component: 'Navigator',
          closable: true,
          floatable: true,
          ratio: 0.5,
        }}
        onClose={onClose}
        onFloat={onFloat}
      >
        <div className="navigator-panel">
          <div className="navigator-panel__body">Accounts</div>
        </div>
      </DockPanel>,
    );

    expect(screen.getAllByText('Navigator')).toHaveLength(1);
    expect(screen.getByText('Navigator')).toHaveClass('dock-panel__title');
    expect(container.querySelector('.navigator-panel__header')).toBeNull();
    expect(container.querySelector('.navigator-panel__body')).not.toBeNull();
    expect(screen.queryByTitle('Minimize')).toBeNull();

    const header = container.querySelector('.dock-panel__header')!;
    fireEvent.doubleClick(header);
    expect(onFloat).toHaveBeenCalledTimes(1);

    // Double-clicking the close button should not float
    fireEvent.doubleClick(screen.getByTitle('Close'));
    expect(onFloat).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('undocks Navigator on title-bar double-click, moves smoothly when dragged, and redocks to left-sidebar on double-click', () => {
    useDockLayoutStore.getState().setLayout(createSidebarLayout());

    const renderPanel = (panel: { id: string; title: string }) => (
      <div data-testid={`body-${panel.id}`}>{panel.title}</div>
    );

    const { container } = render(
      <>
        <DockContainer isRoot renderPanel={renderPanel} />
        <FloatingPanelsLayer renderPanel={renderPanel} />
      </>,
    );

    const dockedNav = container.querySelector<HTMLElement>('[data-dock-child="navigator"]');
    expect(dockedNav).not.toBeNull();
    const dockedHeader = dockedNav!.querySelector<HTMLElement>('.dock-panel__header')!;
    expect(dockedHeader).not.toBeNull();

    // 1. Double-click docked Navigator header -> undocks into floating mini-frame
    act(() => {
      fireEvent.doubleClick(dockedHeader);
    });

    expect(useDockLayoutStore.getState().layout.floatingPanels).toHaveLength(1);
    expect(container.querySelector('[data-dock-child="navigator"]')).toBeNull();

    // Market Watch expands to fill 100% of left-sidebar
    const marketWatchSlot = container.querySelector<HTMLElement>('[data-dock-child="market-watch"]');
    expect(marketWatchSlot?.style.flexGrow).toBe('1');

    const floatingNav = container.querySelector<HTMLElement>('[data-dock-floating-panel="true"][data-dock-panel="navigator"]');
    expect(floatingNav).not.toBeNull();
    expect(floatingNav?.style.left).toBe('16px');
    expect(floatingNav?.style.top).toBe('64px');
    expect(floatingNav?.style.width).toBe('280px');
    expect(floatingNav?.style.height).toBe('320px');

    // 2. Drag floating Navigator header to a new workspace coordinate
    const floatingHeader = floatingNav!.querySelector<HTMLElement>('.dock-panel__header')!;
    act(() => {
      fireEvent.mouseDown(floatingHeader, { clientX: 60, clientY: 75 });
      fireEvent.mouseMove(window, { clientX: 360, clientY: 235 });
      fireEvent.mouseUp(window, { clientX: 360, clientY: 235 });
    });

    const movedFloatingNav = container.querySelector<HTMLElement>('[data-dock-floating-panel="true"][data-dock-panel="navigator"]');
    expect(movedFloatingNav?.style.left).toBe('316px');
    expect(movedFloatingNav?.style.top).toBe('224px');

    // 3. Double-click floating Navigator header -> redocks back into left-sidebar below Market Watch
    const movedHeader = movedFloatingNav!.querySelector<HTMLElement>('.dock-panel__header')!;
    act(() => {
      fireEvent.doubleClick(movedHeader);
    });

    expect(useDockLayoutStore.getState().layout.floatingPanels).toHaveLength(0);
    const redockedMarketWatch = container.querySelector<HTMLElement>('[data-dock-child="market-watch"]');
    const redockedNavigator = container.querySelector<HTMLElement>('[data-dock-child="navigator"]');
    expect(redockedMarketWatch).not.toBeNull();
    expect(redockedNavigator).not.toBeNull();
    expect(Number(redockedMarketWatch?.style.flexGrow)).toBeCloseTo(0.62, 2);
    expect(Number(redockedNavigator?.style.flexGrow)).toBeCloseTo(0.38, 2);

    // 4. Double-clicking again restores the last moved floating position (316, 224)
    act(() => {
      fireEvent.doubleClick(redockedNavigator!.querySelector<HTMLElement>('.dock-panel__header')!);
    });
    const refloatedNav = container.querySelector<HTMLElement>('[data-dock-floating-panel="true"][data-dock-panel="navigator"]');
    expect(refloatedNav?.style.left).toBe('316px');
    expect(refloatedNav?.style.top).toBe('224px');

    const resizeHandles = refloatedNav!.querySelectorAll<HTMLElement>('[data-dock-floating-resize-handle="true"]');
    expect(resizeHandles.length).toBe(8);
    resizeHandles.forEach((handle) => {
      expect(handle.className).toContain('bg-transparent');
    });
  });
});
