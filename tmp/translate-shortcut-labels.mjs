import fs from 'node:fs';

const keys = JSON.parse(fs.readFileSync('tmp/shortcut-labels.json', 'utf8'));
const aliases = { ...JSON.parse(fs.readFileSync('tmp/shortcut-label-aliases.json', 'utf8')), 'Cross Line': 'Crossline' };
const unchanged = new Set(['Alt', 'Cmd', 'Ctrl', 'Del', 'End', 'Home', 'PageDown', 'PageUp', 'Shift', 'Esc', 'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN']);
const translations = JSON.parse(fs.readFileSync('tmp/shortcut-translations.json', 'utf8'));
const missing = [];
const counts = {};
for (const language of ['en', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'pl', 'tr', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko', 'id', 'vi', 'th', 'ar', 'hi']) {
  const path = `src/locales/${language}/ui.json`;
  if (!fs.existsSync(path)) continue;
  const catalog = JSON.parse(fs.readFileSync(path, 'utf8'));
  let added = 0;
  for (const key of keys) {
    if (Object.hasOwn(catalog, key)) continue;
    const value = language === 'en' || unchanged.has(key) ? key : aliases[key] && catalog[aliases[key]] || translations[language]?.[key];
    if (typeof value !== 'string' || !value.trim()) { missing.push([language, key]); continue; }
    catalog[key] = value;
    added++;
  }
  if (added) fs.writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
  counts[language] = added;
}
console.log(JSON.stringify({ counts, missing }, null, 2));
