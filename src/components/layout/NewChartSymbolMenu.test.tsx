// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewChartSymbolMenu, positionSymbolSubmenu, type NewChartMenuItem } from './NewChartSymbolMenu';

const items: NewChartMenuItem[] = [
    { label: 'Forex', children: [{ label: 'Majors', children: [
        { label: 'Euro / US Dollar', symbol: 'EURUSD.r' },
        { label: 'GBPUSD', symbol: 'GBPUSD' },
    ] }] },
    { label: 'Metals', children: [{ label: 'Gold', symbol: 'XAUUSD' }] },
];
afterEach(cleanup);
const setup = () => {
    const onSelect = vi.fn();
    const result = render(<div className="rtx-file-menu"><NewChartSymbolMenu items={items} activeSymbol="EURUSD.r" onSelect={onSelect} /></div>);
    return { ...result, onSelect };
};

describe('New Chart symbol folders', () => {
    it('opens folders by click and renders the list outside its scrolling ancestor', () => {
        const { container } = setup();
        const root = screen.getByRole('menu', { name: 'New chart symbols' });
        const forex = screen.getByRole('menuitem', { name: 'Forex' });
        fireEvent.click(forex);
        const child = screen.getByRole('menu', { name: 'Forex symbols' });
        expect(forex).toHaveAttribute('aria-expanded', 'true');
        expect(root).not.toContainElement(child);
        expect(container.querySelector('.rtx-file-menu')).toContainElement(child);
        expect(child.parentElement).toHaveStyle({ position: 'fixed', visibility: 'visible' });
    });
    it('opens arbitrary nesting and selects the exact broker symbol instead of its display label', () => {
        const { onSelect } = setup();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Forex' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Majors' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Euro / US Dollar' }));
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('EURUSD.r');
    });
    it('supports hover and closes the previous sibling folder', () => {
        setup();
        fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Forex' }).parentElement!);
        expect(screen.getByRole('menu', { name: 'Forex symbols' })).toBeVisible();
        fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Metals' }).parentElement!);
        expect(screen.queryByRole('menu', { name: 'Forex symbols' })).not.toBeInTheDocument();
        expect(screen.getByRole('menu', { name: 'Metals symbols' })).toBeVisible();
    });
    it('supports arrow-key entry, navigation, and return to the folder', () => {
        setup();
        const forex = screen.getByRole('menuitem', { name: 'Forex' });
        forex.focus(); fireEvent.keyDown(forex, { key: 'ArrowRight' });
        const majors = screen.getByRole('menuitem', { name: 'Majors' });
        expect(majors).toHaveFocus();
        fireEvent.keyDown(majors, { key: 'ArrowRight' });
        const euro = screen.getByRole('menuitem', { name: 'Euro / US Dollar' });
        expect(euro).toHaveFocus();
        fireEvent.keyDown(euro, { key: 'ArrowDown' });
        const pound = screen.getByRole('menuitem', { name: 'GBPUSD' });
        expect(pound).toHaveFocus();
        fireEvent.keyDown(pound, { key: 'ArrowLeft' });
        expect(majors).toHaveFocus();
        expect(screen.queryByRole('menu', { name: 'Majors symbols' })).not.toBeInTheDocument();
    });
    it('keeps long broker lists complete and scrollable', () => {
        render(<div className="rtx-file-menu"><NewChartSymbolMenu items={[{ label: 'Forex', children: Array.from({ length: 150 }, (_, index) => ({ label: `Pair ${index}`, symbol: `PAIR${index}` })) }]} onSelect={vi.fn()} /></div>);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Forex' }));
        const folder = screen.getByRole('menu', { name: 'Forex symbols' });
        expect(within(folder).getAllByRole('menuitem')).toHaveLength(150);
        expect(folder).toHaveClass('overflow-y-auto');
    });
    it('flips left at the viewport edge and clamps a tall list vertically', () => {
        const anchor = { left: 690, right: 870, top: 600 } as DOMRect;
        expect(positionSymbolSubmenu(anchor, 220, 420, 882, 778)).toEqual({ left: 472, top: 350 });
        expect(positionSymbolSubmenu({ left: 500, right: 720, top: 120 } as DOMRect, 220, 100, 1920, 1080)).toEqual({ left: 718, top: 120 });
    });
});
