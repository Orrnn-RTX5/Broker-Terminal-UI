import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';

export interface NewChartMenuItem {
    label: string;
    symbol?: string;
    children?: NewChartMenuItem[];
}

interface SymbolMenuProps {
    items: NewChartMenuItem[];
    activeSymbol?: string;
    onSelect: (symbol: string) => void;
    label?: string;
    onBack?: () => void;
    focusFirst?: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function positionSymbolSubmenu(anchor: DOMRect, width: number, height: number, viewportWidth: number, viewportHeight: number) {
    const right = anchor.right - 2;
    return {
        left: clamp(right + width <= viewportWidth - 8 ? right : anchor.left - width + 2, 8, viewportWidth - width - 8),
        top: clamp(anchor.top, 8, viewportHeight - height - 8),
    };
}

function SymbolSubmenu({ anchor, ...props }: SymbolMenuProps & { anchor: HTMLButtonElement }) {
    const popup = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    useLayoutEffect(() => {
        const place = () => {
            const bounds = popup.current?.getBoundingClientRect();
            if (!bounds) return;
            setPosition(positionSymbolSubmenu(anchor.getBoundingClientRect(), bounds.width, bounds.height, window.innerWidth, window.innerHeight));
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [anchor, props.items]);

    // Escape each scroll container, but stay inside FileMenu so the application
    // launcher's outside-click handling and inherited theme still own this menu.
    return createPortal(
        <div ref={popup} data-new-chart-submenu style={{ position: 'fixed', zIndex: 10050, left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
            <NewChartSymbolMenu {...props} focusFirst={Boolean(position) && props.focusFirst} />
        </div>,
        anchor.closest('.rtx-file-menu') ?? document.body,
    );
}

export function NewChartSymbolMenu({ items, activeSymbol, onSelect, label = 'New chart symbols', onBack, focusFirst }: SymbolMenuProps) {
    const tr = useUiTranslation();
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [focusChild, setFocusChild] = useState(false);
    const menu = useRef<HTMLDivElement>(null);
    const buttons = useRef<Array<HTMLButtonElement | null>>([]);
    useLayoutEffect(() => {
        if (focusFirst) buttons.current[0]?.focus();
    }, [focusFirst]);
    return <div ref={menu} role="menu" aria-label={tr(label)}
        className="rtx-menu-surface py-1 overflow-y-auto no-scrollbar"
        style={{ width: 220, maxWidth: 'calc(100vw - 16px)', maxHeight: 'min(420px, calc(100vh - 16px))' }}
        onKeyDown={event => {
            const index = buttons.current.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            let next: number | null = null;
            if (event.key === 'ArrowDown') next = (index + 1) % items.length;
            if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = items.length - 1;
            if (next !== null) { event.preventDefault(); event.stopPropagation(); buttons.current[next]?.focus(); }
            if (event.key === 'ArrowLeft' && onBack) { event.preventDefault(); event.stopPropagation(); onBack(); }
        }}>
        {items.map((item, index) => {
            const hasChildren = Boolean(item.children?.length);
            const selected = Boolean(item.symbol && item.symbol === activeSymbol);
            return <div key={`${item.symbol ?? item.label}:${index}`} className="px-1"
                onMouseEnter={() => { setOpenIndex(hasChildren ? index : null); setFocusChild(false); }}>
                <button ref={element => { buttons.current[index] = element; }} type="button" role="menuitem"
                    aria-haspopup={hasChildren ? 'menu' : undefined} aria-expanded={hasChildren ? openIndex === index : undefined}
                    onClick={() => {
                        if (hasChildren) { setOpenIndex(index); setFocusChild(false); }
                        else if (item.symbol) onSelect(item.symbol);
                    }}
                    onKeyDown={event => {
                        if (hasChildren && event.key === 'ArrowRight') {
                            event.preventDefault(); event.stopPropagation(); setOpenIndex(index); setFocusChild(true);
                        }
                    }}
                    className={`w-full flex min-h-[30px] items-center gap-2 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left cursor-default ${selected
                        ? 'text-emerald-400 [.rtx-advanced-view_&]:text-emerald-600 bg-emerald-500/10 [.rtx-advanced-view_&]:bg-emerald-50'
                        : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'}`}>
                    <span aria-hidden="true" className="w-3 text-[10px] flex-none">{selected ? '✓' : ''}</span>
                    <span className="flex-1 font-mono">{item.symbol ? item.label : tr(item.label)}</span>
                    {hasChildren && <Icon name="chevron-right" size="xs" className="rtx-menu-icon--neutral" />}
                </button>
                {hasChildren && openIndex === index && buttons.current[index] && <SymbolSubmenu
                    anchor={buttons.current[index]!} items={item.children!} activeSymbol={activeSymbol} onSelect={onSelect}
                    label={tr("{{value0}} symbols", { value0: item.label })} focusFirst={focusChild}
                    onBack={() => { setOpenIndex(null); buttons.current[index]?.focus(); }}
                />}
            </div>;
        })}
    </div>;
}
