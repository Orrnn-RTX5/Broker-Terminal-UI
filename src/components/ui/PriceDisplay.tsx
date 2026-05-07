/**
 * PriceDisplay — MT5-style price formatting
 * Shows last 2 decimal digits in a larger/bolder font,
 * matching the Flexy Markets MT5 terminal style.
 */
import React from 'react';
import { getSymbolDigits } from '../../utils/symbolUtils';



interface PriceDisplayProps {
    /** The numeric price value */
    price: number;
    /** Symbol name for digit detection, e.g. "BTCUSD" */
    symbol: string;
    /** Optional explicit digits override */
    digits?: number;
    /** Optional className applied to the wrapper span */
    className?: string;
    /** Size of the large last-2-digit text. 'sm' for table rows, 'lg' for panels */
    size?: 'sm' | 'lg';
}

/**
 * Renders a price with the last 2 decimal digits in a larger, bolder font.
 * 
 * Example (EURUSD 1.33601):
 *   small: "1.336"  big: "01"
 * 
 * Example (BTCUSD 67895.43):
 *   small: "67895."  big: "43"
 */
export const PriceDisplay: React.FC<PriceDisplayProps> = ({
    price,
    symbol,
    digits: explicitDigits,
    className = '',
    size = 'sm',
}) => {
    if (!Number.isFinite(price) || price === 0) {
        return <span className={className}>-</span>;
    }

    const d = explicitDigits ?? getSymbolDigits(symbol);
    const full = price.toFixed(d);

    let smallPart: string;
    let bigPart: string;

    if (d <= 1) {
        // No split possible for 0-1 decimals
        return <span className={className}>{full}</span>;
    }

    if (d === 2) {
        // e.g. "67895.43" → small="67895." big="43"
        const dotIdx = full.indexOf('.');
        smallPart = full.slice(0, dotIdx + 1);
        bigPart = full.slice(dotIdx + 1);
    } else {
        // e.g. "1.33601" → small="1.336" big="01"
        const dotIdx = full.indexOf('.');
        const decPart = full.slice(dotIdx + 1);
        smallPart = full.slice(0, dotIdx + 1) + decPart.slice(0, -2);
        bigPart = decPart.slice(-2);
    }

    const bigFontSize = size === 'lg' ? 'text-[14px]' : 'text-[13px]';
    const bigFontWeight = 'font-extrabold';

    return (
        <span className={`${className} whitespace-nowrap`}>
            <span>{smallPart}</span>
            <span className={`${bigFontSize} ${bigFontWeight}`}>{bigPart}</span>
        </span>
    );
};

/**
 * Plain string formatter that returns "small|big" for non-React contexts.
 * Mostly you should use the <PriceDisplay> component instead.
 */
export function formatPriceParts(price: number, symbol: string, explicitDigits?: number): { small: string; big: string } {
    const d = explicitDigits ?? getSymbolDigits(symbol);
    if (!Number.isFinite(price) || price === 0) return { small: '-', big: '' };
    const full = price.toFixed(d);
    if (d <= 1) return { small: full, big: '' };
    if (d === 2) {
        const dotIdx = full.indexOf('.');
        return { small: full.slice(0, dotIdx + 1), big: full.slice(dotIdx + 1) };
    }
    const dotIdx = full.indexOf('.');
    const decPart = full.slice(dotIdx + 1);
    return { small: full.slice(0, dotIdx + 1) + decPart.slice(0, -2), big: decPart.slice(-2) };
}

export default PriceDisplay;
