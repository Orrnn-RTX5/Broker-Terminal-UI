import { lazy, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetainedLazyFeature } from '../startup/RetainedLazyFeature';
import { useTemplateStore } from '../store/useTemplateStore';

vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (text: string) => text }));

const ChartTemplateDialog = lazy(() => import('./ChartTemplateDialog')
  .then(module => ({ default: module.ChartTemplateDialog })));

const currentConfig = {
  chartType: 'candlestick' as const,
  timeframe: 'M1' as const,
  showGrid: true,
  showVolumes: false,
  indicators: [],
  drawingTools: [],
  colors: {
    background: '#000000',
    grid: '#2b2b2b',
    candle: { up: '#26a69a', down: '#ef5350', border: '#378658' },
    volume: { up: '#26a69a', down: '#ef5350' },
  },
};
const initialTemplates = useTemplateStore.getState().templates;

function TemplateHost() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'save' | 'load'>('save');
  return <>
    <button onClick={() => { setMode('load'); setOpen(true); }}>Open Load</button>
    <button onClick={() => { setMode('save'); setOpen(true); }}>Open Save</button>
    <RetainedLazyFeature active={open}>
      <ChartTemplateDialog isOpen={open} mode={mode} onClose={() => setOpen(false)} currentConfig={currentConfig} />
    </RetainedLazyFeature>
  </>;
}

async function openFirstDialog(name: 'Open Load' | 'Open Save') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await vi.dynamicImportSettled();
  });
}

beforeEach(() => {
  useTemplateStore.setState({ templates: [] });
});

afterEach(() => {
  cleanup();
  useTemplateStore.setState({ templates: initialTemplates });
});

describe('retained lazy chart templates', () => {
  it('allows saving when the first mounted dialog was Load', async () => {
    render(<TemplateHost />);
    expect(screen.queryByRole('heading')).toBeNull();
    await openFirstDialog('Open Load');
    expect(screen.getByRole('heading', { name: 'Load Chart Template' })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Save' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'After loading' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    expect(useTemplateStore.getState().templates).toEqual([
      expect.objectContaining({ ...currentConfig, name: 'After loading' }),
    ]);
    expect(screen.queryByRole('heading', { name: 'Save Chart Template' })).toBeNull();
  });

  it('retains an unsaved name through close and load-mode visits', async () => {
    render(<TemplateHost />);
    await openFirstDialog('Open Save');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unfinished draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Load' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Save' }));

    expect(screen.getByRole('textbox')).toHaveValue('Unfinished draft');
    expect(useTemplateStore.getState().templates).toHaveLength(0);
  });

  it('shows an empty save form again after a successful save', async () => {
    render(<TemplateHost />);
    await openFirstDialog('Open Save');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Save' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second template' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(useTemplateStore.getState().templates.map(template => template.name)).toEqual([
      'First template', 'Second template',
    ]);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
