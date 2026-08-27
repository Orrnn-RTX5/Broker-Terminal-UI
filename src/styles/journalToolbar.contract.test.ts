import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const journalSource = readSource('src/components/layout/JournalTab.tsx');
const indexCss = readSource('src/index.css');

describe('Journal toolbar visual contract', () => {
  it('keeps the toolbar and its controls at readable desktop sizes', () => {
    expect(journalSource).toContain('rtx-journal-toolbar flex min-h-[42px]');
    expect(journalSource).toContain('rtx-journal-control h-7 min-w-[94px]');
    expect(journalSource).toContain('rtx-journal-control h-7 min-w-[112px]');
    expect(journalSource).toContain('rtx-journal-control h-7 w-full');
  });

  it('uses squared corners and an inset focus treatment instead of an outer ring', () => {
    expect(indexCss).toMatch(/html \.rtx-journal-toolbar \.rtx-journal-control\s*\{[^}]*border-radius: 2px !important;/);
    expect(indexCss).toMatch(/\.rtx-journal-toolbar button\.rtx-journal-control:active\s*\{[^}]*transform: none;/);
    expect(indexCss).toMatch(/\.rtx-journal-control:focus-visible\s*\{[^}]*outline: none !important;[^}]*outline-offset: 0 !important;[^}]*box-shadow: inset/);
    expect(indexCss).toMatch(/\.rtx-journal-auto\[aria-pressed="true"\]\s*\{[^}]*background: #f4ebff !important;/);
  });
});
