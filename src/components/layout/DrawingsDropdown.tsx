import { Icon } from '../ui/Icon';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drawingManager } from '../../services/drawingManager';
import { ListFilter } from 'lucide-react';

export const DrawingsDropdown: React.FC = () => {
    const isDesktopShell = Boolean(window.electron?.window);
    const [isOpen, setIsOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
    const triggerRef = useRef<HTMLButtonElement>(null);

    const positionMenu = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;

        const rect = trigger.getBoundingClientRect();
        const menuWidth = 208;
        const viewportPadding = 8;
        const left = Math.min(
            Math.max(viewportPadding, rect.right - menuWidth),
            Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding),
        );

        setMenuPosition({ left, top: rect.bottom + 4 });
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) return;

        positionMenu();
        window.addEventListener('resize', positionMenu);
        return () => window.removeEventListener('resize', positionMenu);
    }, [isOpen, positionMenu]);

    const handleAction = (action: string) => {
        switch (action) {
            case 'clear_all':
                drawingManager.clearAllDrawings();
                setConfirmDelete(false);
                break;
            case 'delete_selected':
                drawingManager.deleteSelected();
                break;
            case 'undo':
                drawingManager.undo();
                break;
            case 'redo':
                drawingManager.redo();
                break;
            case 'unselect_all':
                drawingManager.unselectAll();
                break;
        }
        setIsOpen(false);
    };

    const closeMenu = () => {
        setIsOpen(false);
        setConfirmDelete(false);
    };

    const menu = isOpen ? createPortal(
        <>
            <div className="fixed inset-0 z-[10010]" onClick={closeMenu} />
            <div
                className={`rtx-drawing-operations__menu fixed z-[10020] w-52 overflow-hidden rounded border py-1 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150 ${isDesktopShell ? 'rtx-drawing-operations__menu--desktop' : 'border-zinc-800 bg-[#131316]'}`}
                role="menu"
                aria-label="Drawing operations"
                style={menuPosition}
            >
                <DropdownItem
                    icon={<Icon name="trash" size="sm" className="text-red-400" />}
                    label="Delete Selected"
                    onClick={() => handleAction('delete_selected')}
                />

                {/* Delete All — two-click inline confirm (avoids window.confirm which is blocked in Electron) */}
                {!confirmDelete ? (
                    <DropdownItem
                        icon={<Icon name="trash" size="sm" />}
                        label="Delete All"
                        onClick={() => setConfirmDelete(true)}
                    />
                ) : (
                    <div className="flex items-center gap-1 px-3 py-1.5">
                        <span className="text-[12px] font-normal text-red-400 flex-1">Delete all drawings?</span>
                        <button
                            className="px-2 py-0.5 text-[12px] font-normal bg-red-600 hover:bg-red-500 text-white rounded"
                            onClick={() => handleAction('clear_all')}
                        >Yes</button>
                        <button
                            className="px-2 py-0.5 text-[12px] font-normal bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                            onClick={() => setConfirmDelete(false)}
                        >No</button>
                    </div>
                )}

                <div className="h-[1px] bg-zinc-800 my-1 mx-2" />
                <DropdownItem
                    icon={<Icon name="refresh" size="sm" />}
                    label="Undo"
                    onClick={() => handleAction('undo')}
                />
                <DropdownItem
                    icon={<Icon name="refresh" size="sm" style={{ transform: 'scaleX(-1)' }} />}
                    label="Redo"
                    onClick={() => handleAction('redo')}
                />
                <DropdownItem
                    icon={<Icon name="cursor" size="sm" />}
                    label="Unselect All"
                    onClick={() => handleAction('unselect_all')}
                />
            </div>
        </>,
        document.body,
    ) : null;

    return (
        <div className="rtx-drawing-operations relative">
            <button
                ref={triggerRef}
                className="flex items-center gap-1 px-1.5 py-1.5 rounded transition-all text-zinc-400 hover:text-blue-300 hover:bg-blue-500/10 hover:border-blue-500/20"
                onClick={() => { setIsOpen(!isOpen); setConfirmDelete(false); }}
                title="Drawing Operations"
                aria-haspopup="menu"
                aria-expanded={isOpen}
            >
                <ListFilter size={15} />
                <Icon name="chevron-down" size="xs" className="text-zinc-600" />
            </button>
            {menu}
        </div>
    );
};

const DropdownItem = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) => (
    <div
        className="rtx-drawing-operations__item flex min-h-[30px] items-center gap-3 px-3 py-1.5 text-[14px] font-normal text-zinc-300 hover:bg-[#2d2d2d] hover:text-white cursor-pointer transition-colors"
        role="menuitem"
        onClick={onClick}
    >
        <span className="w-4 flex justify-center text-zinc-500">{icon}</span>
        <span>{label}</span>
    </div>
);
