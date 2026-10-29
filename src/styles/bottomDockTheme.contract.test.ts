import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const indexCss = readSource('src/index.css');
const themeCss = readSource('src/styles/theme.css');
const exposureSource = readSource('src/features/bottom-dock/exposure/ExposureTab.tsx');

describe('bottom dock dark surface contract', () => {
  it('uses the same solid panel token as the rest of the web terminal', () => {
    expect(themeCss).toMatch(/--bg-secondary:\s*#131316;/);
    expect(indexCss).toMatch(
      /html:not\(\.rtx-skin-untitled-light\) :is\(\.rtx-bottom-dock, \.rtx-bottom-dock__content\) \{[^}]*background: var\(--bg-secondary\) !important;/,
    );
    expect(indexCss).not.toMatch(
      /\.rtx-panel-shell, \.rtx-chart-panel, \.rtx-bottom-dock, \.rtx-bottom-dock__content/,
    );
  });

  it('keeps the trade grid on the shared neutral surface hierarchy', () => {
    expect(indexCss).toMatch(/\.rtx-trade-tab \{[^}]*background: var\(--bg-secondary\) !important;/);
    expect(indexCss).toMatch(/\.rtx-trade-scroll \{[^}]*background: var\(--bg-secondary\)(?: !important)?;/);
    expect(indexCss).toMatch(/\.rtx-trade-table__head th \{[^}]*background: var\(--bg-tertiary\) !important;/);
    expect(indexCss).toMatch(/\.rtx-trade-table tbody tr\.rtx-trade-row \{[^}]*background: var\(--bg-secondary\) !important;/);
    expect(indexCss).toMatch(/\.rtx-trade-row:not\(\.rtx-trade-row--selected\):hover \{[^}]*background: var\(--bg-quaternary\) !important;/);
  });

  it('matches the footer and bottom tabs to the same app palette', () => {
    expect(indexCss).toMatch(/\.rtx-trade-footer \{[^}]*background: var\(--bg-tertiary\) !important;/);
    expect(indexCss).toMatch(/\.rtx-panel-shell:has\(\.rtx-bottom-dock\),[\s\S]*border-radius: 0 !important;/);
    expect(indexCss).toMatch(/\.rtx-bottom-dock__tabs \{[^}]*background: var\(--bg-tertiary\) !important;/);
    expect(indexCss).toMatch(/\.rtx-dock-tab\.active-tab \{[^}]*background: linear-gradient\(180deg, #0284c7 0%, #0369a1 100%\) !important;/);
  });

  it('keeps the trade dock solid, unshaded, and high-contrast like a terminal', () => {
    expect(indexCss).toMatch(
      /html:not\(\.rtx-skin-untitled-light\) :is\(\.rtx-bottom-dock, \.rtx-bottom-dock__content\) \{[^}]*backdrop-filter: none !important;/,
    );
    expect(indexCss).toMatch(
      /html:not\(\.rtx-skin-untitled-light\) :is\(\.rtx-bottom-dock, \.rtx-bottom-dock__content\) \{[^}]*box-shadow: none !important;/,
    );
    expect(indexCss).toMatch(/\.rtx-trade-table__head th \{[^}]*color: var\(--text-primary\) !important;/);
    expect(indexCss).toMatch(
      /\.rtx-trade-table tbody tr\.rtx-trade-row:not\(\.rtx-trade-row--selected\) \{[^}]*color: var\(--text-primary\);/,
    );
    expect(indexCss).toMatch(/\.rtx-trade-footer \{[^}]*box-shadow: none !important;/);
    expect(indexCss).toMatch(/\.rtx-trade-footer \.rtx-trade-metric-label[\s\S]*?color: var\(--text-primary\) !important;/);
    expect(indexCss).toMatch(
      /\.rtx-trade-footer-metric,[\s\S]*?\.rtx-trade-footer-floating \{[^}]*background: transparent !important;[^}]*border: none !important;/,
    );
    expect(indexCss).toMatch(/\.rtx-trade-metric-label::after \{[^}]*content: ':';/);
    expect(indexCss).toMatch(/\.rtx-trade-footer-inner \{[^}]*gap: 0 !important;/);
    expect(indexCss).toMatch(/\.rtx-trade-footer-metrics \{[^}]*gap: 16px !important;/);
    expect(indexCss).toMatch(
      /\.rtx-trade-footer-floating--profit \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/,
    );
    expect(indexCss).toMatch(
      /\.rtx-trade-footer-currency \{[^}]*display: inline-block;[^}]*margin-left: 4px;[^}]*position: static;/,
    );
    expect(indexCss).toMatch(/\.rtx-exposure-account-bar \{[\s\S]*background: var\(--bg-tertiary\);/);
    expect(exposureSource).toContain('Balance:');
    expect(indexCss).toMatch(
      /\.rtx-trade-table tbody tr\.rtx-trade-row td \{[^}]*border-bottom: 1px solid var\(--border-secondary\) !important;/,
    );
    expect(indexCss).toMatch(
      /\.rtx-trade-table tbody tr\.rtx-trade-row td \{[^}]*border-right: none !important;/,
    );
  });

  it('keeps Market Watch solid and high-contrast without grid lines', () => {
    expect(indexCss).toMatch(
      /html:not\(\.rtx-skin-untitled-light\) \.rtx-market-watch,[\s\S]*?background: var\(--bg-secondary\) !important;/,
    );
    expect(indexCss).toMatch(/\.rtx-market-watch__column-heading \{[^}]*background: var\(--bg-secondary\) !important;/);
    expect(indexCss).toMatch(/\.rtx-market-watch__column-heading \{[^}]*color: var\(--text-primary\) !important;/);
    expect(indexCss).toMatch(/\.rtx-market-watch tbody td[\s\S]*?border: none !important;/);
    expect(indexCss).not.toMatch(
      /\.rtx-market-watch tbody td[^}]*border-bottom: 1px solid/,
    );
  });

  it('keeps the Navigator on the same solid high-contrast surface as Market Watch', () => {
    expect(indexCss).toMatch(/\.navigator-panel,[\s\S]*?\.navigator-panel__body \{[^}]*background: var\(--bg-secondary\) !important;/);
    expect(indexCss).toMatch(/\.navigator-tree-item__label \{[^}]*color: var\(--text-primary\) !important;/);
  });

  it('enforces horizontal row dividers without vertical column borders from Trade to Historical Data', () => {
    const historySource = readSource('src/features/bottom-dock/history/HistoryTab.tsx');
    const toolboxSource = readSource('src/features/bottom-dock/toolbox/ToolboxTab.tsx');
    const historyDownloaderCss = readSource('src/styles/history-downloader.css');
    const lightCss = readSource('src/styles/enterprise-light.css');

    expect(historySource).not.toContain('border-r border-zinc-800');
    expect(exposureSource).not.toContain('border-r border-zinc-800/80');
    expect(toolboxSource).toContain('rtx-toolbox-row');
    expect(indexCss).toMatch(
      /\.rtx-bottom-dock :is\(\.rtx-trade-table, \.rtx-history-table, \.rtx-exposure-tab table, \.rtx-pending-orders-table, \.rtx-journal-table\)[\s\S]*?border-left: none !important;[\s\S]*?border-right: none !important;[\s\S]*?border-bottom: 1px solid var\(--border-secondary\) !important;/,
    );
    expect(lightCss).toMatch(
      /\.rtx-bottom-dock :is\(\.rtx-trade-table, \.rtx-history-table, \.rtx-exposure-tab table, \.rtx-pending-orders-table, \.rtx-journal-table\)[\s\S]*?border-left: none !important;[\s\S]*?border-right: none !important;[\s\S]*?border-bottom: 1px solid var\(--rtx-light-line-border, #64748b\) !important;/,
    );
    expect(historyDownloaderCss).toMatch(/\.rtx-history-downloader__metrics > div \{[^}]*border-left: none;/);
    expect(historyDownloaderCss).toMatch(/\.rtx-history-symbol-row \{[^}]*border-left: none;[^}]*border-right: none;[^}]*border-bottom: 1px solid var\(--history-border\);/);
  });
});
