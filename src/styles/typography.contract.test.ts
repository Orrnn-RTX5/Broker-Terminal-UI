import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const authenticatedStylesSource = readSource('src/authenticatedStyles.ts');
const appSource = readSource('src/App.tsx');
const themeCss = readSource('src/styles/theme.css');
const indexCss = readSource('src/index.css');
const loginCss = readSource('src/styles/login-dialog.css');
const advancedCss = readSource('src/styles/advanced-untitled-light.css');
const lightCss = readSource('src/styles/enterprise-light.css');
const orderDialogCss = readSource('src/styles/order-panel-dialog.css');
const historyDownloaderCss = readSource('src/styles/history-downloader.css');
const topToolbarSource = readSource('src/components/layout/TopToolbar.tsx');
const menuBarSource = readSource('src/components/layout/MenuBar.tsx');
const timeframePickerSource = readSource('src/components/layout/TimeframePicker.tsx');
const advancedViewRootClassesSource = readSource('src/utils/advancedViewRootClasses.ts');
const tradingChartSource = readSource('src/components/TradingChart.tsx');
const marketWatchSource = readSource('src/components/layout/MarketWatchPanel.tsx');
const bottomDockSource = readSource('src/components/BottomDock.tsx');
const statusBarSource = readSource('src/components/layout/StatusBar.tsx');
const journalSource = readSource('src/components/layout/JournalTab.tsx');
const welcomeSource = readSource('src/components/WelcomeTerminal.tsx');
const fileMenuSource = readSource('src/components/layout/FileMenu.tsx');
const dockPanelSource = readSource('src/components/dock/DockPanel.tsx');
const calendarSource = readSource('src/components/layout/CalendarTab.tsx');
const researchSource = readSource('src/components/layout/ResearchTabs.tsx');
const historyDownloaderSource = readSource('src/components/HistoryDownloader.tsx');
const dataWindowSource = readSource('src/components/DataWindow.tsx');
const depthOfMarketSource = readSource('src/components/DepthOfMarket.tsx');
const accountPanelSource = readSource('src/components/AccountPanel.tsx');
const contextMenuSource = readSource('src/components/ui/ContextMenu.tsx');
const orderDialogSource = readSource('src/components/OrderPanelDialog.tsx');
const modifyDialogSource = readSource('src/components/ModifyPositionDialog.tsx');
const symbolsDialogSource = readSource('src/components/SymbolsDialog.tsx');
const optionsDialogSource = readSource('src/components/settings/OptionsDialog.tsx');
const openAccountDialogSource = readSource('src/components/dialogs/OpenAccountDialog.tsx');
const loginDialogSource = readSource('src/components/LoginDialog.tsx');

describe('enterprise typography contract', () => {
  it('loads the bundled variable font, including real italic glyphs, before global CSS', () => {
    const normalFontImport = authenticatedStylesSource.indexOf("import '@fontsource-variable/plus-jakarta-sans';");
    const italicFontImport = authenticatedStylesSource.indexOf("import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';");
    const globalCssImport = authenticatedStylesSource.indexOf("import './index.css';");

    expect(normalFontImport).toBeGreaterThan(-1);
    expect(italicFontImport).toBeGreaterThan(normalFontImport);
    expect(globalCssImport).toBeGreaterThan(italicFontImport);
  });

  it('uses one canonical sans stack across the authenticated shell and login', () => {
    expect(themeCss).toContain("--font-sans: 'Plus Jakarta Sans Variable'");
    expect(themeCss).toContain("--font-login-sans: var(--font-sans)");
    expect(indexCss).toMatch(/html, body, #root \{[\s\S]*font-family: var\(--font-sans\)/);
    expect(loginCss).toContain('font-family: var(--font-login-sans, var(--font-sans));');
    expect(appSource).toContain('className="rtx-app-shell ');
    expect(indexCss).not.toContain("font-family: 'Inter'");
    expect(loginCss).not.toContain("font-family: 'Inter'");
  });

  it('defines distinct regular, medium, and semibold weights', () => {
    expect(themeCss).toContain('--text-2xs: 0.6875rem;');
    expect(themeCss).toContain('--text-xs: 0.75rem;');
    expect(themeCss).toContain('--text-sm: 0.875rem;');
    expect(themeCss).toContain('--text-base: 0.875rem;');
    expect(themeCss).toContain('--text-lg: 1rem;');
    expect(themeCss).toContain('--text-xl: 1.125rem;');
    expect(themeCss).toContain('--text-2xl: 1.375rem;');
    expect(themeCss).toContain('--font-weight-normal: 400;');
    expect(themeCss).toContain('--font-weight-medium: 500;');
    expect(themeCss).toContain('--font-weight-semibold: 600;');
    expect(themeCss).toContain('--font-weight-bold: 600;');
    expect(themeCss).toContain('--font-weight-extrabold: 650;');
    expect(themeCss).toContain('--font-weight-black: 700;');
    expect(themeCss).toMatch(/\.rtx-app-shell \{[\s\S]*font-size: var\(--text-base\);[\s\S]*font-weight: var\(--font-weight-normal\);[\s\S]*line-height: var\(--leading-normal\);/);
    expect(themeCss).toMatch(/button,[\s\S]*legend \{[\s\S]*font-weight: var\(--font-weight-normal\);/);
  });

  it('keeps the missing utility and Advanced View sizing without global micro-size inflation', () => {
    expect(themeCss).toMatch(/\.text-2xs \{[\s\S]*font-size: var\(--text-2xs\)/);
    expect(themeCss).not.toContain('html:not(.rtx-advanced-view) .rtx-app-shell :where(.text-\\[');
    expect(advancedCss).toMatch(/rtx-advanced-font-small[^}]*--rtx-advanced-primary-font-size: 13px;[^}]*--rtx-advanced-dense-font-size: 12px;[^}]*--rtx-advanced-header-font-size: 11px;/);
    expect(advancedCss).toMatch(/rtx-advanced-font-normal[^}]*--rtx-advanced-primary-font-size: 14px;[^}]*--rtx-advanced-dense-font-size: 13px;[^}]*--rtx-advanced-header-font-size: 12px;/);
    expect(advancedCss).toMatch(/rtx-advanced-font-large[^}]*--rtx-advanced-primary-font-size: 15px;[^}]*--rtx-advanced-dense-font-size: 14px;[^}]*--rtx-advanced-header-font-size: 13px;/);
    expect(advancedCss).toContain('font-size: var(--rtx-advanced-primary-font-size, 14px) !important;');
    expect(advancedCss).toContain('font-size: var(--rtx-advanced-dense-font-size, 13px) !important;');
    expect(advancedCss).toContain('font-size: var(--rtx-advanced-header-font-size, 12px) !important;');
    expect(advancedCss).not.toContain('font-size: 10.5px !important;');
    expect(advancedCss).toContain('.h-\\[24px\\]');
    expect(advancedCss).not.toContain('.h-\\\\[24px\\\\]');
    expect(topToolbarSource).toContain('syncAdvancedViewRootClasses(document.documentElement, advancedViewEnabled, advancedOptions);');
    expect(advancedViewRootClassesSource).toContain('setExclusiveClass(root, ADVANCED_VIEW_FONT_CLASSES, `rtx-advanced-font-${options.fontSize}`);');
    expect(advancedViewRootClassesSource).toContain("root.classList.toggle('rtx-advanced-focus-chart', enabled && options.focusChart);");
    expect(topToolbarSource).toContain("const ADVANCED_FONT_SIZES: readonly AdvancedFontSize[] = ['small', 'normal', 'large'];");
    expect(topToolbarSource).toContain('fontSize: isStoredOption(parsed?.fontSize, ADVANCED_FONT_SIZES)');
    expect(menuBarSource).toContain("label: 'Theme'");
    expect(menuBarSource).toContain("label: 'Dark Theme'");
    expect(menuBarSource).toContain("label: 'Light Theme'");
    expect(menuBarSource).toContain("label: 'Font Size'");
    expect(menuBarSource).toContain("label: 'Focus Chart'");
    expect(topToolbarSource).toContain('onSetAdvancedFontSize={(fontSize) => updateAdvancedOptions({ fontSize })}');
    expect(advancedCss).toContain('html.rtx-advanced-font-small {');
    expect(advancedCss).toContain('html.rtx-advanced-font-normal {');
    expect(advancedCss).toContain('html.rtx-advanced-font-large {');
    expect(advancedCss).toContain('.rtx-app-shell :where(');
    expect(advancedCss).toContain('.text-\\[14px\\],');
    expect(advancedCss).toContain('.text-\\[13px\\],');
    expect(advancedCss).toContain('.text-\\[12px\\],');
    expect(advancedCss).toContain('.rtx-chart-hud');
    expect(advancedCss).toContain('.rtx-status-bar');
    expect(advancedCss).toContain('.rtx-market-watch__column-heading');
  });

  it('locks the physically measured terminal chrome and chart HUD typography', () => {
    expect(topToolbarSource).toContain('rtx-toolbar-action rtx-toolbar-action--primary text-[13px] font-normal');
    expect(topToolbarSource).toContain('rtx-toolbar-action rtx-toolbar-action--last-symbol text-[13px] font-normal');
    expect(themeCss).toMatch(/\.rtx-toolbar-action \{[\s\S]*font-size: 13px;[\s\S]*font-weight: var\(--font-weight-normal\);/);
    expect(timeframePickerSource).toMatch(/text-\[13px\] font-normal font-segoe[\s\S]*\{option\.value\}/);
    expect(advancedCss).toContain('.rtx-timeframe-strip');
    expect(advancedCss).toContain('.rtx-timeframe-option[aria-checked="true"]');
    expect(tradingChartSource.match(/className="rtx-chart-hud"/g)).toHaveLength(2);
    expect(tradingChartSource).toContain("fontSize: 'var(--rtx-ui-font-size, 14px)'");
  });

  it('locks Market Watch, trade dock, status, and journal to measured reference roles', () => {
    expect(marketWatchSource).toMatch(/className="rtx-market-watch__symbol"[\s\S]*fontSize: 13,[\s\S]*fontWeight: 500/);
    expect(marketWatchSource).toMatch(/className="rtx-market-watch__column-heading"[\s\S]*fontSize: 12, fontWeight: 500/);
    expect(marketWatchSource).toContain('.rtx-market-watch .rtx-market-watch__price .price-big { font-size: inherit !important; font-weight: inherit !important; }');
    expect(advancedCss).toMatch(/\.text-\\\[14px\\\],[\s\S]*\.rtx-market-watch__symbol,[\s\S]*\.rtx-market-watch__daily,[\s\S]*font-size: var\(--rtx-advanced-primary-font-size, 14px\) !important;/);
    expect(advancedCss).toMatch(/\.text-\\\[13px\\\],[\s\S]*\.rtx-market-watch__column-heading,[\s\S]*font-size: var\(--rtx-advanced-dense-font-size, 13px\) !important;/);
    expect(bottomDockSource).toContain('rtx-trade-table__head sticky top-0');
    expect(bottomDockSource).toContain('font-normal text-[12px] leading-[18px]');
    expect(bottomDockSource).toContain('text-[13px] leading-[19.5px] font-normal');
    expect(indexCss).toMatch(/html \.rtx-trade-table tbody tr\.rtx-trade-row td\s*\{[^}]*font-size: 13px;[^}]*font-weight: var\(--font-weight-normal\);/);
    expect(indexCss).toMatch(/html:not\(\.rtx-skin-untitled-light\) \.rtx-trade-table tbody tr\.rtx-trade-row td\s*\{[^}]*line-height: 19\.5px;/);
    expect(statusBarSource).toContain('rtx-status-bar h-6');
    expect(statusBarSource).toContain('text-[13px] leading-[19.5px] font-normal');
    expect(journalSource).toContain('font-normal text-[12px] uppercase');
    expect(journalSource).toContain('text-[13px] leading-[19.5px] font-normal');
    expect(indexCss).toMatch(/html \.rtx-trade-table thead th,[\s\S]*?html \.rtx-trade-table__head th\s*\{[^}]*font-size: 12px;[^}]*font-weight: var\(--font-weight-normal\);/);
    expect(indexCss).toMatch(/html \.rtx-trade-footer \.rtx-trade-metric-label\s*\{[^}]*font-size: 13px;[^}]*font-weight: var\(--font-weight-normal\);/);
    expect(indexCss).toMatch(/html \.rtx-bottom-dock__tabs \.rtx-dock-tab\.active-tab\s*\{[^}]*font-weight: 600;/);
  });

  it('normalizes menus, floating panels, and secondary toolbox surfaces', () => {
    expect(fileMenuSource).toMatch(/min-h-\[30px\][^"`]*text-\[14px\][^"`]*font-normal/);
    expect(fileMenuSource).toMatch(/text-\[12px\][^"`]*font-normal/);
    expect(dockPanelSource).toMatch(/text-\[14px\][^"`]*font-normal[^"`]*leading-\[30px\]/);
    expect(contextMenuSource).toMatch(/text-\[12px\][^"`]*font-normal/);
    expect(bottomDockSource).toContain('text-[13px] leading-[19.5px] font-normal');
    expect(calendarSource).toMatch(/text-\[12px\][^"`]*leading-\[18px\]/);
    expect(calendarSource).toMatch(/text-\[13px\][^"`]*font-normal[^"`]*leading-\[19\.5px\]/);
    expect(researchSource).toMatch(/text-\[12px\][^"`]*leading-\[18px\]/);
    expect(researchSource).toMatch(/text-\[13px\][^"`]*font-normal[^"`]*leading-\[19\.5px\]/);
    expect(historyDownloaderSource).toMatch(/text-\[14px\][^"`]*font-normal/);
    expect(historyDownloaderSource).toContain('rtx-history-field-label');
    expect(historyDownloaderCss).toMatch(/\.rtx-history-field-label\s*\{[^}]*font-size: 10px;[^}]*font-weight: 600;/);
    expect(bottomDockSource).toContain('rtx-exposure-tab');
    expect(calendarSource).toContain('rtx-calendar-tab');
    expect(researchSource).toContain('rtx-research-tab');
    expect(historyDownloaderSource).toContain('rtx-history-downloader');
  });

  it('normalizes dense account, data, and market-depth panels without flattening actions', () => {
    expect(dataWindowSource).toContain("fontSize: 14, fontWeight: 400, lineHeight: '21px'");
    expect(dataWindowSource).toContain('minHeight: 24');
    expect(dataWindowSource).toContain('minWidth: 200');
    expect(depthOfMarketSource).toContain('rtx-depth-of-market__columns');
    expect(depthOfMarketSource).toContain('rtx-depth-of-market__heading');
    expect(depthOfMarketSource).toContain('ref={mainContentRef}');
    expect(depthOfMarketSource).toContain('height={mainContentHeight}');
    expect(appSource).toContain('Math.max(360, origW + dx)');
    expect(appSource).toContain('minWidth: 360');
    expect(accountPanelSource).toContain('text-[14px] leading-[21px] font-normal');
    expect(accountPanelSource).toContain('text-[12px] leading-[18px] font-normal');
    expect(accountPanelSource).toContain('text-[14px] leading-[21px] font-semibold');
    expect(themeCss).toMatch(/\.data-grid th \{[\s\S]*padding: 4px var\(--space-3\);/);
    expect(themeCss).toMatch(/\.data-grid td \{[\s\S]*padding: 4px var\(--space-3\);/);
  });

  it('keeps dialogs and responsive login states on the same hierarchy', () => {
    expect(orderDialogSource).toContain('rtx-order-dialog__label');
    expect(orderDialogCss).toMatch(/\.rtx-order-dialog__label\s*\{[^}]*font-size: 13px;[^}]*font-weight: var\(--font-weight-normal\);/);
    expect(orderDialogCss).toMatch(/\.rtx-order-dialog__margin\s*\{[^}]*font-size: 11px;/);
    expect(modifyDialogSource).toContain('text-[14px] font-normal');
    expect(modifyDialogSource).toContain('text-[12px] font-normal');
    expect(symbolsDialogSource).toContain('border-collapse text-[13px] font-normal');
    expect(symbolsDialogSource).toContain('text-[12px] font-normal');
    expect(optionsDialogSource).toContain('text-[14px] font-normal');
    expect(optionsDialogSource).toContain('text-[12px] font-normal');
    expect(openAccountDialogSource).toContain('text-[14px] font-normal');
    expect(openAccountDialogSource).toContain('rtx-reading-text');
    expect(loginDialogSource).toContain('rtx-login-label text-[14px] leading-5 font-medium');
    expect(loginDialogSource).toContain('rtx-dialog-title');
    expect(welcomeSource).toContain('fontSize: 14');
    expect(welcomeSource).toContain("fontWeight: 'var(--rtx-font-weight-body, 400)'");
  });

  it('keeps financial data tabular and preserves the system-mono stack for prices', () => {
    expect(themeCss).toContain("--font-mono: ui-monospace, 'Cascadia Mono', Consolas");
    expect(themeCss).toMatch(/\.font-mono \{[\s\S]*font-variant-numeric: tabular-nums slashed-zero/);
    expect(indexCss).toMatch(/input\[type="number"\],[\s\S]*input\[inputmode="decimal"\][\s\S]*font-family: var\(--font-mono\)/);
    expect(indexCss).not.toMatch(/input\[type="text"\],[\s\S]*font-family: var\(--font-mono\)/);
    expect(journalSource).toContain('rtx-journal-table');
    expect(lightCss).toMatch(/\.rtx-journal-table tbody td,[\s\S]*?font-variant-numeric: tabular-nums;/);
    expect(marketWatchSource).toContain("fontVariantNumeric: 'tabular-nums'");
    expect(bottomDockSource).toContain('tabular-nums');
    expect(advancedCss).toContain('.rtx-dom-dialog :where(.font-mono, input[type="number"], input[inputmode="decimal"])');
    expect(advancedCss).not.toMatch(/\.rtx-dom-dialog \* \{[\s\S]*?font-family:/);
  });

  it('does not flatten semantic emphasis through broad Advanced View color overrides', () => {
    const advancedGreenOverride = advancedCss.match(/\.text-\\\[\\#4ade80\\\],[\s\S]*?\.text-emerald-400 \{([\s\S]*?)\}/)?.[1] ?? '';
    const advancedRedOverride = advancedCss.match(/\.text-\\\[\\#f87171\\\],[\s\S]*?\.text-red-500 \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(advancedGreenOverride).toContain('color: #027a48 !important;');
    expect(advancedGreenOverride).not.toContain('font-weight');
    expect(advancedRedOverride).toContain('color: #b42318 !important;');
    expect(advancedRedOverride).not.toContain('font-weight');
  });

  it('does not request unsupported variable-font weights on the active login surface', () => {
    const cssWeights = Array.from(welcomeSource.matchAll(/font-weight:\s*(\d+)/g), match => Number(match[1]));
    const inlineWeights = Array.from(welcomeSource.matchAll(/fontWeight:\s*(\d+)/g), match => Number(match[1]));

    expect(Math.max(...cssWeights, ...inlineWeights)).toBeLessThanOrEqual(800);
  });
});
