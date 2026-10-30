import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shellSource = readFileSync(resolve(process.cwd(), 'src/components/BottomDock.tsx'), 'utf8');
const tradeControllerSource = readFileSync(
    resolve(process.cwd(), 'src/features/bottom-dock/trade/TradeTab.tsx'),
    'utf8',
);
const tradeTableSource = readFileSync(
    resolve(process.cwd(), 'src/features/bottom-dock/trade/TradeTable.tsx'),
    'utf8',
);
const tradeModelSource = readFileSync(
    resolve(process.cwd(), 'src/features/bottom-dock/trade/tradeTabModel.ts'),
    'utf8',
);
const tradeSource = `${tradeModelSource}\n${tradeControllerSource}\n${tradeTableSource}`;

describe('BottomDock trade type presentation', () => {
    it('keeps the Trade surface warm while another bottom tab is active', () => {
        const content = shellSource.slice(
            shellSource.indexOf('{/* Content Area */}'),
            shellSource.indexOf('{/* Bottom Tabs */}'),
        );

        expect(content).toContain("hidden={activeTab !== 'Trade'}");
        expect(content).toContain('<TradeTab');
        expect(content).not.toContain("{activeTab === 'Trade' && (");
        expect(tradeControllerSource).toContain('export const TradeTab = memo(function TradeTab');
    });

    it('labels the side field as Type in both the grid and exported report', () => {
        expect(tradeSource).toContain("{ key: 'side', label: 'Type'");
        expect(tradeSource).toContain("columns.push({ label: 'Type'");
        expect(tradeSource).not.toContain('Side / Type');
    });

    it('shows lowercase buy or sell text without an arrow icon', () => {
        const sideCell = tradeTableSource.match(/\{\/\* side \*\/\}([\s\S]*?)\{\/\* volume \*\/\}/)?.[1] ?? '';
        expect(sideCell).toContain('<span>{tr(sideLabel)}</span>');
        expect(sideCell).toContain("tr('Type: {{value0}}', { value0: tr(sideLabel) })");
        expect(sideCell).not.toContain('<svg');
    });

    it('centers every trade header and row value without offsetting sortable labels', () => {
        const headerHelpers = tradeTableSource.match(/const renderSortableHeader[\s\S]*?return \(/)?.[0] ?? '';
        const tradeTable = tradeTableSource.match(/<table\s+className="rtx-trade-table[\s\S]*?<\/table>/)?.[0] ?? '';
        const tradeRow = tradeTableSource.slice(
            tradeTableSource.indexOf('const TradeTableRow = memo('),
            tradeTableSource.indexOf('export function TradeTable('),
        );
        // Rejection reasons span the columns as a separate, left-aligned message.
        const tradeValues = tradeRow.slice(0, tradeRow.indexOf('{isTerminalPlacementFailure && ('));

        expect(headerHelpers).toContain('text-center border-r');
        expect(headerHelpers).toContain('items-center justify-center px-2 text-center');
        expect(tradeTable).toContain('rtx-trade-table w-full text-center');
        expect(tradeTable).toContain('{tableBody}');
        expect(tradeValues).toContain('flex items-center justify-center');
        expect(tradeValues).toContain('rtx-trade-sl-value w-full cursor-pointer bg-transparent px-1 text-center');
        expect(tradeValues).toContain('rtx-trade-tp-value w-full cursor-pointer bg-transparent px-1 text-center');
        expect(tradeValues).toContain('rtx-trade-row');
        expect(tradeValues).not.toContain('text-right');
        expect(tradeValues).not.toContain('text-left');
    });

    it('pins Close In-Profit, Close In-Loss, and Close All to the bottom tab strip', () => {
        const tabs = shellSource.slice(shellSource.indexOf('{/* Bottom Tabs */}'));
        const footer = tradeTableSource.slice(tradeTableSource.indexOf('className="rtx-trade-footer '));

        expect(tabs).toContain('Close In-Profit');
        expect(tabs).toContain('Close In-Loss');
        expect(tabs).toContain('Close All');
        expect(tabs).toContain('rtx-dock-tab-actions');
        expect(tabs).toContain('rtx-dock-tab rtx-trade-bulk-close');
        expect(shellSource).toContain("{ id: 'Toolbox' }");
        expect(tabs).not.toContain('rtx-trade-footer-action');
        expect(footer).not.toContain('Close In-Profit');
        expect(footer).not.toContain('rtx-trade-footer-actions');
    });

    it('keeps the account summary under the last trade and sticky at the bottom when rows overflow', () => {
        const tradeTab = tradeTableSource;
        const historySource = readFileSync(
            resolve(process.cwd(), 'src/features/bottom-dock/history/HistoryTab.tsx'),
            'utf8',
        );

        expect(tradeTab).toContain('rtx-trade-scroll');
        expect(tradeTab).toContain('rtx-trade-footer sticky bottom-0 z-10');
        expect(historySource).toContain('rtx-history-table__foot sticky bottom-0 z-10');
        expect(historySource).toContain('rtx-history-summary-row sticky bottom-0 z-10');
        expect(tradeTab.indexOf('rtx-trade-table')).toBeLessThan(tradeTab.indexOf('rtx-trade-footer'));
        expect(tradeTab.lastIndexOf('rtx-trade-scroll')).toBeLessThan(tradeTab.indexOf('rtx-trade-footer'));
        expect(tradeTab).not.toContain('syncHorizontalScroll');
        expect(tradeTab).not.toContain('footerScrollRef');
        expect(tradeTab).toContain('footerProfitColumnWidth');
        expect(tradeTab).toContain('footerCloseColumnWidth');
        expect(tradeTab).toContain('rtx-trade-footer-floating');
        expect(tradeTab).toContain('rtx-trade-footer-floating--profit');
        expect(tradeTab).toContain('justify-center');
    });

    it('places the account summary directly below the columns when there are no open positions', () => {
        const tradeTab = tradeTableSource;
        const loadingState = tradeTab.slice(
            tradeTab.indexOf('<tbody'),
            tradeTab.indexOf('{displayedLivePositions.map'),
        );

        expect(loadingState).toContain('loading || error');
        expect(loadingState).not.toContain('No open positions');
        expect(tradeTab.indexOf('rtx-trade-footer')).toBeLessThan(tradeTab.indexOf('rtx-trade-empty-state'));
    });

    it('renders the Symbol cell as centered text without the colored direction badge', () => {
        const symbolCell = tradeTableSource.match(/\{\/\* symbol \*\/\}([\s\S]*?)\{\/\* ticket \*\/\}/)?.[1] ?? '';

        expect(symbolCell).toContain('text-center');
        expect(symbolCell).toContain('<span>{symbolLabel}</span>');
        expect(symbolCell).not.toContain("isBuy ? '+' : '-'");
        expect(symbolCell).not.toContain('h-[11px] w-[7px]');
    });

    it('uses the hand cursor only for editable Stop Loss and Take Profit surfaces', () => {
        const tradeTab = `${tradeControllerSource}\n${tradeTableSource}`;
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
        expect(handCursorLines).toHaveLength(2);
        [
            'rtx-trade-sl-value',
            'rtx-trade-tp-value',
        ].forEach(cursorSurface => {
            expect(handCursorLines.some(line => line.includes(cursorSurface))).toBe(true);
        });
        handCursorLines.forEach(line => {
            expect(line).toMatch(/rtx-trade-(?:sl|tp)-value/);
        });
        cursorLines
            .filter(line => !line.includes('cursor-pointer'))
            .forEach(line => {
                expect(line).toContain('cursor-default');
            });
    });
});
