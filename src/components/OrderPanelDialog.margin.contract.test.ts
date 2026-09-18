import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/OrderPanelDialog.tsx'), 'utf8');

describe('OrderPanelDialog required margin contract', () => {
  it('loads required margin from POST /calculate/margin instead of a local heuristic', () => {
    expect(source).toContain("tradeApi.market.calculateMargin({");
    expect(source).toContain('account_login: login');
    expect(source).toContain("data-testid=\"order-required-margin\"");
    expect(source).toContain('formatRequiredMargin(requiredMargin, baseCurrency)');
    expect(source).not.toContain('volumeNum * instContractSize');
    expect(source).not.toContain('marginRequired = (volume');
  });
});
