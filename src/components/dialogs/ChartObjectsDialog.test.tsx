// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Drawing } from '../../services/drawingManager';
import {
  ChartObjectsDialog,
  getChartObjectDisplayName,
  type ChartObjectsDrawingService,
} from './ChartObjectsDialog';

const makeDrawing = (overrides: Partial<Drawing> & Pick<Drawing, 'id' | 'type'>): Drawing => ({
  points: [{ time: 1_700_000_000, price: 100 }],
  color: '#2196F3',
  lineWidth: 2,
  lineStyle: 'solid',
  selected: false,
  ...overrides,
});

const createDrawingService = (initialDrawings: Drawing[]) => {
  let drawings = initialDrawings.map(drawing => ({ ...drawing }));
  const service: ChartObjectsDrawingService = {
    getDrawings: vi.fn(() => drawings),
    selectDrawing: vi.fn((id, _multi, targetContextId) => {
      if (targetContextId !== 'chart-a') return false;
      const drawing = drawings.find(candidate => candidate.id === id);
      if (!drawing) return false;
      drawing.selected = true;
      return true;
    }),
    unselectDrawing: vi.fn((id, targetContextId) => {
      if (targetContextId !== 'chart-a') return false;
      const drawing = drawings.find(candidate => candidate.id === id);
      if (!drawing) return false;
      drawing.selected = false;
      return true;
    }),
    unselectAll: vi.fn((targetContextId) => {
      if (targetContextId !== 'chart-a') return 0;
      const selectedCount = drawings.filter(drawing => drawing.selected).length;
      drawings.forEach(drawing => (drawing.selected = false));
      return selectedCount;
    }),
    deleteDrawing: vi.fn((id, targetContextId) => {
      if (targetContextId !== 'chart-a') return false;
      const previousLength = drawings.length;
      drawings = drawings.filter(drawing => drawing.id !== id);
      return drawings.length !== previousLength;
    }),
    deleteSelected: vi.fn((targetContextId) => {
      if (targetContextId !== 'chart-a') return 0;
      const previousLength = drawings.length;
      drawings = drawings.filter(drawing => !drawing.selected);
      return previousLength - drawings.length;
    }),
  };
  return service;
};

describe('ChartObjectsDialog', () => {
  it('renders truthful object labels and keeps selection/deletion scoped to the supplied context', () => {
    const service = createDrawingService([
      makeDrawing({ id: 'd-horizontal-123456', type: 'hline' }),
      makeDrawing({
        id: 'd-arrow-654321',
        type: 'stamp',
        subtype: 'arrowUp',
        selected: true,
        color: '#22c55e',
      }),
    ]);
    const onClose = vi.fn();

    render(
      <ChartObjectsDialog
        isOpen
        targetContextId="chart-a"
        symbol="XAUUSD"
        timeframe="M5"
        drawingService={service}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Objects on XAUUSD M5' })).toBeInTheDocument();
    expect(screen.getByText('Horizontal line')).toBeInTheDocument();
    expect(screen.getByText('Arrow up')).toBeInTheDocument();
    expect(service.getDrawings).toHaveBeenLastCalledWith('chart-a');
    expect(screen.getByText('2 objects · 1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Delete Arrow up/ }));
    expect(service.deleteDrawing).toHaveBeenCalledWith('d-arrow-654321', 'chart-a');
    expect(screen.queryByText('Arrow up')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /Select Horizontal line/ }));
    expect(service.selectDrawing).toHaveBeenCalledWith('d-horizontal-123456', true, 'chart-a');
    expect(screen.getByText('1 object · 1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }));
    expect(service.deleteSelected).toHaveBeenCalledWith('chart-a');
    expect(screen.getByText('No drawing objects are attached to XAUUSD M5.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refreshes for matching drawing events and ignores unrelated chart events', async () => {
    const service = createDrawingService([
      makeDrawing({ id: 'd-line', type: 'trendline', subtype: 'ray' }),
    ]);

    render(
      <ChartObjectsDialog
        isOpen
        targetContextId="chart-a"
        symbol="EURUSD"
        drawingService={service}
        onClose={vi.fn()}
      />,
    );
    expect(service.getDrawings).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('drawings:changed', {
        detail: { contextId: 'chart-b', reason: 'added' },
      }));
    });
    expect(service.getDrawings).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('drawings:changed', {
        detail: { contextId: 'chart-a', reason: 'updated' },
      }));
    });
    await waitFor(() => expect(service.getDrawings).toHaveBeenCalledTimes(2));
  });

  it('handles a missing target safely and closes with Escape before app shortcuts run', () => {
    const service = createDrawingService([]);
    const onClose = vi.fn();
    const outerShortcut = vi.fn();
    window.addEventListener('keydown', outerShortcut);

    render(
      <ChartObjectsDialog
        isOpen
        targetContextId={null}
        symbol=""
        drawingService={service}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('No active chart context is available.')).toBeInTheDocument();
    expect(service.getDrawings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outerShortcut).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outerShortcut);
  });

  it('maps catalog and stamp subtypes to readable names', () => {
    expect(getChartObjectDisplayName({ type: 'trendline', subtype: 'info_line' })).toBe('Info line');
    expect(getChartObjectDisplayName({ type: 'stamp', subtype: 'sell' })).toBe('Sell arrow');
    expect(getChartObjectDisplayName({ type: 'stamp', subtype: 'customMarker' })).toBe('Custom Marker');
  });
});
