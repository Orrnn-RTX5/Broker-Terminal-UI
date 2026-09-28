import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

const toolbarSource = readSource('src/components/layout/TopToolbar.tsx');
const themeCss = readSource('src/styles/theme.css');
const advancedCss = readSource('src/styles/legacy-light-overrides.css');
const enterpriseCss = readSource('src/styles/enterprise-light.css');
const iconRegistrySource = readSource('src/components/ui/iconRegistry.ts');
const iconComponentSource = readSource('src/components/ui/Icon.tsx');
const timeframePickerSource = readSource('src/components/layout/TimeframePicker.tsx');

const markedCluster = toolbarSource.slice(
  toolbarSource.indexOf('{/* New Order & Last Symbol */}'),
  toolbarSource.indexOf('{/* Group 8: Horizontal MT-style timeframe strip */}'),
);

describe('TopToolbar primary command cluster', () => {
  it('uses dedicated outline command icons alongside the labeled action icons', () => {
    for (const icon of [
      'new-order',
      'activity',
      'bar-chart',
      'candlestick',
      'line-chart',
      'area-chart',
      'zoom-in',
      'zoom-out',
      'grid',
      'refresh',
      'chart-shift',
      'indicator-list',
      'camera',
      'period-separator',
      'sliders-horizontal',
    ]) {
      expect(markedCluster).toMatch(new RegExp(`(?:icon|name)="${icon}"`));
    }

    expect(markedCluster).not.toMatch(/<(?:FileText|TrendingUp|BarChart2|CandlestickChart|LineChart|AreaChart|ZoomIn|ZoomOut|LayoutPanelTop|RefreshCw)\b/);
    expect(markedCluster).toContain('<Icon name="new-order" size={20} />');
    expect(markedCluster).toContain('<Icon name="activity" size={20} />');
    expect(markedCluster).toContain('label={tr("Chart capture and overlays")}');
    expect(markedCluster).toContain('className="rtx-period-separator-toggle"');
    expect(markedCluster).toContain('className="rtx-trade-history-overlay-button"');
    expect(markedCluster).not.toMatch(/<(?:Camera|GitCommitHorizontal|SlidersHorizontal)\b/);
    expect(toolbarSource).toContain('<ChartCommandIcon name={icon} />');
    expect(themeCss).toMatch(/\.rtx-toolbar-action__icon \{[\s\S]*flex: 0 0 20px;[\s\S]*height: 20px;[\s\S]*width: 20px;/);
  });

  it('keeps the two labeled actions dense, reactive, and accessible', () => {
    expect(markedCluster).toContain('text-[13px] font-normal');
    expect(markedCluster).toContain('aria-label={tr("New Order (F9)")}');
    expect(markedCluster).toContain("new CustomEvent('openNewOrder', {");
    expect(markedCluster).toContain('detail: { symbol }');
    expect(markedCluster).toContain('aria-pressed={lastSymbolPanelVisible}');
    expect(toolbarSource).toContain('useLastSymbolStore((state) => state.lastSymbol)');
    expect(toolbarSource).toContain('useLastSymbolStore((state) => state.panelVisible)');
    expect(markedCluster).not.toContain('useLastSymbolStore.getState()');
  });

  it('exposes chart types as a named radio group', () => {
    expect(markedCluster).toContain('label={tr("Chart type")} role="radiogroup"');
    expect(markedCluster.match(/selectionRole="radio"/g)).toHaveLength(4);
    expect(toolbarSource).toContain("aria-checked={selectionRole === 'radio' ? active : undefined}");
  });

  it('uses restrained tokenized states in dark, light, and desktop chrome', () => {
    expect(themeCss).toMatch(/\.rtx-toolbar-action,[\s\S]*\.rtx-toolbar-icon-button \{[\s\S]*height: 32px;[\s\S]*transition: background-color 140ms ease/);
    expect(themeCss).toMatch(/\.rtx-toolbar-action--primary \{[^}]*background: transparent;[^}]*border-color: transparent;[^}]*border-radius: 0;/);
    expect(advancedCss).toMatch(/\.rtx-toolbar-action--primary \{[^}]*background: transparent !important;[^}]*border-color: transparent !important;/);
    expect(themeCss).toMatch(/\.rtx-toolbar-icon-button\[role='radio'\]\[aria-checked='true'\] \{[^}]*background: rgb\(59 130 246 \/ 0\.15\);[^}]*border-color: rgb\(59 130 246 \/ 0\.5\);[^}]*box-shadow: none;/);
    expect(themeCss).toMatch(/html\.rtx-desktop-shell-active \.rtx-desktop-command-row \.rtx-toolbar-icon-button:is\(\[role='radio'\]\[aria-checked='true'\], \[aria-pressed='true'\]\) \{[^}]*background: rgb\(59 130 246 \/ 0\.15\);[^}]*border-color: rgb\(59 130 246 \/ 0\.5\);[^}]*box-shadow: none;/);
    expect(themeCss).not.toMatch(/\.rtx-desktop-command-row \.rtx-toolbar-icon-button:is\(\[role='radio'\], \.rtx-period-separator-toggle\) \{[^}]*background: transparent !important;/);
    expect(advancedCss).toMatch(/\.rtx-toolbar-icon-button\[role="radio"\]\[aria-checked="true"\] \{[^}]*box-shadow: none !important;/);
    expect(enterpriseCss).toMatch(/\.rtx-toolbar-icon-button\[role="radio"\]\[aria-checked="true"\] \{[^}]*box-shadow: none !important;/);
    expect(themeCss).toContain('background: var(--rtx-light-panel-header, var(--bg-secondary));');
    expect(markedCluster).not.toContain('shadow-[0_0_8px');
  });

  it('matches timeframe foreground clarity without thickening the glyphs', () => {
    expect(timeframePickerSource).toContain('text-zinc-200');
    expect(themeCss).toContain('color: var(--text-primary);');
    expect(themeCss).toContain('color: var(--color-zinc-100, #f4f4f5);');
    expect(themeCss).toContain('color: var(--color-blue-300, #93c5fd);');
    expect(iconComponentSource).toContain('strokeWidth={1.5}');
    expect(themeCss).toMatch(/\.rtx-toolbar-icon-button svg,[\s\S]*stroke-width: 1\.25;/);
    expect(advancedCss).toContain('color: #344054 !important;');
  });

  it('keeps equal spacing across command groups and the timeframe strip', () => {
    expect(themeCss).toMatch(/\.rtx-toolbar-command-cluster \{[\s\S]*gap: 0;[\s\S]*padding-inline: 10px;/);
    expect(themeCss).toMatch(/\.rtx-toolbar-group,[\s\S]*\.rtx-timeframe-strip \{[\s\S]*gap: var\(--rtx-toolbar-item-gap, 10px\);/);
    expect(themeCss).toMatch(/\.rtx-mt5-divider \{[\s\S]*margin-inline: 6px;[\s\S]*width: 0;/);
    expect(toolbarSource).toContain('className="rtx-mt5-divider invisible h-6 w-0 shrink-0"');
    expect(toolbarSource).not.toContain('mx-[4px] h-6 w-[2px]');
    expect(timeframePickerSource).toContain('min-w-[38px]');
    expect(timeframePickerSource).toContain('px-2.5');
  });

  it('keeps screenshot, period separators, and trade-history overlays as three equal buttons before timeframes', () => {
    const overlayGroup = markedCluster.slice(
      markedCluster.indexOf('{/* Screenshot, period separators, and trade-history overlays — three equal command buttons */}'),
    );

    expect(overlayGroup.match(/<CommandIconButton/g)).toHaveLength(3);
    expect(overlayGroup).toContain('icon="camera"');
    expect(overlayGroup).toContain('icon="period-separator"');
    expect(overlayGroup).toContain('icon="sliders-horizontal"');
    expect(toolbarSource.indexOf('label={tr("Chart capture and overlays")}')).toBeGreaterThan(-1);
    expect(toolbarSource.indexOf('label={tr("Chart capture and overlays")}')).toBeLessThan(
      toolbarSource.indexOf('{/* Group 8: Horizontal MT-style timeframe strip */}'),
    );
    expect(toolbarSource.slice(
      toolbarSource.indexOf('{/* Group 8: Horizontal MT-style timeframe strip */}'),
    )).not.toContain('rtx-period-separator-toggle');
  });

  it('keeps the indicator glyph monochrome and themeable', () => {
    const indicatorIcon = iconRegistrySource.slice(
      iconRegistrySource.indexOf("'indicator-list':"),
      iconRegistrySource.indexOf("'symbol-box':"),
    );

    expect(indicatorIcon).toContain("fill: 'currentColor'");
    expect(indicatorIcon).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
