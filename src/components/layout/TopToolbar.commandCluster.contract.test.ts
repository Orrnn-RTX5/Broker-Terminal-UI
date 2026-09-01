import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

const toolbarSource = readSource('src/components/layout/TopToolbar.tsx');
const themeCss = readSource('src/styles/theme.css');
const advancedCss = readSource('src/styles/advanced-untitled-light.css');
const iconRegistrySource = readSource('src/components/ui/iconRegistry.ts');
const iconComponentSource = readSource('src/components/ui/Icon.tsx');
const timeframePickerSource = readSource('src/components/layout/TimeframePicker.tsx');

const markedCluster = toolbarSource.slice(
  toolbarSource.indexOf('{/* New Order & Last Symbol */}'),
  toolbarSource.indexOf('{/* Group 8: Horizontal MT-style timeframe strip */}'),
);

describe('TopToolbar primary command cluster', () => {
  it('uses one product icon system at a clearly legible 20px scale', () => {
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
    ]) {
      expect(markedCluster).toMatch(new RegExp(`(?:icon|name)="${icon}"`));
    }

    expect(markedCluster).not.toMatch(/<(?:FileText|TrendingUp|BarChart2|CandlestickChart|LineChart|AreaChart|ZoomIn|ZoomOut|LayoutPanelTop|RefreshCw)\b/);
    expect(markedCluster).toContain('<Icon name="new-order" size={20} />');
    expect(markedCluster).toContain('<Icon name="activity" size={20} />');
    expect(toolbarSource).toContain('<Icon name={icon} size={20} />');
    expect(themeCss).toMatch(/\.rtx-toolbar-action__icon \{[\s\S]*flex: 0 0 20px;[\s\S]*height: 20px;[\s\S]*width: 20px;/);
  });

  it('keeps the two labeled actions dense, reactive, and accessible', () => {
    expect(markedCluster).toContain('text-[13px] font-semibold');
    expect(markedCluster).toContain('aria-label="New Order (F9)"');
    expect(markedCluster).toContain('aria-pressed={lastSymbolPanelVisible}');
    expect(toolbarSource).toContain('useLastSymbolStore((state) => state.lastSymbol)');
    expect(toolbarSource).toContain('useLastSymbolStore((state) => state.panelVisible)');
    expect(markedCluster).not.toContain('useLastSymbolStore.getState()');
  });

  it('exposes chart types as a named radio group', () => {
    expect(markedCluster).toContain('label="Chart type" role="radiogroup"');
    expect(markedCluster.match(/selectionRole="radio"/g)).toHaveLength(4);
    expect(toolbarSource).toContain("aria-checked={selectionRole === 'radio' ? active : undefined}");
  });

  it('uses restrained tokenized states in dark, light, and desktop chrome', () => {
    expect(themeCss).toMatch(/\.rtx-toolbar-action,[\s\S]*\.rtx-toolbar-icon-button \{[\s\S]*height: 32px;[\s\S]*transition: background-color 140ms ease/);
    expect(themeCss).toMatch(/\.rtx-toolbar-icon-button\[aria-checked='true'\] \{[\s\S]*box-shadow: inset 0 -2px 0 var\(--color-info\);/);
    expect(themeCss).toContain('html.rtx-desktop-shell-active .rtx-toolbar-action--primary');
    expect(advancedCss).toContain('.rtx-toolbar-icon-button[aria-checked="true"]');
    expect(markedCluster).not.toContain('shadow-[0_0_8px');
  });

  it('matches timeframe foreground clarity without thickening the glyphs', () => {
    expect(timeframePickerSource).toContain('text-zinc-400');
    expect(themeCss).toContain('color: var(--color-zinc-400, #a1a1aa);');
    expect(themeCss).toContain('color: var(--color-zinc-100, #f4f4f5);');
    expect(themeCss).toContain('color: var(--color-blue-300, #93c5fd);');
    expect(iconComponentSource).toContain('strokeWidth={1.5}');
    expect(advancedCss).toContain('color: #344054 !important;');
    expect(themeCss).toMatch(/html\.rtx-desktop-shell-active \.rtx-toolbar-action,[\s\S]*color: #30343a !important;/);
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
