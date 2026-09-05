import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const componentSource = readSource('src/components/layout/CalendarTab.tsx');
const calendarCss = readSource('src/styles/calendar-tab.css');
const indexCss = readSource('src/index.css');

describe('economic calendar presentation contract', () => {
  it('loads its isolated styles after the terminal theme layers', () => {
    const enterpriseThemeIndex = indexCss.indexOf('@import "./styles/enterprise-light.css";');
    const calendarStylesIndex = indexCss.indexOf('@import "./styles/calendar-tab.css";');

    expect(enterpriseThemeIndex).toBeGreaterThan(-1);
    expect(calendarStylesIndex).toBeGreaterThan(enterpriseThemeIndex);
  });

  it('uses semantic terminal tokens in both dark and light modes', () => {
    expect(calendarCss).toContain('--calendar-bg: var(--bg-secondary);');
    expect(calendarCss).toContain('--calendar-header: var(--bg-tertiary);');
    expect(calendarCss).toContain('--calendar-text: var(--text-primary);');
    expect(calendarCss).toContain('color-scheme: dark;');
    expect(calendarCss).toMatch(/html\.rtx-skin-untitled-light \.rtx-calendar-tab,[\s\S]*?color-scheme: light;/);

    expect(componentSource).not.toMatch(/(?:bg|text|border)-(?:gray|zinc)-/);
    expect(componentSource).not.toContain('border-r ');
    expect(componentSource).not.toContain('shadow-xl');
    expect(componentSource).not.toContain('tracking-wider');
  });

  it('keeps a solid high-contrast table with horizontal rules only', () => {
    expect(calendarCss).toContain('border-right: none !important;');
    expect(calendarCss).toMatch(/\.rtx-calendar-tab tbody td \{[\s\S]*border-bottom: 1px solid var\(--calendar-border\) !important;/);
    expect(calendarCss).toMatch(/html:not\(\.rtx-skin-untitled-light\) \.rtx-calendar-tab,[\s\S]*background: var\(--bg-secondary\) !important;/);
    expect(calendarCss).toMatch(/html:not\(\.rtx-skin-untitled-light\) \.rtx-calendar-tab__head th \{[\s\S]*background: var\(--bg-tertiary\) !important;/);
    expect(calendarCss).toContain('backdrop-filter: none !important;');
  });

  it('adapts the event grid to narrow dock widths', () => {
    expect(calendarCss).toContain('container-type: inline-size;');
    expect(calendarCss).toContain('@container (max-width: 920px)');
    expect(calendarCss).toContain('@container (max-width: 710px)');
    expect(calendarCss).toContain('@container (max-width: 520px)');
  });
});
