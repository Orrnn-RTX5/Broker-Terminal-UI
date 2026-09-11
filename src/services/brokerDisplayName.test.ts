import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brokerDisplayName } from './brokerDisplayName';
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllEnvs());
describe('broker display labels', () => {
  it('uses the configured full name for an older matching saved session only', () => {
    vi.stubEnv('VITE_BACKEND_URL', 'https://service.achieverfinancials.com');
    vi.stubEnv('VITE_DEFAULT_MT5_SERVER', 'Achiever Financials');
    expect(brokerDisplayName('https://service.achieverfinancials.com', 'Broker')).toBe('Achiever Financials');
    expect(brokerDisplayName('https://other.example')).toBe('Broker');
  });
  it('uses the full directory name for a URL without needing a logo', () => {
    expect(brokerDisplayName('https://service.achieverfinancials.com', 'Achiever Financials')).toBe('Achiever Financials');
  });
  it('uses matching stored session metadata with normalized trailing slashes', () => {
    localStorage.setItem('server_url', 'https://service.achieverfinancials.com/');
    localStorage.setItem('broker_name', 'Achiever Financials');
    expect(brokerDisplayName('https://service.achieverfinancials.com')).toBe('Achiever Financials');
  });
  it('never applies one broker name to a different saved broker', () => {
    localStorage.setItem('server_url', 'https://first.example');
    localStorage.setItem('broker_name', 'First Broker');
    expect(brokerDisplayName('https://second.example')).toBe('Broker');
    expect(brokerDisplayName('https://second.example', 'Second Broker')).toBe('Second Broker');
  });
  it('does not display URL-shaped name metadata and preserves existing named servers', () => {
    expect(brokerDisplayName('https://broker.example', 'https://broker.example')).toBe('Broker');
    expect(brokerDisplayName('Named Broker')).toBe('Named Broker');
  });
});
