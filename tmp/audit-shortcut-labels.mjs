import fs from 'node:fs';
const keys = JSON.parse(fs.readFileSync('tmp/shortcut-labels.json', 'utf8'));
const tokens = value => [...value.matchAll(/\{\{[^}]+\}\}/g)].map(match => match[0]).sort().join('|');
const unchanged = /^(Alt|Cmd|Ctrl|Del|End|Home|PageDown|PageUp|Shift|Esc|M1|M5|M15|M30|H1|H4|D1|W1|MN)$/;
const missing = [], badTokens = [], same = {};
for (const language of ['en', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'pl', 'tr', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko', 'id', 'vi', 'th', 'ar', 'hi']) {
  const catalog = JSON.parse(fs.readFileSync(`src/locales/${language}/ui.json`, 'utf8'));
  for (const key of keys) {
    if (!Object.hasOwn(catalog, key)) missing.push([language, key]);
    else if (tokens(key) !== tokens(catalog[key])) badTokens.push([language, key]);
  }
  if (language !== 'en') same[language] = keys.filter(key => catalog[key] === key && !unchanged.test(key));
}
console.log(JSON.stringify({ count: keys.length, missing, badTokens, same }, null, 2));
