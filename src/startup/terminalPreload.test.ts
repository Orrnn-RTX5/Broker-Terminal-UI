import { describe, expect, it } from 'vitest';
import type { OutputBundle, OutputChunk } from 'rollup';
import { terminalPreloadAssets } from '../../viteTerminalPreload';

const chunk = (fileName: string, source: string | null, imports: string[] = [], dynamicImports: string[] = []) => ({
  type: 'chunk', fileName, facadeModuleId: source, imports, dynamicImports,
  viteMetadata: { importedCss: new Set([fileName.replace('.js', '.css')]) },
}) as unknown as OutputChunk;

describe('production terminal preload graph', () => {
  it('fetches required fallback translations early without preloading every language', () => {
    const bundle: OutputBundle = {
      'english-ui.js': chunk('english-ui.js', 'C:/repo/src/locales/en/ui.json'),
      'english.js': chunk('english.js', 'C:/repo/src/locales/en/translation.json'),
      'arabic.js': chunk('arabic.js', 'C:/repo/src/locales/ar/ui.json'),
    };
    expect(terminalPreloadAssets(bundle).filter(asset => !asset.style)).toEqual([
      { href: '/english-ui.js', style: false },
      { href: '/english.js', style: false },
    ]);
  });
  it('preloads the first viewport and shared dependencies once, excluding optional dynamic features', () => {
    const bundle: OutputBundle = {
      'App.js': chunk('App.js', 'C:/repo/src/App.tsx', ['shared.js'], ['Dialog.js']),
      'Chart.js': chunk('Chart.js', 'C:/repo/src/components/TradingChart.tsx', ['shared.js']),
      'shared.js': chunk('shared.js', null, ['App.js']),
      'Dialog.js': chunk('Dialog.js', 'C:/repo/src/components/Dialog.tsx'),
      'styles.js': chunk('styles.js', 'C:/repo/src/authenticatedStyles.ts'),
    };
    const assets = terminalPreloadAssets(bundle, '/terminal/');
    expect(assets.filter(asset => !asset.style).map(asset => asset.href)).toEqual([
      '/terminal/App.js', '/terminal/shared.js', '/terminal/Chart.js', '/terminal/styles.js',
    ]);
    expect(assets.filter(asset => asset.style)).toHaveLength(4);
    expect(assets.some(asset => asset.href.includes('Dialog'))).toBe(false);
  });
  it('leaves builds with no terminal chunk alone', () => {
    expect(terminalPreloadAssets({ 'login.js': chunk('login.js', '/repo/src/Login.tsx') })).toEqual([]);
  });
  it('finds the global stylesheet when Vite removes its empty JavaScript entry', () => {
    const bundle = {
      'assets/authenticatedStyles-hash.css': { type: 'asset', fileName: 'assets/authenticatedStyles-hash.css', source: 'body {}' },
      'assets/Dialog-hash.css': { type: 'asset', fileName: 'assets/Dialog-hash.css', source: '.dialog {}' },
    } as unknown as OutputBundle;
    expect(terminalPreloadAssets(bundle)).toEqual([
      { href: '/assets/authenticatedStyles-hash.css', style: true },
    ]);
  });
  it('finds App when shared exports leave its dynamic chunk without a facade', () => {
    const app = { ...chunk('App.js', null), modules: { 'C:/repo/src/App.tsx': {} } } as unknown as OutputChunk;
    expect(terminalPreloadAssets({ 'App.js': app })).toContainEqual({ href: '/App.js', style: false });
  });
});
