import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// White-label: the shipped app icons are one neutral generic mark (no vendor
// brand). A broker logo/icon comes from broker config (web) or BRAND_ICON (desktop build).
const root = process.cwd();
const read = (file: string) => readFileSync(path.resolve(root, file));

describe('neutral brand assets', () => {
  it('ships only the generic terminal icon and chart watermark in public/brand', () => {
    expect(readdirSync(path.resolve(root, 'public/brand'))).toEqual(['rtx5-chart-watermark.png', 'terminal-icon.png']);
  });

  it('uses the same generic icon for the app fallback, titlebar and desktop build', () => {
    const icon = read('public/brand/terminal-icon.png');
    expect(read('public/titlebar-icon.png').equals(icon)).toBe(true);
    expect(read('build/icon.png').equals(icon)).toBe(true);
    expect(read('public/favicon.ico').equals(read('build/icon.ico'))).toBe(true);
  });

  it('points the splash and the logo fallback at the generic icon', () => {
    expect(read('desktop-splash.html').toString()).toContain('src="./dist/brand/terminal-icon.png"');
    expect(read('src/components/BrokerLogoImage.tsx').toString()).toContain("toPublicAssetPath('brand/terminal-icon.png')");
    for (const file of ['desktop-splash.html', 'index.html', 'src/components/WelcomeTerminal.tsx', 'src/components/BrokerLogoImage.tsx']) {
      expect(read(file).toString(), file).not.toMatch(/rtx5-app-icon|rtx5-login-wordmark/);
    }
  });
});
