import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

const dialogSource = readSource('src/components/OrderPanelDialog.tsx');
const dialogCss = readSource('src/styles/order-panel-dialog.css');

describe('OrderPanelDialog presentation contract', () => {
  it('uses the terminal design tokens instead of the legacy dialog palette', () => {
    expect(dialogSource).not.toContain('bg-[#1e222d]');
    expect(dialogSource).not.toContain('bg-[#252a37]');
    expect(dialogSource).not.toContain('border-zinc-600');

    expect(dialogCss).toContain('background: var(--bg-secondary);');
    expect(dialogCss).toContain('border: 1px solid var(--border-secondary);');
    expect(dialogCss).toContain('color: var(--text-primary);');
    expect(dialogCss).toContain('--order-bid: var(--color-loss);');
    expect(dialogCss).toContain('--order-ask: var(--color-info);');
  });

  it('keeps secondary captions legible instead of reusing the faint global tertiary text', () => {
    expect(dialogCss).toContain('--order-supporting-text: color-mix(in srgb, var(--text-primary) 68%, var(--bg-secondary));');
    expect(dialogCss).not.toContain('color: var(--text-tertiary);');
    expect(dialogCss).toContain('color: var(--order-supporting-text);');
    expect(dialogSource).toContain("axis: readCssValue('color', '#a1a1aa')");
  });

  it('keeps the tick chart responsive, high-DPI, and aligned to active chart colors', () => {
    expect(dialogSource).toContain('getEffectiveChartColors(chartSettings');
    expect(dialogSource).toContain('window.devicePixelRatio');
    expect(dialogSource).toContain('new ResizeObserver(scheduleDraw)');
    expect(dialogSource).toContain('chartColors={chartColors}');
    expect(dialogSource).toContain('data-testid="order-mini-tick-chart"');
    expect(dialogCss).toContain('width: 100%;');
    expect(dialogCss).toContain('@media (max-width: 760px)');
  });

  it('provides one functional close control and accessible field labels', () => {
    expect(dialogSource).toContain('aria-label="Close New Order dialog"');
    expect(dialogSource).not.toContain('>—</button>');
    expect(dialogSource).not.toContain('>□</button>');
    expect(dialogSource).toContain('htmlFor={volumeFieldId}');
    expect(dialogSource).toContain('aria-label="Increase volume"');
    expect(dialogSource).toContain('role="dialog"');
  });
});
