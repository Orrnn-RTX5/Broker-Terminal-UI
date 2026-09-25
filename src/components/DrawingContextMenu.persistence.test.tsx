// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawingManager, type Drawing } from '../services/drawingManager';
import { DrawingContextMenu } from './DrawingContextMenu';

function fireHuePointer(element: Element, type: 'pointerdown' | 'pointerup') {
    const event = new MouseEvent(type, { bubbles: true, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(element, event);
}

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
        const updateDrawingProperties = vi.spyOn(drawingManager, 'updateDrawingProperties').mockImplementation((_id, properties) => {
            Object.assign(drawing, properties);
            return true;
        });
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
        fireEvent.change(screen.getByRole('textbox', { name: 'RGB' }), {
            target: { value: '37, 99, 235' },
        });
        expect(drawing.color).toBe('#2563eb');
        expect(updateDrawingProperties).toHaveBeenCalledExactlyOnceWith(
            drawing.id, { color: '#2563eb' }, 'chart-xauusd-m1',
        );

        fireEvent.click(screen.getByText('Line Style & Width'));
        fireEvent.click(screen.getByText('Dashed'));
        expect(drawing.lineStyle).toBe('dashed');
        expect(persistCurrentContext).toHaveBeenLastCalledWith('chart-xauusd-m1');
        expect(persistCurrentContext.mock.invocationCallOrder[0])
            .toBeLessThan(saveToBackend.mock.invocationCallOrder[0]);

        fireEvent.click(screen.getByTitle('Thick'));
        expect(drawing.lineWidth).toBe(4);
        expect(persistCurrentContext).toHaveBeenCalledTimes(2);
        expect(persistCurrentContext).toHaveBeenLastCalledWith('chart-xauusd-m1');
    });

    it('previews only the menu drawing and saves its context once the hue drag finishes', () => {
        const drawing: Drawing = {
            id: 'd-menu-chart', type: 'trendline',
            points: [{ time: 1, price: 100 }, { time: 2, price: 101 }],
            color: '#ff0000', lineStyle: 'solid', lineWidth: 2, selected: true,
        };
        const otherDrawing: Drawing = { ...drawing, id: 'd-active-chart', color: '#8b5cf6' };
        vi.spyOn(drawingManager, 'getDrawings').mockImplementation(contextId => (
            contextId === 'chart-xauusd-m1' ? [drawing] : [otherDrawing]
        ));
        const saveToBackend = vi.spyOn(drawingManager, 'saveToBackend').mockResolvedValue(undefined);
        const persistCurrentContext = vi.spyOn(drawingManager, 'persistCurrentContext').mockReturnValue(true);
        const updateDrawingProperties = vi.spyOn(drawingManager, 'updateDrawingProperties').mockImplementation((_id, properties) => {
            Object.assign(drawing, properties);
            return true;
        });
        const renderAllDrawings = vi.spyOn(drawingManager, 'renderAllDrawings').mockImplementation(() => undefined);

        render(<DrawingContextMenu onClose={vi.fn()} />);
        act(() => window.dispatchEvent(new CustomEvent('drawing:contextmenu', {
            detail: { x: 20, y: 20, drawingId: drawing.id, contextId: 'chart-xauusd-m1' },
        })));
        fireEvent.click(screen.getByText('Change Color'));
        const hue = screen.getByRole('slider', { name: 'Hue' });
        fireHuePointer(hue, 'pointerdown');
        fireEvent.change(hue, { target: { value: '120' } });
        expect(drawing.color).toBe('#00ff00');
        expect(otherDrawing.color).toBe('#8b5cf6');
        expect(renderAllDrawings).toHaveBeenCalled();
        expect(persistCurrentContext).not.toHaveBeenCalled();
        expect(saveToBackend).not.toHaveBeenCalled();
        expect(updateDrawingProperties).not.toHaveBeenCalled();

        fireEvent.change(hue, { target: { value: '240' } });
        expect(drawing.color).toBe('#0000ff');
        expect(persistCurrentContext).not.toHaveBeenCalled();
        fireHuePointer(hue, 'pointerup');
        expect(updateDrawingProperties).toHaveBeenCalledExactlyOnceWith(
            drawing.id, { color: '#0000ff' }, 'chart-xauusd-m1',
        );
        expect(otherDrawing.color).toBe('#8b5cf6');
    });
});
