import { create } from 'zustand';

interface ConfirmOptions {
    confirmLabel?: string;
    danger?: boolean;
}

interface ConfirmState {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    danger: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    showConfirm: (title: string, message: string, options?: ConfirmOptions) => Promise<boolean>;
    closeConfirm: () => void;
}

export const useConfirmStore = create<ConfirmState>((set) => ({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: '',
    danger: false,
    onConfirm: () => { },
    onCancel: () => { },
    showConfirm: (title, message, options) => {
        return new Promise((resolve) => {
            set({
                isOpen: true,
                title,
                message,
                confirmLabel: options?.confirmLabel ?? '',
                danger: options?.danger ?? false,
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
