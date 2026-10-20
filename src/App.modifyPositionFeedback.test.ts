import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T6 — Modify SL/TP failure must surface in the user-visible feedback toast.
// Contract test only (no render): slices the current handleModifyPosition out
// of src/App.tsx and asserts the failure branch reuses the existing
// publishOrderFeedback toast mechanism with the formatted error, instead of
// leaving the failure console-only. Success path must stay unchanged (silent
// + positions refresh).
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

const modifyStart = appSource.indexOf('const handleModifyPosition = async (');
const modifyEnd = appSource.indexOf('const handleCloseBulk = async (', modifyStart);
const modifyHandler = appSource.slice(modifyStart, modifyEnd);

const catchStart = modifyHandler.indexOf('} catch (err');
const successBranch = modifyHandler.slice(0, catchStart);
const failureBranch = modifyHandler.slice(catchStart);

describe('Modify SL/TP feedback source contract (T6)', () => {
  it('modify failure shows a toast with the formatted error (never console-only)', () => {
    expect(modifyStart).toBeGreaterThan(-1);
    expect(modifyEnd).toBeGreaterThan(modifyStart);
    expect(catchStart).toBeGreaterThan(-1);

    // The existing toast mechanism is reused — no new UI is built here.
    expect(modifyHandler).not.toContain('displayToast(');
    expect(failureBranch).not.toContain('alert(');

    // Failure is logged AND toasted: console.error alone is not enough.
    expect(failureBranch).toContain("console.error('Failed to modify position:', err);");
    expect(failureBranch).toContain('publishOrderFeedback(');
    expect(failureBranch.indexOf('publishOrderFeedback(')).toBeGreaterThan(
      failureBranch.indexOf("console.error('Failed to modify position:', err);"),
    );

    // Toast carries the ticket and the user-safe formatted error, as an error toast.
    expect(failureBranch).toContain("feedbackLabel('Modify position')");
    expect(failureBranch).toContain('feedbackValue(` #${id}: `)');
    expect(failureBranch).toContain("feedbackLabel('Failed')");
    expect(failureBranch).toContain('formatOrderError(err)');
    expect(failureBranch).toContain("'error',");
  });

  it('modify success path is unchanged: silent with a positions refresh', () => {
    expect(successBranch).toContain('await tradingV2Api.modifyPosition(id,');
    expect(successBranch).toContain('price_sl: sl,');
    expect(successBranch).toContain('price_tp: tp,');
    expect(successBranch).toContain('refreshPositions(getLiveTradingLogin() || undefined);');
    // No success toast was added; success stays silent.
    expect(successBranch).not.toContain('publishOrderFeedback(');
  });

  it('modify toast plumbing uses the shared feedback imports', () => {
    expect(appSource).toContain(
      "import { publishOrderFeedback, type OrderFeedbackDetail } from './app/trading/orderFeedback';",
    );
    expect(appSource).toContain("import { formatOrderError } from './utils/orderError';");
    expect(appSource).toContain("feedbackLabel, feedbackValue");
  });
});
