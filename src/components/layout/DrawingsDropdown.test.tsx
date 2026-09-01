// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawingManager } from '../../services/drawingManager';
import { DrawingsDropdown } from './DrawingsDropdown';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('DrawingsDropdown', () => {
    it('renders its action sheet through the document body so desktop toolbar overflow cannot clip it', () => {
        const undo = vi.spyOn(drawingManager, 'undo').mockImplementation(() => undefined);
        render(<DrawingsDropdown />);

        const trigger = screen.getByTitle('Drawing Operations');
        fireEvent.click(trigger);

        const menu = screen.getByRole('menu', { name: 'Drawing operations' });
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(menu.parentElement).toBe(document.body);
        expect(menu).toHaveClass('fixed');
        expect(within(menu).getAllByRole('menuitem')).toHaveLength(5);

        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Undo' }));
        expect(undo).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu', { name: 'Drawing operations' })).not.toBeInTheDocument();
    });

    it('preserves the inline confirmation before deleting every drawing', () => {
        const clearAll = vi.spyOn(drawingManager, 'clearAllDrawings').mockImplementation(() => undefined);
        render(<DrawingsDropdown />);

        fireEvent.click(screen.getByTitle('Drawing Operations'));
        const menu = screen.getByRole('menu', { name: 'Drawing operations' });
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete All' }));

        expect(within(menu).getByText('Delete all drawings?')).toBeInTheDocument();
        fireEvent.click(within(menu).getByRole('button', { name: 'Yes' }));
        expect(clearAll).toHaveBeenCalledOnce();
    });
});
