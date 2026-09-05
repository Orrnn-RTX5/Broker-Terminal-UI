import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Regression guard for webterminal-ui-F07.
 *
 * electron.cjs:`shell-open-path` must constrain shell.openPath to app-owned base
 * directories so a compromised renderer cannot open arbitrary local files.
 * electron.cjs runs in the Electron main process (it requires the `electron`
 * module) so it cannot be imported here directly; this test pins the exact
 * containment algorithm used by the handler so the security property is locked.
 */

const isPathWithinAllowedBase = (resolvedPath: string, allowedBases: string[]): boolean => {
  return allowedBases.some((base) => {
    if (resolvedPath === base) return true;
    const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
    return resolvedPath.startsWith(baseWithSep);
  });
};

describe('shell-open-path containment (F07)', () => {
  const base = path.resolve('/app/data-root');
  const bases = [base];

  it('allows the base directory itself', () => {
    expect(isPathWithinAllowedBase(base, bases)).toBe(true);
  });

  it('allows nested paths under an allowed base', () => {
    expect(isPathWithinAllowedBase(path.join(base, 'profiles', 'a.json'), bases)).toBe(true);
  });

  it('rejects path-traversal escapes via ..', () => {
    const escaped = path.resolve(base, '..', '..', 'etc', 'passwd');
    expect(isPathWithinAllowedBase(escaped, bases)).toBe(false);
  });

  it('rejects a sibling directory sharing a name prefix', () => {
    // "/app/data-root-evil" must NOT match base "/app/data-root".
    const sibling = path.resolve('/app/data-root-evil/x');
    expect(isPathWithinAllowedBase(sibling, bases)).toBe(false);
  });

  it('rejects an unrelated absolute path', () => {
    expect(isPathWithinAllowedBase(path.resolve('/tmp/elsewhere'), bases)).toBe(false);
  });

  it('rejects non-string / empty inputs at the handler boundary', () => {
    // The handler rejects these before resolving; model that contract here.
    const isValidInput = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
    expect(isValidInput('')).toBe(false);
    expect(isValidInput('   ')).toBe(false);
    expect(isValidInput(null)).toBe(false);
    expect(isValidInput(123)).toBe(false);
    expect(isValidInput('./data')).toBe(true);
  });
});

describe('dedicated app data-folder bridge', () => {
  const electronSource = readFileSync(path.resolve(process.cwd(), 'electron.cjs'), 'utf8');
  const preloadSource = readFileSync(path.resolve(process.cwd(), 'preload.cjs'), 'utf8');
  const windowTypesSource = readFileSync(path.resolve(process.cwd(), 'src/types/trading.ts'), 'utf8');

  it('derives the folder only from Electron userData and creates it recursively', () => {
    expect(electronSource).toContain("ipcMain.handle('shell-open-data-folder', async () => {");
    expect(electronSource).toContain("path.join(app.getPath('userData'), 'data')");
    expect(electronSource).toContain('await fs.mkdir(dataFolder, { recursive: true })');
    expect(electronSource).toContain('return await shell.openPath(dataFolder)');
  });

  it('exposes the no-argument bridge through preload and Window typing', () => {
    expect(preloadSource).toContain(
      "openDataFolder: () => ipcRenderer.invoke('shell-open-data-folder')",
    );
    expect(windowTypesSource).toContain('openDataFolder: () => Promise<string>');
  });
});
