// @vitest-environment jsdom
import { useEffect } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_RESOLUTION_PRESETS, useTerminalResolutionStore } from '../../store/useTerminalResolutionStore';
import { TerminalViewport } from './TerminalViewport';

afterEach(() => {
  cleanup();
  useTerminalResolutionStore.getState().setResolution('1920x1080');
  sessionStorage.removeItem('rtx-terminal-resolution');
  vi.restoreAllMocks();
});

describe('terminal resolution', () => {
  it.each(TERMINAL_RESOLUTION_PRESETS)('applies $id and restores Auto without remounting charts', preset => {
    const unmounted = vi.fn();
    const Chart = () => {
      useEffect(() => unmounted, []);
      return <div>Chart</div>;
    };
    const { container } = render(<TerminalViewport role="main"><Chart /></TerminalViewport>);
    expect(screen.getByRole('main')).toHaveStyle({ width: '1920px', height: '1080px' });
    act(() => useTerminalResolutionStore.getState().setResolution(preset.id));
    expect(screen.getByRole('main')).toHaveStyle({ width: `${preset.width}px`, height: `${preset.height}px` });
    expect(container.querySelector('.rtx-terminal-viewport')).toHaveStyle({ overflow: 'auto' });
    expect(screen.getByRole('main').style.transform).toBe('');
    act(() => useTerminalResolutionStore.getState().setResolution('auto'));
    expect(screen.getByRole('main')).toHaveStyle({ width: '100%', height: '100%' });
    expect(unmounted).not.toHaveBeenCalled();
  });

  it('saves only in tab storage and ignores an unsupported saved size', async () => {
    const sharedPreference = localStorage.getItem('rtx-terminal-resolution');
    act(() => useTerminalResolutionStore.getState().setResolution('1920x1080'));
    expect(JSON.parse(sessionStorage.getItem('rtx-terminal-resolution')!).state.resolution).toBe('1920x1080');
    expect(localStorage.getItem('rtx-terminal-resolution')).toBe(sharedPreference);
    sessionStorage.setItem('rtx-terminal-resolution', JSON.stringify({ state: { resolution: '90000x1' }, version: 0 }));
    await act(async () => useTerminalResolutionStore.persist.rehydrate());
    expect(useTerminalResolutionStore.getState().resolution).toBe('1920x1080');
    expect(useTerminalResolutionStore.getState().setResolution).toBeTypeOf('function');
  });

  it('restores the selected size after hydration in this tab', async () => {
    useTerminalResolutionStore.getState().setResolution('1366x768');
    const saved = sessionStorage.getItem('rtx-terminal-resolution')!;
    useTerminalResolutionStore.getState().setResolution('auto');
    sessionStorage.setItem('rtx-terminal-resolution', saved);
    await act(async () => useTerminalResolutionStore.persist.rehydrate());
    render(<TerminalViewport role="main" />);
    expect(screen.getByRole('main')).toHaveStyle({ width: '1366px', height: '768px' });
  });

  it('keeps a fixed height inside the desktop title bar content', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(process.cwd(), 'src/components/layout/DesktopWindowShell.css'), 'utf8');
    document.head.appendChild(style);
    try {
      const { container } = render(<div className="rtx-desktop-shell"><TerminalViewport role="main" className="rtx-app-shell" /></div>);
      act(() => useTerminalResolutionStore.getState().setResolution('1280x720'));
      expect(getComputedStyle(screen.getByRole('main')).height).toBe('720px');
      const viewport = container.querySelector<HTMLElement>('.rtx-terminal-viewport')!;
      viewport.scrollLeft = 20;
      viewport.scrollTop = 30;
      act(() => useTerminalResolutionStore.getState().setResolution('auto'));
      expect(viewport.scrollLeft).toBe(0);
      expect(viewport.scrollTop).toBe(0);
      expect(getComputedStyle(screen.getByRole('main')).height).toBe('100%');
    } finally { style.remove(); }
  });
});
