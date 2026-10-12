import { useUiTranslation } from '../hooks/useUiTranslation';
import { useId, useRef, useState, type FormEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useDialogFocusScope } from '../hooks/useDialogFocusScope';
import { ApiError } from '../api/client';
import { tradeApi } from '../api/trade';

interface ChangePasswordDialogProps {
    isOpen: boolean;
    onClose: () => void;
    accountLogin?: string;
}

interface PasswordFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    inputRef?: Ref<HTMLInputElement>;
}

function PasswordField({ id, label, value, onChange, placeholder, inputRef }: PasswordFieldProps) {
    const tr = useUiTranslation();
    const [visible, setVisible] = useState(false);
    const toggleLabel = `${visible ? tr('Hide password') : tr('Show password')}: ${label}`;

    return (
        <div className="space-y-1">
            <label htmlFor={id} className="text-xs text-zinc-400">{label}</label>
            <div className="relative">
                <input
                    id={id}
                    ref={inputRef}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    className={`${visible ? '' : 'rtx-secret-input '}w-full bg-[#0d0d11] border border-zinc-700 rounded pl-3 pr-10 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600`}
                    placeholder={placeholder}
                />
                <button
                    type="button"
                    aria-label={toggleLabel}
                    aria-controls={id}
                    aria-pressed={visible}
                    title={toggleLabel}
                    className="absolute inset-y-0 right-1 flex w-8 items-center justify-center rounded text-zinc-400 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setVisible(current => !current)}
                >
                    {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
            </div>
        </div>
    );
}

export function ChangePasswordDialog({ isOpen, onClose, accountLogin }: ChangePasswordDialogProps) {
    const tr = useUiTranslation();
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [type, setType] = useState<'master' | 'investor'>('master');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const dialogId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const initialFocusRef = useRef<HTMLInputElement>(null);
    useDialogFocusScope({ isOpen: isOpen && Boolean(accountLogin), dialogRef, onClose, initialFocusRef });

    if (!isOpen || !accountLogin || typeof document === 'undefined') return null;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if ((type === 'master' && !oldPassword) || !newPassword || !confirmPassword) {
            setError('Please fill in all fields');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('New passwords do not match');
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccess('');

        try {
            const response = type === 'master'
                ? await tradeApi.auth.changePassword({
                    current_password: oldPassword,
                    new_password: newPassword,
                })
                : await tradeApi.account.setInvestorPassword(accountLogin, {
                    password: newPassword,
                });

            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSuccess(response.message || 'Password changed successfully');
        } catch (err) {
            const message = err instanceof ApiError
                ? err.message
                : err instanceof Error
                    ? err.message
                    : 'Password changes are unavailable';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${dialogId}-title`}
                tabIndex={-1}
                className="rtx-action-sheet bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl flex flex-col w-[400px] max-w-full max-h-[calc(100dvh-32px)] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-[#191a1e]">
                    <h2 id={`${dialogId}-title`} className="min-w-0 break-words text-zinc-200 font-medium">{tr("Change Password - ")}{accountLogin}</h2>
                    <button type="button" onClick={onClose} aria-label={tr("Close")} className="shrink-0 text-zinc-400 hover:text-white transition-colors">
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="min-h-0 overflow-y-auto p-4 space-y-4">
                    <div className="space-y-1">
                        <label htmlFor={`${dialogId}-type`} className="text-xs text-zinc-400">{tr("Password Type")}</label>
                        <select
                            id={`${dialogId}-type`}
                            value={type}
                            onChange={(e) => {
                                setType(e.target.value as 'master' | 'investor');
                                setError('');
                                setSuccess('');
                            }}
                            className="w-full bg-[#0d0d11] border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                        >
                            <option value="master">{tr("Master Password")}</option>
                            <option value="investor">{tr("Investor Password (Read-only)")}</option>
                        </select>
                    </div>

                    {type === 'master' && (
                        <PasswordField
                            key={`${accountLogin}:${type}:current`}
                            id={`${dialogId}-current`}
                            inputRef={initialFocusRef}
                            label={tr("Current Password")}
                            value={oldPassword}
                            onChange={setOldPassword}
                            placeholder={tr("Enter current password")}
                        />
                    )}

                    <PasswordField
                        key={`${accountLogin}:${type}:new`}
                        id={`${dialogId}-new`}
                        inputRef={type === 'investor' ? initialFocusRef : undefined}
                        label={tr("New Password")}
                        value={newPassword}
                        onChange={setNewPassword}
                        placeholder={tr("Enter new password")}
                    />

                    <PasswordField
                        key={`${accountLogin}:${type}:confirm`}
                        id={`${dialogId}-confirm`}
                        label={tr("Confirm New Password")}
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        placeholder={tr("Confirm new password")}
                    />

                    {error && (
                        <div role="alert" className="p-2 bg-red-500/10 border border-red-500/20 text-red-500 text-xs rounded">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div role="status" className="p-2 bg-green-500/10 border border-green-500/20 text-green-500 text-xs rounded">
                            {success}
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? tr("Changing...") : tr("Change Password")}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
