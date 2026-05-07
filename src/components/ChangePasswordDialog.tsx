import { useState, FormEvent } from 'react';
import { api } from '../services/api';

interface ChangePasswordDialogProps {
    isOpen: boolean;
    onClose: () => void;
    accountLogin?: string;
}

export function ChangePasswordDialog({ isOpen, onClose, accountLogin }: ChangePasswordDialogProps) {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [type, setType] = useState<'master' | 'investor'>('master');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    if (!isOpen || !accountLogin) return null;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!oldPassword || !newPassword || !confirmPassword) {
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
            const loginNum = parseInt(accountLogin, 10);
            const res = await api.mt5.changePassword(loginNum, oldPassword, newPassword, type);

            if (res.success) {
                setSuccess(res.message || 'Password changed successfully');
                // Clear form
                setOldPassword('');
                setNewPassword('');
                setConfirmPassword('');

                // Auto-close after success
                setTimeout(() => {
                    onClose();
                    setSuccess('');
                }, 2000);
            } else {
                setError(res.message || 'Failed to change password');
            }
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'An error occurred while changing password');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-[400px] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#191a1e]">
                    <h2 className="text-zinc-200 font-medium">Change Password - {accountLogin}</h2>
                    <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs text-zinc-400">Password Type</label>
                        <select
                            value={type}
                            onChange={(e) => setType(e.target.value as 'master' | 'investor')}
                            className="w-full bg-[#0d0d11] border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                        >
                            <option value="master">Master Password</option>
                            <option value="investor">Investor Password (Read-only)</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-zinc-400">Current Password</label>
                        <input
                            type="password"
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            className="w-full bg-[#0d0d11] border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                            placeholder="Enter current password"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-zinc-400">New Password</label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full bg-[#0d0d11] border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                            placeholder="Enter new password"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-zinc-400">Confirm New Password</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full bg-[#0d0d11] border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                            placeholder="Confirm new password"
                        />
                    </div>

                    {error && (
                        <div className="p-2 bg-red-500/10 border border-red-500/20 text-red-500 text-xs rounded">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="p-2 bg-green-500/10 border border-green-500/20 text-green-500 text-xs rounded">
                            {success}
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-medium py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Changing...' : 'Change Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
