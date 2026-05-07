import { create } from 'zustand';

interface ConfirmState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    showConfirm: (title: string, message: string) => Promise<boolean>;
    closeConfirm: () => void;
}

export const useConfirmStore = create<ConfirmState>((set) => ({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { },
    onCancel: () => { },
    showConfirm: (title, message) => {
        return new Promise((resolve) => {
            set({
                isOpen: true,
                title,
                message,
                onConfirm: () => {
                    set({ isOpen: false });
                    resolve(true);
                },
                onCancel: () => {
                    set({ isOpen: false });
                    resolve(false);
                }
            });
        });
    },
    closeConfirm: () => set({ isOpen: false })
}));
