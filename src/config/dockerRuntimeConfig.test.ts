import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWebRuntimeConfig, renderWebRuntimeConfig } from '../../viteWebRuntimeConfig';

const directories: string[] = [];
const shell = process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe')
  : '/bin/sh';
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), 'rtx-docker-env-test-'))) throw new Error('Unexpected test directory');
    rmSync(directory, { recursive: true, force: true });
  }
});

const generate = (overrides: Record<string, string> = {}) => {
  const directory = mkdtempSync(join(tmpdir(), 'rtx-docker-env-test-'));
  directories.push(directory);
  const path = join(directory, 'runtime-config.js');
  const built = renderWebRuntimeConfig(createWebRuntimeConfig({
    VITE_BROKER_ID: 'TEST', VITE_BACKEND_URL: 'https://fxtrustbrokerbackend.orrnn.com',
  }));
  writeFileSync(path, built);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VITE_|BACKEND_|API_|WS_|BROKER_|FEED_|DISCOVERY_|DEFAULT_MT5_|SHARED_DISCOVERY_|USE_MOCK_)/.test(key)));
  execFileSync(shell, [resolve('docker-entrypoint.sh').replace(/\\/g, '/')], {
    env: { ...env, NGINX_HTML_DIR: directory.replace(/\\/g, '/'), ...overrides },
    encoding: 'utf8', timeout: 10000,
  });
  return { built, source: readFileSync(path, 'utf8') };
};

describe.skipIf(!existsSync(shell))('container broker environment', () => {
  it('preserves the .env.web build when no broker override is supplied', () => {
    const { built, source } = generate();
    expect(source).toBe(built);
  });
  it('sets complete broker identity for an explicit deployment override', () => {
    const { source } = generate({
      BROKER_ID: 'achiever-financials', API_HOST: 'https://service.achieverfinancials.com',
      WS_HOST: 'wss://service.achieverfinancials.com', DEFAULT_MT5_SERVER: 'Achiever Financials',
    });
    const runtimeWindow: Record<string, any> = { location: { protocol: 'https:' } };
    new Function('window', 'navigator', source)(runtimeWindow, { userAgent: 'Mozilla/5.0' });
    expect(runtimeWindow.RUNTIME_CONFIG).toMatchObject({
      BROKER_ID: 'achiever-financials', VITE_BROKER_ID: 'achiever-financials', FEED_BROKER_ID: 'achiever-financials',
      API_HOST: 'https://service.achieverfinancials.com', DEFAULT_MT5_SERVER: 'Achiever Financials',
    });
    runtimeWindow.location.protocol = 'file:';
    runtimeWindow.RUNTIME_CONFIG = { selectedByDesktop: true };
    new Function('window', 'navigator', source)(runtimeWindow, { userAgent: 'Electron' });
    expect(runtimeWindow.RUNTIME_CONFIG).toEqual({ selectedByDesktop: true });
  });
});
