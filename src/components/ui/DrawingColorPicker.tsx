import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { clampColorChannel, hexToPickerHsv, hexToRgb, hsvToHex, normalizeHexColor } from '../../utils/colorPicker';
import type { PickerHsv } from '../../utils/colorPicker';
import './DrawingColorPicker.css';

function formatRgbValue(color: string): string {
    const { r, g, b } = hexToRgb(color);
    return `${r}, ${g}, ${b}`;
}

function parseRgbValue(input: string): string | null {
    const match = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/.exec(input);
    if (!match) return null;
    const channels = match.slice(1).map(Number);
    if (channels.some(channel => channel > 255)) return null;
    return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export interface DrawingColorPickerProps {
    value: string;
    onChange: (hex: string) => void;
    onChangeComplete?: (hex: string) => void;
}

export function DrawingColorPicker({ value, onChange, onChangeComplete }: DrawingColorPickerProps) {
    const tr = useUiTranslation();
    const titleId = useId();
    const rgbId = useId();
    const [picker, setPicker] = useState(() => {
        const color = normalizeHexColor(value) ?? '#4a9eff';
        return { externalValue: value, color, hsv: hexToPickerHsv(color), input: formatRgbValue(color) };
    });
    const [copied, setCopied] = useState(false);
    const shadePointer = useRef<number | null>(null);
    const huePointer = useRef<number | null>(null);
    const editing = useRef({ hsv: picker.hsv, color: picker.color });
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // A parent echo of our own live color must not quantize the active HSV axes.
    if (value !== picker.externalValue) {
        const color = normalizeHexColor(value) ?? picker.color;
        setPicker({
            ...picker,
            externalValue: value,
            ...(color !== picker.color ? { color, hsv: hexToPickerHsv(color, picker.hsv), input: formatRgbValue(color) } : {}),
        });
    }

    useEffect(() => {
        editing.current = { hsv: picker.hsv, color: picker.color };
    }, [picker.hsv, picker.color]);

    useEffect(() => () => {
        if (copyTimer.current) clearTimeout(copyTimer.current);
    }, []);

    const publishHsv = (hsv: PickerHsv, complete = false) => {
        const color = hsvToHex(hsv);
        editing.current = { hsv, color };
        setPicker(previous => ({ ...previous, hsv, color, input: formatRgbValue(color) }));
        setCopied(false);
        onChange(color);
        if (complete) onChangeComplete?.(color);
    };

    const publishRgb = (color: string, input = formatRgbValue(color)) => {
        const hsv = hexToPickerHsv(color, editing.current.hsv);
        editing.current = { hsv, color };
        setPicker(previous => ({ ...previous, hsv, color, input }));
        setCopied(false);
        onChange(color);
        onChangeComplete?.(color);
    };

    const updateShade = (event: PointerEvent<HTMLDivElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        publishHsv({
            ...editing.current.hsv,
            s: clampColorChannel((event.clientX - bounds.left) / bounds.width * 100),
            v: clampColorChannel((1 - (event.clientY - bounds.top) / bounds.height) * 100),
        });
    };

    const finishShade = (event: PointerEvent<HTMLDivElement>) => {
        if (shadePointer.current !== event.pointerId) return;
        shadePointer.current = null;
        onChangeComplete?.(editing.current.color);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const finishHue = () => {
        if (huePointer.current === null) return;
        huePointer.current = null;
        onChangeComplete?.(editing.current.color);
    };

    const handleShadeKey = (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 10 : 1;
        const hsv = { ...editing.current.hsv };
        if (event.key === 'ArrowLeft') hsv.s -= step;
        else if (event.key === 'ArrowRight') hsv.s += step;
        else if (event.key === 'ArrowUp') hsv.v += step;
        else if (event.key === 'ArrowDown') hsv.v -= step;
        else if (event.key === 'Home') hsv.s = 0;
        else if (event.key === 'End') hsv.s = 100;
        else return;
        event.preventDefault();
        event.stopPropagation();
        publishHsv({ ...hsv, s: clampColorChannel(hsv.s), v: clampColorChannel(hsv.v) }, true);
    };

    const finishRgb = () => {
        const color = parseRgbValue(picker.input);
        if (color && color !== picker.color) publishRgb(color);
        else setPicker(previous => ({ ...previous, input: formatRgbValue(previous.color) }));
    };

    const copyRgb = async () => {
        try {
            await navigator.clipboard.writeText(formatRgbValue(picker.color));
            setCopied(true);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 1600);
        } catch {
            // Leave the exact value selected for ordinary copy when clipboard access is unavailable.
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    };

    const { h, s, v } = picker.hsv;
    const spectrumStyles = {
        '--drawing-picker-color': picker.color,
        '--drawing-picker-hue': `hsl(${h} 100% 50%)`,
    } as CSSProperties;

    return (
        <section className="drawing-color-picker rtx-menu-surface" aria-labelledby={titleId} style={spectrumStyles}>
            <div className="drawing-color-picker__title" id={titleId}>{tr('Colour picker')}</div>
            <div className="drawing-color-picker__spectrum">
                <div className="drawing-color-picker__preview" aria-label={`${tr('Selected color')}: rgb(${formatRgbValue(picker.color)})`} />
                <div
                    className="drawing-color-picker__shade"
                    role="slider"
                    tabIndex={0}
                    aria-label={tr('Color saturation and brightness')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(s)}
                    aria-valuetext={`${tr('Saturation')} ${Math.round(s)}%, ${tr('Brightness')} ${Math.round(v)}%`}
                    onKeyDown={handleShadeKey}
                    onPointerDown={event => {
                        if (event.button !== 0 || shadePointer.current !== null) return;
                        event.preventDefault();
                        event.currentTarget.focus();
                        shadePointer.current = event.pointerId;
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                        updateShade(event);
                    }}
                    onPointerMove={event => { if (shadePointer.current === event.pointerId) updateShade(event); }}
                    onPointerUp={event => {
                        if (shadePointer.current === event.pointerId) updateShade(event);
                        finishShade(event);
                    }}
                    onPointerCancel={finishShade}
                    onLostPointerCapture={finishShade}
                    onBlur={() => {
                        if (shadePointer.current === null) return;
                        shadePointer.current = null;
                        onChangeComplete?.(editing.current.color);
                    }}
                >
                    <span className="drawing-color-picker__shade-handle" style={{ left: `${s}%`, top: `${100 - v}%` }} />
                </div>
            </div>
            <div className="drawing-color-picker__controls">
                <div className="drawing-color-picker__hue-wrap">
                    <input
                        className="drawing-color-picker__hue"
                        aria-label={tr('Hue')}
                        aria-valuetext={`${Math.round(h)}°`}
                        type="range" min={0} max={360} step={1} value={h}
                        onPointerDown={event => {
                            if (event.button !== 0) return;
                            huePointer.current = event.pointerId;
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                        }}
                        onChange={event => publishHsv({ ...editing.current.hsv, h: Number(event.target.value) }, huePointer.current === null)}
                        onPointerUp={finishHue}
                        onPointerCancel={finishHue}
                        onLostPointerCapture={finishHue}
                        onBlur={finishHue}
                        onKeyDown={event => {
                            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopPropagation();
                        }}
                    />
                </div>
                <div className="drawing-color-picker__rgb-field">
                    <label className="drawing-color-picker__rgb-label" htmlFor={rgbId}>RGB</label>
                    <input
                        ref={inputRef}
                        id={rgbId}
                        className="drawing-color-picker__rgb-input"
                        aria-label="RGB"
                        value={picker.input}
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={32}
                        onChange={event => {
                            const input = event.target.value;
                            setPicker(previous => ({ ...previous, input }));
                            const color = parseRgbValue(input);
                            if (color) publishRgb(color, input);
                        }}
                        onBlur={finishRgb}
                        onKeyDown={event => {
                            if (event.key !== 'Escape') event.stopPropagation();
                            if (event.key === 'Enter') { event.preventDefault(); finishRgb(); }
                        }}
                    />
                    <button className="drawing-color-picker__copy" type="button" aria-label={tr(copied ? 'Copied' : 'Copy RGB value')} title={tr(copied ? 'Copied' : 'Copy RGB value')} onClick={() => { void copyRgb(); }}>
                        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                    </button>
                </div>
            </div>
        </section>
    );
}
