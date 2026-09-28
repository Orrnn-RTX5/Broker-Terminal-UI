import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useBulkCloseConfirmStore, type BulkCloseType } from '../../store/useBulkCloseConfirmStore';
import { BulkCloseConfirmDialog } from './BulkCloseConfirmDialog';

const positions = [
  { id: 101, symbol: 'BTCUSD', side: 'BUY' as const, volume: 0.01, openPrice: 84_100, pnl: 2.5 },
  { id: 102, symbol: 'BTCUSD', side: 'SELL' as const, volume: 0.01, openPrice: 84_200, pnl: -1.25 },
];

describe('BulkCloseConfirmDialog', () => {
  beforeEach(() => {
    useBulkCloseConfirmStore.getState().closeBulkCloseConfirm();
  });

  it.each<[BulkCloseType, string]>([
    ['ALL', 'Close All Positions'],
    ['WINNERS', 'Close In-Profit Positions'],
    ['LOSERS', 'Close In-Loss Positions'],
  ])('keeps the first confirmation for %s closes', async (type, title) => {
    let confirmation: Promise<boolean> | undefined;

    render(
      <>
        <button
          onClick={() => {
            confirmation = useBulkCloseConfirmStore.getState().showBulkCloseConfirm({
              type,
              positions,
              combinedPnL: 1.25,
            });
          }}
        >
          Open confirmation
        </button>
        <BulkCloseConfirmDialog />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    // A synchronous query is intentional: the sheet must exist in the same
    // interaction turn, without a timer, animation wait, or async lookup.
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close 2 Positions' }));

    expect(confirmation).toBeDefined();
    await expect(confirmation!).resolves.toBe(true);
    expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument();
  });

  it('has no entrance animation or full-screen blur delaying first paint', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/bulk-close-dialog.css'), 'utf8');
    const backdropStart = css.indexOf('.rtx-bulk-close-backdrop {');
    const backdropEnd = css.indexOf('\n}', backdropStart);
    const dialogStart = css.indexOf('.rtx-bulk-close-dialog {');
    const dialogEnd = css.indexOf('\n}', dialogStart);
    const backdropRule = css.slice(backdropStart, backdropEnd);
    const dialogRule = css.slice(dialogStart, dialogEnd);

    expect(backdropStart).toBeGreaterThan(-1);
    expect(dialogStart).toBeGreaterThan(-1);
    expect(backdropRule).not.toContain('blur(');
    expect(backdropRule).not.toContain('animation:');
    expect(dialogRule).not.toContain('animation:');
    expect(css).not.toContain('rtx-bulk-close-backdrop-in');
    expect(css).not.toContain('rtx-bulk-close-dialog-in');
  });

  it('resolves a programmatically closed confirmation as cancelled', async () => {
    const confirmation = useBulkCloseConfirmStore.getState().showBulkCloseConfirm({
      type: 'ALL',
      positions,
      combinedPnL: 1.25,
    });

    useBulkCloseConfirmStore.getState().closeBulkCloseConfirm();

    await expect(confirmation).resolves.toBe(false);
    expect(useBulkCloseConfirmStore.getState().isOpen).toBe(false);
  });

  it('cancels the previous promise before replacing an open confirmation', async () => {
    const first = useBulkCloseConfirmStore.getState().showBulkCloseConfirm({
      type: 'ALL',
      positions,
      combinedPnL: 1.25,
    });
    const second = useBulkCloseConfirmStore.getState().showBulkCloseConfirm({
      type: 'WINNERS',
      positions: positions.slice(0, 1),
      combinedPnL: 2.5,
    });

    await expect(first).resolves.toBe(false);
    useBulkCloseConfirmStore.getState().onConfirm();
    await expect(second).resolves.toBe(true);
  });
});
