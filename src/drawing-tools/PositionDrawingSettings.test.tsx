// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Drawing } from './model/drawing';

const update = vi.hoisted(() => vi.fn(() => true));
vi.mock('../services/drawingManager', () => ({ drawingManager: { updateDrawingProperties: update } }));
vi.mock('../store/useAppStore', () => ({ useAppStore: (selector: (state: unknown) => unknown) => selector({ account: { balance: 4321 } }) }));
import { PositionDrawingSettings } from './PositionDrawingSettings';

const drawing = { id: 'position-1', type: 'measure', subtype: 'long_position', points: [{ time: 120, price: 100 }], positionTargetPrice: 110, positionStopPrice: 95 } as Drawing;
beforeEach(() => {
  update.mockClear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
});
afterEach(cleanup);

it('uses the account balance without inventing risk or instrument value, and cancel does not save', () => {
  const close = vi.fn();
  render(<PositionDrawingSettings drawing={drawing} contextId="chart-1" onClose={close} />);
  expect(screen.getByLabelText('Account size')).toHaveValue(4321);
  expect(screen.getByLabelText('Risk')).toHaveValue(null);
  expect(screen.getByLabelText('Point value')).toHaveValue(null);
  fireEvent.click(screen.getByText('Cancel'));
  expect(close).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
});

it('saves sizing and edited prices atomically to the owning chart', () => {
  const close = vi.fn();
  render(<PositionDrawingSettings drawing={drawing} contextId="chart-1" onClose={close} />);
  for (const [label, value] of Object.entries({ 'Account size': '2500', Risk: '2', 'Point value': '10', 'Lot size': '100', Leverage: '20', 'Quantity decimals': '3', 'Entry price': '101', 'Target price': '111', 'Stop price': '96' })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByText('Apply'));
  expect(update).toHaveBeenCalledWith('position-1', {
    points: [{ time: 120, price: 101 }], positionTargetPrice: 111, positionStopPrice: 96,
    positionSizing: { accountSize: 2500, risk: 2, riskMode: 'percent', pointValue: 10, lotSize: 100, leverage: 20, quantityPrecision: 3 },
  }, 'chart-1');
  expect(close).toHaveBeenCalledOnce();
});

it('rejects levels on the wrong side of entry without changing the drawing', () => {
  render(<PositionDrawingSettings drawing={{ ...drawing, positionSizing: { accountSize: 1000, risk: 1, pointValue: 1, lotSize: 1 } }} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Target price'), { target: { value: '90' } });
  fireEvent.click(screen.getByText('Apply'));
  expect(screen.getByRole('alert')).toHaveTextContent('opposite sides of entry');
  expect(update).not.toHaveBeenCalled();
});
