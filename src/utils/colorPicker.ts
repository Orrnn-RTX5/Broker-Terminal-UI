export interface PickerRgb { r: number; g: number; b: number }
export interface PickerHsv { h: number; s: number; v: number }

export const clampColorChannel = (value: number, max = 100): number => Math.min(max, Math.max(0, value));

export function normalizeHexColor(value: string, allowShort = true): string | null {
    const hex = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
    if (allowShort && /^[0-9a-f]{3}$/i.test(hex)) {
        return `#${hex.split('').map(char => char + char).join('').toLowerCase()}`;
    }
    return null;
}

export function hexToRgb(value: string): PickerRgb {
    const hex = normalizeHexColor(value) ?? '#4a9eff';
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function rgbToHsv({ r, g, b }: PickerRgb): PickerHsv {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === red) h = ((green - blue) / delta) % 6;
        else if (max === green) h = (blue - red) / delta + 2;
        else h = (red - green) / delta + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h, s: max === 0 ? 0 : delta / max * 100, v: max * 100 };
}

export function hsvToHex({ h, s, v }: PickerHsv): string {
    const hue = ((h % 360) + 360) % 360 / 60;
    const saturation = clampColorChannel(s) / 100;
    const value = clampColorChannel(v) / 100;
    const chroma = value * saturation;
    const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
    const offset = value - chroma;
    const channels = hue < 1 ? [chroma, secondary, 0]
        : hue < 2 ? [secondary, chroma, 0]
            : hue < 3 ? [0, chroma, secondary]
                : hue < 4 ? [0, secondary, chroma]
                    : hue < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
    return `#${channels.map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsl(rgb: PickerRgb): { h: number; s: number; l: number } {
    const { h } = rgbToHsv(rgb);
    const max = Math.max(rgb.r, rgb.g, rgb.b) / 255;
    const min = Math.min(rgb.r, rgb.g, rgb.b) / 255;
    const delta = max - min;
    const lightness = (max + min) / 2;
    return { h, s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)) * 100, l: lightness * 100 };
}

export function rgbToCmyk({ r, g, b }: PickerRgb): { c: number; m: number; y: number; k: number } {
    const max = Math.max(r, g, b) / 255;
    if (max === 0) return { c: 0, m: 0, y: 0, k: 100 };
    return { c: (1 - r / 255 / max) * 100, m: (1 - g / 255 / max) * 100, y: (1 - b / 255 / max) * 100, k: (1 - max) * 100 };
}

/** Retain the editing axes that cannot be recovered from gray or black RGB. */
export function hexToPickerHsv(hex: string, previous?: PickerHsv): PickerHsv {
    const next = rgbToHsv(hexToRgb(hex));
    if (previous && next.s === 0) next.h = previous.h;
    if (previous && next.v === 0) next.s = previous.s;
    return next;
}
