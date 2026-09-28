import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const themeCss = readSource('src/styles/theme.css');
const advancedCss = readSource('src/styles/legacy-light-overrides.css');
const topToolbarSource = readSource('src/components/layout/TopToolbar.tsx');
const desktopQuickActionsSource = readSource('src/components/layout/DesktopQuickActions.tsx');
const menuBarSource = readSource('src/components/layout/MenuBar.tsx');
const dockPanelSource = readSource('src/components/dock/DockPanel.tsx');
const dockContainerSource = readSource('src/components/dock/DockContainer.tsx');

describe('terminal top chrome background contract', () => {
  it('uses the shared panel surface instead of the blue glass backdrop', () => {
    expect(topToolbarSource).toContain('className="rtx-top-chrome flex flex-col');
    expect(topToolbarSource).not.toMatch(/rtx-top-chrome[^"]*bg-slate-950\/20/);
    expect(topToolbarSource).not.toMatch(/rtx-top-chrome[^"]*backdrop-blur/);
    expect(themeCss).toMatch(/\.rtx-top-chrome\s*\{[^}]*background: var\(--bg-secondary\);/);
    expect(themeCss).toMatch(/--bg-secondary:\s*#131316;/);
  });

  it('uses one shared surface for the single-row chrome and its menus', () => {
    expect(advancedCss).toMatch(/html\.rtx-advanced-view\.rtx-skin-untitled-light\s*\{[\s\S]*--bg-secondary:\s*#ffffff;/);
    expect(topToolbarSource).not.toContain('<HeaderBar');
    expect(topToolbarSource).toContain('<MenuBar');
    expect(topToolbarSource).toContain('<WindowControls />');
    expect(menuBarSource).toContain('rtx-menu-launcher');
    expect(menuBarSource).toContain('rtx-application-menu');
    expect(themeCss).toMatch(/\.rtx-application-menu,\s*\n\.rtx-menu-surface\s*\{[^}]*background: var\(--bg-secondary\);/);
    expect(advancedCss).toContain('.rtx-window-controls');
    expect(advancedCss).not.toContain('.rtx-header-bar');
  });

  it('keeps web actions in the application menu while Electron owns the fixed right quick-actions cluster', () => {
    expect(menuBarSource).toContain("label: 'Theme'");
    expect(menuBarSource).toContain("label: 'Search Symbols'");
    expect(menuBarSource).toContain("label: 'Crosshair'");
    expect(menuBarSource).toContain("label: 'Selection Mode'");
    expect(menuBarSource).toContain("label: 'Stamps'");
    expect(menuBarSource).toContain("label: 'Delete All'");
    expect(menuBarSource).toContain('accountId={accountId}');

    const desktopScrollIndex = topToolbarSource.indexOf('rtx-desktop-command-scroll');
    const desktopActionsIndex = topToolbarSource.indexOf('<DesktopQuickActions');
    expect(desktopScrollIndex).toBeGreaterThan(-1);
    expect(desktopActionsIndex).toBeGreaterThan(desktopScrollIndex);
    expect(desktopQuickActionsSource).toContain('rtx-desktop-command-actions');
    expect(desktopQuickActionsSource).toContain('data-rtx-desktop-toolbar-cluster="right"');
    expect(desktopQuickActionsSource).toContain('role="toolbar"');
    expect(desktopQuickActionsSource).toContain('aria-label={tr("Desktop quick actions")}');
  });

  it('keeps the hamburger fixed and preserves an Electron drag surface', () => {
    const menuIndex = topToolbarSource.indexOf('<MenuBar');
    const scrollingStripIndex = topToolbarSource.indexOf('rtx-chart-toolbar-scroll flex min-w-0 flex-1');
    const desktopScrollingStripIndex = topToolbarSource.indexOf('rtx-desktop-command-scroll');
    const desktopQuickActionsIndex = topToolbarSource.indexOf('<DesktopQuickActions');
    expect(menuIndex).toBeGreaterThan(-1);
    expect(scrollingStripIndex).toBeGreaterThan(menuIndex);
    expect(desktopScrollingStripIndex).toBeGreaterThan(menuIndex);
    expect(desktopQuickActionsIndex).toBeGreaterThan(desktopScrollingStripIndex);
    expect(topToolbarSource).toContain('className="min-w-[24px] flex-1 self-stretch"');
    expect(menuBarSource).toContain("WebkitAppRegion: 'no-drag'");
  });

  it('keeps Electron action sheets theme-aware instead of forcing a light surface', () => {
    expect(themeCss).toMatch(/html\.rtx-desktop-shell-active :is\(\.trend-tools-menu, \.rtx-drawing-operations__menu\) \{[\s\S]*background: var\(--bg-elevated\) !important;/);
    expect(themeCss).toMatch(/\.rtx-drawing-operations__menu--desktop \{[\s\S]*background: var\(--bg-elevated\) !important;/);
    expect(themeCss).toMatch(/html\.rtx-desktop-shell-active \.trend-tools-menu__item\[data-selected='true'\] \{[\s\S]*background: var\(--color-info-dim\) !important;/);
    expect(themeCss).not.toMatch(/html\.rtx-desktop-shell-active :is\([^}]*\.trend-tools-menu[^}]*\) \{[^}]*background: #ffffff !important;/);
  });

  it('keeps toolbar group spacing without rendering pipe symbols', () => {
    expect(topToolbarSource).toContain('aria-hidden="true" className="rtx-mt5-divider invisible');
    expect(topToolbarSource).not.toContain('rtx-mt5-divider mx-[4px] w-[2px] h-6 border-l');
    expect(advancedCss).toMatch(/\.rtx-mt5-divider\s*\{[^}]*visibility: hidden !important;/);
    expect(advancedCss).not.toMatch(/\.rtx-mt5-divider\s*\{[^}]*display: none !important;/);
  });

  it('keeps dock chrome and core workspace surfaces enterprise-light', () => {
    expect(advancedCss).toContain('--rtx-light-canvas: #f5f7fa;');
    expect(advancedCss).toContain('--rtx-light-panel-header: #f2f4f7;');
    expect(advancedCss).toContain('--rtx-light-selected: #f4f3ff;');
    expect(dockPanelSource).toContain('dock-panel__header');
    expect(dockPanelSource).toContain('dock-panel__title');
    expect(dockPanelSource).toContain('dock-panel__action dock-panel__action--close');
    expect(advancedCss).toMatch(/\.dock-panel__header[\s\S]*?background: var\(--rtx-light-panel-header\) !important;/);
    expect(advancedCss).toContain('.dock-panel__action--close:hover');
    expect(advancedCss).toContain('background: var(--rtx-light-selected) !important;');
    expect(advancedCss).not.toContain('div[class*="h-[22px]"]');
  });

  it('allows Focus Chart only while the Light theme is active', () => {
    expect(dockContainerSource).toMatch(/classList\.contains\('rtx-advanced-view'\)[\s\S]*classList\.contains\('rtx-advanced-focus-chart'\)/);
    expect(advancedCss).toContain('html.rtx-advanced-view.rtx-advanced-focus-chart .rtx-dock-workspace');
    expect(advancedCss).not.toMatch(/html\.rtx-advanced-focus-chart\s/);
  });

  it('does not apply app table styling to the chart library internals', () => {
    expect(advancedCss).toContain('table:not(.tv-lightweight-charts *)');
    expect(advancedCss).toContain(':where(thead, th):not(.tv-lightweight-charts *)');
    expect(advancedCss).toContain(':where(td, tr):not(.tv-lightweight-charts *)');
    expect(advancedCss).not.toMatch(/rtx-skin-untitled-light table\s*\{/);
  });
});
