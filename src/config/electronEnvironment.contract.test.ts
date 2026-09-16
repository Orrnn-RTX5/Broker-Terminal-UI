import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readEnv = (name: string): Record<string, string> => Object.fromEntries(
  readFileSync(resolve(process.cwd(), name), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

describe('Electron broker directory environment', () => {
  it('uses desktop selection with the real superadmin directory', () => {
    const electron = readEnv('.env.electron');

    expect(electron.BACKEND_TARGET).toBe('electron');
    expect(electron.VITE_BACKEND_TARGET).toBe('electron');
    expect(electron.VITE_BACKEND_MODE).toBe('electron');
    expect(electron.VITE_USE_MOCK_DISCOVERY).toBe('false');
    expect(electron.VITE_BROKER_DISCOVERY_URL).toBe('https://fxtrustsuperbackned.orrnn.com');
    expect(electron.VITE_DISCOVERY_BASE_URL).toBe(electron.VITE_BROKER_DISCOVERY_URL);
    expect(electron.VITE_EXTRA_BROKER_DISCOVERY_URLS).toBe('https://superbackend.orrnn.com');
  });
});
