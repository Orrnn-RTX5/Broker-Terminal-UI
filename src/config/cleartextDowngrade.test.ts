import { describe, expect, it } from 'vitest';
import { isCleartextDowngradeAllowedHost } from './api';

/**
 * Regression guard for webterminal-ui-F05.
 *
 * The opt-in FORCE_HTTP_ONLY https->http downgrade is only safe for
 * loopback / RFC1918 / link-local hosts. A public broker host must NEVER be
 * eligible for cleartext downgrade. This predicate is the single source of
 * truth consulted by BOTH config/api.ts and services/brokerSession.ts.
 */
describe('isCleartextDowngradeAllowedHost', () => {
  it('allows loopback and localhost', () => {
    expect(isCleartextDowngradeAllowedHost('127.0.0.1')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('localhost')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('app.localhost')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('::1')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('0.0.0.0')).toBe(true);
  });

  it('allows RFC1918 / link-local IPv4 ranges', () => {
    expect(isCleartextDowngradeAllowedHost('10.0.0.5')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('172.16.4.4')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('172.31.255.255')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('192.168.1.10')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('169.254.1.1')).toBe(true);
  });

  it('allows IPv6 ULA / link-local', () => {
    expect(isCleartextDowngradeAllowedHost('fc00::1')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('fd12:3456::1')).toBe(true);
    expect(isCleartextDowngradeAllowedHost('fe80::1')).toBe(true);
  });

  it('REFUSES public hostnames (the F05 defect)', () => {
    expect(isCleartextDowngradeAllowedHost('testbrokerbackend.orrnn.com')).toBe(false);
    expect(isCleartextDowngradeAllowedHost('services.myprop.trade')).toBe(false);
    expect(isCleartextDowngradeAllowedHost('example.com')).toBe(false);
  });

  it('REFUSES publicly-routable IPv4', () => {
    expect(isCleartextDowngradeAllowedHost('103.91.186.142')).toBe(false);
    expect(isCleartextDowngradeAllowedHost('8.8.8.8')).toBe(false);
    expect(isCleartextDowngradeAllowedHost('172.15.0.1')).toBe(false); // just outside 172.16/12
    expect(isCleartextDowngradeAllowedHost('172.32.0.1')).toBe(false); // just outside 172.16/12
    expect(isCleartextDowngradeAllowedHost('192.169.0.1')).toBe(false);
  });

  it('handles empty / bracketed input', () => {
    expect(isCleartextDowngradeAllowedHost('')).toBe(false);
    expect(isCleartextDowngradeAllowedHost('[::1]')).toBe(true);
  });
});
