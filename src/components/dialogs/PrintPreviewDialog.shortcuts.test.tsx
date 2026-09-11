import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrintPreviewDialog } from './PrintPreviewDialog';
import { chartPrinter, DEFAULT_PRINT_PREFERENCES } from '../../services/chartPrinter';
import i18n, { i18nReady } from '../../i18n';

beforeEach(async () => {
  await i18nReady;
  await i18n.changeLanguage('en');
  vi.spyOn(chartPrinter, 'generatePrintableHTML').mockReturnValue('<!doctype html><html><body>Preview</body></html>');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const open = (onPrint: () => Promise<void>, options: { isLoading?: boolean; error?: string } = {}) => {
  render(<PrintPreviewDialog onClose={vi.fn()} onPrint={onPrint} preferences={DEFAULT_PRINT_PREFERENCES}
    chartData={{ symbol: 'TEST', timeframe: 'M1', chartCanvas: document.createElement('canvas'), indicators: [], drawings: [] }} {...options} />);
  fireEvent.load(screen.getByTitle('Print Preview'));
  return screen.getByRole('button', { name: 'Close print preview' });
};

it.each([{ ctrlKey: true }, { metaKey: true }])('prints from the focused preview with %j+P without a global print', async modifiers => {
  const print = vi.fn().mockResolvedValue(undefined);
  const globalPrint = vi.fn();
  const target = open(print);
  document.addEventListener('keydown', globalPrint);
  try {
    await act(async () => { expect(fireEvent.keyDown(target, { key: 'p', ...modifiers })).toBe(false); });
    expect(print).toHaveBeenCalledExactlyOnceWith(DEFAULT_PRINT_PREFERENCES);
    expect(globalPrint).not.toHaveBeenCalled();
  } finally { document.removeEventListener('keydown', globalPrint); }
});

it.each([{ isLoading: true }, { error: 'Capture failed' }])('honors disabled print state for both modifier keys: %j', async state => {
  const print = vi.fn().mockResolvedValue(undefined);
  const target = open(print, state);
  expect(screen.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  await act(async () => {
    fireEvent.keyDown(target, { key: 'p', ctrlKey: true });
    fireEvent.keyDown(target, { key: 'p', metaKey: true });
  });
  expect(print).not.toHaveBeenCalled();
});

it('does not open a second print while the first print request is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const print = vi.fn(() => pending);
  const target = open(print);
  await act(async () => {
    fireEvent.keyDown(target, { key: 'p', ctrlKey: true });
    fireEvent.keyDown(target, { key: 'p', metaKey: true });
  });
  expect(print).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Opening print dialog...' })).toBeDisabled();
  await act(async () => { finish(); await pending; });
  expect(screen.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});
