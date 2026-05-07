import { Icon } from '../ui/Icon';
import React, { useState } from 'react';
import { drawingManager } from '../../services/drawingManager';
import { ListFilter } from 'lucide-react';

export const DrawingsDropdown: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

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

    return (
        <div className="relative">
            <button
                className="flex items-center gap-1 px-1.5 py-1.5 rounded transition-all text-zinc-400 hover:text-blue-300 hover:bg-blue-500/10 hover:border-blue-500/20"
                onClick={() => { setIsOpen(!isOpen); setConfirmDelete(false); }}
                title="Drawing Operations"
            >
                <ListFilter size={15} />
                <Icon name="chevron-down" size="xs" className="text-zinc-600" />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-[90]"
                        onClick={() => { setIsOpen(false); setConfirmDelete(false); }}
                    />
                    <div className="absolute top-full right-0 mt-1 w-52 bg-[#131316] border border-zinc-800 rounded shadow-2xl z-[100] py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
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
                                <span className="text-[10px] text-red-400 flex-1">Delete all drawings?</span>
                                <button
                                    className="px-2 py-0.5 text-[10px] bg-red-600 hover:bg-red-500 text-white rounded"
                                    onClick={() => handleAction('clear_all')}
                                >Yes</button>
                                <button
                                    className="px-2 py-0.5 text-[10px] bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
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
                </>
            )}
        </div>
    );
};

const DropdownItem = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) => (
    <div
        className="flex items-center gap-3 px-3 py-2 text-[11px] text-zinc-300 hover:bg-[#2d2d2d] hover:text-white cursor-pointer transition-colors"
        onClick={onClick}
    >
        <span className="w-4 flex justify-center text-zinc-500">{icon}</span>
        <span>{label}</span>
    </div>
);
