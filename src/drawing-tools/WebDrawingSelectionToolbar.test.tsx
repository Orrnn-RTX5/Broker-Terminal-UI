// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => ({
  updateDrawingProperties: vi.fn(),
  deleteDrawing: vi.fn(),
}));

vi.mock('../services/drawingManager', () => ({
  drawingManager: managerMocks,
}));

import { WebDrawingSelectionToolbar } from './WebDrawingSelectionToolbar';

const drawingSelection = {
  drawingId: 'drawing-17',
  contextId: 'chart-xauusd-m1',
  type: 'channel',
  subtype: 'parallel_channel',
  color: '#2962ff',
  lineWidth: 2,
  lineStyle: 'solid',
  locked: false,
  anchorClientX: 450,
  anchorClientY: 30,
} as const;

const dispatchSelected = (
  overrides: Partial<typeof drawingSelection> = {},
) => {
  act(() => {
    window.dispatchEvent(new CustomEvent('drawing:selected', {
      detail: { ...drawingSelection, ...overrides },
    }));
  });
};

const dispatchSelectionCleared = (contextId: string) => {
  act(() => {
    window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
      detail: { contextId },
    }));
  });
};

beforeEach(() => {
  cleanup();
  managerMocks.updateDrawingProperties.mockReset();
  managerMocks.deleteDrawing.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WebDrawingSelectionToolbar', () => {
  it('appears when drawing:selected identifies the selected drawing', () => {
    render(<WebDrawingSelectionToolbar />);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

    dispatchSelected();

    expect(screen.getByRole('toolbar', { name: 'Edit parallel_channel' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Line color')).toHaveValue('#2962ff');
    expect(screen.getByLabelText('Line width')).toHaveValue('2');
    expect(screen.getByLabelText('Line style')).toHaveValue('solid');
  });

  it('clamps from the live toolbar and viewport dimensions on selection and resize', () => {
    let viewportWidth = 500;
    let viewportHeight = 300;
    let toolbarWidth = 120;
    let toolbarHeight = 36;

    vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewportWidth);
    vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => viewportHeight);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const width = this.classList.contains('web-drawing-selection-toolbar')
        ? toolbarWidth
        : 0;
      const height = this.classList.contains('web-drawing-selection-toolbar')
        ? toolbarHeight
        : 0;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });

    render(<WebDrawingSelectionToolbar />);
    dispatchSelected();
    const toolbar = screen.getByRole('toolbar');

    expect(toolbar).toHaveStyle({ left: '372px', top: '42px' });

    viewportWidth = 280;
    viewportHeight = 110;
    toolbarWidth = 200;
    toolbarHeight = 64;
    act(() => window.dispatchEvent(new Event('resize')));

    expect(toolbar).toHaveStyle({ left: '72px', top: '38px' });
  });

  it('updates color, width, style, and lock in the owning context', () => {
    render(<WebDrawingSelectionToolbar />);
    dispatchSelected();

    fireEvent.change(screen.getByLabelText('Line color'), {
      target: { value: '#ff0000' },
    });
    fireEvent.change(screen.getByLabelText('Line width'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Line style'), {
      target: { value: 'dotted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lock drawing' }));

    expect(managerMocks.updateDrawingProperties.mock.calls).toEqual([
      ['drawing-17', { color: '#ff0000' }, 'chart-xauusd-m1'],
      ['drawing-17', { lineWidth: 4 }, 'chart-xauusd-m1'],
      ['drawing-17', { lineStyle: 'dotted' }, 'chart-xauusd-m1'],
      ['drawing-17', { locked: true }, 'chart-xauusd-m1'],
    ]);
  });

  it('deletes the selected drawing from its owning context', () => {
    render(<WebDrawingSelectionToolbar />);
    dispatchSelected();

    fireEvent.click(screen.getByRole('button', { name: 'Delete drawing' }));

    expect(managerMocks.deleteDrawing).toHaveBeenCalledOnce();
    expect(managerMocks.deleteDrawing).toHaveBeenCalledWith(
      'drawing-17',
      'chart-xauusd-m1',
    );
  });

  it('ignores another context clearing selection and hides for the matching context', () => {
    render(<WebDrawingSelectionToolbar />);
    dispatchSelected();
    expect(screen.getByRole('toolbar')).toBeInTheDocument();

    dispatchSelectionCleared('chart-eurusd-m5');
    expect(screen.getByRole('toolbar')).toBeInTheDocument();

    dispatchSelectionCleared('chart-xauusd-m1');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});
