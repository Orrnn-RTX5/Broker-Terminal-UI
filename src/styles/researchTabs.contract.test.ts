import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const componentSource = readSource('src/components/layout/ResearchTabs.tsx');
const researchCss = readSource('src/styles/research-tabs.css');
const indexCss = readSource('src/index.css');

describe('research tabs presentation contract', () => {
  it('loads its isolated styles after the terminal theme layers', () => {
    const enterpriseThemeIndex = indexCss.indexOf('@import "./styles/enterprise-light.css";');
    const researchStylesIndex = indexCss.indexOf('@import "./styles/research-tabs.css";');

    expect(enterpriseThemeIndex).toBeGreaterThan(-1);
    expect(researchStylesIndex).toBeGreaterThan(enterpriseThemeIndex);
    expect(indexCss).not.toContain('@import "./styles/articles-tab.css";');
  });

  it('uses semantic terminal tokens in both dark and light modes', () => {
    expect(researchCss).toContain('--research-bg: var(--bg-secondary);');
    expect(researchCss).toContain('--research-header: var(--bg-tertiary);');
    expect(researchCss).toContain('--research-text: var(--text-primary);');
    expect(researchCss).toContain('color-scheme: dark;');
    expect(researchCss).toMatch(/html\.rtx-skin-untitled-light :is\(\.rtx-articles-tab, \.rtx-codebase-tab, \.rtx-experts-tab\),[\s\S]*?color-scheme: light;/);

    expect(componentSource).toContain('rtx-research-tab');
    expect(componentSource).toContain('rtx-articles-tab');
    expect(componentSource).toContain('rtx-codebase-tab');
    expect(componentSource).toContain('rtx-experts-tab');
  });

  it('positions Experts type, rating, date, and price columns with structured widths and alignment', () => {
    expect(researchCss).toMatch(/\.rtx-experts-tab__col--type \{[\s\S]*?width:\s*11%;/);
    expect(researchCss).toMatch(/\.rtx-experts-tab__col--price \{[\s\S]*?width:\s*9%;/);
  });

  it('left-aligns headers with their row values and structures table columns across the dock', () => {
    expect(researchCss).toContain('text-align: left !important;');
    expect(researchCss).toContain('table-layout: fixed;');
    expect(researchCss).toMatch(/\.rtx-codebase-tab__col--category \{[\s\S]*?width:\s*15%;/);
    expect(researchCss).toMatch(/\.rtx-codebase-tab__col--date \{[\s\S]*?width:\s*12%;/);
  });

  it('keeps a solid high-contrast table with horizontal rules only', () => {
    expect(researchCss).toContain('border-right: none !important;');
    expect(researchCss).toMatch(/:is\(\.rtx-articles-tab, \.rtx-codebase-tab, \.rtx-experts-tab\) tbody td \{[\s\S]*border-bottom: 1px solid var\(--research-border\) !important;/);
    expect(researchCss).toMatch(/html:not\(\.rtx-skin-untitled-light\) :is\(\.rtx-articles-tab, \.rtx-codebase-tab, \.rtx-experts-tab\),[\s\S]*background: var\(--bg-secondary\) !important;/);
    expect(researchCss).toMatch(/html:not\(\.rtx-skin-untitled-light\) :is\(\.rtx-articles-tab, \.rtx-codebase-tab, \.rtx-experts-tab\) thead th \{[\s\S]*background: var\(--bg-tertiary\) !important;/);
    expect(researchCss).toContain('backdrop-filter: none !important;');
  });

  it('adapts the research grids to narrow dock widths', () => {
    expect(researchCss).toContain('container-type: inline-size;');
    expect(researchCss).toContain('@container (max-width: 920px)');
    expect(researchCss).toContain('@container (max-width: 710px)');
    expect(researchCss).toContain('@container (max-width: 520px)');
  });
});
