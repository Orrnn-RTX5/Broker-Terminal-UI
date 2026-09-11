import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const topToolbarSource = readSource('src/components/layout/TopToolbar.tsx');
const desktopQuickActionsSource = readSource('src/components/layout/DesktopQuickActions.tsx');
const menuBarSource = readSource('src/components/layout/MenuBar.tsx');
const desktopStatusSource = readSource('src/components/layout/desktopToolbarStatus.ts');
const themeSource = readSource('src/styles/theme.css');
const appSource = readSource('src/App.tsx');

describe('Electron desktop quick-actions toolbar contract', () => {
    it('uses the strict Electron bridge gate and never adds the cluster to the browser toolbar', () => {
        expect(topToolbarSource).toContain(
            "const isDesktopShell = typeof window !== 'undefined' && Boolean(window.electron?.window);",
        );
        expect(topToolbarSource).toMatch(
            /\{isDesktopShell\s*&&\s*\(\s*<DesktopQuickActions\b/,
        );
    });

    it('keeps the leading command strip scrollable and the trailing cluster fixed on the right', () => {
        const rowIndex = topToolbarSource.indexOf('rtx-desktop-command-row');
        const scrollIndex = topToolbarSource.indexOf('rtx-desktop-command-scroll');
        const actionsIndex = topToolbarSource.indexOf('<DesktopQuickActions');

        expect(rowIndex).toBeGreaterThan(-1);
        expect(scrollIndex).toBeGreaterThan(rowIndex);
        expect(actionsIndex).toBeGreaterThan(scrollIndex);
        expect(desktopQuickActionsSource).toContain('rtx-desktop-command-actions');
        expect(desktopQuickActionsSource).toContain('data-rtx-desktop-toolbar-cluster="right"');
        expect(desktopQuickActionsSource).toContain('role="toolbar"');
        expect(desktopQuickActionsSource).toContain('aria-label={tr("Desktop quick actions")}');
    });

    it('shares the complete drawing rail with a horizontal desktop arrangement', () => {
        expect(topToolbarSource).not.toContain("import { LeftDrawingToolbar } from './LeftDrawingToolbar';");
        expect(topToolbarSource).not.toContain('<LeftDrawingToolbar');
        expect(topToolbarSource).not.toContain('<WebDrawingToolsRail');
        expect(appSource).toContain('WebDrawingToolsRail,');
        expect(appSource).not.toContain('isWebDrawingToolsRuntime,');
        expect(appSource).toContain('<WebDrawingToolsRail selectedSymbol={desktopToolbarSymbol} />');
        expect(appSource).toContain('<WebDrawingToolsRail selectedSymbol={desktopToolbarSymbol} orientation="horizontal" />');
        expect(appSource).toContain('<WebDrawingSelectionToolbar />');
    });

    it('keeps desktop search and Account-owned Logout separate from the full drawing toolbar', () => {
        for (const label of [
            'Search Symbols',
            'Account',
            'Log out',
        ]) {
            expect(desktopQuickActionsSource).toContain(label);
        }
        expect(desktopQuickActionsSource).not.toContain('QUICK_DRAWING_TOOLS');
    });

    it('derives the account badge without a duplicate toolbar connection indicator', () => {
        expect(topToolbarSource).not.toContain("symbol = 'BTCUSD'");
        expect(topToolbarSource).toContain('savedAccountCount={savedAccountCount}');
        expect(topToolbarSource).toContain('feedStatus={feedStatus}');
        expect(desktopQuickActionsSource).toContain('formatDesktopAccountBadge(savedAccountCount)');
        expect(desktopQuickActionsSource).not.toContain('rtx-desktop-connection-button');
        expect(desktopStatusSource).toContain("feedState = 'live'");
        expect(themeSource).toContain('width: var(--rtx-desktop-feed-level, 0%);');
        expect(themeSource).not.toContain('width: 15%;');
    });

    it('uses the active rendered chart symbol when a restored tab and global selection disagree', () => {
        expect(appSource).toContain(
            'const desktopToolbarSymbol = chartSelectionReadiness.renderedChartSymbol || selectedSymbol;',
        );
        expect(appSource).toContain('setSelectedSymbol(renderedChartSymbol);');
        expect(appSource).toContain('symbol={desktopToolbarSymbol}');
        expect(appSource).toContain('<WebDrawingToolsRail selectedSymbol={desktopToolbarSymbol} />');
        expect(appSource).toContain('${desktopToolbarSymbol},${tf}`');
        expect(appSource).toContain('marketStatus={desktopToolbarMarketStatus}');
    });

    it('does not restore a standalone desktop Logout button in MenuBar', () => {
        expect(menuBarSource).not.toContain('rtx-desktop-logout-button');
        expect(menuBarSource).not.toContain('aria-label="Log out"');
        expect(menuBarSource).toContain('const isElectronDesktop = typeof window !== \'undefined\' && Boolean(window.electron?.window);');
    });
});
