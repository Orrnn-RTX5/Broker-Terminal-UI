// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawingManager, type Drawing } from '../services/drawingManager';
import { DrawingContextMenu } from './DrawingContextMenu';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('DrawingContextMenu persistence', () => {
    it('persists color, line-style, and width mutations for the drawing context', () => {
        const drawing: Drawing = {
            id: 'd-test-1',
            type: 'trendline',
            points: [
                { time: 1, price: 100 },
                { time: 2, price: 101 },
            ],
            color: '#4a9eff',
            lineStyle: 'solid',
            lineWidth: 2,
            selected: true,
        };
        vi.spyOn(drawingManager, 'getDrawings').mockImplementation(() => [drawing]);
        const saveToBackend = vi.spyOn(drawingManager, 'saveToBackend').mockResolvedValue(undefined);
        const persistCurrentContext = vi.spyOn(drawingManager, 'persistCurrentContext').mockReturnValue(true);
        vi.spyOn(drawingManager, 'renderAllDrawings').mockImplementation(() => undefined);

        render(<DrawingContextMenu onClose={vi.fn()} />);
        act(() => {
            window.dispatchEvent(new CustomEvent('drawing:contextmenu', {
                detail: {
                    x: 20,
                    y: 20,
                    drawingId: drawing.id,
                    contextId: 'chart-xauusd-m1',
                },
            }));
        });

        fireEvent.click(screen.getByText('Change Color'));
        fireEvent.click(screen.getByTitle('#2563eb'));
        expect(drawing.color).toBe('#2563eb');
        expect(persistCurrentContext).toHaveBeenLastCalledWith('chart-xauusd-m1');
        expect(persistCurrentContext.mock.invocationCallOrder[0])
            .toBeLessThan(saveToBackend.mock.invocationCallOrder[0]);

        fireEvent.click(screen.getByText('Line Style & Width'));
        fireEvent.click(screen.getByText('Dashed'));
        expect(drawing.lineStyle).toBe('dashed');
        expect(persistCurrentContext).toHaveBeenLastCalledWith('chart-xauusd-m1');

        fireEvent.click(screen.getByTitle('Thick'));
        expect(drawing.lineWidth).toBe(4);
        expect(persistCurrentContext).toHaveBeenCalledTimes(3);
        expect(persistCurrentContext).toHaveBeenLastCalledWith('chart-xauusd-m1');
    });
});
