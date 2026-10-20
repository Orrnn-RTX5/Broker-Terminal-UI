import { describe, expect, it } from 'vitest';
import { supportedLanguages } from '../config/supportedLanguages';
import englishUi from './en/ui.json';
import englishMenu from './en/translation.json';

// White-label: no catalog VALUE (what users read) may show the technology
// vendor brand, in any language. Keys are lookup identifiers and stay as-is.
const catalogs = import.meta.glob('./*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;
const VENDOR_BRAND = /rtx[\s-]?5|आरटीएक्स|orrnn/i;
const leaves = (value: Record<string, unknown>, prefix = ''): Array<[string, string]> => Object.entries(value).flatMap(
  ([key, entry]) => typeof entry === 'string'
    ? [[`${prefix}${key}`, entry] as [string, string]]
    : leaves(entry as Record<string, unknown>, `${prefix}${key}.`),
);

describe('brand-neutral catalog values', () => {
  it.each(supportedLanguages)('$code shows no vendor brand in any ui or menu value', ({ code }) => {
    for (const namespace of ['ui', 'translation']) {
      const catalog = catalogs[`./${code}/${namespace}.json`];
      expect(catalog, `${code}/${namespace} exists`).toBeDefined();
      const branded = leaves(catalog).filter(([, value]) => VENDOR_BRAND.test(value));
      expect(branded, `${code}/${namespace}`).toEqual([]);
    }
  });

  it('keeps the vendor-brand lookup keys and gives them neutral English values', () => {
    const ui = englishUi as Record<string, string>;
    expect(ui['Your broker and the RTX5 team can see this report.']).toBe('Your broker and the platform support team can see this report.');
    expect(ui['RTX5 AlgoBook']).toBe('AlgoBook');
    expect(ui['RTX5 Terminal']).toBe('Terminal');
    expect(ui['RTX5 for iOS']).toBe('Terminal for iOS');
    expect(ui['Login to RTX5.community']).toBe('Login to the community');
    expect((englishMenu as { menu: { help: Record<string, string> } }).menu.help.algoBook).toBe('AlgoBook');
  });
});
