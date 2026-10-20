import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Desktop brand identity: product name from deployment config with a neutral
// fallback. A missing brand warns operators and never breaks the build or
// shows an error string to users. appId is not brand data and stays fixed.
const require = createRequire(import.meta.url);
const root = process.cwd();
const brand = require(path.resolve(root, 'electron-brand.cjs')) as {
  NEUTRAL_PRODUCT_NAME: string;
  resolveBrandProductName: (options?: { env?: Record<string, string | undefined>; packageMetadata?: unknown; warn?: (message: string) => void }) => string;
  resolveWindowTitle: (title: unknown, fallback: string, warn?: (message: string) => void) => string;
  createBuilderConfig: (base: Record<string, unknown>, env?: Record<string, string | undefined>, warn?: (message: string) => void) => { appId: string; productName: string; artifactName: string; nsis: Record<string, unknown>; files: unknown; extraMetadata?: Record<string, unknown> };
};
const pkg = JSON.parse(readFileSync(path.resolve(root, 'package.json'), 'utf8'));
const electronSource = readFileSync(path.resolve(root, 'electron.cjs'), 'utf8');

describe('desktop product name', () => {
  it('uses BRAND_PRODUCT_NAME, then the packaged stamp, then the neutral name with a warning', () => {
    const warn = vi.fn();
    expect(brand.resolveBrandProductName({ env: { BRAND_PRODUCT_NAME: ' Fixture Trader ' }, packageMetadata: { brandProductName: 'Stamped' }, warn })).toBe('Fixture Trader');
    expect(brand.resolveBrandProductName({ env: {}, packageMetadata: { brandProductName: 'Stamped' }, warn })).toBe('Stamped');
    expect(warn).not.toHaveBeenCalled();

    expect(brand.resolveBrandProductName({ env: { BRAND_PRODUCT_NAME: '  ' }, packageMetadata: null, warn })).toBe('Terminal');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('BRAND_PRODUCT_NAME is not configured');
  });

  it('falls back to the product name for an empty renderer title and warns', () => {
    const warn = vi.fn();
    expect(brand.resolveWindowTitle('Fixture Markets - 1001', 'Fixture Trader', warn)).toBe('Fixture Markets - 1001');
    expect(warn).not.toHaveBeenCalled();
    expect(brand.resolveWindowTitle(undefined, 'Fixture Trader', warn)).toBe('Fixture Trader');
    expect(brand.resolveWindowTitle('   ', '', warn)).toBe('Terminal');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('wires the window title through the resolver with no visible error text', () => {
    expect(electronSource).toContain("require('./electron-brand.cjs')");
    expect(electronSource).toContain('title: BRAND_PRODUCT_NAME,');
    expect(electronSource).toContain('mainWindow.setTitle(resolveWindowTitle(title, BRAND_PRODUCT_NAME));');
    expect(electronSource).not.toMatch(/Brand unavailable|RTX Terminal/);
  });
});

describe('electron-builder config', () => {
  it('keeps the live appId and neutral package defaults', () => {
    expect(pkg.build.appId).toBe('com.rtx.terminal');
    expect(pkg.build.productName).toBe('Terminal');
    expect(pkg.build.artifactName).toBe('Terminal.Setup.${version}.${ext}');
    expect(pkg.build.nsis.shortcutName).toBe('Terminal');
    expect(pkg.build.files).toContain('electron-brand.cjs');
    expect(pkg.scripts['electron:build']).toContain('--config electron-builder.config.cjs');
    expect(pkg.scripts['electron:publish']).toContain('--config electron-builder.config.cjs');
  });

  it('builds with the neutral name when the brand env is unset', () => {
    const warn = vi.fn();
    const config = brand.createBuilderConfig(pkg.build, {}, warn);
    expect(config.appId).toBe('com.rtx.terminal');
    expect(config.productName).toBe('Terminal');
    expect(config.artifactName).toBe('Terminal.Setup.${version}.${ext}');
    expect(config.nsis.shortcutName).toBe('Terminal');
    expect(config.nsis.oneClick).toBe(pkg.build.nsis.oneClick);
    expect(config.extraMetadata).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('applies a configured brand to name, artifact, shortcut and the packaged stamp only', () => {
    const config = brand.createBuilderConfig(pkg.build, { BRAND_PRODUCT_NAME: 'Fixture FX Trader' }, vi.fn());
    expect(config.appId).toBe('com.rtx.terminal');
    expect(config.productName).toBe('Fixture FX Trader');
    expect(config.artifactName).toBe('Fixture.FX.Trader.Setup.${version}.${ext}');
    expect(config.nsis.shortcutName).toBe('Fixture FX Trader');
    expect(config.extraMetadata).toEqual({ brandProductName: 'Fixture FX Trader' });
    expect(config.files).toEqual(pkg.build.files);
  });
});
