// @vitest-environment jsdom
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryVirtualWindow } from './useHistoryVirtualWindow';

describe('History scroll scheduling', () => {
  let frames: Map<number, FrameRequestCallback>;
  let serial: number;
  const commit = vi.fn();
  const initialReset = {};
  function Harness({ reset = initialReset }: { reset?: unknown }) {
    const { scrollRef, window, onScroll } = useHistoryVirtualWindow(100_000, reset);
    return <Profiler id="rows" onRender={commit}>
      <div ref={scrollRef} onScroll={onScroll} data-testid="scroller">
        <span>{window.startIndex}:{window.endIndex}</span>
      </div>
    </Profiler>;
  }
  const flushFrame = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
  const scrollTo = (offset: number) => {
    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = offset;
    fireEvent.scroll(scroller);
  };
  beforeEach(() => {
    frames = new Map();
    serial = 0;
    commit.mockClear();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++serial, callback);
      return serial;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('coalesces rapid scrolling and renders the latest offset in one frame', () => {
    render(<Harness />);
    scrollTo(300);
    scrollTo(900);
    scrollTo(1500);
    expect(frames.size).toBe(1);
    flushFrame();
    expect(screen.getByText('42:70')).toBeInTheDocument();
  });

  it('does not repaint mounted rows for movement inside the same virtual window', () => {
    render(<Harness />);
    scrollTo(1);
    flushFrame();
    commit.mockClear();
    scrollTo(2);
    scrollTo(5);
    flushFrame();
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels pending old scroll work and returns to the top on filter changes', () => {
    const { rerender, unmount } = render(<Harness />);
    scrollTo(1500);
    flushFrame();
    scrollTo(3000);
    rerender(<Harness reset={{}} />);
    expect(frames.size).toBe(0);
    expect(screen.getByTestId('scroller').scrollTop).toBe(0);
    expect(screen.getByText('0:20')).toBeInTheDocument();
    scrollTo(900);
    unmount();
    expect(frames.size).toBe(0);
  });
});
