import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const componentSource = readSource('src/components/HistoryDownloader.tsx');
const historyCss = readSource('src/styles/history-downloader.css');
const indexCss = readSource('src/index.css');

describe('historical data manager presentation contract', () => {
  it('loads its isolated styles after the terminal theme layers', () => {
    const enterpriseThemeIndex = indexCss.indexOf('@import "./styles/enterprise-light.css";');
    const historyStylesIndex = indexCss.indexOf('@import "./styles/history-downloader.css";');

    expect(enterpriseThemeIndex).toBeGreaterThan(-1);
    expect(historyStylesIndex).toBeGreaterThan(enterpriseThemeIndex);
  });

  it('uses semantic terminal tokens in both dark and light modes', () => {
    expect(historyCss).toContain('--history-bg: var(--bg-primary);');
    expect(historyCss).toContain('--history-panel: var(--bg-secondary);');
    expect(historyCss).toContain('--history-text: var(--text-primary);');
    expect(historyCss).toContain('color-scheme: dark;');
    expect(historyCss).toMatch(/html\.rtx-skin-untitled-light \.rtx-history-downloader,[\s\S]*?color-scheme: light;/);

    expect(componentSource).not.toMatch(/(?:bg|text|border)-(?:gray|zinc)-/);
    expect(componentSource).not.toContain('bg-zinc-8000');
  });

  it('adapts the manager to narrow dock and floating-panel widths', () => {
    expect(historyCss).toContain('container-type: inline-size;');
    expect(historyCss).toContain('@container (max-width: 920px)');
    expect(historyCss).toContain('@container (max-width: 710px)');
    expect(historyCss).toContain('@container (max-width: 520px)');
  });
});
