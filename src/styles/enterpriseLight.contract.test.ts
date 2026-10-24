import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type Node, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const indexCss = readSource('src/index.css');
const lightCss = readSource('src/styles/enterprise-light.css');
const legacyLightCss = readSource('src/styles/legacy-light-overrides.css');
const dataWindowSource = readSource('src/components/DataWindow.tsx');
const confirmDialogSource = readSource('src/components/ui/ConfirmDialog.tsx');
const optionsDialogSource = readSource('src/components/settings/OptionsDialog.tsx');
const chartTemplateSource = readSource('src/components/ChartTemplateDialog.tsx');
const symbolsDialogSource = readSource('src/components/SymbolsDialog.tsx');
const chartSettingsSource = readSource('src/store/useChartSettingsStore.ts');
const marketWatchSource = [
  readSource('src/components/market-watch/MarketWatchPanel.tsx'),
  readSource('src/components/market-watch/MarketWatchGrid.tsx'),
  readSource('src/components/market-watch/MarketWatchSymbolExplorer.tsx'),
  readSource('src/components/market-watch/MarketWatchRow.tsx'),
  readSource('src/components/market-watch/marketWatchPanelModel.ts'),
].join('\n');

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
    const legacyIndex = indexCss.indexOf('@import "./styles/legacy-light-overrides.css";');
    const enterpriseIndex = indexCss.indexOf('@import "./styles/enterprise-light.css";');

    expect(legacyIndex).toBeGreaterThan(-1);
    expect(enterpriseIndex).toBeGreaterThan(legacyIndex);
  });

  it('shares the revised light palette across web and desktop surfaces', () => {
    const expectedPalette = {
      '--rtx-light-canvas': '#e8edf3',
      '--rtx-light-panel': '#f8fafc',
      '--rtx-light-panel-subtle': '#f1f4f8',
      '--rtx-light-panel-header': '#e2e8f0',
      '--rtx-light-elevated': '#ffffff',
      '--rtx-light-chart': '#fafbfc',
      '--rtx-light-field': '#ffffff',
      '--rtx-light-hover': '#e8eef6',
      '--rtx-light-pressed': '#d6e3f3',
      '--rtx-light-selected': '#dce9fa',
      '--rtx-light-border': '#c5ced9',
      '--rtx-light-border-strong': '#9eacbd',
      '--rtx-light-control-border': '#697b91',
      '--rtx-light-control-border-hover': '#52667f',
      '--rtx-light-row-border': '#dde4ed',
      '--rtx-light-text': '#182230',
      '--rtx-light-text-secondary': '#334155',
      '--rtx-light-text-muted': '#475569',
      '--rtx-light-price': '#172b45',
      '--rtx-light-accent': '#2457a7',
      '--rtx-light-accent-strong': '#1e4788',
      '--rtx-light-accent-pressed': '#173768',
      '--rtx-light-accent-soft': '#dce9fa',
      '--rtx-light-accent-border': '#2457a7',
      '--rtx-light-buy': '#2563eb',
      '--rtx-light-sell': '#dc2626',
      '--color-profit': '#1746bc',
      '--color-loss': '#a51f26',
    };
    for (const [token, color] of Object.entries(expectedPalette)) {
      expect(readHexToken(token), token).toBe(color);
    }
    expect(lightCss).not.toMatch(/#(?:7f56d9|7e57c2|6941c6|f4ebff|f3e5f5|e9d7fe)/i);
  });

  it('keeps small text and financial values readable through row interaction states', () => {
    const surfaces = [
      '--rtx-light-panel',
      '--rtx-light-elevated',
      '--rtx-light-canvas',
      '--rtx-light-chart',
      '--rtx-light-panel-header',
      '--rtx-light-panel-subtle',
      '--rtx-light-field',
      '--rtx-light-hover',
      '--rtx-light-selected',
      '--rtx-light-pressed',
    ];
    const foregrounds = [
      '--rtx-light-text',
      '--rtx-light-text-secondary',
      '--rtx-light-text-muted',
      '--rtx-light-price',
      '--rtx-light-chart-high',
      '--rtx-light-accent',
      '--rtx-light-quote-up',
      '--rtx-light-quote-down',
      '--color-profit',
      '--color-loss',
    ];

    for (const surface of surfaces) {
      for (const foreground of foregrounds) {
        expect(
          contrastRatio(readHexToken(foreground), readHexToken(surface)),
          `${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('makes editable control outlines visible against fields and adjacent surfaces', () => {
    for (const border of ['--rtx-light-control-border', '--rtx-light-control-border-hover']) {
      for (const surface of ['--rtx-light-field', '--rtx-light-panel', '--rtx-light-elevated', '--rtx-light-selected']) {
        expect(
          contrastRatio(readHexToken(border), readHexToken(surface)),
          `${border} against ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps white action labels readable on every primary, buy, and sell state', () => {
    for (const action of [
      '--rtx-light-accent',
      '--rtx-light-accent-strong',
      '--rtx-light-accent-pressed',
      '--rtx-light-buy',
      '--rtx-light-buy-hover',
      '--rtx-light-buy-pressed',
      '--rtx-light-sell',
      '--rtx-light-sell-hover',
      '--rtx-light-sell-pressed',
    ]) {
      expect(
        contrastRatio('#ffffff', readHexToken(action)),
        `White text on ${action}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('provides flat base surfaces beneath the optional chrome finish', () => {
    expect(lightCss).toMatch(/:is\(\.rtx-top-chrome, \.rtx-main-toolbar\)\s*\{[\s\S]*?box-shadow: none !important;/);
    expect(lightCss).toMatch(/\.dock-panel\s*\{[\s\S]*?border-radius: 0 !important;/);
    expect(lightCss).toMatch(/\.dock-panel--active\s*\{[\s\S]*?box-shadow: none !important;/);
    expect(lightCss).toMatch(/\.rtx-trade-footer\s*\{[\s\S]*?box-shadow: none !important;/);
    expect(lightCss).toContain('backdrop-filter: none !important;');
  });

  it('provides stable hooks for formerly dark light-mode surfaces', () => {
    // A substring match also paints every BEM child and the page backdrop.
    expect(legacyLightCss).not.toContain('[class*="dialog"]');
    expect(legacyLightCss).toContain(':where([role="dialog"], [role="alertdialog"])');
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
    expect(lightCss).toMatch(/\.rtx-chart-wrapper\s*>\s*div\[class\*="bg-\[#0a0a0f\]"\]/);
    expect(lightCss).toMatch(/\.rtx-chart-hud\s*>\s*span,[\s\S]*?background: transparent !important;/);
    expect(chartSettingsSource).toContain('background: "#fafbfc"');
    expect(chartSettingsSource).toContain('foreground: "#334155"');
    expect(chartSettingsSource).toContain('grid: "rgba(71, 85, 105, 0.07)"');
    expect(chartSettingsSource).toContain('if (color.toUpperCase() === CHART_PROFIT_COLOR) return "#06634e";');
    expect(chartSettingsSource).toContain('if (color.toUpperCase() === CHART_LOSS_COLOR) return "#a51f26";');
  });

  it('repairs selected Market Watch rows even when the row omits mw-row', () => {
    expect(lightCss).toContain('.rtx-market-watch :is(.mw-row, tr)[aria-selected="true"]');
    expect(lightCss).toContain('box-shadow: inset 2px 0 0 var(--rtx-light-accent) !important;');
  });

  it('centralizes the requested light typography without scattering component overrides', () => {
    const overrides: string[] = [];
    for (const path of [
      'src/styles/enterprise-light.css',
      'src/styles/legacy-light-overrides.css',
      'src/styles/theme.css',
      'src/styles/surface-finish.css',
      'src/index.css',
    ]) {
      parse(readSource(path), { from: path }).walkDecls((declaration) => {
        const property = declaration.prop;
        const changesSizeOrWeight = /^(?:font|font-size|font-weight)$/.test(property)
          || /^--.*font.*(?:size|weight)/.test(property)
          || /^--text-(?:2xs|xs|sm|base|lg|xl|2xl)$/.test(property);
        if (!changesSizeOrWeight) return;

        // Walk ancestors so nested dialog rules and media-query overrides are
        // checked too. Dark-only :not(...) selectors are not light scopes.
        let parent: Node['parent'] = declaration.parent;
        while (parent) {
          if (parent.type === 'rule') {
            const selector = (parent as Rule).selector.replace(/:not\([^)]*\)/g, '');
            if (/\.(?:rtx-skin-untitled-light|theme-light)\b/.test(selector)) {
              overrides.push(`${path}:${declaration.source?.start?.line} ${property}: ${declaration.value}`);
              break;
            }
          }
          parent = parent.parent;
        }
      });
    }
    expect(overrides).toEqual([]);
    const typography = parse(readSource('src/styles/light-typography.css'));
    typography.walkRules((rule) => {
      expect(rule.selector).toMatch(/^html:root(?:\.rtx-advanced-view)?\.rtx-skin-untitled-light/);
    });
    const tokenValues = new Map<string, string>();
    typography.nodes.filter((node) => node.type === 'rule'
      && /^html:root(?:\.rtx-advanced-view)?\.rtx-skin-untitled-light$/.test(node.selector)).forEach((rule) => {
      if (rule.type === 'rule') rule.walkDecls((declaration) => { tokenValues.set(declaration.prop, declaration.value); });
    });
    expect(tokenValues.get('--rtx-light-ui-font-size')).toBe('var(--rtx-ui-font-size)');
    expect(tokenValues.get('--rtx-light-ui-font-weight')).toBe('var(--rtx-font-weight-body)');
    expect(tokenValues.get('--rtx-light-type-body')).toBe('var(--rtx-ui-font-size)');
    expect(tokenValues.get('--rtx-light-type-caption')).toBe('max(12px, calc(var(--rtx-ui-font-size) - 1px))');
    expect(tokenValues.get('--rtx-light-weight-body')).toBe('400');
    expect(tokenValues.get('--rtx-light-weight-control')).toBe('500');
    expect(tokenValues.get('--rtx-light-weight-heading')).toBe('600');
    expect(readSource('src/authenticatedStyles.ts')).toContain("import './styles/light-typography.css';");
  });

  it('keeps light-specific font families and icon styling without a separate type scale', () => {
    expect(lightCss).toMatch(/\.rtx-toolbar-icon-button svg[\s\S]*?stroke-width: 1\.35 !important;/);
    expect(lightCss).toMatch(/\.rtx-toolbar-action\s*\{[^}]*font-family: "Segoe UI", Tahoma, Arial, sans-serif !important;/);
    expect(lightCss).toMatch(/\.rtx-timeframe-strip \.rtx-timeframe-option\s*\{[^}]*font-family: "Segoe UI", Tahoma, Arial, sans-serif !important;/);
  });

  it('neutralizes pink trade stripes while preserving a quiet selected row and readable trade action buttons', () => {
    expect(lightCss).toContain('.rtx-trade-table tbody tr.rtx-trade-row:not(.rtx-trade-row--selected):nth-child(even)');
    expect(lightCss).toMatch(/\.rtx-trade-table tbody tr\.rtx-trade-row[\s\S]*?background: var\(--rtx-light-panel\) !important;/);
    expect(lightCss).toContain('background: var(--rtx-light-selected) !important;');
    expect(lightCss).not.toMatch(/#f3e5f5/i);
    expect(lightCss).toMatch(/\.rtx-trade-action-button,\s*html\.rtx-advanced-view\.rtx-skin-untitled-light \.rtx-trade-close-button\s*\{[\s\S]*?background: var\(--rtx-light-panel-muted\) !important;[\s\S]*?color: var\(--rtx-light-text-secondary\) !important;/);
    expect(lightCss).toMatch(/\.rtx-trade-action-button:not\(:disabled\):hover\s*\{[\s\S]*?color: var\(--rtx-light-accent\) !important;/);
    expect(lightCss).toMatch(/\.rtx-trade-close-button:not\(:disabled\):hover\s*\{[\s\S]*?background: var\(--color-loss\) !important;[\s\S]*?color: #ffffff !important;/);
    expect(legacyLightCss).toContain('.rtx-trade-control-btn');
  });

  it('separates blue/red quote movement from green/red daily performance', () => {
    expect(readHexToken('--rtx-light-quote-up')).toBe('#1746bc');
    expect(readHexToken('--rtx-light-quote-down')).toBe('#a51f26');
    expect(lightCss).toMatch(/\.rtx-market-watch__price--up\s*\{[^}]*color: var\(--rtx-light-quote-up\) !important;/);
    expect(lightCss).toMatch(/\.rtx-market-watch__price--down\s*\{[^}]*color: var\(--rtx-light-quote-down\) !important;/);
    expect(lightCss).toMatch(/\.rtx-market-watch__direction--up\s*\{[^}]*color: var\(--rtx-light-quote-up\) !important;/);
    expect(lightCss).toMatch(/\.rtx-market-watch__direction--down\s*\{[^}]*color: var\(--rtx-light-quote-down\) !important;/);
    expect(lightCss).toMatch(/\.rtx-market-watch__daily--up\s*\{[^}]*color: var\(--color-profit\) !important;/);
    expect(lightCss).toMatch(/\.rtx-market-watch__daily--down\s*\{[^}]*color: var\(--color-loss\) !important;/);
  });

  it('renders broker descriptions beneath symbol codes in either theme', () => {
    expect(marketWatchSource).toContain('const SYMBOL_EXPLORER_ROW_HEIGHT = 48;');
    expect(marketWatchSource).toContain('rtx-market-watch__symbol-description');
    expect(marketWatchSource).toContain('symbolDescriptionByName');
    expect(marketWatchSource).toContain('getFallbackSymbolDescription(symbol)');
  });
});
