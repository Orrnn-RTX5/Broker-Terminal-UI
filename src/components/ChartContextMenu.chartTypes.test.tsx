// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';

import { ChartContextMenu } from './ChartContextMenu';
import { useTemplateStore } from '../store/useTemplateStore';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderMenu = (
  currentChartType: 'line' | 'area',
  overrides: Partial<ComponentProps<typeof ChartContextMenu>> = {},
) => {
  const onChangeChartType = vi.fn();
  const onClose = vi.fn();
  const onToggleGrid = vi.fn();
  const noop = vi.fn();

  render(
    <ChartContextMenu
      visible
      x={20}
      y={20}
      symbol="XAUUSD"
      currentChartType={currentChartType}
      currentTimeframe="M1"
      onChangeChartType={onChangeChartType}
      onChangeTimeframe={noop}
      onToggleOneClickTrading={noop}
      onToggleGrid={onToggleGrid}
      onToggleVolumes={noop}
      onToggleAutoScroll={noop}
      onToggleChartShift={noop}
      onOpenProperties={noop}
      onSaveAsPicture={noop}
      onPrintChart={noop}
      onRefresh={noop}
      onZoomIn={noop}
      onZoomOut={noop}
      onDeleteIndicators={noop}
      onOpenNewOrder={noop}
      onOpenDOM={noop}
      onOpenTemplateDialog={noop}
      onAddIndicator={noop}
      targetContextId="chart-test"
      onClose={onClose}
      {...overrides}
    />,
  );

  return { onChangeChartType, onToggleGrid, onClose };
};

describe('ChartContextMenu chart types', () => {
  it('keeps Line and Area separate and places Area immediately after Line', async () => {
    const { onChangeChartType, onClose } = renderMenu('line');
    const lineLabel = screen.getByText('Line Chart');
    const areaLabel = screen.getByText('Area Chart');
    const lineItem = lineLabel.parentElement as HTMLDivElement;
    const areaItem = areaLabel.parentElement as HTMLDivElement;

    expect(lineItem.nextElementSibling).toBe(areaItem);
    expect(lineItem).toHaveStyle({ background: 'var(--ctx-item-active-bg, rgba(59, 130, 246, 0.15))' });
    expect(areaItem).toHaveStyle({ background: 'transparent' });

    fireEvent.click(areaItem);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onChangeChartType).toHaveBeenCalledWith('area'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks only Area active when Area is selected and Line still selects Line', async () => {
    const { onChangeChartType } = renderMenu('area');
    const lineItem = screen.getByText('Line Chart').parentElement as HTMLDivElement;
    const areaItem = screen.getByText('Area Chart').parentElement as HTMLDivElement;

    expect(lineItem).toHaveStyle({ background: 'transparent' });
    expect(areaItem).toHaveStyle({ background: 'var(--ctx-item-active-bg, rgba(59, 130, 246, 0.15))' });

    fireEvent.click(lineItem);
    await waitFor(() => expect(onChangeChartType).toHaveBeenCalledWith('line'));
  });
});

describe('ChartContextMenu grid choices', () => {
  it('preserves the checked Grid toggle and Ctrl+G shortcut without optional grid-choice callbacks', async () => {
    const { onToggleGrid, onClose } = renderMenu('line');
    const grid = screen.getByRole('menuitemcheckbox', { name: 'Grid' });
    expect(grid).toHaveAttribute('aria-checked', 'true');
    expect(grid).toHaveTextContent('Ctrl+G');
    expect(screen.queryByRole('menuitem', { name: 'Grid type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Fine grid' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Grid line style' })).not.toBeInTheDocument();
    fireEvent.click(grid);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onToggleGrid).not.toHaveBeenCalled();
    await waitFor(() => expect(onToggleGrid).toHaveBeenCalledOnce());
  });

  it('checks Square by default and selects Price/time aligned after closing', async () => {
    const user = userEvent.setup({ skipHover: true });
    const onChangeGridType = vi.fn();
    const { onClose } = renderMenu('line', { showGrid: false, onChangeGridType });
    const trigger = screen.getByRole('menuitem', { name: 'Grid type' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const square = screen.getByRole('menuitemradio', { name: 'Square' });
    const scale = screen.getByRole('menuitemradio', { name: 'Price/time aligned' });
    expect(square).toHaveAttribute('aria-checked', 'true');
    expect(square.querySelector('polyline')).not.toBeNull();
    expect(scale).toHaveAttribute('aria-checked', 'false');
    expect(scale.querySelector('polyline')).toBeNull();
    // user-event omits mouseout.relatedTarget; provide the native portal transition before its full pointer click.
    fireEvent.mouseOut(trigger, { relatedTarget: scale });
    expect(screen.getByRole('menu', { name: 'Grid type' })).toBeInTheDocument();
    await user.click(scale);
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(onChangeGridType).toHaveBeenCalledWith('scale'));
  });

  it('checks the selected price/time grid and opens grid choices from the keyboard', async () => {
    const onChangeGridType = vi.fn();
    const { onClose } = renderMenu('line', { gridType: 'scale', onChangeGridType });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Grid type' }), { key: 'Enter' });
    expect(screen.getByRole('menuitemradio', { name: 'Price/time aligned' })).toHaveAttribute('aria-checked', 'true');
    const square = screen.getByRole('menuitemradio', { name: 'Square' });
    expect(square).toHaveAttribute('aria-checked', 'false');
    expect(square).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(onChangeGridType).toHaveBeenCalledWith('square'));
  });

  it('selects MT5 through its own grid-type callback and closes the menu', async () => {
    const onChangeGridType = vi.fn();
    const { onClose } = renderMenu('line', { gridType: 'scale', onChangeGridType });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grid type' }));
    const mt5 = within(screen.getByRole('menu', { name: 'Grid type' })).getByRole('menuitemradio', { name: 'Fine grid' });
    expect(mt5).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(mt5);
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(onChangeGridType).toHaveBeenCalledWith('mt5'));
  });

  it.each(['click', 'Enter', ' '])('offers MT5 directly and closes before applying it with %s', async (action) => {
    const onChangeGridType = vi.fn();
    const { onClose } = renderMenu('line', { showGrid: false, gridType: 'scale', onChangeGridType });
    expect(screen.queryByRole('menu', { name: 'Grid type' })).not.toBeInTheDocument();
    const mt5 = screen.getByRole('menuitemradio', { name: 'Fine grid' });
    expect(mt5).toHaveAttribute('aria-checked', 'false');
    if (action === 'click') fireEvent.click(mt5);
    else fireEvent.keyDown(mt5, { key: action });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onChangeGridType).not.toHaveBeenCalled();
    await waitFor(() => expect(onChangeGridType).toHaveBeenCalledWith('mt5'));
  });

  it.each([true, false])('marks the direct MT5 entry only while its grid is visible (%s)', (showGrid) => {
    renderMenu('line', { showGrid, gridType: 'mt5', onChangeGridType: vi.fn() });
    const mt5 = screen.getByRole('menuitemradio', { name: 'Fine grid' });
    expect(mt5).toHaveAttribute('aria-checked', String(showGrid));
    expect(mt5.querySelector('polyline') !== null).toBe(showGrid);
  });

  it('checks saved MT5 while retaining the separately selected solid line style', () => {
    renderMenu('line', { gridType: 'mt5', gridLineStyle: 'solid', onChangeGridType: vi.fn(), onChangeGridLineStyle: vi.fn() });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grid type' }));
    const mt5 = within(screen.getByRole('menu', { name: 'Grid type' })).getByRole('menuitemradio', { name: 'Fine grid' });
    expect(mt5).toHaveAttribute('aria-checked', 'true');
    expect(mt5.querySelector('polyline')).not.toBeNull();
    expect(screen.getByRole('menuitemradio', { name: 'Square' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemradio', { name: 'Price/time aligned' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grid line style' }));
    expect(screen.getByRole('menuitemradio', { name: 'Solid' })).toHaveAttribute('aria-checked', 'true');
  });

  it('checks Dashed by default and chooses Solid without invoking the grid-type callback', async () => {
    const onChangeGridType = vi.fn();
    const onChangeGridLineStyle = vi.fn();
    const { onClose } = renderMenu('line', { gridType: 'scale', onChangeGridType, onChangeGridLineStyle });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grid line style' }));
    const dashed = screen.getByRole('menuitemradio', { name: 'Dashed' });
    expect(dashed).toHaveAttribute('aria-checked', 'true');
    expect(dashed.querySelector('polyline')).not.toBeNull();
    const solid = screen.getByRole('menuitemradio', { name: 'Solid' });
    expect(solid).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(solid);
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(onChangeGridLineStyle).toHaveBeenCalledWith('solid'));
    expect(onChangeGridType).not.toHaveBeenCalled();
  });

  it('checks Solid and keeps pointer-hover selection of Dashed available', async () => {
    const onChangeGridLineStyle = vi.fn();
    const { onClose } = renderMenu('line', { gridLineStyle: 'solid', onChangeGridLineStyle });
    const trigger = screen.getByRole('menuitem', { name: 'Grid line style' });
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(screen.getByRole('menuitemradio', { name: 'Solid' })).toHaveAttribute('aria-checked', 'true');
    const dashed = screen.getByRole('menuitemradio', { name: 'Dashed' });
    expect(dashed).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(dashed);
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(onChangeGridLineStyle).toHaveBeenCalledWith('dashed'));
  });

  it('keeps menu scrolling available and closes the child submenu when its parent scrolls', () => {
    const { onClose } = renderMenu('line', { onChangeGridType: vi.fn() });
    const mainMenu = screen.getByRole('menu', { name: 'Chart context menu' });
    fireEvent.wheel(mainMenu);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grid type' }));
    fireEvent.wheel(screen.getByRole('menu', { name: 'Grid type' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.scroll(mainMenu);
    expect(screen.queryByRole('menu', { name: 'Grid type' })).not.toBeInTheDocument();
    fireEvent.wheel(window);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('places a detached submenu inside the viewport near the right and bottom edges', () => {
    const rect = (left: number, top: number, width: number, height: number) => ({
      left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'menu' && this.getAttribute('aria-label') === 'Grid type') return rect(0, 0, 200, 98);
      if (this.firstElementChild?.getAttribute('aria-haspopup') === 'menu') return rect(window.innerWidth - 234, window.innerHeight - 58, 250, 30);
      return rect(0, 0, 0, 0);
    });
    renderMenu('line', { onChangeGridType: vi.fn() });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grid type' }));
    const submenu = screen.getByRole('menu', { name: 'Grid type' });
    expect(submenu.parentElement).toBe(document.body);
    expect(submenu).toHaveStyle({
      position: 'fixed',
      left: `${window.innerWidth - 434}px`,
      top: `${window.innerHeight - 106}px`,
    });
  });

  it('keeps the Templates parent open when entering its detached nested submenu', () => {
    const initial = useTemplateStore.getState();
    useTemplateStore.setState({ templates: [{ ...initial.templates[0], id: 'custom-test', name: 'Custom test', isDefault: false }] });
    try {
      renderMenu('line');
      const templatesTrigger = screen.getByRole('menuitem', { name: 'Templates' });
      fireEvent.click(templatesTrigger);
      const templates = screen.getByRole('menu', { name: 'Templates' });
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Template' }));
      const removal = screen.getByRole('menu', { name: 'Remove Template' });
      fireEvent.mouseLeave(templates, { relatedTarget: removal });
      fireEvent.mouseLeave(templatesTrigger.parentElement!, { relatedTarget: removal });
      expect(screen.getByRole('menu', { name: 'Templates' })).toBeInTheDocument();
      expect(screen.getByRole('menu', { name: 'Remove Template' })).toBeInTheDocument();
    } finally {
      cleanup();
      useTemplateStore.setState(initial);
    }
  });

  it('shows and toggles the chart background logo from the right-click context menu', async () => {
    const onToggleBackgroundLogo = vi.fn();
    const onOpenBackgroundImage = vi.fn();
    const { onClose } = renderMenu('line', {
      showBackgroundLogo: true,
      onToggleBackgroundLogo,
      onOpenBackgroundImage,
    });
    const hideItem = screen.getByRole('menuitemcheckbox', { name: 'Hide Background Logo' });
    expect(hideItem).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(hideItem);
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(onToggleBackgroundLogo).toHaveBeenCalledOnce());

    cleanup();
    renderMenu('line', { showBackgroundLogo: false, onToggleBackgroundLogo, onOpenBackgroundImage });
    const showItem = screen.getByRole('menuitemcheckbox', { name: 'Show Background Logo' });
    expect(showItem).toHaveAttribute('aria-checked', 'false');

    const bgImageItem = screen.getByRole('menuitem', { name: 'Background image' });
    fireEvent.click(bgImageItem);
    await waitFor(() => expect(onOpenBackgroundImage).toHaveBeenCalledOnce());
  });
});
