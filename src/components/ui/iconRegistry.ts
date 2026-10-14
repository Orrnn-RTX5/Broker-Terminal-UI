/**
 * Icon Registry
 * 
 * Centralized SVG path definitions for all icons.
 * All icons use a consistent 16×16 viewBox, stroke-only style,
 * strokeWidth 1.5, round linecap/linejoin.
 * 
 * Each entry is a function returning React SVG children (paths, circles, rects)
 * WITHOUT the surrounding <svg> wrapper — the Icon component provides that.
 */

import React from 'react';

export type IconName = keyof typeof iconRegistry;

// Helper for creating JSX elements
const h = React.createElement;

export type IconState = 'default' | 'hover' | 'active' | 'disabled' | 'selected';

export const iconRegistry = {

    // ─── Navigation ───────────────────────────────────────────────

    // Pointer cursor - clean outline navigation arrow
    'cursor': () => h(React.Fragment, null,
        h('path', { d: 'M3 2.5L13 8.2l-4.4 1.3-2.1 4.3L3 2.5z', strokeLinejoin: 'round' })
    ),

    // Crosshair - precision reticle ring with open center dot
    'crosshair': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 4.75 }),
        h('line', { x1: 8, y1: 1.5, x2: 8, y2: 4.25 }),
        h('line', { x1: 8, y1: 11.75, x2: 8, y2: 14.5 }),
        h('line', { x1: 1.5, y1: 8, x2: 4.25, y2: 8 }),
        h('line', { x1: 11.75, y1: 8, x2: 14.5, y2: 8 }),
        h('circle', { cx: 8, cy: 8, r: 0.85, fill: 'currentColor', stroke: 'none' })
    ),

    // Zoom In - clean magnifier with sharp handle angle
    'zoom-in': () => h(React.Fragment, null,
        h('circle', { cx: 6.5, cy: 6.5, r: 4.5 }),
        h('line', { x1: 10, y1: 10, x2: 14.5, y2: 14.5 }),
        h('line', { x1: 4.5, y1: 6.5, x2: 8.5, y2: 6.5 }),
        h('line', { x1: 6.5, y1: 4.5, x2: 6.5, y2: 8.5 })
    ),

    // Zoom Out - clean magnifier
    'zoom-out': () => h(React.Fragment, null,
        h('circle', { cx: 6.5, cy: 6.5, r: 4.5 }),
        h('line', { x1: 10, y1: 10, x2: 14.5, y2: 14.5 }),
        h('line', { x1: 4.5, y1: 6.5, x2: 8.5, y2: 6.5 })
    ),

    // Search magnifier
    'search': () => h(React.Fragment, null,
        h('circle', { cx: 7, cy: 7, r: 5 }),
        h('line', { x1: 11, y1: 11, x2: 15, y2: 15, strokeWidth: 2 })
    ),

    'chevron-down': () => h('path', { d: 'M4 6l4 4 4-4' }),

    'chevron-right': () => h('path', { d: 'M6 4l4 4-4 4' }),

    'chevron-left': () => h('path', { d: 'M10 4l-4 4 4 4' }),

    'chevron-up': () => h('path', { d: 'M4 10l4-4 4 4' }),

    'arrow-up': () => h('path', { d: 'M8 13V3M4 7l4-4 4 4' }),

    'arrow-down': () => h('path', { d: 'M8 3v10M4 9l4 4 4-4' }),

    'arrow-left': () => h('path', { d: 'M13 8H3M7 4l-4 4 4 4' }),

    'arrow-right': () => h('path', { d: 'M3 8h10M9 4l4 4-4 4' }),

    'move-up-right': () => h('path', { d: 'M4 12L12 4M12 4v6M12 4H6' }),

    // ─── Trading ──────────────────────────────────────────────────

    // New order - document with plus
    'new-order': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 2, width: 10, height: 12, rx: 1.5 }),
        h('line', { x1: 8, y1: 5.5, x2: 8, y2: 10.5 }),
        h('line', { x1: 5.5, y1: 8, x2: 10.5, y2: 8 })
    ),

    'buy': () => h(React.Fragment, null,
        h('path', { d: 'M8 12V4' }),
        h('path', { d: 'M5 7l3-3 3 3' }),
        h('path', { d: 'M3 14h10' })
    ),

    'sell': () => h(React.Fragment, null,
        h('path', { d: 'M8 4v8' }),
        h('path', { d: 'M5 9l3 3 3-3' }),
        h('path', { d: 'M3 14h10' })
    ),

    'close-position': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 5.5 }),
        h('path', { d: 'M5.5 5.5l5 5M10.5 5.5l-5 5' })
    ),

    'one-click': () => h(React.Fragment, null,
        h('path', { d: 'M8 2v6' }),
        h('path', { d: 'M5.5 4.5l5 0' }),
        h('path', { d: 'M4 9l4 5 4-5' })
    ),

    'play': () => h('path', { d: 'M5 3l8 5-8 5V3z' }),

    'stop': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 5.5 }),
        h('path', { d: 'M5.17 5.17l5.66 5.66' })
    ),

    // ─── Chart Types ──────────────────────────────────────────────

    // Candlestick - two well-separated candles with crisp wicks
    'candlestick': () => h(React.Fragment, null,
        h('rect', { x: 2.5, y: 5.5, width: 3.5, height: 6, rx: 0.5 }),
        h('line', { x1: 4.25, y1: 2.5, x2: 4.25, y2: 5.5 }),
        h('line', { x1: 4.25, y1: 11.5, x2: 4.25, y2: 14 }),
        h('rect', { x: 10, y: 3.5, width: 3.5, height: 6, rx: 0.5 }),
        h('line', { x1: 11.75, y1: 1.5, x2: 11.75, y2: 3.5 }),
        h('line', { x1: 11.75, y1: 9.5, x2: 11.75, y2: 13 })
    ),

    // OHLC Bar chart - two well-spaced OHLC bars matching toolbar glyph
    'bar-chart': () => h(React.Fragment, null,
        h('line', { x1: 5, y1: 3, x2: 5, y2: 13.5 }),
        h('line', { x1: 2.5, y1: 9.5, x2: 5, y2: 9.5 }),
        h('line', { x1: 5, y1: 5.5, x2: 7.5, y2: 5.5 }),
        h('line', { x1: 11.5, y1: 2.5, x2: 11.5, y2: 12.5 }),
        h('line', { x1: 9, y1: 7.5, x2: 11.5, y2: 7.5 }),
        h('line', { x1: 11.5, y1: 4.5, x2: 14, y2: 4.5 })
    ),

    // Line chart - smooth clean polyline
    'line-chart': () => h('polyline', { points: '1.5 12 5 7.5 8 10 11 4.5 14.5 3', fill: 'none' }),

    'area-chart': () => h(React.Fragment, null,
        h('path', { d: 'M2 11L6 6.5L9.5 9L14 3.5V13.5H2Z', fill: 'currentColor', fillOpacity: 0.18, stroke: 'none' }),
        h('polyline', { points: '2 11 6 6.5 9.5 9 14 3.5', fill: 'none' }),
        h('line', { x1: 2, y1: 13.5, x2: 14, y2: 13.5, strokeWidth: 1.2 })
    ),

    'heikin-ashi': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 4, width: 3, height: 7, rx: 0.5 }),
        h('path', { d: 'M4.5 2v2M4.5 11v3' }),
        h('rect', { x: 10, y: 5, width: 3, height: 5, rx: 0.5 }),
        h('path', { d: 'M11.5 3v2M11.5 10v3' })
    ),

    // ─── Chart Controls ───────────────────────────────────────────

    'grid': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 5, height: 5, rx: 0.75 }),
        h('rect', { x: 9, y: 2, width: 5, height: 5, rx: 0.75 }),
        h('rect', { x: 2, y: 9, width: 5, height: 5, rx: 0.75 }),
        h('rect', { x: 9, y: 9, width: 5, height: 5, rx: 0.75 })
    ),

    'grid-3x3': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1.5, strokeWidth: 1.3 }),
        h('path', { d: 'M2 6h12M2 10h12M6 2v12M10 2v12', strokeWidth: 1.05 })
    ),

    'volume': () => h(React.Fragment, null,
        h('path', { d: 'M3 10v-4l3-3 3 3v4' }),
        h('path', { d: 'M10 6a3 3 0 010 4M12 4a5 5 0 010 8' })
    ),

    // Auto scroll - single crisp candle + arrow advancing toward right boundary
    'auto-scroll': (state?: IconState) => {
        const isActive = state === 'active' || state === 'selected';
        const candleColor = isActive ? '#22c55e' : 'currentColor';
        const lineColor = isActive ? '#3b82f6' : 'currentColor';

        return h(React.Fragment, null,
            h('g', { stroke: candleColor, fill: 'none' },
                h('line', { x1: 3.75, y1: 2.5, x2: 3.75, y2: 5 }),
                h('rect', { x: 2, y: 5, width: 3.5, height: 6, rx: 0.5 }),
                h('line', { x1: 3.75, y1: 11, x2: 3.75, y2: 13.5 })
            ),
            h('path', { d: 'M7.75 8h4.5M10.25 5.75L12.5 8l-2.25 2.25', stroke: candleColor, fill: 'none' }),
            h('line', { x1: 14.5, y1: 2.5, x2: 14.5, y2: 13.5, stroke: lineColor })
        );
    },

    // Chart shift - single crisp candle + arrow shifting left from right boundary
    'chart-shift': (state?: IconState) => {
        const isActive = state === 'active' || state === 'selected';
        const candleColor = isActive ? '#22c55e' : 'currentColor';
        const lineColor = isActive ? '#3b82f6' : 'currentColor';

        return h(React.Fragment, null,
            h('g', { stroke: candleColor, fill: 'none' },
                h('line', { x1: 3.75, y1: 2.5, x2: 3.75, y2: 5 }),
                h('rect', { x: 2, y: 5, width: 3.5, height: 6, rx: 0.5 }),
                h('line', { x1: 3.75, y1: 11, x2: 3.75, y2: 13.5 })
            ),
            h('path', { d: 'M12.5 8H8M10.25 5.75L8 8l2.25 2.25', stroke: lineColor, fill: 'none' }),
            h('line', { x1: 14.5, y1: 2.5, x2: 14.5, y2: 13.5, stroke: lineColor })
        );
    },

    'magnet': () => h(React.Fragment, null,
        h('path', { d: 'M4 2h3v5a3 3 0 006 0V2h3' }),
        h('path', { d: 'M4 5h3M10 5h3' })
    ),

    // ─── Drawing Tools ────────────────────────────────────────────

    // Trend line - sharp diagonal with solid endpoint dots
    'trend-line': () => h(React.Fragment, null,
        h('line', { x1: 2.5, y1: 13.5, x2: 13.5, y2: 2.5 }),
        h('circle', { cx: 2.5, cy: 13.5, r: 1.5, fill: 'currentColor', strokeWidth: 0 }),
        h('circle', { cx: 13.5, cy: 2.5, r: 1.5, fill: 'currentColor', strokeWidth: 0 })
    ),

    // Horizontal line - clean line with arrow caps
    'h-line': () => h(React.Fragment, null,
        h('line', { x1: 1, y1: 8, x2: 15, y2: 8 }),
        h('path', { d: 'M3.5 5.5L1 8L3.5 10.5', strokeWidth: 1.2 }),
        h('path', { d: 'M12.5 5.5L15 8L12.5 10.5', strokeWidth: 1.2 })
    ),

    // Vertical line - clean line with arrow caps
    'v-line': () => h(React.Fragment, null,
        h('line', { x1: 8, y1: 1, x2: 8, y2: 15 }),
        h('path', { d: 'M5.5 3.5L8 1L10.5 3.5', strokeWidth: 1.2 }),
        h('path', { d: 'M5.5 12.5L8 15L10.5 12.5', strokeWidth: 1.2 })
    ),

    // Equidistant channel - cleaner two parallel lines
    'channel': () => h(React.Fragment, null,
        h('line', { x1: 2, y1: 13, x2: 12, y2: 3 }),
        h('line', { x1: 5, y1: 14, x2: 15, y2: 4, strokeDasharray: '2.5 1.5' }),
        h('circle', { cx: 2, cy: 13, r: 1.5, fill: 'currentColor', strokeWidth: 0 }),
        h('circle', { cx: 12, cy: 3, r: 1.5, fill: 'currentColor', strokeWidth: 0 })
    ),

    // Fibonacci retracement - cleaner levels
    'fibonacci': () => h(React.Fragment, null,
        h('line', { x1: 1, y1: 2.5, x2: 15, y2: 2.5, strokeWidth: 1.2 }),
        h('line', { x1: 1, y1: 6.5, x2: 15, y2: 6.5, strokeWidth: 1.2 }),
        h('line', { x1: 1, y1: 10, x2: 15, y2: 10, strokeWidth: 1.2 }),
        h('line', { x1: 1, y1: 13.5, x2: 15, y2: 13.5, strokeWidth: 1.2 }),
        h('line', { x1: 3, y1: 13.5, x2: 13, y2: 2.5, strokeDasharray: '2 2' })
    ),

    // Fibonacci extension
    'fib-extension': () => h(React.Fragment, null,
        h('line', { x1: 1, y1: 2, x2: 15, y2: 2 }),
        h('line', { x1: 1, y1: 8, x2: 15, y2: 8 }),
        h('line', { x1: 1, y1: 14, x2: 15, y2: 14 }),
        h('path', { d: 'M3 14L8 8L13 2', strokeDasharray: '2 2' })
    ),

    // Rectangle
    'rectangle': () => h('rect', { x: 2.5, y: 4, width: 11, height: 8, rx: 0.5 }),

    // Ellipse
    'ellipse': () => h('ellipse', { cx: 8, cy: 8, rx: 6, ry: 4.5 }),

    // Triangle
    'triangle': () => h('polygon', { points: '8,2 15,14 1,14', fill: 'none' }),

    // Text tool - sharp T with serif base
    'text': () => h(React.Fragment, null,
        h('line', { x1: 2.5, y1: 3, x2: 13.5, y2: 3, strokeWidth: 2 }),
        h('line', { x1: 8, y1: 3, x2: 8, y2: 13, strokeWidth: 1.8 }),
        h('line', { x1: 5.5, y1: 13, x2: 10.5, y2: 13, strokeWidth: 1.4 })
    ),

    'freehand': () => h('path', { d: 'M3 12c2-4 4-2 5-6s2-2 4-4' }),

    'paintbrush': () => h(React.Fragment, null,
        h('path', { d: 'M11.5 2.5a1.414 1.414 0 0 1 2 2L5.5 12.5 2 14l1.5-3.5 8-8z' }),
        h('path', { d: 'M9.5 4.5l2 2' })
    ),

    'callout': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 9, rx: 1.5 }),
        h('path', { d: 'M5 11v3l3-3' })
    ),

    'ruler': () => h(React.Fragment, null,
        h('path', { d: 'M2 14L14 2' }),
        h('path', { d: 'M5 14l0-3M8 11l0-3M11 8l0-3' })
    ),

    'ray': () => h(React.Fragment, null,
        h('path', { d: 'M3 11L13 3' }),
        h('circle', { cx: 3, cy: 11, r: 1.5 }),
        h('path', { d: 'M10 3h3v3', strokeDasharray: '2 2' })
    ),

    'infinite-line': () => h(React.Fragment, null,
        h('path', { d: 'M1 12L15 4' }),
        h('circle', { cx: 5, cy: 10, r: 1.5 }),
        h('circle', { cx: 11, cy: 6, r: 1.5 })
    ),

    'parallel-channel': () => h(React.Fragment, null,
        h('path', { d: 'M2 11L12 4' }),
        h('path', { d: 'M4 14L14 7' }),
        h('path', { d: 'M2 11L4 14', strokeDasharray: '1 1' }),
        h('path', { d: 'M12 4L14 7', strokeDasharray: '1 1' })
    ),

    'polygon': () => h('polygon', { points: '8,2 14,6 12,13 4,13 2,6' }),

    'label': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 3, width: 12, height: 8, rx: 1.5 }),
        h('path', { d: 'M5 6h6M5 9h4' })
    ),

    'pan': () => h(React.Fragment, null,
        h('path', { d: 'M8 2v12M2 8h12' }),
        h('path', { d: 'M6 4l2-2 2 2M6 12l2 2 2-2M4 6l-2 2 2 2M12 6l2 2-2 2' })
    ),

    'crosshair-ruler': () => h(React.Fragment, null,
        h('path', { d: 'M8 2v12M2 8h12' }),
        h('circle', { cx: 8, cy: 8, r: 3 }),
        h('path', { d: 'M12 12l2 2' })
    ),

    'measure': () => h(React.Fragment, null,
        h('path', { d: 'M2 14L14 2' }),
        h('path', { d: 'M5 14l0-3M8 11l0-3M11 8l0-3' })
    ),

    // Shapes - clean minimal set
    'shapes': () => h(React.Fragment, null,
        h('polygon', { points: '8,1.5 13,8 3,8', fill: 'none' }),
        h('circle', { cx: 11.5, cy: 12, r: 2.8, fill: 'none' }),
        h('rect', { x: 1, y: 10, width: 5, height: 5, rx: 0.8, fill: 'none' })
    ),

    // ─── UI Controls ──────────────────────────────────────────────

    'settings': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 2 }),
        h('path', { d: 'M8.15 1.33h-.3a1.33 1.33 0 0 0-1.33 1.33v.12a1.33 1.33 0 0 1-.67 1.15l-.29.17a1.33 1.33 0 0 1-1.33 0l-.1-.05a1.33 1.33 0 0 0-1.82.49l-.15.25a1.33 1.33 0 0 0 .49 1.82l.1.07a1.33 1.33 0 0 1 .67 1.15v.34a1.33 1.33 0 0 1-.67 1.16l-.1.06a1.33 1.33 0 0 0-.49 1.82l.15.25a1.33 1.33 0 0 0 1.82.49l.1-.05a1.33 1.33 0 0 1 1.33 0l.29.17a1.33 1.33 0 0 1 .67 1.15v.12a1.33 1.33 0 0 0 1.33 1.33h.3a1.33 1.33 0 0 0 1.33-1.33v-.12a1.33 1.33 0 0 1 .67-1.15l.29-.17a1.33 1.33 0 0 1 1.33 0l.1.05a1.33 1.33 0 0 0 1.82-.49l.15-.26a1.33 1.33 0 0 0-.49-1.82l-.1-.05a1.33 1.33 0 0 1-.67-1.16v-.33a1.33 1.33 0 0 1 .67-1.16l.1-.06a1.33 1.33 0 0 0 .49-1.82l-.15-.25a1.33 1.33 0 0 0-1.82-.49l-.1.05a1.33 1.33 0 0 1-1.33 0l-.29-.17a1.33 1.33 0 0 1-.67-1.15v-.12a1.33 1.33 0 0 0-1.33-1.33z' })
    ),

    'bell': () => h(React.Fragment, null,
        h('path', { d: 'M8 2a4 4 0 014 4c0 3 1 4 2 5H2c1-1 2-2 2-5a4 4 0 014-4z' }),
        h('path', { d: 'M6.5 13a1.5 1.5 0 003 0' })
    ),

    'user': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 4.8, r: 2.6 }),
        h('path', { d: 'M2.5 14c0-2.8 2.4-4.5 5.5-4.5s5.5 1.7 5.5 4.5' })
    ),

    'save': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M5 2v4h6V2' }),
        h('rect', { x: 4, y: 9, width: 8, height: 3 })
    ),

    'print': () => h(React.Fragment, null,
        h('rect', { x: 4, y: 1, width: 8, height: 5 }),
        h('rect', { x: 2, y: 5, width: 12, height: 7, rx: 1 }),
        h('rect', { x: 4, y: 10, width: 8, height: 4 })
    ),

    'camera': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 4.5, width: 14, height: 9.5, rx: 1.5 }),
        h('path', { d: 'M5 4.5l1.5-2.5h3L11 4.5' }),
        h('circle', { cx: 8, cy: 9.5, r: 2.8 })
    ),

    'screenshot': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1, strokeDasharray: '2 2' }),
        h('circle', { cx: 8, cy: 8, r: 2.5 })
    ),

    'period-separator': () => h(React.Fragment, null,
        h('line', { x1: 1.5, y1: 8, x2: 5.5, y2: 8 }),
        h('circle', { cx: 8, cy: 8, r: 2.2 }),
        h('line', { x1: 10.5, y1: 8, x2: 14.5, y2: 8 })
    ),

    'sliders-horizontal': () => h(React.Fragment, null,
        h('line', { x1: 2, y1: 4, x2: 6.5, y2: 4 }),
        h('circle', { cx: 8.5, cy: 4, r: 1.6 }),
        h('line', { x1: 10.5, y1: 4, x2: 14, y2: 4 }),
        h('line', { x1: 2, y1: 8, x2: 5, y2: 8 }),
        h('circle', { cx: 7, cy: 8, r: 1.6 }),
        h('line', { x1: 9, y1: 8, x2: 14, y2: 8 }),
        h('line', { x1: 2, y1: 12, x2: 8, y2: 12 }),
        h('circle', { cx: 10, cy: 12, r: 1.6 }),
        h('line', { x1: 12, y1: 12, x2: 14, y2: 12 })
    ),

    'export': () => h(React.Fragment, null,
        h('path', { d: 'M8 2v8' }),
        h('path', { d: 'M5 5l3-3 3 3' }),
        h('path', { d: 'M2 10v3h12v-3' })
    ),

    'import': () => h(React.Fragment, null,
        h('path', { d: 'M8 10V2' }),
        h('path', { d: 'M5 7l3 3 3-3' }),
        h('path', { d: 'M2 10v3h12v-3' })
    ),

    'download': () => h(React.Fragment, null,
        h('path', { d: 'M8 2v8' }),
        h('path', { d: 'M5 7l3 3 3-3' }),
        h('path', { d: 'M2 12v2h12v-2' })
    ),

    'upload': () => h(React.Fragment, null,
        h('path', { d: 'M8 10V2' }),
        h('path', { d: 'M5 5l3-3 3 3' }),
        h('path', { d: 'M2 12v2h12v-2' })
    ),

    'plus': () => h('path', { d: 'M8 3v10M3 8h10' }),

    'plus-circle': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M8 5v6M5 8h6' })
    ),

    'minus': () => h('path', { d: 'M3 8h10' }),

    'x-close': () => h('path', { d: 'M4 4l8 8M12 4l-8 8' }),

    'check': () => h('polyline', { points: '3 8 6.5 11.5 13 5' }),

    'check-circle': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('polyline', { points: '5 8 7 10 11 6' })
    ),

    'layers': () => h(React.Fragment, null,
        h('path', { d: 'M8 2L2 6l6 4 6-4L8 2z' }),
        h('path', { d: 'M2 10l6 4 6-4' })
    ),

    'layout': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M2 6h12M6 6v8' })
    ),

    'layout-template': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M2 6h12M8 6v8' })
    ),

    'layout-list': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M5 5h6M5 8h6M5 11h6' })
    ),

    'template': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M2 5h12M5 5v9' })
    ),

    'palette': () => h(React.Fragment, null,
        h('path', { d: 'M8 1.5a6.5 6.5 0 0 0-6.5 6.5c0 3.59 2.91 6.5 6.5 6.5.69 0 1.25-.56 1.25-1.25 0-.32-.12-.62-.33-.85-.2-.22-.32-.51-.32-.82 0-.69.56-1.25 1.25-1.25h1.4c2.07 0 3.75-1.68 3.75-3.75C15 3.99 11.87 1.5 8 1.5z' }),
        h('circle', { cx: 5.2, cy: 7.5, r: 0.95, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 7.2, cy: 4.8, r: 0.95, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 10.3, cy: 5.2, r: 0.95, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 11.5, cy: 7.8, r: 0.95, fill: 'currentColor', stroke: 'none' })
    ),

    'filter': () => h('path', { d: 'M2 3h12L9 8.5V12l-2 1V8.5L2 3z' }),

    'sort': () => h(React.Fragment, null,
        h('path', { d: 'M4 3v10M2 10l2 3 2-3' }),
        h('path', { d: 'M12 13V3M10 6l2-3 2 3' })
    ),

    'refresh': () => h(React.Fragment, null,
        h('path', { d: 'M13 3v4h-4' }),
        h('path', { d: 'M3 13v-4h4' }),
        h('path', { d: 'M13 7A5 5 0 008 3 5 5 0 003 7M3 9a5 5 0 005 4 5 5 0 005-4' })
    ),

    'copy': () => h(React.Fragment, null,
        h('rect', { x: 5, y: 5, width: 9, height: 9, rx: 1 }),
        h('path', { d: 'M11 2H3a1 1 0 00-1 1v8' })
    ),

    'trash': () => h(React.Fragment, null,
        h('path', { d: 'M3 4h10M6 4V3h4v1' }),
        h('path', { d: 'M4 4l1 10h6l1-10' }),
        h('path', { d: 'M7 7v4M9 7v4' })
    ),

    'edit': () => h('path', { d: 'M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z' }),

    'eye': () => h(React.Fragment, null,
        h('path', { d: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z' }),
        h('circle', { cx: 8, cy: 8, r: 2 })
    ),

    'eye-off': () => h(React.Fragment, null,
        h('path', { d: 'M2 2l12 12' }),
        h('path', { d: 'M5.5 5.5A5.5 5.5 0 001 8s3 5 7 5a5.5 5.5 0 002.5-.6M9.9 6.1A2 2 0 0110 8a2 2 0 01-2 2' }),
        h('path', { d: 'M12.5 5.5A9 9 0 0115 8s-3 5-7 5' })
    ),

    'pencil-lock': () => h(React.Fragment, null,
        h('path', { d: 'M9.5 1.5l3 3L5 12H2V9l7.5-7.5z' }),
        h('rect', { x: 9, y: 9, width: 6, height: 5, rx: 1 }),
        h('path', { d: 'M10.5 9V7.75a1.5 1.5 0 013 0V9' })
    ),

    'lock': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 7, width: 10, height: 7, rx: 1 }),
        h('path', { d: 'M5 7V5a3 3 0 016 0v2' })
    ),

    'unlock': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 7, width: 10, height: 7, rx: 1 }),
        h('path', { d: 'M5 7V5a3 3 0 016 0' })
    ),

    'more-vertical': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 4, r: 1 }),
        h('circle', { cx: 8, cy: 8, r: 1 }),
        h('circle', { cx: 8, cy: 12, r: 1 })
    ),

    'briefcase': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 5, width: 14, height: 9, rx: 1 }),
        h('path', { d: 'M5 5V3a1 1 0 011-1h4a1 1 0 011 1v2' })
    ),

    'image': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1.5 }),
        h('circle', { cx: 5.5, cy: 5.5, r: 1.5 }),
        h('path', { d: 'M14 10l-3-3-5 5-2-2-2 2' })
    ),

    // ─── Status ───────────────────────────────────────────────────

    'connected': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 3, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 8, cy: 8, r: 5.5 })
    ),

    'disconnected': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 5.5 }),
        h('path', { d: 'M5.5 5.5l5 5M10.5 5.5l-5 5' })
    ),

    'warning': () => h(React.Fragment, null,
        h('path', { d: 'M8 2L1.5 13.5h13L8 2z' }),
        h('path', { d: 'M8 6.2v3.3' }),
        h('circle', { cx: 8, cy: 11.6, r: 0.75, fill: 'currentColor', stroke: 'none' })
    ),

    'alert-triangle': () => h(React.Fragment, null,
        h('path', { d: 'M8 2L1.5 13.5h13L8 2z' }),
        h('path', { d: 'M8 6.2v3.3' }),
        h('circle', { cx: 8, cy: 11.6, r: 0.75, fill: 'currentColor', stroke: 'none' })
    ),

    'info': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M8 7.2v4.3' }),
        h('circle', { cx: 8, cy: 4.8, r: 0.75, fill: 'currentColor', stroke: 'none' })
    ),

    'error': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M5.5 5.5l5 5M10.5 5.5l-5 5' })
    ),

    'help-circle': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M6.2 6.2a1.8 1.8 0 0 1 3.5.6c0 1.1-1.7 1.4-1.7 2.4' }),
        h('circle', { cx: 8, cy: 11.7, r: 0.75, fill: 'currentColor', stroke: 'none' })
    ),

    // ─── File & System ────────────────────────────────────────────

    'file': () => h(React.Fragment, null,
        h('path', { d: 'M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z' }),
        h('path', { d: 'M10 2v4h4' })
    ),

    'file-text': () => h(React.Fragment, null,
        h('path', { d: 'M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z' }),
        h('path', { d: 'M10 2v4h4' }),
        h('path', { d: 'M6 9h4M6 11h4' })
    ),

    'folder': () => h('path', { d: 'M2 5V4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V5z' }),

    'folder-open': () => h(React.Fragment, null,
        h('path', { d: 'M2 5V4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v1' }),
        h('path', { d: 'M1 7h14l-2 7H3L1 7z' })
    ),

    'code': () => h(React.Fragment, null,
        h('path', { d: 'M5 4L1 8l4 4' }),
        h('path', { d: 'M11 4l4 4-4 4' }),
        h('path', { d: 'M9 2l-2 12' })
    ),

    'terminal': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 2, width: 14, height: 12, rx: 1.5 }),
        h('path', { d: 'M4 6l3 2-3 2' }),
        h('path', { d: 'M8 11h4' })
    ),

    'cpu': () => h(React.Fragment, null,
        h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1 }),
        h('path', { d: 'M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5h2.5M1.5 9.5h2.5M12 6.5h2.5M12 9.5h2.5', strokeWidth: 1.25 })
    ),

    'database': () => h(React.Fragment, null,
        h('ellipse', { cx: 8, cy: 4, rx: 5, ry: 2 }),
        h('path', { d: 'M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4' }),
        h('path', { d: 'M3 8c0 1.1 2.2 2 5 2s5-.9 5-2' })
    ),

    'hard-drive': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 6, width: 12, height: 6, rx: 1 }),
        h('path', { d: 'M2 9h12' }),
        h('circle', { cx: 11, cy: 10.5, r: 0.5, fill: 'currentColor', stroke: 'none' })
    ),

    'globe': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('ellipse', { cx: 8, cy: 8, rx: 2.6, ry: 6, strokeWidth: 1.2 }),
        h('path', { d: 'M2.2 8h11.6', strokeWidth: 1.2 })
    ),

    'server': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 5, rx: 1 }),
        h('rect', { x: 2, y: 9, width: 12, height: 5, rx: 1 }),
        h('circle', { cx: 11, cy: 4.5, r: 0.5, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 11, cy: 11.5, r: 0.5, fill: 'currentColor', stroke: 'none' })
    ),

    'shield': () => h('path', { d: 'M8 1L2 4v4c0 4.4 2.6 7 6 9 3.4-2 6-4.6 6-9V4L8 1z' }),

    'smartphone': () => h(React.Fragment, null,
        h('rect', { x: 4, y: 1, width: 8, height: 14, rx: 1.5 }),
        h('path', { d: 'M7 12h2' })
    ),

    'mail': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 3, width: 14, height: 10, rx: 1 }),
        h('path', { d: 'M1 3l7 5 7-5' })
    ),

    'wifi': () => h(React.Fragment, null,
        h('path', { d: 'M2 5c3.3-3 8.7-3 12 0' }),
        h('path', { d: 'M4 8c2.2-2 5.8-2 8 0' }),
        h('path', { d: 'M6 11c1.1-1 2.9-1 4 0' }),
        h('circle', { cx: 8, cy: 13, r: 0.5, fill: 'currentColor', stroke: 'none' })
    ),

    'credit-card': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 3, width: 14, height: 10, rx: 1.5 }),
        h('path', { d: 'M1 7h14' }),
        h('path', { d: 'M4 10h3' })
    ),

    'monitor': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 2, width: 14, height: 10, rx: 1 }),
        h('path', { d: 'M5 14h6M8 12v2' })
    ),

    'box': () => h(React.Fragment, null,
        h('path', { d: 'M8 1L2 4v8l6 3 6-3V4L8 1z' }),
        h('path', { d: 'M2 4l6 3 6-3M8 7v8' })
    ),

    'log-in': () => h(React.Fragment, null,
        h('path', { d: 'M7 2h6a1 1 0 011 1v10a1 1 0 01-1 1H7' }),
        h('path', { d: 'M1 8h9' }),
        h('path', { d: 'M7 5l3 3-3 3' })
    ),

    'log-out': () => h(React.Fragment, null,
        h('path', { d: 'M9 2H3a1 1 0 00-1 1v10a1 1 0 001 1h6' }),
        h('path', { d: 'M6 8h9' }),
        h('path', { d: 'M12 5l3 3-3 3' })
    ),

    'user-plus': () => h(React.Fragment, null,
        h('circle', { cx: 7, cy: 5, r: 3 }),
        h('path', { d: 'M1 14c0-3 2.5-5 6-5s4 1 4 1' }),
        h('path', { d: 'M13 9v4M11 11h4' })
    ),

    // ─── Indicators ───────────────────────────────────────────────

    'trending-up': () => h(React.Fragment, null,
        h('polyline', { points: '1.5 12 5.5 7.5 8.5 10.5 14 3.5' }),
        h('polyline', { points: '10 3.5 14 3.5 14 7.5' })
    ),

    'trending-down': () => h(React.Fragment, null,
        h('polyline', { points: '2 4 6 8 9 5 14 12' }),
        h('path', { d: 'M10 12h4v-4' })
    ),

    'activity': () => h('polyline', { points: '1 8 4 4 7 12 10 6 13 8 15 8' }),

    'bar-chart-2': () => h(React.Fragment, null,
        h('path', { d: 'M4 13.5V8M8 13.5V3.5M12 13.5V6' }),
        h('line', { x1: 2, y1: 13.5, x2: 14, y2: 13.5, strokeWidth: 1.2 })
    ),

    'bar-chart-3': () => h(React.Fragment, null,
        h('path', { d: 'M4 13.5V9.5M8 13.5V3.5M12 13.5V6.5' }),
        h('line', { x1: 2, y1: 13.5, x2: 14, y2: 13.5, strokeWidth: 1.2 })
    ),

    'pie-chart': () => h(React.Fragment, null,
        h('path', { d: 'M8 2a6 6 0 110 12 6 6 0 010-12z' }),
        h('path', { d: 'M8 2v6h6' })
    ),

    'signal': () => h(React.Fragment, null,
        h('path', { d: 'M4 14V10M8 14V6M12 14V2' })
    ),

    'zap': () => h('path', { d: 'M9 1L3 9h5l-1 6 6-8H8l1-6z' }),

    'clock': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M8 4v4l3 2' })
    ),

    'history': () => h(React.Fragment, null,
        h('path', { d: 'M3 3v4h4' }),
        h('path', { d: 'M3 7a6 6 0 1012 0 6 6 0 00-12 0' }),
        h('path', { d: 'M9 5v3l2 1' })
    ),

    'calendar': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 3, width: 12, height: 11, rx: 1 }),
        h('path', { d: 'M5 1v3M11 1v3M2 7h12' })
    ),

    'newspaper': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M5 5h3v3H5zM10 5h1M10 7h1M5 10h6M5 12h4' })
    ),

    'book-open': () => h(React.Fragment, null,
        h('path', { d: 'M2 2h5a3 3 0 013 3v9c-1-1-2-1-3-1H2V2z' }),
        h('path', { d: 'M14 2H9a3 3 0 00-3 3v9c1-1 2-1 3-1h5V2z' })
    ),

    'bot': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 5, width: 10, height: 8, rx: 1.5 }),
        h('path', { d: 'M8 2v3' }),
        h('circle', { cx: 6, cy: 9, r: 1 }),
        h('circle', { cx: 10, cy: 9, r: 1 }),
        h('path', { d: 'M1 9h2M13 9h2' })
    ),

    'building': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 2, width: 10, height: 12, rx: 0.5 }),
        h('path', { d: 'M6 5h1M9 5h1M6 8h1M9 8h1M7 11h2v3H7z' })
    ),

    'thumbs-up': () => h('path', { d: 'M9 6V3a2 2 0 00-2-2L4 8v6h7.5a1.5 1.5 0 001.5-1.2l1-6A1.5 1.5 0 0012.5 5H9zM4 14H2.5A1.5 1.5 0 011 12.5v-4A1.5 1.5 0 012.5 7H4' }),

    'thumbs-down': () => h('path', { d: 'M7 10v3a2 2 0 002 2l3-7V2H4.5A1.5 1.5 0 003 3.2l-1 6A1.5 1.5 0 003.5 11H7zM12 2h1.5A1.5 1.5 0 0115 3.5v4a1.5 1.5 0 01-1.5 1.5H12' }),

    // ─── MT5 Toolbar ──────────────────────────────────────────────

    'compass': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M10.5 5.5l-5 5M6 10l-1-3 3 1M10 6l1 3-3-1' })
    ),

    // Tile horizontal - two clean stacked panels
    'tile-horizontal': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 1.5, width: 14, height: 5.5, rx: 1 }),
        h('rect', { x: 1, y: 9, width: 14, height: 5.5, rx: 1 })
    ),

    'tile-vertical': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 5, height: 12, rx: 0.5 }),
        h('rect', { x: 9, y: 2, width: 5, height: 12, rx: 0.5 })
    ),

    'cascade': () => h(React.Fragment, null,
        h('rect', { x: 1, y: 1, width: 9, height: 7, rx: 0.5 }),
        h('rect', { x: 4, y: 4, width: 9, height: 7, rx: 0.5 }),
        h('rect', { x: 6, y: 6, width: 9, height: 7, rx: 0.5 })
    ),

    'star': () => h('polygon', { points: '8,1 9.8,5.8 15,6.2 11,9.6 12.2,15 8,12.2 3.8,15 5,9.6 1,6.2 6.2,5.8' }),

    'new-chart': () => h(React.Fragment, null,
        h('polyline', { points: '2 10 5 7 8 9 11 5 14 3' }),
        h('path', { d: 'M11 3h3v3' })
    ),

    'chart-list': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M5 5h6M5 8h6M5 11h3' }),
        h('path', { d: 'M11 9v4M9 11h4' })
    ),

    'print-preview': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 0.5 }),
        h('circle', { cx: 8, cy: 8, r: 3 }),
        h('path', { d: 'M8 5v6M5 8h6' })
    ),

    'market-watch': () => h(React.Fragment, null,
        h('circle', { cx: 8, cy: 8, r: 6 }),
        h('path', { d: 'M8 4v4l3 2' }),
        h('path', { d: 'M4 4l1 1M12 4l-1 1' })
    ),

    'data-window': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1 }),
        h('path', { d: 'M2 5h12' }),
        h('path', { d: 'M5 8h2M9 8h2M5 11h2M9 11h2' })
    ),

    'strategy-tester': () => h(React.Fragment, null,
        h('rect', { x: 2, y: 4, width: 12, height: 8, rx: 1 }),
        h('path', { d: 'M5 7l2 2 4-4' })
    ),

    // ─── RTX Specific / Rebranded ─────────────────────────────────

    'ide': () => h(React.Fragment, null,
        h('text', { x: 2, y: 11, fontSize: 8, fontWeight: 'bold', fill: '#0ea5e9', stroke: 'none', fontFamily: 'sans-serif' }, 'IDE')
    ),

    'market': () => h(React.Fragment, null,
        // Yellow shopping bag
        h('path', { d: 'M5 5v-1a3 3 0 016 0v1h2v9h-10v-9h2z', fill: '#eab308', stroke: '#ca8a04' }),
        h('path', { d: 'M5 5v-1a3 3 0 016 0', fill: 'none', stroke: '#ca8a04' })
    ),

    'signals-antenna': () => h(React.Fragment, null,
        h('path', { d: 'M8 14v-4M8 10a2 2 0 100-4 2 2 0 000 4z', stroke: '#3b82f6' }),
        h('path', { d: 'M4 8c0-2.2 1.8-4 4-4M12 8c0-2.2-1.8-4-4-4', stroke: '#3b82f6', strokeDasharray: '1 2' })
    ),

    'virtual-hosting': () => h(React.Fragment, null,
        h('path', { d: 'M4 10a3 3 0 010-6 3 3 0 016 0 3 3 0 010 6z', fill: '#e0f2fe', stroke: '#3b82f6' }),
        h('path', { d: 'M7 10h6', stroke: '#3b82f6', strokeWidth: 2 })
    ),

    'register-signal': () => h(React.Fragment, null,
        h('circle', { cx: 7, cy: 7, r: 5, stroke: '#3b82f6', strokeDasharray: '2 2' }),
        h('circle', { cx: 7, cy: 7, r: 2, fill: '#3b82f6', stroke: 'none' }),
        h('path', { d: 'M11 11h4M13 9v4', stroke: '#22c55e', strokeWidth: 1.5 })
    ),

    'algo-trading': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 3, width: 10, height: 10, stroke: '#ef4444' }),
        h('path', { d: 'M3 8h10M8 3v10', stroke: '#ef4444' })
    ),

    // New order document - crisp document with bold plus
    'new-order-document': () => h(React.Fragment, null,
        h('path', { d: 'M3.5 1h6L13.5 5v10a1 1 0 01-1 1h-9a1 1 0 01-1-1V2a1 1 0 011-1z', stroke: '#60a5fa', fill: 'none', strokeWidth: 1.3 }),
        h('path', { d: 'M9.5 1v4h4', stroke: '#60a5fa', fill: 'none', strokeWidth: 1.3 }),
        h('line', { x1: 8, y1: 7.5, x2: 8, y2: 12.5, stroke: '#34d399', strokeWidth: 1.8 }),
        h('line', { x1: 5.5, y1: 10, x2: 10.5, y2: 10, stroke: '#34d399', strokeWidth: 1.8 })
    ),

    // Indicator list - clean panel with signal wave
    'indicator-list': () => h(React.Fragment, null,
        h('rect', { x: 1.5, y: 2, width: 13, height: 12, rx: 1.2, fill: 'none', strokeWidth: 1.3 }),
        h('polyline', { points: '3 11.5 5.5 7 8 9.5 10.5 5 13 6.5', strokeWidth: 1.5, fill: 'none' }),
        h('circle', { cx: 12.5, cy: 4, r: 1.3, fill: 'currentColor', stroke: 'none' })
    ),
    'symbol-box': () => h(React.Fragment, null,
        h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 1, fill: '#eab308', stroke: '#ca8a04' }),
        h('text', { x: '50%', y: '50%', fontSize: 8, fontWeight: 'bold', fill: 'white', stroke: 'none', textAnchor: 'middle', dominantBaseline: 'central', fontFamily: 'sans-serif' }, '$')
    ),

} as const satisfies Record<string, (state?: IconState) => React.ReactElement>;

/**
 * List of all registered icon names — useful for icon picker UIs and docs.
 */
export const iconNames = Object.keys(iconRegistry) as IconName[];

/**
 * Get SVG children for a given icon name. Returns null if not found.
 */
export function getIconPaths(name: string, state?: IconState): React.ReactElement | null {
    const factory = (iconRegistry as Record<string, ((state?: IconState) => React.ReactElement) | undefined>)[name];
    return factory ? factory(state) : null;
}
