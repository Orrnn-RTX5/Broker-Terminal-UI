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

describe('Electron GTA environment', () => {
  it('builds the desktop bundle against GTA while retaining shared discovery', () => {
    const electron = readEnv('.env.electron');

    expect({
      BACKEND_TARGET: electron.BACKEND_TARGET,
      VITE_BACKEND_TARGET: electron.VITE_BACKEND_TARGET,
      VITE_BACKEND_MODE: electron.VITE_BACKEND_MODE,
      VITE_BACKEND_URL: electron.VITE_BACKEND_URL,
      VITE_API_URL: electron.VITE_API_URL,
      VITE_WS_URL: electron.VITE_WS_URL,
      VITE_MARKET_WS_URL: electron.VITE_MARKET_WS_URL,
      VITE_BROKER_DISCOVERY_URL: electron.VITE_BROKER_DISCOVERY_URL,
      VITE_DISCOVERY_BASE_URL: electron.VITE_DISCOVERY_BASE_URL,
      VITE_BROKER_ID: electron.VITE_BROKER_ID,
      VITE_FEED_BROKER_ID: electron.VITE_FEED_BROKER_ID,
      VITE_USE_MOCK_DISCOVERY: electron.VITE_USE_MOCK_DISCOVERY,
    }).toEqual({
      BACKEND_TARGET: 'electron',
      VITE_BACKEND_TARGET: 'electron',
      VITE_BACKEND_MODE: 'electron',
      VITE_BACKEND_URL: 'https://services.growtradingacademy.com',
      VITE_API_URL: 'https://services.growtradingacademy.com',
      VITE_WS_URL: 'wss://services.growtradingacademy.com/ws/v2',
      VITE_MARKET_WS_URL: 'wss://services.growtradingacademy.com/ws/v2',
      VITE_BROKER_DISCOVERY_URL: 'https://superbackend.orrnn.com',
      VITE_DISCOVERY_BASE_URL: 'https://superbackend.orrnn.com',
      VITE_BROKER_ID: 'gta_broker',
      VITE_FEED_BROKER_ID: 'gta_broker',
      VITE_USE_MOCK_DISCOVERY: 'false',
    });
  });

  it('keeps the GTA feed credential independent from the web deployment', () => {
    const electron = readEnv('.env.electron');
    const hasElectronToken = Boolean(electron.VITE_FEED_BROKER_TOKEN);

    expect(hasElectronToken).toBe(true);
  });
});
