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
    const tradingChartViewSource = readSource('src/features/trading-chart/presentation/TradingChartView.tsx');
    expect(lightCss).toMatch(/\.rtx-chart-wrapper\s*>\s*div\[class\*="bg-\[#0a0a0f\]"\]/);
    expect(lightCss).toMatch(/\.rtx-chart-hud\s*>\s*span,[\s\S]*?background: transparent !important;/);
    expect(lightCss).toMatch(/html\.rtx-advanced-view\.rtx-skin-untitled-light \.rtx-chart-hud \{[\s\S]*?background: var\(--rtx-light-panel, #ffffff\) !important;/);
    expect(tradingChartViewSource).toContain("background: chartTheme.background, padding: '2px 6px', borderRadius: '3px'");
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

  it('keeps dark selected and focused Market Watch rows on a muted slate surface so blue and red quotes stay readable', () => {
    const marketWatchDesktopCss = readSource('src/components/market-watch/market-watch-desktop.css');
    expect(marketWatchDesktopCss).toContain('--mw-desktop-row-selected: #222934;');
    expect(marketWatchDesktopCss).toContain('--mw-desktop-row-selected-focus: #252d3a;');
    expect(marketWatchDesktopCss).toContain('background: var(--mw-desktop-row-selected-focus, var(--mw-desktop-row-selected, var(--mw-desktop-row-hover))) !important;');
    expect(contrastRatio('#4597ff', '#252d3a')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ff5858', '#252d3a')).toBeGreaterThanOrEqual(4.2);
  });

  it('draws horizontal and vertical cell borders for every Market Watch symbol row and header while keeping single-stroke dock seams', () => {
    const marketWatchDesktopCss = readSource('src/components/market-watch/market-watch-desktop.css');
    const lightTypographyCss = readSource('src/styles/light-typography.css');
    const chartThemeSource = readSource('src/features/trading-chart/presentation/chartTheme.ts');
    expect(readHexToken('--rtx-light-line-border')).toBe('#64748b');
    expect(marketWatchDesktopCss).toMatch(
      /\.rtx-market-watch__grid\.rtx-market-watch__grid--lines\.rtx-market-watch__grid--lines tbody td\s*\{[\s\S]*?border-top: 1px solid var\(--mw-desktop-grid\) !important;[\s\S]*?border-bottom: 1px solid var\(--mw-desktop-grid\) !important;[\s\S]*?border-left: 1px solid var\(--mw-desktop-grid-vertical, var\(--mw-desktop-grid\)\) !important;[\s\S]*?border-right: 1px solid var\(--mw-desktop-grid-vertical, var\(--mw-desktop-grid\)\) !important;/,
    );
    expect(marketWatchDesktopCss).toMatch(
      /\.rtx-market-watch__grid th\s*\{[\s\S]*?backdrop-filter: none !important;[\s\S]*?-webkit-backdrop-filter: none !important;/,
    );
    expect(marketWatchDesktopCss).toMatch(
      /\.rtx-market-watch__grid th:is\(\.rtx-market-watch__column-heading--bid, \.rtx-market-watch__column-heading--ask\)\s*\{[\s\S]*?text-align: center !important;/,
    );
    expect(marketWatchDesktopCss).toMatch(
      /\.rtx-market-watch__grid\.rtx-market-watch__grid--lines\.rtx-market-watch__grid--lines thead th\s*\{[\s\S]*?border-top: 0 !important;[\s\S]*?border-bottom: 1px solid var\(--mw-desktop-border-strong, var\(--mw-desktop-grid\)\) !important;[\s\S]*?border-left: 1px solid var\(--mw-desktop-grid-vertical, var\(--mw-desktop-grid\)\) !important;[\s\S]*?border-right: 1px solid var\(--mw-desktop-grid-vertical, var\(--mw-desktop-grid\)\) !important;/,
    );
    expect(marketWatchDesktopCss).toMatch(
      /\.rtx-market-watch__grid\.rtx-market-watch__grid--lines\.rtx-market-watch__grid--lines :is\(thead th, tbody td\):last-child\s*\{[\s\S]*?border-right: 0 !important;/,
    );
    expect(lightCss).toMatch(
      /\[data-dock-panel\]:not\(\[data-dock-floating-panel='true'\]\) > div:first-child\s*\{[\s\S]*?border-top: 0 !important;[\s\S]*?border-left: 0 !important;[\s\S]*?border-right: 1px solid var\(--rtx-light-line-border, #64748b\) !important;[\s\S]*?border-bottom: 1px solid var\(--rtx-light-line-border, #64748b\) !important;/,
    );
    expect(marketWatchDesktopCss).toMatch(
      /\.rtx-market-watch\.rtx-market-watch--desktop\s+\.rtx-market-watch__symbol\s*\{[\s\S]*?font-size: 13px !important;[\s\S]*?font-weight: 400 !important;/,
    );
    expect(marketWatchDesktopCss).toMatch(
      /\.rtx-market-watch\.rtx-market-watch--desktop\s+\.rtx-market-watch__view-tabs\s+button\[aria-selected='true'\]\s*\{[\s\S]*?box-shadow:\s*none !important;/,
    );
    expect(lightTypographyCss).toMatch(
      /\.rtx-market-watch__symbol,\s*\.rtx-market-watch__price \.price-big\s*\)\s*\{[\s\S]*?--rtx-type-size: max\(13px, calc\(var\(--rtx-ui-font-size\) - 1px\)\);[\s\S]*?--rtx-type-weight: var\(--rtx-light-weight-body\);/,
    );
    expect(chartThemeSource).toContain("scaleBorder: useReferenceLightSurface\n      ? '#64748b'");
  });

  it('keeps bulk-close confirm buttons white in light mode, removes history status pill borders and active time-filter bottom bar, and uses regular weight on chart time axis labels', () => {
    const bulkCloseCss = readSource('src/styles/bulk-close-dialog.css');
    const historyModelSource = readSource('src/features/bottom-dock/history/historyTabModel.ts');
    const chartHelpersSource = readSource('src/components/TradingChart.helpers.ts');
    expect(bulkCloseCss).toMatch(/\.rtx-bulk-close-dialog__btn-confirm\s*\{[\s\S]*?color: #ffffff !important;/);
    expect(legacyLightCss).toContain('.rtx-bulk-close-dialog__btn-confirm');
    expect(lightCss).toMatch(
      /\.rtx-history-toolbar \.rtx-history-time-btn\[aria-pressed="true"\]\s*\{[\s\S]*?background: var\(--rtx-light-selected\) !important;[\s\S]*?color: var\(--rtx-light-accent-strong\) !important;[\s\S]*?box-shadow: none !important;/,
    );
    expect(historyModelSource).toContain('rtx-history-status-label inline-flex items-center text-[11px] font-normal');
    expect(historyModelSource).not.toContain('bg-emerald-500/15');
    expect(historyModelSource).not.toContain('border-emerald-500/30');
    expect(chartHelpersSource).toContain('allowBoldLabels: false');
  });

  it('styles right-click context menus with regular-weight labels, sans-serif shortcuts, subtle borders, and monochrome icons', () => {
    const lightTypographyCss = readSource('src/styles/light-typography.css');
    const appTypographyCss = readSource('src/styles/app-typography.css');
    const contextMenuSource = readSource('src/components/ui/ContextMenu.tsx');
    const iconRegistrySource = readSource('src/components/ui/iconRegistry.ts');

    expect(contextMenuSource).toContain('rtx-context-menu__item');
    expect(contextMenuSource).toContain('rtx-context-menu__label');
    expect(contextMenuSource).not.toContain('font-mono');
    expect(lightTypographyCss).toMatch(
      /\.rtx-timeframe-option, \.rtx-timeframe-option\[aria-checked='true'\],[\s\S]*?--rtx-type-weight: var\(--rtx-light-weight-body\);/,
    );
    expect(appTypographyCss).toMatch(
      /html:root \.rtx-main-toolbar \.rtx-timeframe-option,\s*html:root \.rtx-timeframe-option,\s*html:root \.rtx-timeframe-option\[aria-checked='true'\]\s*\{[\s\S]*?--rtx-type-weight: var\(--rtx-font-weight-body\);/,
    );
    expect(lightTypographyCss).toMatch(
      /\.rtx-context-menu \[role='menuitem'\],[\s\S]*?--rtx-type-size: max\(13px, calc\(var\(--rtx-ui-font-size\) - 1px\)\);[\s\S]*?--rtx-type-weight: var\(--rtx-light-weight-body\);/,
    );
    expect(lightTypographyCss).toMatch(
      /\.rtx-context-menu \.rtx-context-menu__shortcut\s*\{[\s\S]*?--rtx-type-size: max\(12px, calc\(var\(--rtx-ui-font-size\) - 2px\)\);[\s\S]*?--rtx-type-weight: var\(--rtx-light-weight-body\);[\s\S]*?--rtx-type-family: var\(--rtx-ui-font-family\);/,
    );
    expect(lightCss).toMatch(
      /:is\(\.rtx-chart-context-menu, \.rtx-context-menu\)\s*\{[\s\S]*?border-radius: 6px !important;[\s\S]*?border: 1px solid #cbd5e1 !important;/,
    );
    const symbolBoxIcon = iconRegistrySource.slice(iconRegistrySource.indexOf("'symbol-box':"));
    expect(symbolBoxIcon).not.toMatch(/#(?:eab308|ca8a04)/i);
    expect(lightTypographyCss).toMatch(
      /\.dock-panel__title \[role='tab'\]\s*\{[\s\S]*?height: 100% !important;[\s\S]*?min-height: 0 !important;/,
    );
    expect(lightCss).toMatch(
      /\.dock-panel__header:not\(\.rtx-bottom-dock__header\)\s*\{[\s\S]*?height: 26px !important;[\s\S]*?min-height: 26px !important;/,
    );
    expect(lightCss).toMatch(
      /\.rtx-history-toolbar :is\(\.rtx-history-time-btn, \.rtx-history-refresh-btn\)\s*\{[\s\S]*?display: inline-flex !important;[\s\S]*?align-items: center !important;[\s\S]*?height: 22px !important;/,
    );
    expect(lightCss).toMatch(
      /\.rtx-history-toolbar__meta > span\s*\{[\s\S]*?align-items: center !important;[\s\S]*?height: 22px !important;[\s\S]*?line-height: 20px !important;/,
    );
    expect(lightCss).toMatch(
      /\.rtx-bottom-dock__tabs \.rtx-dock-tab\.active-tab\s*\{[\s\S]*?background: var\(--rtx-light-elevated\) !important;[\s\S]*?color: var\(--rtx-light-text\) !important;[\s\S]*?box-shadow: none !important;/,
    );
    expect(lightTypographyCss).toMatch(
      /\.rtx-bottom-dock__tabs \.rtx-dock-tab\.active-tab\s*\{[\s\S]*?border: 1px solid var\(--rtx-light-line-border, #64748b\) !important;[\s\S]*?border-top: 0 !important;/,
    );
  });
});
