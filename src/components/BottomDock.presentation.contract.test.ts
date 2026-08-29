import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/BottomDock.tsx'), 'utf8');

describe('BottomDock trade type presentation', () => {
    it('labels the side field as Type in both the grid and exported report', () => {
        expect(source).toContain("{ key: 'side', label: 'Type'");
        expect(source).toContain("columns.push({ label: 'Type'");
        expect(source).not.toContain('Side / Type');
    });

    it('shows lowercase buy or sell text without an arrow icon', () => {
        const sideCell = source.match(/\{\/\* side \*\/\}([\s\S]*?)\{\/\* volume \*\/\}/)?.[1] ?? '';
        expect(sideCell).toContain('<span>{sideLabel}</span>');
        expect(sideCell).toContain('Type: ${sideLabel}');
        expect(sideCell).not.toContain('<svg');
    });

    it('centers every trade header and row value without offsetting sortable labels', () => {
        const headerHelpers = source.match(/const renderSortableHeader[\s\S]*?return \(/)?.[0] ?? '';
        const tradeTable = source.match(/<table\s+className="rtx-trade-table[\s\S]*?<\/table>/)?.[0] ?? '';

        expect(headerHelpers).toContain('text-center border-r');
        expect(headerHelpers).toContain('items-center justify-center px-2 text-center');
        expect(tradeTable).toContain('rtx-trade-table w-full text-center');
        expect(tradeTable).toContain('flex items-center justify-center');
        expect(tradeTable).toContain('bg-zinc-800 text-white text-center');
        expect(tradeTable).not.toContain('text-right');
        expect(tradeTable).not.toContain('text-left');
    });

    it('renders the Symbol cell as centered text without the colored direction badge', () => {
        const symbolCell = source.match(/\{\/\* symbol \*\/\}([\s\S]*?)\{\/\* ticket \*\/\}/)?.[1] ?? '';

        expect(symbolCell).toContain('text-center');
        expect(symbolCell).toContain('<span>{symbolLabel}</span>');
        expect(symbolCell).not.toContain("isBuy ? '+' : '-'");
        expect(symbolCell).not.toContain('h-[11px] w-[7px]');
    });
});
