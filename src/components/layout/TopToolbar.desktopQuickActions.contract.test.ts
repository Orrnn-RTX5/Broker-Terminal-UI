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
        expect(desktopQuickActionsSource).toContain('aria-label="Desktop quick actions"');
    });

    it('keeps the new full trend-tool rail browser-only and out of Electron', () => {
        expect(topToolbarSource).not.toContain("import { LeftDrawingToolbar } from './LeftDrawingToolbar';");
        expect(topToolbarSource).not.toContain('<LeftDrawingToolbar');
        expect(topToolbarSource).not.toContain('<WebDrawingToolsRail');
        expect(appSource).toContain(
            "import { WebDrawingToolsRail, isWebDrawingToolsRuntime } from './drawing-tools';",
        );
        expect(appSource).toContain(
            '{isWebDrawingToolsRuntime() && <WebDrawingToolsRail selectedSymbol={selectedSymbol} />}',
        );
    });

    it('keeps the reference quick actions and Account-owned Logout reachable', () => {
        for (const label of [
            'Search Symbols',
            'Crosshair',
            'Cursor',
            'Trend Line',
            'Horizontal Line',
            'Vertical Line',
            'Equidistant Channel',
            'Fibonacci Retracement',
            'Thumbs Up',
            'Clear All Drawings',
            'Account',
            'Log out',
        ]) {
            expect(desktopQuickActionsSource).toContain(label);
        }
    });

    it('derives the badge and selected-symbol feed state instead of painting fixed values', () => {
        expect(topToolbarSource).not.toContain("symbol = 'BTCUSD'");
        expect(topToolbarSource).toContain('savedAccountCount={savedAccountCount}');
        expect(topToolbarSource).toContain('feedStatus={feedStatus}');
        expect(desktopQuickActionsSource).toContain('formatDesktopAccountBadge(savedAccountCount)');
        expect(desktopQuickActionsSource).toContain('resolveDesktopToolbarStatus({');
        expect(desktopStatusSource).toContain("feedState = 'live'");
        expect(themeSource).toContain('width: var(--rtx-desktop-feed-level, 0%);');
        expect(themeSource).not.toContain('width: 15%;');
    });

    it('uses the active rendered chart symbol when a restored tab and global selection disagree', () => {
        expect(appSource).toContain(
            'const desktopToolbarSymbol = chartSelectionReadiness.renderedChartSymbol || selectedSymbol;',
        );
        expect(appSource).toContain('symbol={desktopToolbarSymbol}');
    });

    it('does not restore a standalone desktop Logout button in MenuBar', () => {
        expect(menuBarSource).not.toContain('rtx-desktop-logout-button');
        expect(menuBarSource).not.toContain('aria-label="Log out"');
        expect(menuBarSource).toContain('const isElectronDesktop = typeof window !== \'undefined\' && Boolean(window.electron?.window);');
    });
});
