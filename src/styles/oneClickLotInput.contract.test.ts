import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const componentSource = readSource('src/components/OneClickTrading.tsx');
const themeCss = readSource('src/styles/theme.css');
const advancedLightCss = readSource('src/styles/legacy-light-overrides.css');

describe('OneClickTrading lot input surface contract', () => {
  it('removes only the value input background and its edit-focus box', () => {
    expect(themeCss).toMatch(
      /\.rtx-oct \.rtx-oct-lot-input \{[^}]*background: transparent !important;[^}]*background-color: transparent !important;/,
    );
    expect(themeCss).toMatch(
      /\.rtx-oct \.rtx-oct-lot-input:focus,[\s\S]*?\.rtx-oct \.rtx-oct-lot-input:focus-visible \{[^}]*outline: none !important;[^}]*box-shadow: none !important;/,
    );
    expect(themeCss).toContain('.rtx-oct .rtx-oct-volume-control button:focus-visible');
    expect(themeCss).not.toContain(
      '.rtx-oct .rtx-oct-volume-control :is(button, input):focus-visible',
    );
    expect(advancedLightCss).not.toContain(
      '.rtx-oct .rtx-oct-volume-control :is(button, input):focus-visible',
    );
  });

  it('retains the complete lot-control background in dark and light themes', () => {
    expect(componentSource).toContain("background: 'linear-gradient(180deg, #1f2937 0%, #111827 100%)'");
    expect(themeCss).toMatch(
      /\.theme-light \.rtx-oct \.rtx-oct-volume-control \{[^}]*background: #ffffff !important;/,
    );
    expect(advancedLightCss).toMatch(
      /\.rtx-oct \.rtx-oct-volume-control \{[^}]*background: #ffffff !important;/,
    );
  });
});
