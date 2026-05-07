/**
 * Icon Component
 * 
 * Centralized, theme-aware icon component that renders icons from the registry.
 * All icons share a consistent visual style matching the DrawingToolbar:
 * - 16×16 viewBox
 * - Stroke-only (no fills)
 * - strokeWidth 1.5
 * - Round linecap/linejoin
 * - Monochrome with currentColor inheritance
 * 
 * @example
 * <Icon name="settings" />
 * <Icon name="trend-line" size="lg" className="text-blue-400" />
 * <Icon name="check" size="sm" state="active" />
 */

import React from 'react';
import { getIconPaths, type IconName } from './iconRegistry';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type IconState = 'default' | 'hover' | 'active' | 'disabled' | 'selected';

export interface IconProps {
    /** Registry key — e.g. 'trend-line', 'settings', 'bell' */
    name: IconName;
    /** Preset size: xs=12, sm=14, md=16, lg=20, xl=24 */
    size?: IconSize | number;
    /** Additional CSS classes (color, spacing, etc.) */
    className?: string;
    /** Accessible tooltip text */
    title?: string;
    /** Visual state — sets color automatically unless className overrides */
    state?: IconState;
    /** Inline style overrides */
    style?: React.CSSProperties;
    /** Click handler */
    onClick?: (e: React.MouseEvent) => void;
}

const SIZE_MAP: Record<IconSize, number> = {
    xs: 12,
    sm: 14,
    md: 20,
    lg: 24,
    xl: 28,
};

const STATE_CLASSES: Record<IconState, string> = {
    default: '',   // Inherit from parent via currentColor
    hover: 'text-zinc-200',
    active: 'text-blue-400',
    disabled: 'text-zinc-600 opacity-50',
    selected: 'text-blue-400',
};

export const Icon: React.FC<IconProps> = ({
    name,
    size = 'md',
    className = '',
    title,
    state,
    style,
    onClick,
}) => {
    const pixelSize = typeof size === 'number' ? size : SIZE_MAP[size];
    const paths = getIconPaths(name, state);

    if (!paths) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(`[Icon] Unknown icon name: "${name}"`);
        }
        // Render a small placeholder square in dev
        return (
            <svg
                width={pixelSize}
                height={pixelSize}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className={`inline-block ${className}`}
                aria-hidden="true"
            >
                <rect x="3" y="3" width="10" height="10" strokeDasharray="2 2" />
            </svg>
        );
    }

    const stateClasses = state ? STATE_CLASSES[state] : '';

    return (
        <svg
            width={pixelSize}
            height={pixelSize}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`inline-block flex-shrink-0 ${stateClasses} ${className}`.trim()}
            style={style}
            role={title ? 'img' : undefined}
            aria-label={title}
            aria-hidden={!title}
            onClick={onClick}
        >
            {title && <title>{title}</title>}
            {paths}
        </svg>
    );
};

/**
 * Re-export icon names for convenience
 */
export { iconNames, type IconName } from './iconRegistry';

export default Icon;
