// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from './EmojiPicker';
import { getPictographItems, getPictographStamp, PICTOGRAPH_CATEGORIES } from './pictographCatalog';

afterEach(cleanup);

describe('EmojiPicker', () => {
  it('defers offscreen artwork while preserving category jumps and scrolling', () => {
    const originalObserver = globalThis.IntersectionObserver;
    let onIntersect!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) { onIntersect = callback; }
      observe() {}
      disconnect = disconnect;
    } as unknown as typeof IntersectionObserver;
    try {
      const { container, unmount } = render(<EmojiPicker onSelect={vi.fn()} />);
      const food = container.querySelector<HTMLElement>('[data-category="food"]')!;
      const grid = food.querySelector<HTMLElement>('.drawing-emoji-picker__grid')!;
      expect(grid.querySelectorAll('img')).toHaveLength(0);
      const reservedHeight = grid.style.minHeight;
      expect(Number.parseFloat(reservedHeight)).toBeGreaterThan(0);
      const bounds = food.getBoundingClientRect();
      act(() => onIntersect([{
        target: food,
        isIntersecting: true,
        boundingClientRect: bounds,
        intersectionRatio: 1,
        intersectionRect: bounds,
        rootBounds: null,
        time: 0,
      }], {} as IntersectionObserver));
      expect(grid.querySelectorAll('img')).toHaveLength(getPictographItems('emojis', 'food').length);
      expect(grid.style.minHeight).toBe(reservedHeight);

      const flags = container.querySelector('[data-category="flags"]')!;
      expect(flags.querySelectorAll('img')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Flags' }));
      expect(flags.querySelectorAll('img')).toHaveLength(getPictographItems('emojis', 'flags').length);
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      globalThis.IntersectionObserver = originalObserver;
    }
  });

  it('waits for the positioned portal to become visible before moving focus', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<EmojiPicker ready={false} onSelect={onSelect} />);
    const firstCategory = screen.getByRole('button', { name: 'Smileys & people' });
    expect(firstCategory).not.toHaveFocus();
    rerender(<EmojiPicker ready onSelect={onSelect} />);
    expect(firstCategory).toHaveFocus();
  });

  it('opens with category controls, local artwork, and working format tabs', () => {
    render(<EmojiPicker onSelect={vi.fn()} />);
    const categories = screen.getByRole('toolbar', { name: 'Emoji categories' });
    expect(within(categories).getAllByRole('button')).toHaveLength(8);
    expect(within(categories).getByRole('button', { name: 'Smileys & people' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Emojis' })).toHaveAttribute('aria-selected', 'true');
    for (const image of screen.getByRole('tabpanel').querySelectorAll('img')) {
      // Bundled same-origin artwork or inline data URIs only — never a remote host.
      expect(image.getAttribute('src')).toMatch(/^(?:data:image\/svg\+xml|(?!\/\/|https?:).*\.svg(?:[?#]|$))/);
      expect(image).toHaveAttribute('draggable', 'false');
    }
    for (const label of ['Stickers', 'Icons', 'Emojis']) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
      expect(within(screen.getByRole('tabpanel')).getAllByRole('button').length).toBeGreaterThan(0);
    }
  });

  it.each(['emojis', 'stickers', 'icons'] as const)('selects the exact %s catalog entry', tab => {
    const onSelect = vi.fn();
    const category = PICTOGRAPH_CATEGORIES.find(item => getPictographItems(tab, item.id).length > 0)!;
    const item = getPictographItems(tab, category.id)[0];
    const { container } = render(<EmojiPicker selectedSubtype={item.id} onSelect={onSelect} />);
    const button = container.querySelector<HTMLButtonElement>(`[data-pictograph-id="${item.id}"]`)!;
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(item.id);
    expect(getPictographStamp(item.id)?.assetUrl).toBe(button.querySelector('img')?.getAttribute('src'));
  });

  it('supports category, grid, and footer keyboard navigation without selecting a drawing early', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker onSelect={onSelect} />);
    const categories = screen.getByRole('toolbar', { name: 'Emoji categories' });
    const firstCategory = within(categories).getByRole('button', { name: 'Smileys & people' });
    fireEvent.keyDown(firstCategory, { key: 'ArrowRight' });
    expect(within(categories).getByRole('button', { name: 'Animals & nature' })).toHaveFocus();
    expect(within(categories).getByRole('button', { name: 'Animals & nature' })).toHaveAttribute('aria-pressed', 'true');
    const buttons = within(screen.getByRole('tabpanel')).getAllByRole('button');
    act(() => buttons[0].focus());
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    expect(buttons[1]).toHaveFocus();
    const emojis = screen.getByRole('tab', { name: 'Emojis' });
    emojis.focus();
    fireEvent.keyDown(emojis, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Stickers' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Stickers' })).toHaveAttribute('aria-selected', 'true');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
