import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n, { changeInterfaceLanguage, i18nReady } from '../i18n';
import { feedbackLabel, feedbackValue, feedbackSymbol, formatUiMessage } from './uiFeedback';

describe('interface feedback', () => {
  beforeEach(async () => {
    await i18nReady;
    await changeInterfaceLanguage('en');
  });

  afterEach(async () => { await changeInterfaceLanguage('en'); });

  it('keeps a stored trade message reactive to language while preserving its raw trading values', async () => {
    const parts = [
      feedbackLabel('Buy Limit'), feedbackValue(' · '), feedbackSymbol('EURUSD.r'),
      feedbackValue(' · '), feedbackLabel('Volume'), feedbackValue(': 1.23 · '),
      feedbackLabel('Price'), feedbackValue(': 1.08520 · '), feedbackLabel('Completed'),
    ];
    const original = JSON.stringify(parts);
    const english = formatUiMessage(parts);
    expect(english).toContain('Buy Limit');

    for (const language of ['fr', 'ar']) {
      await changeInterfaceLanguage(language);
      const translated = formatUiMessage(parts);
      expect(translated).not.toBe(english);
      expect(translated).not.toContain('Buy Limit');
      expect(translated).toContain('EURUSD.r');
      expect(translated).toContain('1.23');
      expect(translated).toContain('1.08520');
      expect(JSON.stringify(parts)).toBe(original);
    }
  });

  it('translates known local errors and leaves unknown backend diagnostics unchanged', async () => {
    const diagnostic = 'BROKER_481: rejected ticket #123 (EURUSD.r)';
    await changeInterfaceLanguage('fr');
    expect(formatUiMessage('Order failed')).not.toBe('Order failed');
    expect(formatUiMessage(diagnostic)).toBe(diagnostic);
    expect(formatUiMessage([feedbackLabel('Failed'), feedbackValue(`: ${diagnostic}`)])).toContain(diagnostic);
    expect(formatUiMessage([feedbackSymbol('')])).not.toBe('Selected symbol');
  });
});
