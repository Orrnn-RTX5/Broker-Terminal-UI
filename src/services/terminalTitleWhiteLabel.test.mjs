import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fold note: pure title resolution lives in src/services/brokerDisplayName.ts
// (resolveTerminalTitle + NEUTRAL_TERMINAL_TITLE), executed by
// src/services/terminalTitle.test.ts in the vitest suite. These node pins
// cover the shipped files + wiring without bundler deps.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

test('pure title resolver maps broker fields with neutral fallback (fold port)', () => {
  const display = readFileSync(join(root, 'src', 'services', 'brokerDisplayName.ts'), 'utf8');
  assert.ok(display.includes("export const NEUTRAL_TERMINAL_TITLE = 'Web Terminal'"), 'neutral title constant');
  assert.ok(display.includes('export function resolveTerminalTitle'), 'pure resolver exported');
  for (const field of ['displayName', 'brokerName', 'defaultMt5Server', 'brokerId']) {
    assert.ok(display.includes(field), `resolver reads ${field}`);
  }
});

test('no locale ships vendor title or vendor URL keys (all 19 catalogs parsed)', () => {
  const locales = readdirSync(join(root, 'src', 'locales')).filter((name) => {
    try {
      readFileSync(join(root, 'src', 'locales', name, 'ui.json'), 'utf8');
      return true;
    } catch {
      return false;
    }
  });
  assert.ok(locales.length >= 19, `expected 19 locale catalogs, saw ${locales.length}`);
  for (const locale of locales) {
    const raw = readFileSync(join(root, 'src', 'locales', locale, 'ui.json'), 'utf8');
    const catalog = JSON.parse(raw);
    assert.ok(!('RTX 5 Web Terminal' in catalog), `${locale}: vendor title key must be gone`);
    assert.ok(!('www.rtx5.orrnn.com' in catalog), `${locale}: vendor URL key must be gone`);
    assert.ok(!('RTX Terminal login' in catalog), `${locale}: vendor login key must be gone`);
    assert.ok(!('Download RTX Terminal desktop installer {{value0}}' in catalog), `${locale}: vendor download key must be gone`);
    assert.ok(!('Download the latest RTX Terminal desktop installer' in catalog), `${locale}: vendor download key must be gone`);
    assert.doesNotMatch(raw, /orrnn/i, `${locale}: no vendor host may ship`);
    assert.doesNotMatch(raw, /RTX Terminal/, `${locale}: no vendor title may ship`);
  }
  const en = JSON.parse(readFileSync(join(root, 'src', 'locales', 'en', 'ui.json'), 'utf8'));
  assert.equal(en['Terminal login'], 'Terminal login');
  assert.equal(en['Download desktop installer {{value0}}'], 'Download desktop installer {{value0}}');
  assert.equal(en['Download the latest desktop installer'], 'Download the latest desktop installer');
});

test('title chain is config-driven with no vendor literal (ds-16)', () => {
  const titleHook = readFileSync(join(root, 'src', 'hooks', 'useTerminalTitle.ts'), 'utf8');
  assert.ok(!titleHook.includes('RTX 5 Web Terminal'), 'vendor default must be gone from useTerminalTitle.ts');
  assert.ok(titleHook.includes('getWebTerminalTitle'), 'title must resolve via getWebTerminalTitle');
  assert.ok(titleHook.includes('resolveTerminalTitle'), 'title must flow through resolveTerminalTitle');
  for (const file of [
    'src/App.tsx',
    'src/components/layout/StatusBar.tsx',
    'src/store/useSettingsStore.ts',
    'src/components/settings/OptionsDialog.tsx',
    'src/components/layout/DesktopWindowShell.tsx',
    'src/components/WelcomeTerminal.tsx',
    'src/services/brokerPresentation.ts',
    'src/services/desktopRelease.ts',
    'src/hooks/useTerminalTitle.ts',
    'index.html',
    'electron.cjs',
    'desktop-splash.html',
  ]) {
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /RTX 5 Web Terminal/, `${file}: vendor title must be gone`);
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /RTX Terminal/, `${file}: vendor brand must be gone`);
  }
  for (const [file, marker] of [
    ['src/App.tsx', 'getWebTerminalTitle()'],
    ['src/App.tsx', 'isSameTerminalLabel'],
    ['src/App.tsx', 'initialSide={orderPanelDraft?.side}'],
    ['src/components/OrderPanelDialog.tsx', 'resolveOrderPanelSide'],
    ['src/components/layout/StatusBar.tsx', 'getWebTerminalTitle()'],
    ['src/services/brokerPresentation.ts', 'getLoginTitle()'],
    ['src/services/desktopRelease.ts', 'Download desktop installer'],
    ['src/hooks/useTerminalTitle.ts', 'isSameTerminalLabel'],
  ]) {
    assert.ok(readFileSync(join(root, file), 'utf8').includes(marker), `${file}: must wire ${marker}`);
  }
});
