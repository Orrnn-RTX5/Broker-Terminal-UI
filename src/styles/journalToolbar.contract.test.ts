import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const journalSource = readSource('src/components/layout/JournalTab.tsx');
const indexCss = readSource('src/index.css');

describe('Journal toolbar visual contract', () => {
  it('uses the same compact terminal geometry as the History reference', () => {
    expect(journalSource).toContain('flex h-[31px] min-h-[31px]');
    expect(journalSource).toContain('rtx-journal-control h-7 min-w-[94px]');
    expect(journalSource).toContain('rtx-journal-control h-7 min-w-[112px]');
    expect(journalSource).toContain('rtx-journal-control h-7 w-full');
    expect(journalSource).toContain("{ label: '1h', hours: 1 }");
    expect(journalSource).toContain("{ label: '2h', hours: 2 }");
    expect(journalSource).toContain("{ label: '3h', hours: 3 }");
    expect(journalSource).toContain("{ label: 'Today', hours: 24 }");
    expect(journalSource).toContain("{ label: 'All', hours: 0 }");
    expect(journalSource).toContain('rtx-journal-table__head sticky top-0');
  });

  it('uses squared corners and an inset focus treatment instead of an outer ring', () => {
    expect(indexCss).toMatch(/html \.rtx-journal-toolbar \.rtx-journal-control\s*\{[^}]*border-radius: 2px !important;/);
    expect(indexCss).toMatch(/\.rtx-journal-toolbar button\.rtx-journal-control:active\s*\{[^}]*transform: none;/);
    expect(indexCss).toMatch(/\.rtx-journal-control:focus-visible\s*\{[^}]*outline: none !important;[^}]*outline-offset: 0 !important;[^}]*box-shadow: inset/);
    expect(indexCss).toMatch(/\.rtx-journal-auto\[aria-pressed="true"\]\s*\{[^}]*background: #f4ebff !important;/);
  });
});
