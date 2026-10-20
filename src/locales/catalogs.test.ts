import { describe, expect, it } from 'vitest';
import { supportedLanguages } from '../config/supportedLanguages';
import englishUi from './en/ui.json';
import englishMenu from './en/translation.json';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const catalogs = import.meta.glob('./*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;
// White-label neutral keys (ds-16) allowed to be missing outside en: a
// missing key renders English at runtime via fallbackLng 'en', never
// presented as a translation. Tracked in translation-todo.json + NEEDS_TRANSLATION.md.
const translationTodo: string[] = (JSON.parse(
  readFileSync(new URL('./translation-todo.json', import.meta.url), 'utf8'),
) as { allowMissing: string[] }).allowMissing;
const leaves = (value: Record<string, unknown>, prefix = ''): Record<string, string> => Object.fromEntries(
  Object.entries(value).flatMap(([key, entry]) => typeof entry === 'string'
    ? [[`${prefix}${key}`, entry]]
    : Object.entries(leaves(entry as Record<string, unknown>, `${prefix}${key}.`))),
);
const placeholders = (value: string) => [...value.matchAll(/{{\s*([^}]+)\s*}}/g)].map(match => match[1].trim()).sort();

describe('complete local interface catalogs', () => {
  it('contains catalogs only for supported interface languages', () => {
    const catalogLanguages = [...new Set(
      Object.keys(catalogs).map(path => path.split('/')[1]),
    )].sort();
    const registeredLanguages = supportedLanguages.map(({ code }) => code).sort();

    expect(catalogLanguages).toEqual(registeredLanguages);
  });

  it('covers every literal message used by the shared UI translator', () => {
    const missing: string[] = [];
    const inspect = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) { inspect(path); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
        const text = readFileSync(path, 'utf8');
        if (!text.includes('hooks/useUiTranslation')) continue;
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
            && ['tr', 'translateUi', 'feedbackLabel'].includes(node.expression.text)) {
            const argument = node.arguments[0];
            if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
              const key = argument.text.trim();
              if (key && !Object.prototype.hasOwnProperty.call(englishUi, key)) missing.push(`${entry.name}: ${key}`);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    inspect(resolve(process.cwd(), 'src'));
    expect(missing).toEqual([]);
  });

  it('translation allowlist only names real, non-empty English keys', () => {
    for (const key of translationTodo) {
      expect(typeof (englishUi as Record<string, unknown>)[key], `todo key in en: ${key}`).toBe('string');
      expect(((englishUi as Record<string, string>)[key] ?? '').trim(), `todo key non-empty: ${key}`).not.toBe('');
    }
  });

  it.each(supportedLanguages)('$code includes every menu and UI message with intact placeholders', ({ code }) => {
    for (const [namespace, english] of [['ui', englishUi], ['translation', englishMenu]] as const) {
      const source = namespace === 'ui' ? english as Record<string, string> : leaves(english);
      const resource = catalogs[`./${code}/${namespace}.json`];
      expect(resource, `${code}/${namespace} exists`).toBeDefined();
      const translated = namespace === 'ui' ? resource as Record<string, string> : leaves(resource);
      for (const [key, original] of Object.entries(source)) {
        const label = `${code}/${namespace}: ${key}`;
        if (code !== 'en' && namespace === 'ui' && translated[key] === undefined && translationTodo.includes(key)) {
          continue; // allowed missing: renders English via fallbackLng, tracked in translation-todo.json
        }
        expect(translated[key], label).toBeTypeOf('string');
        expect(translated[key]?.trim(), label).not.toBe('');
        expect(placeholders(translated[key]), label).toEqual(placeholders(original));
        // A merged translation batch must never appear as a single UI label.
        if (!original.includes('\n')) expect(translated[key], label).not.toContain('\n');
      }
    }
  });
});
