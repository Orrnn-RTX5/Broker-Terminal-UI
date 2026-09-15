import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const themeCss = readSource('src/styles/theme.css');
const enterpriseLightCss = readSource('src/styles/enterprise-light.css');
const menuBarSource = readSource('src/components/layout/MenuBar.tsx');
const fileMenuSource = readSource('src/components/layout/FileMenu.tsx');

describe('web application menu typography contract', () => {
  it('matches root and nested menu labels to the dense Trade row role', () => {
    expect(themeCss).toMatch(
      /\.rtx-application-menu__root-item \{[\s\S]*?font-family: "Segoe UI", Tahoma, Arial, sans-serif;[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\);[\s\S]*?font-weight: var\(--font-weight-normal\);[\s\S]*?line-height: 19\.5px;/,
    );
    expect(themeCss).toMatch(
      /\.rtx-application-menu \.rtx-menu-row,[\s\S]*?\.rtx-application-menu \.rtx-file-menu button\.text-\\\[14px\\\] \{[\s\S]*?font-family: "Segoe UI", Tahoma, Arial, sans-serif;[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\);[\s\S]*?font-weight: var\(--font-weight-normal\);[\s\S]*?line-height: 19\.5px;/,
    );
    expect(themeCss).toMatch(
      /\.rtx-application-menu \.rtx-menu-row__shortcut \{[\s\S]*?font-family: "Segoe UI", Tahoma, Arial, sans-serif;[\s\S]*?line-height: 18px;/,
    );
  });

  it('uses Trade-level light contrast without flattening disabled menu states', () => {
    expect(enterpriseLightCss).toMatch(
      /\.rtx-application-menu :is\([\s\S]*?\.rtx-menu-row:not\(\.is-disabled\),[\s\S]*?\.rtx-file-menu button\.text-\\\[14px\\\]:not\(:disabled\)[\s\S]*?color: var\(--rtx-light-text\) !important;/,
    );
    expect(enterpriseLightCss).toMatch(
      /\.rtx-application-menu :is\([\s\S]*?\.rtx-application-menu__root-item,[\s\S]*?\.rtx-menu-row,[\s\S]*?\.rtx-file-menu button\.text-\\\[14px\\\][\s\S]*?font-family: "Segoe UI", Tahoma, Arial, sans-serif !important;/,
    );
    expect(themeCss).toMatch(/\.rtx-menu-row\.is-disabled \{[\s\S]*?color: var\(--text-quaternary\);/);
    expect(themeCss).toMatch(/\.rtx-file-menu button:disabled \{[\s\S]*?color: var\(--text-quaternary\);/);
  });

  it('keeps neutral icons as legible as their labels at every application-menu depth', () => {
    expect(themeCss).toMatch(
      /\.rtx-application-menu :is\([\s\S]*?\.rtx-application-menu__root-icon,[\s\S]*?\.rtx-application-menu__chevron,[\s\S]*?\.rtx-menu-row__icon,[\s\S]*?\.rtx-menu-row__chevron,[\s\S]*?\.rtx-menu-icon--neutral[\s\S]*?\) \{[\s\S]*?color: inherit;/,
    );
    expect(themeCss).toMatch(
      /\.rtx-application-menu :is\([\s\S]*?\.rtx-application-menu__root-icon svg,[\s\S]*?\.rtx-menu-row__icon svg,[\s\S]*?\.rtx-file-menu svg[\s\S]*?\) \{[\s\S]*?stroke-width: 1\.75;/,
    );
    expect(themeCss).not.toMatch(
      /\.rtx-application-menu__root-item:hover \.rtx-application-menu__root-icon,[^{]*\{[^}]*color: var\(--text-primary\);/,
    );
    expect(menuBarSource).toContain('className="rtx-menu-icon--neutral"');
    expect(fileMenuSource).toContain('className="rtx-menu-icon--neutral"');
    expect(fileMenuSource).toContain('className="rtx-menu-icon--neutral w-4 flex items-center justify-center"');
  });
});
