import fs from 'node:fs';
for (const language of ['de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'pl', 'tr', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko', 'id', 'vi', 'th', 'ar', 'hi']) {
  const catalog = JSON.parse(fs.readFileSync(`src/locales/${language}/ui.json`, 'utf8'));
  console.log(language, JSON.stringify(Object.fromEntries(['Last Symbol', 'Last symbol', 'Ghost feed', 'Path', 'Undo', 'Redo', 'Shortcuts'].map(key => [key, catalog[key]]))));
}
