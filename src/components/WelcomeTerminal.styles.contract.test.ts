import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('WelcomeTerminal style boundary', () => {
  it('loads the external stylesheet without retaining an embedded style block', () => {
    const component = readSource('src/components/WelcomeTerminal.tsx');

    expect(component).toContain("import './WelcomeTerminal.css';");
    expect(component).not.toContain('<style>{`');
    expect(component).not.toContain('`}</style>');
  });

  it('keeps the login, broker theme, responsive, and motion rules in CSS', () => {
    const css = readSource('src/components/WelcomeTerminal.css');

    expect(css).toContain('.rtx-login-overlay {');
    expect(css).toContain('.rtx-login-button {');
    expect(css).toContain('.rtx-login-overlay--achiever .rtx-login-panel {');
    expect(css).toContain('@media (max-width: 900px) {');
    expect(css).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(css).not.toContain('${');
  });
});
