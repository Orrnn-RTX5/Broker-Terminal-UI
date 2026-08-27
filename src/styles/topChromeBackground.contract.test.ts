import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const themeCss = readSource('src/styles/theme.css');
const advancedCss = readSource('src/styles/advanced-untitled-light.css');
const topToolbarSource = readSource('src/components/layout/TopToolbar.tsx');
const menuBarSource = readSource('src/components/layout/MenuBar.tsx');
const dockPanelSource = readSource('src/components/dock/DockPanel.tsx');
const dockContainerSource = readSource('src/components/dock/DockContainer.tsx');

describe('terminal top chrome background contract', () => {
  it('uses the shared panel surface instead of the blue glass backdrop', () => {
    expect(topToolbarSource).toContain('className="rtx-top-chrome flex flex-col');
    expect(topToolbarSource).not.toMatch(/rtx-top-chrome[^\"]*bg-slate-950\/20/);
    expect(topToolbarSource).not.toMatch(/rtx-top-chrome[^\"]*backdrop-blur/);
    expect(themeCss).toMatch(/\.rtx-top-chrome\s*\{[^}]*background: var\(--bg-secondary\);/);
    expect(themeCss).toMatch(/--bg-secondary:\s*#131316;/);
  });

  it('uses one shared white surface for every light-mode chrome row', () => {
    expect(advancedCss).toMatch(/html\.rtx-advanced-view\.rtx-skin-untitled-light\s*\{[\s\S]*--bg-secondary:\s*#ffffff;/);
    expect(advancedCss).toMatch(/\.rtx-header-bar\s*\{[\s\S]*?background: var\(--bg-secondary\) !important;[\s\S]*?border-bottom: 1px solid var\(--border-primary\) !important;/);
    expect(menuBarSource).toContain('[.rtx-advanced-view_&]:bg-[var(--bg-secondary)]');
    expect(advancedCss).not.toMatch(/\.rtx-header-bar\s*\{[^}]*background: #F3E5F5 !important;/);
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
