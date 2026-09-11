import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n, { i18nReady } from '../i18n';
import { getDesktopReleaseButtonTitle, FALLBACK_DESKTOP_RELEASE } from '../services/desktopRelease';
import { resolveDesktopToolbarStatus } from '../components/layout/desktopToolbarStatus';
import { getMarketStatusTradeBlockMessage, normalizeMarketStatus } from './marketStatus';

const germanCopy = {
  'Market is closed for {{value0}}.': 'Der Markt für {{value0}} ist geschlossen.',
  '{{value0}} live feed verified': 'Live-Daten für {{value0}} bestätigt',
  'Download RTX Terminal desktop installer {{value0}}': 'RTX Terminal Desktop-Installer {{value0}} herunterladen',
};
let originalGermanCopy: Record<string, string | undefined>;

beforeEach(async () => {
  await i18nReady;
  await i18n.loadLanguages('de');
  originalGermanCopy = Object.fromEntries(Object.keys(germanCopy).map(key => [key, i18n.getResource('de', 'ui', key, { keySeparator: false })]));
  i18n.addResourceBundle('de', 'ui', germanCopy, true, true);
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  const bundle = { ...i18n.getResourceBundle('de', 'ui') };
  for (const [key, value] of Object.entries(originalGermanCopy)) {
    if (value === undefined) delete bundle[key];
    else bundle[key] = value;
  }
  i18n.removeResourceBundle('de', 'ui');
  i18n.addResourceBundle('de', 'ui', bundle);
  await i18n.changeLanguage('en');
});

describe('localized generated presentation', () => {
  it('updates a cached market warning without changing broker status or symbol', async () => {
    const status = normalizeMarketStatus({ symbol: 'EURUSD.r', status: 'closed' });
    expect(getMarketStatusTradeBlockMessage(status)).toBe('Market is closed for EURUSD.R.');

    await i18n.changeLanguage('de');

    expect(getMarketStatusTradeBlockMessage(status)).toBe('Der Markt für EURUSD.R ist geschlossen.');
    expect(status).toMatchObject({ symbol: 'EURUSD.R', status: 'closed', isTradeBlocked: true });
    expect(status.label).toBe('Market Closed');
  });

  it('updates desktop feed and download copy while preserving feed decisions and release versions', async () => {
    const input = {
      symbol: 'EURUSD.r', connectionState: 'connected' as const, transportSecurity: 'secure' as const,
      feed: { symbols: ['EURUSD.R'], loading: false, settled: true, current: true, error: null },
    };
    const english = resolveDesktopToolbarStatus(input);
    const release = { ...FALLBACK_DESKTOP_RELEASE, version: '2.4.1' };
    expect(english.feedLabel).toBe('EURUSD.R live feed verified');
    expect(getDesktopReleaseButtonTitle(release)).toContain('v2.4.1');

    await i18n.changeLanguage('de');

    const german = resolveDesktopToolbarStatus(input);
    expect(german.feedLabel).toBe('Live-Daten für EURUSD.R bestätigt');
    expect(german).toMatchObject({ feedState: english.feedState, fillPercent: english.fillPercent, securityTone: english.securityTone });
    expect(getDesktopReleaseButtonTitle(release)).toBe('RTX Terminal Desktop-Installer v2.4.1 herunterladen');
  });
});
