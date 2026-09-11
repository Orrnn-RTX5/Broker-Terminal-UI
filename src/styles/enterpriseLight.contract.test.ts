import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const indexCss = readSource('src/index.css');
const lightCss = readSource('src/styles/enterprise-light.css');
const dataWindowSource = readSource('src/components/DataWindow.tsx');
const confirmDialogSource = readSource('src/components/ui/ConfirmDialog.tsx');
const optionsDialogSource = readSource('src/components/settings/OptionsDialog.tsx');
const chartTemplateSource = readSource('src/components/ChartTemplateDialog.tsx');
const symbolsDialogSource = readSource('src/components/SymbolsDialog.tsx');
const chartSettingsSource = readSource('src/store/useChartSettingsStore.ts');
const marketWatchSource = readSource('src/components/layout/MarketWatchPanel.tsx');

const readHexToken = (name: string): string => {
  const match = lightCss.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i'));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
};

const hexToRgb = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const relativeLuminance = (hex: string): number => {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
};

const contrastRatio = (foreground: string, background: string): number => {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};

describe('enterprise light visual-system contract', () => {
  it('loads the final light layer after the legacy advanced skin', () => {
    const legacyIndex = indexCss.indexOf('@import "./styles/advanced-untitled-light.css";');
    const enterpriseIndex = indexCss.indexOf('@import "./styles/enterprise-light.css";');

    expect(legacyIndex).toBeGreaterThan(-1);
    expect(enterpriseIndex).toBeGreaterThan(legacyIndex);
  });

  it('uses one neutral surface hierarchy with blue reserved for interaction', () => {
    expect(lightCss).toContain('--rtx-light-canvas: #dfe4e8;');
    expect(lightCss).toContain('--rtx-light-panel: #f2f4f5;');
    expect(lightCss).toContain('--rtx-light-panel-header: #e7ebee;');
    expect(lightCss).toContain('--rtx-light-border: #d1d8de;');
    expect(lightCss).toContain('--rtx-light-accent: #28547c;');
    expect(lightCss).not.toMatch(/#(?:7f56d9|7e57c2|6941c6|f4ebff|f3e5f5|e9d7fe)/i);
  });

  it('keeps ordinary, secondary, muted, and accent text readable on panels', () => {
    const panel = readHexToken('--rtx-light-panel');

    expect(contrastRatio(readHexToken('--rtx-light-text'), panel)).toBeGreaterThanOrEqual(12);
    expect(contrastRatio(readHexToken('--rtx-light-text-secondary'), panel)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(readHexToken('--rtx-light-text-muted'), panel)).toBeGreaterThanOrEqual(5);
    expect(contrastRatio(readHexToken('--rtx-light-accent'), panel)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(readHexToken('--color-profit'), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readHexToken('--color-loss'), panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('flattens core terminal surfaces and removes light-mode glass', () => {
    expect(lightCss).toMatch(/:is\(\.rtx-top-chrome, \.rtx-main-toolbar\)\s*\{[\s\S]*?box-shadow: none !important;/);
    expect(lightCss).toMatch(/\.dock-panel\s*\{[\s\S]*?border-radius: 0 !important;/);
    expect(lightCss).toMatch(/\.dock-panel--active\s*\{[\s\S]*?box-shadow: none !important;/);
    expect(lightCss).toMatch(/\.rtx-trade-footer\s*\{[\s\S]*?box-shadow: none !important;/);
    expect(lightCss).toContain('backdrop-filter: none !important;');
  });

  it('provides stable hooks for formerly dark light-mode surfaces', () => {
    expect(dataWindowSource).toContain('className="rtx-data-window"');
    expect(confirmDialogSource).toContain('rtx-confirm-dialog-backdrop');
    expect(confirmDialogSource).toContain('rtx-confirm-dialog__content');
    expect(optionsDialogSource).toContain('rtx-options-dialog');
    expect(chartTemplateSource).toContain('rtx-chart-template-dialog');
    expect(symbolsDialogSource).toContain('rtx-symbols-dialog');

    for (const selector of [
      '.rtx-data-window',
      '.rtx-confirm-dialog',
      '.rtx-options-dialog',
      '.rtx-chart-template-dialog',
      '.rtx-symbols-dialog',
    ]) {
      expect(lightCss).toContain(selector);
    }
  });

  it('keeps the chart calm before and after data becomes ready', () => {
    expect(lightCss).toContain('.rtx-chart-wrapper > div[class*="bg-[#0a0a0f]"]');
    expect(lightCss).toMatch(/\.rtx-chart-hud > span,[\s\S]*?background: transparent !important;/);
    expect(chartSettingsSource).toContain('background: "#f2f4f5"');
    expect(chartSettingsSource).toContain('foreground: "#465461"');
    expect(chartSettingsSource).toContain('grid: "#dfe4e8"');
  });

  it('repairs selected Market Watch rows even when the row omits mw-row', () => {
    expect(lightCss).toContain('.rtx-market-watch :is(.mw-row, tr)[aria-selected="true"]');
    expect(lightCss).toContain('box-shadow: inset 2px 0 0 var(--rtx-light-accent) !important;');
  });

  it('uses a readable light-theme hierarchy without making dense data bold', () => {
    expect(lightCss).toContain('--rtx-light-font-body-weight: 400;');
    expect(lightCss).toContain('--rtx-light-font-control-weight: 500;');
    expect(lightCss).toMatch(/\.rtx-toolbar-action\s*\{[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\) !important;[\s\S]*?font-weight: var\(--rtx-light-font-body-weight\) !important;/);
    expect(lightCss).toMatch(/\.rtx-toolbar-icon-button svg[\s\S]*?stroke-width: 1\.35 !important;/);
    expect(lightCss).toMatch(/\.rtx-timeframe-strip \.rtx-timeframe-option\s*\{[\s\S]*?font-family: "Segoe UI", Tahoma, Arial, sans-serif !important;[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\) !important;[\s\S]*?font-weight: var\(--rtx-light-font-body-weight\) !important;/);
    expect(lightCss).toMatch(/\.rtx-toolbar-symbol-badge\s*\{[\s\S]*?font-size: var\(--rtx-advanced-header-font-size, 12px\) !important;[\s\S]*?font-weight: var\(--rtx-light-font-control-weight\) !important;/);
    expect(lightCss).toMatch(/\.dock-panel__title\s*\{[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\) !important;[\s\S]*?font-weight: var\(--rtx-light-font-control-weight\) !important;/);
    expect(lightCss).toMatch(/\.navigator-tree-item__label\s*\{[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\) !important;[\s\S]*?font-weight: var\(--rtx-light-font-body-weight\) !important;/);
    expect(lightCss).toMatch(/\.rtx-chart-hud\s*\{[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\) !important;[\s\S]*?font-weight: var\(--rtx-light-font-body-weight\) !important;/);
    expect(lightCss).toMatch(/\.rtx-market-watch__column-heading,[\s\S]*?\.rtx-trade-table__head th,[\s\S]*?font-weight: var\(--rtx-light-font-control-weight\) !important;/);
    expect(lightCss).toMatch(/\.rtx-trade-table tbody tr\.rtx-trade-row td,[\s\S]*?\.rtx-status-bar__metric[\s\S]*?font-weight: var\(--rtx-light-font-body-weight\) !important;/);
  });

  it('neutralizes pink trade stripes while preserving a quiet selected row', () => {
    expect(lightCss).toContain('.rtx-trade-table tbody tr.rtx-trade-row:not(.rtx-trade-row--selected):nth-child(even)');
    expect(lightCss).toMatch(/\.rtx-trade-table tbody tr\.rtx-trade-row[\s\S]*?background: var\(--rtx-light-panel\) !important;/);
    expect(lightCss).toContain('background: var(--rtx-light-selected) !important;');
    expect(lightCss).not.toMatch(/#f3e5f5/i);
  });

  it('uses MetaTrader quote colors in Market Watch instead of profit green', () => {
    expect(lightCss).toMatch(/\.rtx-market-watch__price--up,[\s\S]*?\.rtx-market-watch__daily--up[\s\S]*?color: #0b6cf0 !important;/);
    expect(lightCss).toMatch(/\.rtx-market-watch__price--down,[\s\S]*?\.rtx-market-watch__daily--down[\s\S]*?color: #d61f2c !important;/);
    expect(lightCss).toContain('.rtx-market-watch__direction--up');
    expect(lightCss).toContain('.rtx-market-watch__direction--down');
  });

  it('renders broker descriptions beneath symbol codes in either theme', () => {
    expect(marketWatchSource).toContain('const SYMBOL_EXPLORER_ROW_HEIGHT = 48;');
    expect(marketWatchSource).toContain('rtx-market-watch__symbol-description');
    expect(marketWatchSource).toContain('symbolDescriptionByName');
    expect(marketWatchSource).toContain('getFallbackSymbolDescription(symbol)');
  });
});
