import { afterEach, beforeAll, expect, it } from 'vitest';
import i18n, { changeInterfaceLanguage, i18nReady } from '../i18n';
import { chartPrinter, DEFAULT_PRINT_PREFERENCES } from './chartPrinter';
import { translateUi } from '../hooks/useUiTranslation';

beforeAll(async () => { await i18nReady; });
afterEach(async () => { await changeInterfaceLanguage('en'); });

it('uses the interface language and direction for print metadata while preserving custom content', async () => {
  await changeInterfaceLanguage('fr');
  const data = { symbol: 'XAUUSD', timeframe: 'M1', indicators: [], drawings: [], capturedAt: new Date('2026-04-01T12:25:00Z') };
  const html = chartPrinter.generatePrintableHTML(data, { ...DEFAULT_PRINT_PREFERENCES, headerText: 'My <chart>', footerText: 'Desk 123' });
  expect(html).toContain('lang="fr" dir="ltr"');
  expect(html).toContain(translateUi('Print'));
  expect(html).toContain('XAUUSD M1');
  expect(html).toContain('My &lt;chart&gt;');
  expect(html).toContain('Desk 123');
  await changeInterfaceLanguage('ar');
  const arabic = chartPrinter.generatePrintableHTML(data, DEFAULT_PRINT_PREFERENCES);
  expect(arabic).toContain('lang="ar" dir="rtl"');
  expect(arabic).toContain('class="chart-container" dir="ltr"');
  expect(i18n.language).toBe('ar');
});
