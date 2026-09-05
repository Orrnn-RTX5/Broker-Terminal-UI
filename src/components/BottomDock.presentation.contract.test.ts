import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/BottomDock.tsx'), 'utf8');

describe('BottomDock trade type presentation', () => {
    it('keeps the Trade surface warm while another bottom tab is active', () => {
        const content = source.slice(
            source.indexOf('{/* Content Area */}'),
            source.indexOf('{/* Bottom Tabs */}'),
        );

        expect(content).toContain("hidden={activeTab !== 'Trade'}");
        expect(content).toContain('<TradeTab');
        expect(content).not.toContain("{activeTab === 'Trade' && (");
        expect(source).toContain('const TradeTab = memo(function TradeTab');
    });

    it('uses the full Exposure width without the Long Positions summary pane', () => {
        const exposureTab = source.slice(
            source.indexOf('function ExposureTab'),
            source.indexOf('type HistoryCacheEntry'),
        );

        expect(exposureTab).toContain('className="flex min-w-0 flex-1 flex-col"');
        expect(exposureTab).not.toContain('Long Positions');
        expect(exposureTab).not.toContain('rtx-exposure-positions');
        expect(exposureTab).not.toContain('renderLongPositionChart');
        expect(source).not.toContain('describeDonutSlice');
        expect(source).not.toContain('type ExposurePieSegment');
    });

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

    it('pins Close Winners, Close Losers, and Close All to the bottom tab strip', () => {
        const tabs = source.slice(
            source.indexOf('{/* Bottom Tabs */}'),
            source.indexOf('function ToolboxTab'),
        );
        const footer = source.slice(
            source.indexOf('className="rtx-trade-footer '),
            source.indexOf('{footerMetricMenu &&'),
        );

        expect(tabs).toContain('Close Winners');
        expect(tabs).toContain('Close Losers');
        expect(tabs).toContain('Close All');
        expect(tabs).toContain('rtx-dock-tab-actions');
        expect(tabs).toContain('rtx-dock-tab rtx-trade-bulk-close');
        expect(source).toContain("{ id: 'Toolbox' }");
        expect(tabs).not.toContain('rtx-trade-footer-action');
        expect(footer).not.toContain('Close Winners');
        expect(footer).not.toContain('rtx-trade-footer-actions');
    });

    it('keeps the account summary under the last trade so it scrolls with the list', () => {
        const tradeTab = source.slice(
            source.indexOf('<div className="rtx-trade-tab'),
            source.indexOf('{footerMetricMenu &&'),
        );

        expect(tradeTab).toContain('rtx-trade-scroll');
        expect(tradeTab.indexOf('rtx-trade-table')).toBeLessThan(tradeTab.indexOf('rtx-trade-footer'));
        expect(tradeTab.lastIndexOf('rtx-trade-scroll')).toBeLessThan(tradeTab.indexOf('rtx-trade-footer'));
        expect(tradeTab).not.toContain('syncHorizontalScroll');
        expect(tradeTab).not.toContain('footerScrollRef');
        expect(tradeTab).toContain('columnWidths.profit');
        expect(tradeTab).toContain('rtx-trade-footer-floating');
        expect(tradeTab).toContain('justify-center');
    });

    it('places the account summary directly below the columns when there are no open positions', () => {
        const tradeTab = source.slice(
            source.indexOf('<div className="rtx-trade-tab'),
            source.indexOf('{footerMetricMenu &&'),
        );
        const loadingState = tradeTab.slice(
            tradeTab.indexOf('<tbody'),
            tradeTab.indexOf('{displayedLivePositions.map'),
        );

        expect(loadingState).toContain('loading || error');
        expect(loadingState).not.toContain('No open positions');
        expect(tradeTab.indexOf('rtx-trade-footer')).toBeLessThan(tradeTab.indexOf('rtx-trade-empty-state'));
    });

    it('renders the Symbol cell as centered text without the colored direction badge', () => {
        const symbolCell = source.match(/\{\/\* symbol \*\/\}([\s\S]*?)\{\/\* ticket \*\/\}/)?.[1] ?? '';

        expect(symbolCell).toContain('text-center');
        expect(symbolCell).toContain('<span>{symbolLabel}</span>');
        expect(symbolCell).not.toContain("isBuy ? '+' : '-'");
        expect(symbolCell).not.toContain('h-[11px] w-[7px]');
    });

    it('uses the hand cursor only for editable Stop Loss and Take Profit surfaces', () => {
        const tradeTab = source.slice(
            source.indexOf('const TradeTab = memo(function TradeTab'),
            source.indexOf('type ExposureTabProps'),
        );
        const cursorLines = tradeTab
            .split('\n')
            .filter(line => line.includes('cursor-'));
        const handCursorLines = tradeTab
            .split('\n')
            .filter(line => line.includes('cursor-pointer'));

        expect(tradeTab).toContain('rtx-trade-tab h-full cursor-default');
        expect(tradeTab).toContain('rtx-trade-row h-[30px]');
        expect(tradeTab).toContain('transition-colors group cursor-default');
        expect(tradeTab).not.toContain('cursor-col-resize');
        expect(tradeTab).not.toContain('cursor-wait');
        expect(handCursorLines).toHaveLength(6);
        [
            'rtx-trade-sl-cell',
            'rtx-trade-sl-editor',
            'rtx-trade-sl-value',
            'rtx-trade-tp-cell',
            'rtx-trade-tp-editor',
            'rtx-trade-tp-value',
        ].forEach(cursorSurface => {
            expect(handCursorLines.some(line => line.includes(cursorSurface))).toBe(true);
        });
        handCursorLines.forEach(line => {
            expect(line).toMatch(/rtx-trade-(?:sl|tp)-(?:cell|editor|value)/);
        });
        cursorLines
            .filter(line => !line.includes('cursor-pointer'))
            .forEach(line => {
                expect(line).toContain('cursor-default');
            });
    });
});
