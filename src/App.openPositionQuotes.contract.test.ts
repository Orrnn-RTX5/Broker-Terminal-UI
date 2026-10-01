import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('App open-position quote contract', () => {
  // A held symbol with no live quote cannot pass the close execution gate, so
  // Close All skipped it without sending anything. App is always mounted,
  // unlike the Toolbox tab or Market Watch, which is why the demand lives here.
  it('subscribes live quotes for every open position from the always-mounted App', () => {
    expect(source).toContain("import { useOpenPositionQuoteDemand } from './hooks/useOpenPositionQuoteDemand';");
    expect(source).toMatch(/useTerminalQuoteClock\(\);[\s\S]{0,200}useOpenPositionQuoteDemand\(\);/);
  });
});
