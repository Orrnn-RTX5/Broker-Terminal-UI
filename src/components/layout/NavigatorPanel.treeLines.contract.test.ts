import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const navigatorSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/NavigatorPanel.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

const treeItemSource = navigatorSource.slice(
  navigatorSource.indexOf('function TreeItem('),
);

describe('Navigator tree branch lines', () => {
  it('renders every vertical and horizontal connector as a solid line', () => {
    expect(treeItemSource.match(/1px solid var\(--navigator-tree-line, #555\)/g)).toHaveLength(3);
    expect(treeItemSource).not.toMatch(/1px (?:dashed|dotted) var\(--navigator-tree-line, #555\)/);
  });
});
