// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrawingColorPicker } from './DrawingColorPicker';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function firePointer(element: Element, type: string, clientX = 0, clientY = 0) {
    const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(element, event);
}

function setShadeBounds(element: Element) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120,
        width: 200, height: 100, toJSON: () => ({}),
    });
}

function renderControlled(initialValue: string) {
    const onChange = vi.fn();
    const onChangeComplete = vi.fn();
    function ControlledPicker() {
        const [value, setValue] = useState(initialValue);
        return <DrawingColorPicker
            value={value}
            onChange={color => {
                onChange(color);
                setValue(color);
            }}
            onChangeComplete={onChangeComplete}
        />;
    }
    render(<ControlledPicker />);
    return { onChange, onChangeComplete };
}

describe('DrawingColorPicker', () => {
    it('shows only the RGB field for the selected color', () => {
        render(<DrawingColorPicker value="#32a852" onChange={vi.fn()} />);

        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('50, 168, 82');
        for (const label of ['HEX', 'CMYK', 'HSV', 'HSL']) {
            expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
        }
    });

    it('previews hue changes while dragging and commits the final color on release', () => {
        const { onChange, onChangeComplete } = renderControlled('#ff0000');
        const hue = screen.getByRole('slider', { name: 'Hue' });

        firePointer(hue, 'pointerdown');
        fireEvent.change(hue, { target: { value: '120' } });
        expect(onChange).toHaveBeenLastCalledWith('#00ff00');
        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('0, 255, 0');
        fireEvent.change(hue, { target: { value: '240' } });
        expect(onChange).toHaveBeenLastCalledWith('#0000ff');
        expect(onChangeComplete).not.toHaveBeenCalled();

        firePointer(hue, 'pointerup');
        expect(onChangeComplete).toHaveBeenCalledExactlyOnceWith('#0000ff');
    });

    it('maps shade dragging to saturation and brightness and clamps at the edges', () => {
        const { onChange, onChangeComplete } = renderControlled('#ff0000');
        const shade = screen.getByRole('slider', { name: 'Color saturation and brightness' });
        setShadeBounds(shade);

        firePointer(shade, 'pointerdown', 110, 70);
        expect(onChange).toHaveBeenLastCalledWith('#804040');
        firePointer(shade, 'pointermove', 310, 70);
        expect(onChange).toHaveBeenLastCalledWith('#800000');
        expect(onChangeComplete).not.toHaveBeenCalled();

        firePointer(shade, 'pointerup', 310, 70);
        expect(onChangeComplete).toHaveBeenCalledExactlyOnceWith('#800000');
        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('128, 0, 0');
    });

    it.each(['pointercancel', 'lostpointercapture', 'blur'])(
        'commits the last shade once when dragging ends through %s', eventType => {
            const { onChangeComplete } = renderControlled('#ff0000');
            const shade = screen.getByRole('slider', { name: 'Color saturation and brightness' });
            setShadeBounds(shade);

            firePointer(shade, 'pointerdown', 110, 70);
            expect(onChangeComplete).not.toHaveBeenCalled();
            if (eventType === 'blur') fireEvent.blur(shade);
            else firePointer(shade, eventType);
            firePointer(shade, 'lostpointercapture');
            expect(onChangeComplete).toHaveBeenCalledExactlyOnceWith('#804040');
        },
    );

    it('keeps a chosen hue at black so increasing brightness restores that hue', () => {
        const { onChange } = renderControlled('#00ff00');
        const shade = screen.getByRole('slider', { name: 'Color saturation and brightness' });
        const hue = screen.getByRole('slider', { name: 'Hue' });
        setShadeBounds(shade);

        firePointer(shade, 'pointerdown', 210, 120);
        firePointer(shade, 'pointerup', 210, 120);
        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('0, 0, 0');

        firePointer(hue, 'pointerdown');
        fireEvent.change(hue, { target: { value: '240' } });
        firePointer(hue, 'pointerup');
        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('0, 0, 0');

        firePointer(shade, 'pointerdown', 210, 20);
        firePointer(shade, 'pointerup', 210, 20);
        expect(onChange).toHaveBeenLastCalledWith('#0000ff');
        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('0, 0, 255');
    });

    it('supports shade adjustment from the keyboard and commits the selected color', () => {
        const { onChange, onChangeComplete } = renderControlled('#ff0000');
        const shade = screen.getByRole('slider', { name: 'Color saturation and brightness' });

        fireEvent.keyDown(shade, { key: 'ArrowDown', shiftKey: true });
        expect(onChange).toHaveBeenLastCalledWith('#e60000');
        expect(onChangeComplete).toHaveBeenLastCalledWith('#e60000');
        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('230, 0, 0');
    });

    it('accepts RGB edits and rejects incomplete, non-integer, or out-of-range channels', () => {
        const { onChange, onChangeComplete } = renderControlled('#32a852');
        const rgb = screen.getByRole('textbox', { name: 'RGB' });

        for (const value of ['50, 168', 'red', '256, 0, 0', '-1, 0, 0', '0.5, 0, 0']) {
            fireEvent.change(rgb, { target: { value } });
            fireEvent.blur(rgb);
            expect(onChange).not.toHaveBeenCalled();
            expect(rgb).toHaveValue('50, 168, 82');
        }

        fireEvent.change(rgb, { target: { value: '170,187,204' } });
        expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
        expect(onChangeComplete).toHaveBeenLastCalledWith('#aabbcc');
        fireEvent.keyDown(rgb, { key: 'Enter' });
        expect(rgb).toHaveValue('170, 187, 204');

        fireEvent.change(rgb, { target: { value: '255, 136, 0' } });
        expect(onChange).toHaveBeenLastCalledWith('#ff8800');
        expect(onChangeComplete).toHaveBeenLastCalledWith('#ff8800');
        expect(rgb).toHaveValue('255, 136, 0');
    });

    it('refreshes the RGB field when another drawing color is supplied', () => {
        const onChange = vi.fn();
        const { rerender } = render(<DrawingColorPicker value="#32a852" onChange={onChange} />);

        rerender(<DrawingColorPicker value="#8b5cf6" onChange={onChange} />);
        expect(screen.getByRole('textbox', { name: 'RGB' })).toHaveValue('139, 92, 246');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('copies the currently selected RGB value', async () => {
        const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: { writeText },
        });
        try {
            renderControlled('#32a852');
            fireEvent.change(screen.getByRole('textbox', { name: 'RGB' }), {
                target: { value: '139, 92, 246' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Copy RGB value' }));

            expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
            expect(writeText).toHaveBeenCalledExactlyOnceWith('139, 92, 246');
        } finally {
            if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
            else Reflect.deleteProperty(navigator, 'clipboard');
        }
    });
});
