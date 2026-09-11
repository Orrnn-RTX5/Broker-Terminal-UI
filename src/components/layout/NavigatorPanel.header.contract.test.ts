import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string): string => readFileSync(
  resolve(process.cwd(), path),
  'utf8',
).replace(/\r\n/g, '\n');

const navigatorSource = readSource('src/components/layout/NavigatorPanel.tsx');
const dockPanelSource = readSource('src/components/dock/DockPanel.tsx');
const navigatorMarkup = navigatorSource.slice(
  navigatorSource.indexOf('return (', navigatorSource.indexOf('export const NavigatorPanel')),
  navigatorSource.indexOf('function TreeItem('),
);

describe('Navigator panel header', () => {
  it('does not render a duplicate header inside the Navigator content', () => {
    expect(navigatorMarkup).toContain('navigator-panel__body');
    expect(navigatorMarkup).not.toContain('navigator-panel__header');
    expect(navigatorMarkup).not.toMatch(/>\s*Navigator\s*</);
  });

  it('keeps the dock title and close action in the retained outer header', () => {
    expect(dockPanelSource).toContain('{tr(panel.title)}');
    expect(dockPanelSource).toContain('title={tr("Close")}');
    expect(dockPanelSource).toContain('onClose?.();');
    expect(dockPanelSource).toContain('<X className="w-3 h-3" />');
  });
});
