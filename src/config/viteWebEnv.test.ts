import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWebBrokerEnvironment } from '../../viteWebEnv';

const directories: string[] = [];
const fixture = (source: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'rtx-web-env-test-'));
  directories.push(directory);
  writeFileSync(join(directory, '.env.web'), source);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), 'rtx-web-env-test-'))) throw new Error('Unexpected test directory');
    rmSync(directory, { recursive: true, force: true });
  }
});
const selected = { VITE_BROKER_ID: 'achiever-financials', VITE_BACKEND_URL: 'https://service.achieverfinancials.com' };

describe('one active broker block', () => {
  it.each(['API_HOST', 'API_URL', 'BACKEND_URL', 'RTX5_API_URL', 'API_V2_URL', 'FIX_API_URL'])('accepts unprefixed %s consistently with runtime configuration', key => {
    const config = { BROKER_ID: 'never-seen-before', [key]: 'https://unrelated.example' };
    expect(() => validateWebBrokerEnvironment(config, fixture('BROKER_ID=never-seen-before'))).not.toThrow();
  });
  it('does not revive a VITE_ broker ID or origin when the primary setting is explicitly empty', () => {
    const directory = fixture('BROKER_ID=');
    expect(() => validateWebBrokerEnvironment({ ...selected, BROKER_ID: '' }, directory)).toThrow('No complete web broker');
    expect(() => validateWebBrokerEnvironment({ ...selected, API_HOST: '' }, directory)).toThrow('No complete web broker');
  });
  it('accepts an uncommented broker beside commented alternatives', () => {
    expect(() => validateWebBrokerEnvironment(selected, fixture('# VITE_BROKER_ID=TEST\nVITE_BROKER_ID=achiever-financials\n'))).not.toThrow();
  });
  it('rejects two active blocks instead of mixing one broker ID with another host', () => {
    const directory = fixture('VITE_BROKER_ID=TEST\nVITE_BROKER_ID=achiever-financials\n');
    expect(() => validateWebBrokerEnvironment(selected, directory)).toThrow('Uncomment only one broker block');
  });
  it('reports duplicate key locations without revealing credentials', () => {
    const directory = fixture('VITE_API_HOST=first-secret\nVITE_API_HOST=second-secret');
    expect(() => validateWebBrokerEnvironment(selected, directory)).toThrow('lines 1 and 2');
    try { validateWebBrokerEnvironment(selected, directory); } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
  it('permits an intentional override in the mode-local file', () => {
    const directory = fixture('VITE_BROKER_ID=TEST');
    writeFileSync(join(directory, '.env.web.local'), 'VITE_BROKER_ID=achiever-financials');
    expect(() => validateWebBrokerEnvironment(selected, directory)).not.toThrow();
  });
  it('rejects an empty selection without exposing a fallback broker', () => {
    expect(() => validateWebBrokerEnvironment({}, fixture('# VITE_BROKER_ID=TEST'))).toThrow('No complete web broker');
  });
});
