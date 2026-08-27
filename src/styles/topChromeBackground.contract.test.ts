import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const themeCss = readSource('src/styles/theme.css');
const topToolbarSource = readSource('src/components/layout/TopToolbar.tsx');

describe('terminal top chrome background contract', () => {
  it('uses the shared panel surface instead of the blue glass backdrop', () => {
    expect(topToolbarSource).toContain('className="rtx-top-chrome flex flex-col');
    expect(topToolbarSource).not.toMatch(/rtx-top-chrome[^\"]*bg-slate-950\/20/);
    expect(topToolbarSource).not.toMatch(/rtx-top-chrome[^\"]*backdrop-blur/);
    expect(themeCss).toMatch(/\.rtx-top-chrome\s*\{[^}]*background: var\(--bg-secondary\);/);
    expect(themeCss).toMatch(/--bg-secondary:\s*#131316;/);
  });
});
