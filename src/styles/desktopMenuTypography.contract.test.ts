import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const themeCss = readSource('src/styles/theme.css');
const enterpriseLightCss = readSource('src/styles/enterprise-light.css');

/** The Electron menu bar is the desktop counterpart of the web application menu,
    so its option labels must declare the same type. Read the declarations of the
    first rule whose selector list contains `marker` instead of duplicating the
    expected values here — comparing the two blocks is what catches drift. */
const declarationsFor = (css: string, marker: string): Record<string, string> => {
    const start = css.indexOf(marker);
    expect(start, `missing rule for ${marker}`).toBeGreaterThan(-1);
    const bodyStart = css.indexOf('{', start);
    const body = css.slice(bodyStart + 1, css.indexOf('}', bodyStart));
    return Object.fromEntries(
        body
            .split(';')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((declaration) => {
                const [property, ...rest] = declaration.split(':');
                return [property.trim(), rest.join(':').trim()];
            }),
    );
};

const FONT_KEYS = ['font-family', 'font-size', 'font-weight'] as const;

describe('desktop application menu typography parity', () => {
    it('renders the File/View/Insert/Charts/Tools/Window/Help labels like the web root items', () => {
        const webRootItem = declarationsFor(themeCss, '.rtx-application-menu__root-item {');
        const desktopTrigger = declarationsFor(
            themeCss,
            'html.rtx-desktop-shell-active .rtx-desktop-menu-bar .rtx-application-menu-trigger {',
        );

        for (const key of FONT_KEYS) {
            expect(desktopTrigger[key], key).toBe(webRootItem[key]);
        }
        expect(desktopTrigger['color']).toBe('var(--text-primary)');
    });

    it('renders every dropdown option, such as Language, at the web menu row type role', () => {
        const webRow = declarationsFor(themeCss, '.rtx-application-menu .rtx-menu-row,');
        const desktopRow = declarationsFor(themeCss, '.rtx-desktop-menu-bar .rtx-menu-row,');

        for (const key of [...FONT_KEYS, 'line-height'] as const) {
            expect(desktopRow[key], key).toBe(webRow[key]);
        }

        const webShortcut = declarationsFor(themeCss, '.rtx-application-menu .rtx-menu-row__shortcut {');
        const desktopShortcut = declarationsFor(themeCss, '.rtx-desktop-menu-bar .rtx-menu-row__shortcut,');
        for (const key of ['font-family', 'line-height'] as const) {
            expect(desktopShortcut[key], key).toBe(webShortcut[key]);
        }
    });

    it('reaches the submenus that Electron portals out of the menu bar', () => {
        expect(themeCss).toMatch(
            /\[data-rtx-desktop-submenu='true'\] \.rtx-menu-row,[\s\S]*?\{[\s\S]*?font-family: "Segoe UI", Tahoma, Arial, sans-serif;/,
        );
    });

    it('keeps the desktop labels at full web contrast in the untitled light skin', () => {
        expect(enterpriseLightCss).toMatch(
            /html\.rtx-advanced-view\.rtx-skin-untitled-light \.rtx-desktop-menu-bar :is\([\s\S]*?\.rtx-application-menu-trigger,[\s\S]*?\.rtx-menu-row:not\(\.is-disabled\),[\s\S]*?\) \{[\s\S]*?color: var\(--rtx-light-text\) !important;/,
        );
        expect(enterpriseLightCss).toMatch(
            /html\.rtx-advanced-view\.rtx-skin-untitled-light \[data-rtx-desktop-submenu='true'\] :is\([\s\S]*?\) \{[\s\S]*?color: var\(--rtx-light-text\) !important;/,
        );
        expect(enterpriseLightCss).toMatch(
            /html\.rtx-advanced-view\.rtx-skin-untitled-light :is\([\s\S]*?\.rtx-desktop-menu-bar,[\s\S]*?\[data-rtx-desktop-submenu='true'\][\s\S]*?\) :is\([\s\S]*?\.rtx-application-menu-trigger,[\s\S]*?\) \{[\s\S]*?font-family: "Segoe UI", Tahoma, Arial, sans-serif !important;[\s\S]*?font-size: var\(--rtx-advanced-dense-font-size, 13px\) !important;/,
        );
    });

    it('changes only type, leaving the desktop menu row metrics untouched', () => {
        const desktopTrigger = declarationsFor(
            themeCss,
            'html.rtx-desktop-shell-active .rtx-desktop-menu-bar .rtx-application-menu-trigger {',
        );
        expect(desktopTrigger['height']).toBe('25px');
        expect(desktopTrigger['background']).toBe('transparent');
        expect(themeCss).toMatch(
            /html\.rtx-desktop-shell-active \.rtx-desktop-menu-row \{[\s\S]*?height: 30px;[\s\S]*?padding-block: 2px;/,
        );
    });
});
